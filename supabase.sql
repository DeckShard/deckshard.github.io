-- Night City Deck — schema del database (Supabase / Postgres)
-- Da incollare una volta in Supabase → SQL Editor → New query → Run.
-- Si può rieseguire: crea solo ciò che manca e riscrive funzioni e regole.
--
-- Contiene: profili pubblici, dati sincronizzati tra dispositivi, amicizie,
-- blocchi, messaggi privati tra amici, segnalazioni, feedback anonimo.
-- Ogni tabella ha la Row Level Security attiva: la chiave pubblica dell'app
-- può fare solo ciò che queste regole permettono.

create extension if not exists citext;

-- ---------------------------------------------------------------- profili pubblici
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nick citext not null unique
    check (char_length(nick) between 3 and 24 and nick ~ '^[A-Za-z0-9_.-]+$'),
  avatar jsonb not null default '{}'::jsonb,        -- { img, pos, zoom, fav }
  faction text check (faction is null or char_length(faction) <= 24),
  lifepath text check (lifepath is null or char_length(lifepath) <= 24),
  wins int not null default 0 check (wins >= 0),
  losses int not null default 0 check (losses >= 0),
  show_collection boolean not null default false,   -- gli amici possono vedere la collezione
  dm_open boolean not null default true,            -- accetta messaggi dagli amici
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- un profilo per ogni nuovo account, con un nick provvisorio da cambiare
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nick) values (new.id, 'choom_' || substr(replace(new.id::text, '-', ''), 1, 8))
  on conflict (id) do nothing;
  insert into public.user_data (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------- dati sincronizzati (collezione, mazzi, impostazioni…)
create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  coll jsonb not null default '{}'::jsonb,
  decks jsonb not null default '[]'::jsonb,
  profile jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  record jsonb not null default '{}'::jsonb,
  stamps jsonb not null default '{}'::jsonb,        -- ultimo aggiornamento di ogni sezione (ms, dal dispositivo)
  updated_at timestamptz not null default now(),
  check (pg_column_size(coll) + pg_column_size(decks) + pg_column_size(profile) + pg_column_size(settings) + pg_column_size(record) < 2000000)
);
alter table public.user_data enable row level security;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- amicizie e blocchi
create table if not exists public.friendships (
  a uuid not null references public.profiles(id) on delete cascade,   -- chi chiede
  b uuid not null references public.profiles(id) on delete cascade,   -- chi riceve
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (a, b),
  check (a <> b)
);
create unique index if not exists friendships_pair on public.friendships (least(a, b), greatest(a, b));
alter table public.friendships enable row level security;

create table if not exists public.blocks (
  blocker uuid not null references public.profiles(id) on delete cascade,
  blocked uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.blocks enable row level security;

create or replace function public.are_friends(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships where status = 'accepted' and ((a = x and b = y) or (a = y and b = x)))
$$;
create or replace function public.is_blocked(x uuid, y uuid) returns boolean   -- in una delle due direzioni
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker = x and blocked = y) or (blocker = y and blocked = x))
$$;

-- ---------------------------------------------------------------- messaggi privati (solo tra amici)
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  sender uuid not null references public.profiles(id) on delete cascade,
  recipient uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists messages_recipient on public.messages (recipient, created_at desc);
create index if not exists messages_sender on public.messages (sender, created_at desc);
alter table public.messages enable row level security;

-- limite anti-spam: al massimo 20 messaggi al minuto per account
create or replace function public.messages_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from messages where sender = new.sender and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'troppi messaggi: aspetta un momento' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists messages_rate on public.messages;
create trigger messages_rate before insert on public.messages for each row execute function public.messages_rate_limit();

-- ---------------------------------------------------------------- segnalazioni e feedback (leggibili solo dal pannello di Supabase)
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter uuid not null references public.profiles(id) on delete cascade,
  reported uuid not null references public.profiles(id) on delete cascade,
  message_id bigint references public.messages(id) on delete set null,
  message_body text,                                -- copia del messaggio, resta anche se viene cancellato
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;

create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  kind text not null default 'idea' check (kind in ('bug', 'idea', 'altro')),
  body text not null check (char_length(body) between 3 and 2000),
  contact text check (contact is null or char_length(contact) <= 120),   -- facoltativo, solo se chi scrive vuole una risposta
  app_version text check (app_version is null or char_length(app_version) <= 20),
  lang text check (lang is null or char_length(lang) <= 5),
  device text check (device is null or char_length(device) <= 200),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;

