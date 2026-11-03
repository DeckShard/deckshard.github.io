// DeckShard · Edge Function «push» (Supabase → Edge Functions → nome: push)
// Manda le notifiche push quando arriva un messaggio, una sfida o una richiesta d'amicizia.
// La chiamano tre Database Webhook (INSERT su messages, game_tables, friendships).
// Segreto WEBHOOK_SECRET (Edge Functions → Secrets) e la stessa stringa nell'intestazione x-webhook-secret
// dei tre webhook: così solo il database può chiedere l'invio delle notifiche.
// Impostazioni della funzione: «Verify JWT» SPENTO (la funzione non si fida del contenuto ricevuto:
// rilegge ogni evento dal database; e il GET restituisce solo la chiave pubblica).
// Con GET restituisce la chiave pubblica VAPID che serve al telefono per iscriversi.
// Le chiavi VAPID le genera da sola al primo avvio e le salva nella tabella push_keys,
// che nessun utente può leggere: non ci sono segreti da copiare a mano.
// Tutto con WebCrypto (RFC 8291 per la cifratura, RFC 8292 per VAPID), senza librerie esterne.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// chiave segreta del progetto: le nuove «sb_secret_…» (SUPABASE_SECRET_KEYS) o, in mancanza, la vecchia service_role
const SERVICE_KEY = (() => { try{ const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); const v = k.default || Object.values(k)[0]; if(v) return String(v); }catch(_e){ /* formato inatteso */ } return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""; })();
// le chiavi «sb_secret_» non sono JWT: vanno solo nell'intestazione apikey
const AUTH_HEADERS: Record<string, string> = SERVICE_KEY.startsWith("sb_") ? { apikey: SERVICE_KEY } : { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const SUBJECT = "mailto:deckshard.app@gmail.com";
// segreto condiviso con i Database Webhook (intestazione x-webhook-secret): se è impostato tra i segreti
// della funzione, le chiamate POST senza quel valore vengono ignorate
const HOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || "";
const sameSecret = (a: string, b: string) => { if(a.length !== b.length) return false; let d = 0; for(let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

/* ------------------------------------------------------------ utilità */
const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) => { const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ""; for(const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = (s: string) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while(s.length % 4) s += "="; const bin = atob(s); const out = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for(const p of parts){ out.set(p, o); o += p.length; } return out; };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function rest(path: string, init: RequestInit = {}){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...AUTH_HEADERS, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) } });
  if(!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

/* ------------------------------------------------------------ chiavi VAPID (create una volta, poi lette dal database) */
let KEYS: { pub: string, jwk: JsonWebKey } | null = null;
async function keys(){
  if(KEYS) return KEYS;
  const row = (await rest("push_keys?id=eq.1&select=public_key,private_key"))[0];
  if(row){ KEYS = { pub: row.public_key, jwk: JSON.parse(row.private_key) }; return KEYS; }
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  await rest("push_keys", { method: "POST", body: JSON.stringify({ id: 1, public_key: pub, private_key: JSON.stringify(jwk) }), headers: { Prefer: "resolution=ignore-duplicates" } });
  KEYS = null; return keys();   // rilegge: se due chiamate sono partite insieme, vince la prima
}

/* ------------------------------------------------------------ VAPID (RFC 8292) */
async function vapidHeader(endpoint: string){
  const { pub, jwk } = await keys();
  const aud = new URL(endpoint).origin, exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" }))), body = b64u(enc.encode(JSON.stringify({ aud, exp, sub: SUBJECT })));
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${pub}`;
}

/* ------------------------------------------------------------ cifratura del contenuto (RFC 8291, aes128gcm) */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number){
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}
export async function encrypt(payload: Uint8Array, p256dh: string, auth: string){
  const ua = unb64u(p256dh), authSecret = unb64u(auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // record size 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

async function sendPush(sub: { endpoint: string, p256dh: string, auth: string }, msg: unknown){
  const body = await encrypt(enc.encode(JSON.stringify(msg)), sub.p256dh, sub.auth);
  return fetch(sub.endpoint, { method: "POST", body, headers: { Authorization: await vapidHeader(sub.endpoint), TTL: "86400", Urgency: "normal", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream" } });
}

/* ------------------------------------------------------------ eventi → notifiche
   Il contenuto del webhook non basta per fidarsi: ogni evento si rilegge dal database e deve essere recente,
   così una chiamata inventata non può far arrivare notifiche false. */
const TEXT = {
  it: { msg: (n: string) => n, deck: "🃏 Ti ha mandato un mazzo", reqT: "Richiesta di amicizia", req: (n: string) => `${n} vuole aggiungerti alla sua crew`, chT: "Sfida!", ch: (n: string, c: string) => `${n} ti sfida a una partita · tavolo ${c}` },
  en: { msg: (n: string) => n, deck: "🃏 Sent you a deck", reqT: "Friend request", req: (n: string) => `${n} wants to add you to their crew`, ch: (n: string, c: string) => `${n} challenges you to a game · table ${c}`, chT: "Challenge!" }
};
const recent = (t: string) => Date.now() - new Date(t).getTime() < 5 * 60 * 1000;
// nick e avatar di chi scrive: il telefono mostra il suo ritratto al posto del logo (Android; iPhone usa sempre l'icona dell'app)
async function who(id: string){
  const p = (await rest(`profiles?id=eq.${id}&select=nick,avatar`))[0] || {}, a = p.avatar || {};
  const img = typeof a.img === "string" && /^\.\/img\/[\w-]+\.webp$/.test(a.img) ? a.img : "";
  return { nick: p.nick || "Choom", ava: { img, pos: Number(a.pos ?? 34), zoom: Number(a.zoom ?? 150), name: String(a.fav || p.nick || "") } };
}
async function describe(p: any){
  const r = p && p.record; if(!p || p.type !== "INSERT" || !r) return null;
  if(p.table === "messages"){
    const m = (await rest(`messages?id=eq.${Number(r.id)}&select=id,sender,recipient,body,created_at`))[0]; if(!m || !recent(m.created_at)) return null;
    const { nick, ava } = await who(m.sender), isDeck = /#d=/.test(m.body);
    return { to: m.recipient, kind: "messages", tag: `msg-${m.sender}`, url: "./#profile", ava, make: (t: any) => ({ title: t.msg(nick), body: isDeck ? t.deck : String(m.body).slice(0, 140) }) };
  }
  if(p.table === "friendships"){
    const f = (await rest(`friendships?a=eq.${r.a}&b=eq.${r.b}&select=a,b,status,created_at`))[0]; if(!f || f.status !== "pending" || !recent(f.created_at)) return null;
    const { nick, ava } = await who(f.a);
    return { to: f.b, kind: "requests", tag: `req-${f.a}`, url: "./#profile", ava, make: (t: any) => ({ title: t.reqT, body: t.req(nick) }) };
  }
  if(p.table === "game_tables"){
    const g = (await rest(`game_tables?id=eq.${r.id}&select=id,host,invited,code,status,created_at`))[0]; if(!g || !g.invited || g.invited === g.host || g.status !== "waiting" || !recent(g.created_at)) return null;
    const { nick, ava } = await who(g.host);
    return { to: g.invited, kind: "challenges", tag: `table-${g.id}`, url: "./#sim", ava, make: (t: any) => ({ title: t.chT, body: t.ch(nick, g.code) }) };
  }
  return null;
}

Deno.serve(async req => {
  if(req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try{
    if(req.method === "GET") return json({ publicKey: (await keys()).pub });
    if(HOOK_SECRET && !sameSecret(req.headers.get("x-webhook-secret") || "", HOOK_SECRET)) return json({ error: "forbidden" }, 403);
    const ev = await describe(await req.json().catch(() => null));
    if(!ev) return json({ sent: 0, skipped: true });
    const subs = await rest(`push_subs?user_id=eq.${ev.to}&select=endpoint,p256dh,auth,prefs,lang`);
    let sent = 0;
    for(const s of subs){
      if(s.prefs && s.prefs[ev.kind] === false) continue;
      const t = (TEXT as any)[s.lang] || TEXT.it, content = ev.make(t);
      const res = await sendPush(s, { ...content, url: ev.url, tag: ev.tag, ava: ev.ava });
      if(res.status === 404 || res.status === 410) await rest(`push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" });   // telefono non più iscritto
      else if(res.ok) sent++;
    }
    return json({ sent });
  }catch(e){ return json({ error: String((e as Error).message || e) }, 500); }
});
