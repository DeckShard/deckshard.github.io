/* Stato locale: collezione, mazzi, profilo, impostazioni, record partite.
   Tutto in localStorage con ripiego in memoria.                          */

const MEM = {};
let OK = true;
try { localStorage.setItem("ncd:t", "1"); localStorage.removeItem("ncd:t"); } catch (e) { OK = false; }

const get = (k, d) => { try { const v = OK ? localStorage.getItem("ncd:" + k) : MEM[k]; return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const set = (k, v) => { const s = JSON.stringify(v); try { if (OK) localStorage.setItem("ncd:" + k, s); else MEM[k] = s; } catch (e) { MEM[k] = s; } };

export const storageOk = () => OK;

export const DEFAULT_PROFILE = {
  nick: "", lifepath: "", faction: "", fav: "", favImg: "", theme: "auto", accent: "samurai",
  melee: "", cptcg: "", bio: ""
};

export const S = {
  coll: get("coll", {}),          // { printingId: qty }
  decks: get("decks", []),        // [{ id, name, legends:[cardId], cards:[{cid,pid,n}], updated }]
  profile: Object.assign({}, DEFAULT_PROFILE, get("profile", {})),
  settings: Object.assign({ view: "grid", sort: "name", ownedOnly: false }, get("settings", {})),
  record: Object.assign({ wins: 0, losses: 0, games: [] }, get("record", {})),
  recent: get("recent", []),
  save(k){ set(k, this[k]); }
};

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
export function importAll(obj){
  if (!obj || typeof obj !== "object") throw new Error("file non riconosciuto");
  if (obj.coll) { S.coll = obj.coll; S.save("coll"); }
  if (obj.decks) { S.decks = obj.decks; S.save("decks"); }
  if (obj.profile) { S.profile = Object.assign({}, DEFAULT_PROFILE, obj.profile); S.save("profile"); }
  if (obj.settings) { S.settings = Object.assign(S.settings, obj.settings); S.save("settings"); }
  if (obj.record) { S.record = obj.record; S.save("record"); }
}
export function wipe(){
  for (const k of ["coll", "decks", "profile", "settings", "record", "recent"]) { try { localStorage.removeItem("ncd:" + k); } catch (e) {} delete MEM[k]; }
  S.coll = {}; S.decks = []; S.profile = Object.assign({}, DEFAULT_PROFILE); S.settings = { view: "grid", sort: "name", ownedOnly: false };
  S.record = { wins: 0, losses: 0, games: [] }; S.recent = [];
}