create or replace function public.feedback_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from feedback where created_at > now() - interval '1 hour') >= 60 then
    raise exception 'troppi feedback in questo momento, riprova più tardi' using errcode = 'P0001';
  end if;
  new.user_id := auth.uid();                        -- mai dal client
  return new;
end $$;
drop trigger if exists feedback_rate on public.feedback;
create trigger feedback_rate before insert on public.feedback for each row execute function public.feedback_rate_limit();

-- ---------------------------------------------------------------- regole di accesso (RLS)
-- profili: leggibili da chi ha un account; ognuno modifica solo il proprio
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- dati sincronizzati: solo i propri
drop policy if exists user_data_own on public.user_data;
create policy user_data_own on public.user_data for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- amicizie e blocchi: si leggono le proprie; si modificano solo con le funzioni qui sotto
drop policy if exists friendships_read on public.friendships;
create policy friendships_read on public.friendships for select to authenticated using (auth.uid() in (a, b));
drop policy if exists blocks_read on public.blocks;
create policy blocks_read on public.blocks for select to authenticated using (blocker = auth.uid());

-- messaggi: si leggono i propri; si scrive solo a un amico che non ci ha bloccato e accetta messaggi
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using (auth.uid() in (sender, recipient));
drop policy if exists messages_send on public.messages;
create policy messages_send on public.messages for insert to authenticated with check (
  sender = auth.uid() and read_at is null
  and public.are_friends(sender, recipient)
  and not public.is_blocked(sender, recipient)
  and coalesce((select dm_open from public.profiles where id = recipient), false)
);

-- segnalazioni: si inviano, non si leggono
drop policy if exists reports_send on public.reports;
create policy reports_send on public.reports for insert to authenticated with check (reporter = auth.uid());

-- feedback: chiunque può inviarlo, anche senza account; nessuno lo legge dall'app
drop policy if exists feedback_send on public.feedback;
create policy feedback_send on public.feedback for insert to anon, authenticated with check (true);

-- niente permessi diretti oltre a quelli delle regole (Supabase di base concede tutto ad anon e authenticated)
revoke all on public.profiles, public.user_data, public.friendships, public.blocks, public.messages, public.reports, public.feedback from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (nick, avatar, faction, lifepath, wins, losses, show_collection, dm_open, updated_at) on public.profiles to authenticated;
grant select, insert, update on public.user_data to authenticated;
grant select on public.friendships, public.blocks to authenticated;
grant select, insert on public.messages to authenticated;
grant insert on public.reports to authenticated;
grant insert on public.feedback to anon, authenticated;
grant usage on all sequences in schema public to anon, authenticated;

