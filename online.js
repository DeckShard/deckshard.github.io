/* Tavoli online: due giocatori, un codice di 4 caratteri o una sfida diretta a un amico.
   Una partita è seme + mazzi + elenco ordinato di mosse (tabella game_moves): ogni
   telefono applica le stesse mosse con lo stesso motore e ottiene lo stesso stato.
   Il database accetta una mossa solo se è la successiva (seq = mosse + 1), quindi
   l'ordine è unico; in caso di conflitto (es. i due mulligan insieme) si ricostruisce
   la partita dal registro. Ogni 10 secondi un «sono qui»: chi tace per più di un
   minuto perde.                                                                  */

import { client, state as cloud } from "./cloud.js";
import { kitOf } from "./prerelease.js";

const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
let VER = "";
export const setOnlineVersion = v => { VER = v || ""; };

/* stato del tavolo seguito da questo telefono */
export const T = {
  row: null,          // riga di game_tables
  seat: null,         // 0 = host, 1 = ospite
  nicks: ["", ""],
  applied: 0,         // mosse già applicate alla partita locale
  inflight: 0,        // mosse inviate e non ancora confermate
  otherIdle: 0, idleAt: 0,
  ended: null,        // { result: "host"|"guest"|"draw", reason }
  drawOffer: null,
  chat: [], chatUnread: 0,
  stamps: [],         // orario di ogni mossa (indice = seq - 1)
  error: null
};
let hooks = { move: () => {}, rebuild: () => {}, start: () => {}, end: () => {}, lost: () => {} };
export const setOnlineHooks = h => { hooks = { ...hooks, ...h }; };

const rpc = async (fn, args) => { const c = await client(); if(!c) throw new Error("Serve un account"); const { data, error } = await c.rpc(fn, args); if(error) throw new Error(error.message); return data; };
export const signedIn = () => !!(cloud.user);
export const myId = () => cloud.user && cloud.user.id;

/* il mazzo che viaggia nel database: solo ciò che serve al motore */
export const deckPayload = d => ({ name: (d.name || "").slice(0, 60), format: d.format === "sealed" ? "sealed" : "built", ...(d.format === "sealed" ? (d.draft ? { draft: { set: d.draft.set, seed: d.draft.seed, picks: d.draft.picks } } : { kit: kitOf(d) }) : {}),
  legends: (d.legends || []).filter(Boolean).map(l => ({ cid: l.cid, pid: l.pid })), cards: (d.cards || []).filter(e => e.n > 0).map(e => ({ cid: e.cid, pid: e.pid, n: e.n })) });

/* ------------------------------------------------------------ lobby */
export let tables = [];
export async function refreshTables(){
  if(!signedIn()){ tables = []; emit("ncd:tables"); return tables; }
  try{ tables = (await rpc("my_tables")) || []; }catch(e){ T.error = e.message; }
  emit("ncd:tables");
  return tables;
}
export const invitesForMe = () => tables.filter(t => t.status === "waiting" && t.invited === myId() && t.host !== myId() && Date.now() - new Date(t.created_at).getTime() < 30 * 60000);
export const activeTables = () => tables.filter(t => t.status === "active");
export const myWaiting = () => tables.find(t => t.status === "waiting" && t.host === myId());

export async function createTable(deck, autopay, inviteId, opts){
  const row = await rpc("create_table", { deck: deckPayload(deck), autopay: !!autopay, invite: inviteId || null, p_ver: VER, p_opts: inviteId ? null : (opts || null) });
  await attach(row, 0);
  refreshTables();
  return row;
}
export async function joinTable(code, deck, autopay){
  const row = await rpc("join_table", { p_code: (code || "").trim().toUpperCase(), deck: deckPayload(deck), autopay: !!autopay, p_ver: VER });
  await attach(row, 1);
  refreshTables();
  return row;
}
export async function cancelTable(id){ await rpc("cancel_table", { t: id }); if(T.row && T.row.id === id) detach(); await refreshTables(); }

/* riprende un tavolo (dopo un riavvio dell'app o da un altro dispositivo) */
export async function resumeTable(id){
  const c = await client();
  const { data, error } = await c.from("game_tables").select("*").eq("id", id).maybeSingle();
  if(error) throw new Error(error.message);
  if(!data) throw new Error("Tavolo non trovato");
  await attach(data, data.host === myId() ? 0 : 1);
  return data;
}

