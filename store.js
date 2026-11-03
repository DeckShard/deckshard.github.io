/* Stato locale: collezione, mazzi, profilo, impostazioni, record partite.
   Tutto in localStorage con ripiego in memoria.                          */

const MEM = {};
let OK = true;
try { localStorage.setItem("ncd:t", "1"); localStorage.removeItem("ncd:t"); } catch (e) { OK = false; }

const get = (k, d) => { try { const v = OK ? localStorage.getItem("ncd:" + k) : MEM[k]; return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const set = (k, v) => { const s = JSON.stringify(v); try { if (OK) localStorage.setItem("ncd:" + k, s); else MEM[k] = s; } catch (e) { MEM[k] = s; } };

export const storageOk = () => OK;

/* ------------------------------------------------------------ pulizia dei dati
   Tutto ciò che entra da fuori (backup importato, cloud, memoria del browser) passa da qui:
   identificativi solo con lettere, cifre e trattini, numeri veri entro limiti sensati, testi
   corti e niente campi sconosciuti. Così un file di backup preparato ad arte non può
   infilare codice nelle pagine né far esplodere la memoria.                              */
const isId = v => typeof v === "string" && /^[A-Za-z0-9_:-]{1,64}$/.test(v);
const int = (v, lo, hi, d = 0) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const fin = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const str = (v, max) => typeof v === "string" ? v.slice(0, max) : "";
const obj = v => v && typeof v === "object" && !Array.isArray(v) ? v : null;
const plain = v => typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 80 && !/[<>"'`]/.test(v));
const entry = (e, maxN) => obj(e) && isId(e.cid) ? { cid: e.cid, pid: isId(e.pid) ? e.pid : undefined, n: int(e.n, 0, maxN) } : null;
function cleanDeck(d){
  if(!obj(d)) return null;
  const out = { id: isId(d.id) ? d.id : Math.random().toString(36).slice(2, 10), name: str(d.name, 80) || "Mazzo", notes: str(d.notes, 4000), updated: int(d.updated, 0, 9e15) };
  out.legends = (Array.isArray(d.legends) ? d.legends : []).slice(0, 3).map(l => isId(l) ? { cid: l } : obj(l) && isId(l.cid) ? { cid: l.cid, pid: isId(l.pid) ? l.pid : undefined } : null);
  while(out.legends.length < 3) out.legends.push(null);
  out.cards = (Array.isArray(d.cards) ? d.cards : []).slice(0, 300).map(e => entry(e, 50)).filter(e => e && e.n > 0);
  if(d.format === "sealed"){
    out.format = "sealed";
    if(Array.isArray(d.pool)) out.pool = d.pool.slice(0, 600).map(e => entry(e, 99)).filter(e => e && e.n > 0);
    if(obj(d.kit) && isId(String(d.kit.set))) out.kit = { set: String(d.kit.set), seed: fin(d.kit.seed, -9e15, 9e15, 0) };
  }
  if(Array.isArray(d.importErrors)) out.importErrors = d.importErrors.slice(0, 50).map(x => str(x, 200));
  return out;
}
const DEF_SETTINGS = () => ({ view: "grid", sort: "name", ownedOnly: false, collView: "card", collPick: "rarest", favPrints: {} });
export function clean(k, v){
  if(k === "coll"){
    const out = {}; let n = 0;
    for(const [pid, q] of Object.entries(obj(v) || {})){ if(n >= 10000) break; const x = int(q, 0, 99); if(isId(pid) && x){ out[pid] = x; n++; } }
    return out;
  }
  if(k === "decks") return (Array.isArray(v) ? v : []).slice(0, 500).map(cleanDeck).filter(Boolean);
  if(k === "profile"){
    const p = obj(v) || {}, out = {};
    for(const [key, max] of Object.entries({ nick: 24, lifepath: 24, faction: 24, fav: 60, theme: 12, accent: 24, melee: 60, cptcg: 60, bio: 500, lang: 5 })) if(typeof p[key] === "string") out[key] = p[key].slice(0, max);
    if(typeof p.favImg === "string" && /^\.\/img\/[A-Za-z0-9_-]{1,64}\.webp$/.test(p.favImg)) out.favImg = p.favImg; else if("favImg" in p) out.favImg = "";
    if(p.favPos != null) out.favPos = fin(p.favPos, 0, 100, 34);
    if(p.favZoom != null) out.favZoom = fin(p.favZoom, 50, 400, 150);
    if(p.v != null) out.v = int(p.v, 0, 99);
    if(p.autoPay != null) out.autoPay = !!p.autoPay;
    return out;
  }
  if(k === "settings"){
    const out = {};
    for(const [key, val] of Object.entries(obj(v) || {})){
      if(!/^[A-Za-z0-9_]{1,40}$/.test(key)) continue;
      if(key === "favPrints"){ const f = {}; for(const [c, p] of Object.entries(obj(val) || {})) if(isId(c) && isId(p)) f[c] = p; out.favPrints = f; continue; }
      if(plain(val)) out[key] = val;
      else if(obj(val)){ const o = {}; for(const [a, b] of Object.entries(val)) if(/^[A-Za-z0-9_]{1,40}$/.test(a) && plain(b)) o[a] = b; out[key] = o; }
    }
    return out;
  }
  if(k === "record"){
    const r = obj(v) || {}, out = { wins: int(r.wins, 0, 1e9), losses: int(r.losses, 0, 1e9) };
    out.games = (Array.isArray(r.games) ? r.games : []).slice(0, 50).filter(obj).map(g => ({ when: int(g.when, 0, 9e15), mode: isId(g.mode) ? g.mode : "bot", winner: str(g.winner, 40), reason: str(g.reason, 160), turns: int(g.turns, 0, 9999), ...(g.vs != null ? { vs: str(g.vs, 40) } : {}) }));
    if(Array.isArray(r.onlineIds)) out.onlineIds = r.onlineIds.filter(isId).slice(0, 30);
    if(obj(r.online)) out.online = { w: int(r.online.w, 0, 1e9), l: int(r.online.l, 0, 1e9), d: int(r.online.d, 0, 1e9) };
    return out;
  }
  return v;
}

export const DEFAULT_PROFILE = {
  nick: "", lifepath: "", faction: "", fav: "", favImg: "", theme: "dark", accent: "holophone",
  melee: "", cptcg: "", bio: "", v: 3, autoPay: false, lang: "it"
};

/* profili salvati prima della v1.1 avevano "samurai" come accento predefinito:
   il predefinito ora è "holophone"; chi vuole il giallo lo risceglie dal profilo */
function migrateProfile(p){
  if(!p.v){ if(p.accent === "samurai") p.accent = "holophone"; p.v = 2; set("profile", p); }
  if(p.v < 3){ if(p.theme === "auto") p.theme = "dark"; p.v = 3; set("profile", p); }
  return p;
}
export const S = {
  coll: clean("coll", get("coll", {})),          // { printingId: qty }
  decks: clean("decks", get("decks", [])),       // [{ id, name, legends:[{cid,pid}], cards:[{cid,pid,n}], updated }]
  profile: migrateProfile(Object.assign({}, DEFAULT_PROFILE, clean("profile", get("profile", {})))),
  settings: Object.assign(DEF_SETTINGS(), clean("settings", get("settings", {}))),
  record: Object.assign({ wins: 0, losses: 0, games: [] }, clean("record", get("record", {}))),
  recent: get("recent", []),
  save(k){ set(k, this[k]); if(!QUIET) for(const f of HOOKS) f(k); }
};
/* chi vuole sapere quando una sezione cambia (la sincronizzazione con l'account) */
const HOOKS = [];
let QUIET = false;
export const onSave = f => { HOOKS.push(f); };
/* salvataggi che arrivano dal cloud: non devono ripartire verso il cloud */
export function quietly(fn){ QUIET = true; try { fn(); } finally { QUIET = false; } }
export const rawGet = get, rawSet = set;
export function rawDel(k){ try { if (OK) localStorage.removeItem("ncd:" + k); } catch (e) {} delete MEM[k]; }

/* collezione */
export const qtyOf = pid => S.coll[pid] || 0;
export function setQty(pid, n){
  n = Math.max(0, Math.min(99, n | 0));
  if (n) S.coll[pid] = n; else delete S.coll[pid];
  S.save("coll");
}
export const cardQty = c => c.prints.reduce((a, p) => a + qtyOf(p.id), 0);

/* mazzi */
export const newId = () => Math.random().toString(36).slice(2, 10);
export function saveDeck(d){
  d.updated = Date.now();
  const i = S.decks.findIndex(x => x.id === d.id);
  if (i < 0) S.decks.unshift(d); else S.decks[i] = d;
  S.save("decks");
}
export function deleteDeck(id){ S.decks = S.decks.filter(d => d.id !== id); S.save("decks"); }

export function exportAll(){
  return JSON.stringify({ v: 1, coll: S.coll, decks: S.decks, profile: S.profile, settings: S.settings, record: S.record }, null, 0);
}
export function importAll(b){
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error("file non riconosciuto");
  if (b.coll) { S.coll = clean("coll", b.coll); S.save("coll"); }
  if (b.decks) { S.decks = clean("decks", b.decks); S.save("decks"); }
  if (b.profile) { S.profile = Object.assign({}, DEFAULT_PROFILE, clean("profile", b.profile)); S.save("profile"); }
  if (b.settings) { S.settings = Object.assign(S.settings, clean("settings", b.settings)); S.save("settings"); }
  if (b.record) { S.record = Object.assign({ wins: 0, losses: 0, games: [] }, clean("record", b.record)); S.save("record"); }
}
export function wipe(){
  for (const k of ["coll", "decks", "profile", "settings", "record", "recent", "stamps", "synced", "syncUser"]) { try { localStorage.removeItem("ncd:" + k); } catch (e) {} delete MEM[k]; }
  S.coll = {}; S.decks = []; S.profile = Object.assign({}, DEFAULT_PROFILE); S.settings = DEF_SETTINGS();
  S.record = { wins: 0, losses: 0, games: [] }; S.recent = [];
}