-- ---------------------------------------------------------------- funzioni chiamate dall'app
-- amicizia: richiesta per nick
create or replace function public.friend_request(target_nick text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t uuid;
begin
  if me is null then raise exception 'serve un account'; end if;
  select id into t from profiles where nick = target_nick::citext;
  if t is null then return 'not_found'; end if;
  if t = me then return 'self'; end if;
  if is_blocked(me, t) then return 'not_found'; end if;   -- chi ci ha bloccato non si fa trovare
  if exists (select 1 from friendships where status = 'accepted' and ((a = me and b = t) or (a = t and b = me))) then return 'already'; end if;
  -- se l'altro ci aveva già chiesto l'amicizia, accettarla
  if exists (select 1 from friendships where a = t and b = me and status = 'pending') then
    update friendships set status = 'accepted', accepted_at = now() where a = t and b = me;
    return 'accepted';
  end if;
  insert into friendships (a, b) values (me, t) on conflict do nothing;
  return 'sent';
end $$;

-- risposta a una richiesta ricevuta
create or replace function public.friend_respond(other uuid, accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if accept then
    update friendships set status = 'accepted', accepted_at = now() where a = other and b = me and status = 'pending';
  else
    delete from friendships where a = other and b = me and status = 'pending';
  end if;
end $$;

-- togliere un amico o ritirare una richiesta
create or replace function public.friend_remove(other uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  delete from friendships where (a = me and b = other) or (a = other and b = me);
end $$;

-- blocco: toglie anche l'amicizia; sblocco
create or replace function public.block_user(other uuid, on_off boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or other = me then return; end if;
  if on_off then
    insert into blocks (blocker, blocked) values (me, other) on conflict do nothing;
    delete from friendships where (a = me and b = other) or (a = other and b = me);
  else
    delete from blocks where blocker = me and blocked = other;
  end if;
end $$;

-- lista amici e richieste, con i messaggi non letti
create or replace function public.friends_list() returns table (
  id uuid, nick citext, avatar jsonb, faction text, wins int, losses int, show_collection boolean,
  status text, incoming boolean, unread int, last_message_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.nick, p.avatar, p.faction, p.wins, p.losses, p.show_collection,
         f.status, (f.b = auth.uid()) as incoming,
         (select count(*)::int from messages m where m.sender = p.id and m.recipient = auth.uid() and m.read_at is null),
         (select max(m.created_at) from messages m where (m.sender = p.id and m.recipient = auth.uid()) or (m.sender = auth.uid() and m.recipient = p.id))
  from friendships f
  join profiles p on p.id = case when f.a = auth.uid() then f.b else f.a end
  where auth.uid() in (f.a, f.b)
  order by f.status desc, p.nick
$$;

-- ricerca giocatori per nick (esclude se stessi e chi ci ha bloccato)
create or replace function public.search_players(q text) returns table (id uuid, nick citext, avatar jsonb, faction text, wins int, losses int)
language sql stable security definer set search_path = public as $$
  select p.id, p.nick, p.avatar, p.faction, p.wins, p.losses from profiles p
  where char_length(q) >= 2 and p.nick ilike replace(replace(q, '%', ''), '_', '\_') || '%'
    and p.id <> auth.uid() and not exists (select 1 from blocks where blocker = p.id and blocked = auth.uid())
  order by p.nick limit 20
$$;

-- segna come letti i messaggi ricevuti da un amico
create or replace function public.mark_read(other uuid) returns void
language sql security definer set search_path = public as $$
  update messages set read_at = now() where sender = other and recipient = auth.uid() and read_at is null
$$;

-- collezione di un amico, se ha scelto di mostrarla
create or replace function public.friend_collection(other uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select d.coll from user_data d join profiles p on p.id = d.user_id
  where d.user_id = other and p.show_collection and public.are_friends(auth.uid(), other)
$$;

-- segnalazione di un messaggio o di un giocatore
create or replace function public.report_user(other uuid, msg bigint default null, why text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into reports (reporter, reported, message_id, message_body, reason)
  values (auth.uid(), other, msg, (select body from messages where id = msg and auth.uid() in (sender, recipient)), left(why, 500));
end $$;

-- cancellazione dell'account con tutti i dati (profilo, amicizie, messaggi, dati sincronizzati)
create or replace function public.delete_me() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then return; end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.handle_new_user(), public.messages_rate_limit(), public.feedback_rate_limit() from public, anon, authenticated;
revoke all on function public.friend_request(text), public.friend_respond(uuid, boolean), public.friend_remove(uuid),
  public.block_user(uuid, boolean), public.friends_list(), public.search_players(text), public.mark_read(uuid),
  public.friend_collection(uuid), public.report_user(uuid, bigint, text), public.delete_me(),
  public.are_friends(uuid, uuid), public.is_blocked(uuid, uuid) from public, anon;
grant execute on function public.friend_request(text), public.friend_respond(uuid, boolean), public.friend_remove(uuid),
  public.block_user(uuid, boolean), public.friends_list(), public.search_players(text), public.mark_read(uuid),
  public.friend_collection(uuid), public.report_user(uuid, bigint, text), public.delete_me(),
  public.are_friends(uuid, uuid), public.is_blocked(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- tempo reale: messaggi, amicizie e dati sincronizzati arrivano subito
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friendships') then
    alter publication supabase_realtime add table public.friendships;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'user_data') then
    alter publication supabase_realtime add table public.user_data;   -- un altro dispositivo salva → questo si aggiorna
  end if;
end $$;

-- ---------------------------------------------------------------- funzione per tenere sveglio il progetto (chiamata dal workflow notturno)
create or replace function public.ping() returns text language sql stable as $$ select 'ok'::text $$;
grant execute on function public.ping() to anon, authenticated;