/* ------------------------------------------------------------ collegamento al tavolo */
let ch = null, chatCh = null, beat = null, chain = Promise.resolve();
async function nicksOf(row){
  const c = await client();
  const ids = [row.host, row.guest].filter(Boolean);
  const { data } = await c.from("profiles").select("id, nick").in("id", ids);
  const by = Object.fromEntries((data || []).map(p => [p.id, p.nick]));
  return [by[row.host] || "Host", row.guest ? (by[row.guest] || "Ospite") : ""];
}
export async function attach(row, seat){
  detach(true);
  const c = await client();
  Object.assign(T, { row, seat, applied: 0, inflight: 0, otherIdle: 0, idleAt: Date.now(), ended: null, drawOffer: row.draw_offer || null, chat: [], chatUnread: 0, stamps: [], error: null });
  T.nicks = await nicksOf(row);
  ch = c.channel("table:" + row.id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "game_moves", filter: `table_id=eq.${row.id}` }, p => onRemoteMove(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_tables", filter: `id=eq.${row.id}` }, p => onTableUpdate(p.new))
    .subscribe();
  chatCh = c.channel("tchat:" + row.id, { config: { broadcast: { self: false } } })
    .on("broadcast", { event: "msg" }, p => { const m = p.payload || {}; if(!m.text) return; T.chat.push({ who: T.nicks[1 - T.seat] || "", text: String(m.text).slice(0, 300), at: Date.now(), mine: false }); T.chat = T.chat.slice(-60); T.chatUnread++; emit("ncd:tablechat"); })
    .subscribe();
  clearInterval(beat); beat = setInterval(heartbeat, 10000);
  document.addEventListener("visibilitychange", onVisible);
  if(row.status === "active") await startFromRow(row);
  emit("ncd:table");
}
export function detach(silent){
  clearInterval(beat); beat = null;
  document.removeEventListener("visibilitychange", onVisible);
  const a = ch, b = chatCh; ch = null; chatCh = null;
  if(a || b) client().then(c => { if(a) c.removeChannel(a); if(b) c.removeChannel(b); });
  T.row = null; T.seat = null;
  if(!silent) emit("ncd:table");
}
const onVisible = () => { if(document.visibilityState === "visible" && T.row){ heartbeat(); if(T.row.status === "active") resync(); } };

/* l'ospite entra: si legge la riga completa (con il mazzo dell'avversario) e si parte */
async function startFromRow(row){
  const c = await client();
  if(!row.guest_deck || !row.host_deck){ const { data } = await c.from("game_tables").select("*").eq("id", row.id).maybeSingle(); if(data) row = data; }
  T.row = row; T.nicks = await nicksOf(row);
  const moves = await fetchMoves();
  T.applied = moves.length;
  hooks.start(row, T.seat, T.nicks, moves.map(withSeat));
  if(row.status === "finished") endFrom(row);
}
export function setupOf(row){
  return {
    decks: [{ ...row.host_deck, name: T.nicks[0] || "Host" }, { ...row.guest_deck, name: T.nicks[1] || "Ospite" }],
    opts: { seed: Number(row.seed), autoPay: [!!row.host_autopay, !!row.guest_autopay], chooseFirst: true, ...(row.first === 0 || row.first === 1 ? { first: row.first } : {}) }   // first: chi vince il tiro (e sceglie)
  };
}
/* il posto di chi ha fatto la mossa lo dice il database (chi l'ha inserita), non la mossa */
const seatOf = player => T.row && player === T.row.host ? 0 : 1;
const withSeat = m => { stampOf(m); return { move: m.move, seat: seatOf(m.player) }; };
/* orario (del server) di ogni mossa: serve agli orologi dei tavoli con limite di tempo */
const stampOf = m => { if(m && m.seq > 0 && m.created_at) T.stamps[m.seq - 1] = new Date(m.created_at).getTime(); };
async function fetchMoves(){
  const c = await client();
  const { data, error } = await c.from("game_moves").select("seq, player, move, created_at").eq("table_id", T.row.id).order("seq").range(0, 4999);
  if(error) throw new Error(error.message);
  return data || [];
}

/* ------------------------------------------------------------ mosse */
export function send(move){
  if(!T.row || T.row.status !== "active" || T.ended) return;
  const seq = ++T.applied, id = T.row.id; T.inflight++;
  if(!T.stamps[seq - 1]) T.stamps[seq - 1] = Date.now();
  chain = chain.then(async () => {
    let ok = null;
    for(let i = 0; i < 8 && ok === null; i++){
      try{ ok = await rpc("play_move", { t: id, p_seq: seq, p_move: move }); }
      catch(e){ T.error = e.message; emit("ncd:table"); await new Promise(r => setTimeout(r, 1500 + i * 1000)); }
    }
    T.inflight--;
    if(ok === true){ T.error = null; return; }
    // la mossa non è entrata: un'altra è arrivata prima (o la partita è finita) → si riparte dal registro
    await resync(move);
  });
}
function onRemoteMove(r){
  if(!T.row || r.table_id !== T.row.id) return;
  stampOf(r);
  if(r.player === myId()) return;                          // eco delle mie mosse
  // il database numera le mosse senza buchi: la successiva si applica subito,
  // qualsiasi altra cosa (buco, conflitto con una mia mossa) si risolve rileggendo il registro
  if(syncing){ behind(r.seq); return; }
  if(r.seq === T.applied + 1){ T.applied++; try{ hooks.move(r.move, seatOf(r.player)); }catch(e){ console.warn(e); resync(); } return; }
  // già applicata (arrivata dopo una rilettura) o in conflitto con una mia mossa: in quel caso
  // il database rifiuta la mia e send() rilegge il registro. Un buco invece si colma rileggendo.
  if(r.seq > T.applied + 1) behind(r.seq);
}
/* la riga del tavolo può arrivare prima della mossa che l'ha aggiornata: si rilegge
   il registro solo se dopo un attimo manca ancora qualcosa */
let behindT = null;
function behind(moves){
  clearTimeout(behindT);
  behindT = setTimeout(() => { if(T.row && T.row.status === "active" && moves > T.applied && !T.inflight) chain = chain.then(() => resync()); }, 2500);
}
let syncing = null;
export function resync(lost){
  if(!T.row) return Promise.resolve();
  if(syncing) return syncing;
  syncing = (async () => {
    try{
      const moves = await fetchMoves();
      T.applied = moves.length;
      hooks.rebuild(moves.map(withSeat));
      if(lost) hooks.lost(lost);
    }catch(e){ T.error = e.message; }
    finally{ syncing = null; emit("ncd:table"); }
  })();
  return syncing;
}

/* ------------------------------------------------------------ stato del tavolo */
function onTableUpdate(n){
  if(!T.row || n.id !== T.row.id) return;
  const wasWaiting = T.row.status === "waiting";
  T.row = { ...T.row, ...n };
  T.drawOffer = n.draw_offer || null;
  if(wasWaiting && n.status === "active") startFromRow(T.row);
  else if(n.status === "finished" || n.status === "cancelled") endFrom(n);
  else if(n.status === "active" && n.moves > T.applied) behind(n.moves);
  emit("ncd:table");
}
function endFrom(n){
  if(T.ended) return;
  if(n.status === "cancelled"){ T.ended = { result: null, reason: "cancelled" }; emit("ncd:table"); return; }
  T.ended = { result: n.result, reason: n.reason };
  clearInterval(beat); beat = null;
  hooks.end(T.ended);
  refreshTables();
  emit("ncd:table");
}
async function heartbeat(){
  if(!T.row || T.ended) return;
  try{
    const h = await rpc("table_heartbeat", { t: T.row.id });
    if(!h) return;
    T.error = null;
    if(T.row.status === "waiting" && h.status === "active"){ T.row.status = "active"; await startFromRow(T.row); return; }
    T.row.status = h.status; T.drawOffer = h.draw_offer || null;
    if(h.status === "finished" || h.status === "cancelled"){ endFrom({ ...T.row, status: h.status, result: h.result, reason: h.reason }); return; }
    if(h.status === "active"){
      T.otherIdle = h.other_idle || 0; T.idleAt = Date.now() - T.otherIdle * 1000;
      if(h.moves > T.applied) behind(h.moves);
      if(T.otherIdle >= 60){ const won = await rpc("claim_timeout", { t: T.row.id }); if(won) endFrom({ ...T.row, status: "finished", result: T.seat === 0 ? "host" : "guest", reason: "timeout" }); }
    }
  }catch(e){ T.error = e.message; }
  emit("ncd:table");
}
/* secondi di silenzio dell'avversario, aggiornati tra un battito e l'altro */
export const otherIdle = () => T.row && T.row.status === "active" && !T.ended ? Math.max(T.otherIdle, Math.floor((Date.now() - T.idleAt) / 1000)) : 0;

/* tavoli con opzioni */
export const tableOpts = () => (T.row && T.row.opts && typeof T.row.opts === "object") ? T.row.opts : {};
export async function concedeTime(){ if(!T.row || T.ended) return; try{ await rpc("concede_time", { t: T.row.id }); }catch(e){ T.error = e.message; } endFrom({ ...T.row, status: "finished", result: T.seat === 0 ? "guest" : "host", reason: "time" }); }
/* al meglio di 3: risultato della serie e partita successiva */
export async function seriesScore(){
  if(!T.row || !T.row.series) return null;
  const c = await client(); const { data } = await c.from("game_tables").select("id, game_no, status, result").eq("series", T.row.series).order("game_no");
  const me = T.seat === 0 ? "host" : "guest", fin = (data || []).filter(g => g.status === "finished");
  return { games: data || [], me: fin.filter(g => g.result === me).length, opp: fin.filter(g => g.result && g.result !== me && g.result !== "draw").length };
}
export async function nextGame(){
  if(!T.row || !T.row.series) return null;
  const row = await rpc("next_game", { t: T.row.id }); if(!row || !row.id) return null;
  await attach(row, row.host === myId() ? 0 : 1); refreshTables(); return row;
}
export async function resign(){ if(!T.row) return; await rpc("resign_table", { t: T.row.id }); endFrom({ ...T.row, status: "finished", result: T.seat === 0 ? "guest" : "host", reason: "resign" }); }
export async function offerDraw(){ if(!T.row) return; await rpc("offer_draw", { t: T.row.id }); T.drawOffer = myId(); emit("ncd:table"); }
export async function answerDraw(accept){
  if(!T.row) return;
  await rpc("answer_draw", { t: T.row.id, accept: !!accept });
  if(accept) endFrom({ ...T.row, status: "finished", result: "draw", reason: "agreement" }); else { T.drawOffer = null; emit("ncd:table"); }
}
/* fine decisa dal motore: la registra chi perde (il database non accetta che il vincitore si proclami da solo) */
export async function reportResult(winnerSeat, why){ if(!T.row || winnerSeat === T.seat) return; try{ await rpc("report_result", { t: T.row.id, winner_seat: winnerSeat, why: (why || "").slice(0, 120) }); }catch(e){ T.error = e.message; } }

export function sendChat(text){
  text = (text || "").trim().slice(0, 300); if(!text || !chatCh) return;
  const who = T.nicks[T.seat] || "";
  chatCh.send({ type: "broadcast", event: "msg", payload: { who, text } });
  T.chat.push({ who, text, at: Date.now(), mine: true }); T.chat = T.chat.slice(-60);
  emit("ncd:tablechat");
}

/* ------------------------------------------------------------ inviti in tempo reale */
let invCh = null, invUser = null;
async function watchInvites(){
  const me = myId();
  if(me === invUser) return;
  const c = await client();
  if(invCh){ c.removeChannel(invCh); invCh = null; }
  invUser = me; tables = [];
  if(!me){ emit("ncd:tables"); return; }
  invCh = c.channel("inv:" + me)
    .on("postgres_changes", { event: "*", schema: "public", table: "game_tables", filter: `invited=eq.${me}` }, p => {
      refreshTables().then(() => { if(p.eventType === "INSERT" && p.new.status === "waiting" && p.new.host !== me){ const t = tables.find(x => x.id === p.new.id); emit("ncd:invite", t || p.new); } });
    })
    .subscribe();
  refreshTables();
}
document.addEventListener("ncd:cloud", () => { if(cloud.status !== "sync") watchInvites().catch(() => {}); });
/* una sfida sparisce da sola quando l'host chiude l'app o annulla: se ce n'è qualcuna in sospeso,
   la lista si rilegge ogni 30 secondi (il database mostra solo le sfide di host ancora collegati) */
setInterval(() => { if(signedIn() && invitesForMe().length && document.visibilityState === "visible") refreshTables(); }, 30000);
