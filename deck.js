/* Deckbuilder: 3 Leggende con nomi diversi, limiti RAM per colore,
   40–50 carte, massimo 3 copie, una voce per carta con scelta dell'artwork. */

import { DATA, COLORS, COLOR_IT, TYPES, TYPE_IT, thumbUrl, imgUrl, priceOf, cardPrice, eur, setName } from "./data.js";
import { S, qtyOf, cardQty, newId, saveDeck, deleteDeck } from "./store.js";
import { $, $$, esc, toast, rowHTML, statsHTML, makeFilters, filtersHTML, passes, bindFilters, sortCards, openCard } from "./ui.js";
import * as cloud from "./cloud.js";

export const DECK_MIN = 40, DECK_MAX = 50, MAX_COPIES = 3;

let CUR = null;               // mazzo in modifica
const LF = { q: "", kind: "all" };   // filtri dell'elenco mazzi
const F = makeFilters("deck");
let browse = "cards";         // "legends" | "cards"
let wired = false;

/* ------------------------------------------------------------ regole */
export function ramLimits(deck){
  const lim = { Red: 0, Yellow: 0, Green: 0, Blue: 0 };
  for(const l of deck.legends){ const c = l && DATA.byId.get(l.cid); if(c && c.color) lim[c.color] += c.ramN || 0; }
  return lim;
}
export function deckSize(deck){ return deck.cards.reduce((a, e) => a + e.n, 0); }
const poolCount = (deck, cid) => deck.pool ? deck.pool.filter(e => e.cid === cid).reduce((a, e) => a + e.n, 0) : 99;
export function validate(deck){
  if(deck.format === "sealed"){
    const out = [], legs = deck.legends.filter(Boolean), n = deckSize(deck);
    out.push({ ok: legs.length === 3, t: `${legs.length}/3 Leggende (nel sealed senza vincoli di nome)` });
    out.push({ ok: n >= 30, t: `${n} carte (nel sealed ne servono almeno 30, Leggende escluse)` });
    const cols = new Set(deck.cards.map(e => DATA.byId.get(e.cid)?.color).filter(Boolean));
    out.push({ ok: cols.size <= 3, t: cols.size <= 3 ? `${cols.size} colori su un massimo di 3${cols.size ? ": " + [...cols].map(c => COLOR_IT[c]).join(", ") : ""}` : `Troppi colori (${[...cols].map(c => COLOR_IT[c]).join(", ")}): massimo 3` });
    const over = deck.cards.filter(e => e.n > poolCount(deck, e.cid)).map(e => DATA.byId.get(e.cid)?.dn);
    out.push({ ok: !over.length, t: over.length ? `Più copie di quelle aperte: ${over.join(", ")}` : "Solo carte aperte dal kit" });
    return out;
  }
  const out = [], lim = ramLimits(deck), legs = deck.legends.filter(Boolean);
  out.push({ ok: legs.length === 3, t: `${legs.length}/3 Leggende` });
  const names = new Set(legs.map(l => DATA.byId.get(l.cid)?.dn));
  if(legs.length) out.push({ ok: names.size === legs.length, t: names.size === legs.length ? "Leggende con nomi diversi" : "Due Leggende hanno lo stesso nome" });
  const n = deckSize(deck);
  out.push({ ok: n >= DECK_MIN && n <= DECK_MAX, t: `${n} carte (servono ${DECK_MIN}–${DECK_MAX}, Leggende escluse)` });
  const over = deck.cards.filter(e => e.n > MAX_COPIES).map(e => DATA.byId.get(e.cid)?.dn);
  out.push({ ok: !over.length, t: over.length ? `Più di ${MAX_COPIES} copie: ${over.join(", ")}` : `Massimo ${MAX_COPIES} copie per carta` });
  const ramKo = deck.cards.filter(e => { const c = DATA.byId.get(e.cid); return c && (c.ramN || 0) > (lim[c.color] || 0); }).map(e => DATA.byId.get(e.cid).dn);
  out.push({ ok: !ramKo.length, t: ramKo.length ? `Fuori dai limiti RAM: ${ramKo.slice(0, 4).join(", ")}${ramKo.length > 4 ? "…" : ""}` : "Tutte le carte entro i limiti RAM delle Leggende" });
  const illegal = [...legs.map(l => l.cid), ...deck.cards.map(e => e.cid)].filter(id => DATA.byId.get(id)?.legal && DATA.byId.get(id).legal !== "legal").map(id => DATA.byId.get(id).dn);
  if(illegal.length) out.push({ ok: false, t: `Non legali nei tornei: ${illegal.join(", ")}` });
  return out;
}
export const isLegal = deck => validate(deck).every(v => v.ok);

/* quante copie mancano in collezione, e quanto costerebbero */
export function missing(deck){
  let copies = 0, cost = 0, unpriced = 0;
  const all = [...deck.legends.filter(Boolean).map(l => ({ cid: l.cid, n: 1 })), ...deck.cards];
  for(const e of all){
    const c = DATA.byId.get(e.cid); if(!c) continue;
    const m = Math.max(0, e.n - cardQty(c)); if(!m) continue;
    copies += m; const pr = cardPrice(c); if(pr) cost += pr.trend * m; else unpriced += m;
  }
  return { copies, cost, unpriced };
}
export function deckValue(deck){
  let v = 0;
  for(const l of deck.legends.filter(Boolean)){ const pr = priceOf(l.pid) || cardPrice(DATA.byId.get(l.cid)); if(pr) v += pr.trend; }
  for(const e of deck.cards){ const pr = priceOf(e.pid) || cardPrice(DATA.byId.get(e.cid)); if(pr) v += pr.trend * e.n; }
  return v;
}

/* ------------------------------------------------------------ import/export testo */
export function exportText(deck){
  const L = deck.legends.filter(Boolean).map(l => "Legend: " + DATA.byId.get(l.cid).dn);
  const byType = t => deck.cards.filter(e => DATA.byId.get(e.cid)?.type === t).sort((a, b) => (DATA.byId.get(a.cid).cost ?? 0) - (DATA.byId.get(b.cid).cost ?? 0))
    .map(e => `${e.n} ${DATA.byId.get(e.cid).dn}`);
  return [`# ${deck.name}`, ...L, "", "# Units", ...byType("Unit"), "", "# Programs", ...byType("Program"), "", "# Gear", ...byType("Gear")].join("\n");
}
const norm = s => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+[-–—]\s+/g, ": ").replace(/\s*:\s*/g, ": ").replace(/\s+/g, " ").trim();
/* codici stampati sulle carte ("MS01 - WNC [A]", "SD01 - HEI", "PRR02 - WNC"…) → set del catalogo */
const SET_CODES = {
  WNC: ["welcometonightcityretail", "welcometonightcitybeta"], MS01: ["welcometonightcityretail", "welcometonightcitybeta"],
  HEI: ["theheistretailstarterdeck", "theheistbetastarterdeck"], SD01: ["theheistretailstarterdeck", "theheistbetastarterdeck"],
  EBP: ["embracingpowerretailstarterdeck", "embracingpowerbetastarterdeck"], SD02: ["embracingpowerretailstarterdeck", "embracingpowerbetastarterdeck"],
  PRM01: ["PRM01"], PRM: ["PRM01", "boxtoppersretail"], PRR: ["prereleaseretail", "prereleasebeta"], PRR02: ["prereleaseretail"], PRR01: ["prereleasebeta"],
  EOR: ["edgerunneropens1"], EOR01: ["edgerunneropens1"], NCB: ["nightcitybrawls1"], NCB01: ["nightcitybrawls1"], BT: ["boxtoppersretail", "boxtoppersbeta"]
};
let PRINT_IDX = null;
function printIndex(){
  if(PRINT_IDX) return PRINT_IDX;
  PRINT_IDX = new Map();
  for(const c of DATA.cards) for(const p of c.prints){
    const n = String(p.num).replace(/^[^0-9]*/, "").replace(/[^0-9].*$/, "").padStart(3, "0");
    const k = p.set + "|" + n; if(!PRINT_IDX.has(k) || p.lang === "en") PRINT_IDX.set(k, p);
  }
  return PRINT_IDX;
}
/* "WNC-025", "3x MS01 025", "025" → stampa; con il solo numero si assume il set principale */
export function printByCode(code, num){
  const idx = printIndex(), n = String(num).padStart(3, "0");
  const sets = code ? (SET_CODES[code.toUpperCase()] || []) : ["welcometonightcityretail", "welcometonightcitybeta"];
  for(const sset of sets){ const p = idx.get(sset + "|" + n); if(p) return p; }
  if(!code){ const all = [...idx.entries()].filter(([k]) => k.endsWith("|" + n)).map(([, p]) => p); if(all.length === 1) return all[0]; }
  return null;
}
/* righe "N carta" (nome o codice) → stampe con quantità; usato anche dall'import della collezione */
export function parseCardLines(text){
  const byName = new Map(DATA.cards.map(c => [norm(c.dn), c]));
  const find = s => { s = norm(s); if(byName.has(s)) return byName.get(s);
    const base = s.split(":")[0].trim(); return DATA.cards.find(c => norm(c.dn).startsWith(s)) || DATA.cards.find(c => norm(c.name) === base && c.type === "Legend") || null; };
  const entries = [], bad = [];
  for(let raw of text.split(/\r?\n/)){
    let line = raw.trim(); if(!line || line.startsWith("#") || /^[-=_*]+$/.test(line)) continue;
    if(/^(legends?|main( deck)?|deck|units?|programs?|gears?|sideboard|cards?|collezione|collection)\s*:?\s*(\(\d+\))?$/i.test(line)) continue;
    line = line.replace(/^legend:?\s*/i, "");
    let m = line.match(/^(\d+)\s*[x×]?\s+(.+)$/i) || line.match(/^(.+?)\s*[x×]\s*(\d+)$/i);
    let n = 1, name = line; if(m){ if(/^\d+$/.test(m[1])){ n = +m[1]; name = m[2]; } else { n = +m[2]; name = m[1]; } }
    name = name.replace(/\s*[;,]\s*\d+\s*$/, "");
    const cm = name.match(/^(?:([A-Za-z]{2,4}\d{0,2})\s*[-–\s]\s*)?#?(\d{1,3})(?:\s+(.*))?$/);
    if(cm){ const p = printByCode(cm[1] || "", cm[2]); if(p){ entries.push({ pid: p.id, cid: p.card.id, n }); continue; } if(!cm[3]){ bad.push(raw); continue; } name = cm[3]; }
    const c = find(name); if(!c){ bad.push(raw); continue; }
    entries.push({ pid: c.def.id, cid: c.id, n });
  }
  return { entries, bad };
}
/* collezione come righe strutturate, poi resa in testo / CSV / JSON */
const SET_CODE = { welcometonightcityretail: "WNC", welcometonightcitybeta: "WNC", theheistretailstarterdeck: "HEI", embracingpowerretailstarterdeck: "EBP", PRM01: "PRM01", prereleaseretail: "PRR", edgerunneropens1: "EOR", nightcitybrawls1: "NCB", boxtoppersretail: "BT" };
export function collectionRows(coll){
  const rows = [];
  for(const [pid, n] of Object.entries(coll)){ const p = DATA.byPrint.get(pid); if(!p || !n) continue;
    const num = String(p.num).replace(/^[^0-9]*/, "").replace(/[^0-9].*$/, "").padStart(3, "0");
    rows.push({ qty: n, name: p.card.dn, code: SET_CODE[p.set] ? `${SET_CODE[p.set]}-${num}` : "", set: p.set, setName: setName(p.set), number: p.num, rarity: p.rarity, lang: p.lang, id: p.id }); }
  return rows.sort((a, b) => a.name.localeCompare(b.name, "it") || a.set.localeCompare(b.set));
}
export function collectionText(coll, fmt = "txt"){
  const rows = collectionRows(coll);
  if(fmt === "json") return JSON.stringify({ app: "DeckShard", game: "Cyberpunk TCG", exported: new Date().toISOString(), cards: rows }, null, 2);
  if(fmt === "csv"){ const q = s => `"${String(s ?? "").replace(/"/g, '""')}"`; return ["quantity,name,code,set,number,rarity,language,printing_id", ...rows.map(r => [r.qty, q(r.name), r.code, r.set, r.number, r.rarity, r.lang, r.id].join(","))].join("\n"); }
  return `# DeckShard — collezione (${rows.length} voci)\n` + rows.map(r => r.code ? `${r.qty} ${r.code} ${r.name}` : `${r.qty} ${r.name}  # ${r.set} #${r.number}`).join("\n");
}
/* JSON di altre app o di questa: diventa righe "N nome/codice" (o stampe dirette quando c'è l'id) */
export function jsonToLines(obj){
  const lines = [], direct = [];
  const pick = (o, keys) => { for(const k of keys) if(o[k] != null && o[k] !== "") return o[k]; return null; };
  const handle = o => {
    if(!o || typeof o !== "object") return;
    const q = Math.max(1, Math.min(99, Math.floor(+pick(o, ["qty", "quantity", "count", "n", "amount", "copies", "owned"])) || 1));   // 1–99 come nella collezione
    const id = pick(o, ["printing_id", "printingId", "pid", "id"]);
    if(id && DATA.byPrint.has(String(id))){ direct.push({ pid: String(id), n: q }); return; }
    const name = pick(o, ["name", "card", "cardName", "card_name", "title"]);
    // Deckrunners: printingId "MS01-010" (codice set + numero); altri: "code"
    const code = pick(o, ["code", "set_code", "cardCode", "number_code"]) || (id && /^[A-Za-z]{2,5}\d{0,2}[-–\s]?\d{1,3}$/.test(String(id)) ? String(id) : null);
    const set = pick(o, ["set", "setCode", "set_code", "expansion"]); const num = pick(o, ["number", "num", "collector_number", "collectorNumber", "cardNumber"]);
    if(code) lines.push(`${q} ${code}${name ? " " + name : ""}`);
    else if(set && num != null && /^[A-Za-z]{2,5}\d{0,2}$/.test(String(set))) lines.push(`${q} ${set}-${String(num).padStart(3, "0")}${name ? " " + name : ""}`);
    else if(name) lines.push(`${q} ${name}`);
  };
  const LISTS = ["entries", "cards", "collection", "items", "list", "deck", "main", "mainDeck", "legends", "units", "programs", "gears"];
  if(Array.isArray(obj)) obj.forEach(handle);
  else if(obj && typeof obj === "object"){
    if(obj.coll && typeof obj.coll === "object"){ for(const [pid, n] of Object.entries(obj.coll)) if(DATA.byPrint.has(pid)) direct.push({ pid, n: Math.max(0, Math.min(99, Math.floor(+n) || 0)) }); }
    else if(LISTS.some(k => Array.isArray(obj[k]))){ for(const k of LISTS) if(Array.isArray(obj[k])) obj[k].forEach(x => typeof x === "string" ? lines.push(`1 ${x}`) : handle(x)); }
    else if(obj.deck && typeof obj.deck === "object"){ return jsonToLines(obj.deck); }
    else { for(const [k, v] of Object.entries(obj)){ if(typeof v === "number") lines.push(`${v} ${k}`); else if(v && typeof v === "object" && !Array.isArray(v)) handle({ name: k, ...v }); } }
  }
  return { lines: lines.join("\n"), direct };
}
export function importText(text){
  const deck = { id: newId(), name: "Mazzo importato", legends: [], cards: [], notes: "" };
  const byName = new Map(DATA.cards.map(c => [norm(c.dn), c]));
  const addPrint = (p, n, line) => {
    const c = p.card;
    if(c.type === "Legend"){ if(deck.legends.length < 3) deck.legends.push({ cid: c.id, pid: p.id }); else bad.push(`${line} (quarta Leggenda: ne servono 3)`); return; }
    const e = deck.cards.find(x => x.cid === c.id); if(e){ e.n += n; e.pid = p.id; } else deck.cards.push({ cid: c.id, pid: p.id, n });
  };
  const find = s => { s = norm(s); if(byName.has(s)) return byName.get(s);
    const base = s.split(":")[0].trim(); return DATA.cards.find(c => norm(c.dn).startsWith(s)) || DATA.cards.find(c => norm(c.name) === base && c.type === "Legend") || null; };
  const bad = [];
  for(let raw of text.split(/\r?\n/)){
    let line = raw.trim(); if(!line) continue;
    if(line.startsWith("#")){ const t = line.slice(1).trim(); if(t && !/^(units?|programs?|gears?|legends?|deck|main)$/i.test(t)) deck.name = t; continue; }
    // intestazioni di sezione ("Legends:", "Main deck", "Units") e righe di soli trattini
    if(/^(legends?|main( deck)?|deck|units?|programs?|gears?|sideboard|cards?)\s*:?\s*(\(\d+\))?$/i.test(line) || /^[-=_*]+$/.test(line)) continue;
    let m = line.match(/^legend:?\s*(.+)$/i);
    if(m){
      const cm = m[1].trim().match(/^(?:(\d+)\s*[x×]?\s+)?(?:([A-Za-z]{2,4}\d{0,2})\s*[-–\s]\s*)?#?(\d{1,3})$/);
      const p = cm ? printByCode(cm[2] || "", cm[3]) : null;
      if(p && p.card.type === "Legend"){ addPrint(p, 1, line); continue; }
      const c = find(m[1].replace(/^\d+\s*[x×]?\s+/, ""));
      if(c && c.type === "Legend") addPrint(c.def, 1, line); else bad.push(line); continue;
    }
    m = line.match(/^(\d+)\s*[x×]?\s+(.+)$/i) || line.match(/^(.+?)\s*[x×]\s*(\d+)$/i);
    let n = 1, name = line; if(m){ if(/^\d+$/.test(m[1])){ n = +m[1]; name = m[2]; } else { n = +m[2]; name = m[1]; } }
    // riga con codice e numero: "WNC-025", "MS01 025", "SD01-001 V: Corporate Exile", oppure solo "025"
    const cm = name.match(/^(?:([A-Za-z]{2,4}\d{0,2})\s*[-–\s]\s*)?#?(\d{1,3})(?:\s+(.*))?$/) ;
    if(cm){ const p = printByCode(cm[1] || "", cm[2]); if(p){ addPrint(p, n, line); continue; } if(!cm[3]){ bad.push(line); continue; } name = cm[3]; }
    const c = find(name); if(!c){ bad.push(line); continue; }
    if(c.type === "Legend"){ addPrint(c.def, 1, line); continue; }
    const e = deck.cards.find(x => x.cid === c.id); if(e) e.n += n; else deck.cards.push({ cid: c.id, pid: c.def.id, n });
  }
  while(deck.legends.length < 3) deck.legends.push(null);
  return { deck, bad };
}

/* bozza da uno starter: tutte le carte del set, quantità stimate per arrivare a 40 */
export function starterDeck(setCode, name){
  const deck = { id: newId(), name, legends: [], cards: [], notes: "Bozza creata dalle carte dello starter: le quantità reali vanno verificate sulla lista ufficiale." };
  const cs = DATA.cards.filter(c => c.prints.some(p => p.set === setCode));
  for(const c of cs){
    const p = c.prints.find(x => x.set === setCode) || c.def;
    if(c.type === "Legend"){ if(deck.legends.length < 3) deck.legends.push({ cid: c.id, pid: p.id }); }
    else deck.cards.push({ cid: c.id, pid: p.id, n: (c.cost ?? 0) <= 3 ? 3 : 2 });
  }
  let n = deckSize(deck);
  for(const e of deck.cards.slice().sort((a, b) => (DATA.byId.get(b.cid).cost ?? 0) - (DATA.byId.get(a.cid).cost ?? 0))){ if(n <= DECK_MIN) break; if(e.n > 1){ e.n--; n--; } }
  for(const e of deck.cards){ if(n >= DECK_MIN) break; if(e.n < 3){ e.n++; n++; } }
  while(deck.legends.length < 3) deck.legends.push(null);
  return deck;
}

/* ------------------------------------------------------------ elenco mazzi */
export function renderDeck(){
  if(!wired){ wire(); wired = true; }
  if(CUR){ renderEditor(); return; }
  $("#deckEdit").hidden = true; const list = $("#deckList"); list.hidden = false;
  const all = S.decks.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const q = (LF.q || "").toLowerCase();
  const decks = all.filter(d => (LF.kind === "all" || (LF.kind === "sealed") === (d.format === "sealed")) && (!q || d.name.toLowerCase().includes(q) || d.legends.filter(Boolean).some(l => (DATA.byId.get(l.cid)?.dn || "").toLowerCase().includes(q))));
  const built = decks.filter(d => d.format !== "sealed"), sealed = decks.filter(d => d.format === "sealed");
  const nS = all.filter(d => d.format === "sealed").length;
  list.innerHTML = `
    <div class="card">
      <div class="deckhead"><div><h2 style="margin:0">I tuoi mazzi</h2><div class="sub">${all.length ? `${all.length - nS} costruiti${nS ? ` · ${nS} prerelease` : ""}` : "Nessun mazzo ancora"}</div></div>
        <div class="dacts"><button class="btn acc2" id="deckNew">+ Nuovo</button><button class="btn sm" id="deckImport">Importa testo</button></div></div>
      ${all.length > 3 ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
        <input class="inp" id="deckListQ" type="search" placeholder="Cerca per nome o Leggenda…" value="${esc(LF.q || "")}" style="flex:1;min-width:160px">
        <span class="seg" id="deckListKind"><button data-v="all" aria-pressed="${LF.kind === "all"}">Tutti</button><button data-v="built" aria-pressed="${LF.kind === "built"}">Costruiti</button><button data-v="sealed" aria-pressed="${LF.kind === "sealed"}">Prerelease</button></span></div>` : ""}
      ${LF.kind !== "sealed" ? `<div class="rows decks" style="margin-top:12px">${built.map(d => deckRowHTML(d)).join("") || `<div class="empty">${q ? "Nessun mazzo con questo nome." : "Crea un mazzo da zero, importalo da testo o parti da uno starter qui sotto."}</div>`}</div>` : ""}
      ${sealed.length && LF.kind !== "built" ? `<h3 style="margin-top:14px">Mazzi Prerelease</h3><div class="rows decks" style="margin-top:6px">${sealed.map(d => deckRowHTML(d)).join("")}</div>` : ""}
    </div>
    <div class="card">
      <h3>Punti di partenza</h3>
      <div class="sub">Gli starter ufficiali come bozza (quantità stimate) e, appena un sito pubblicherà i mazzi dei tornei in formato leggibile, i mazzi meta dell'ultimo mese.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn sm" data-starter="theheistretailstarterdeck" data-name="Starter The Heist">Starter «The Heist»</button>
        <button class="btn sm" data-starter="embracingpowerretailstarterdeck" data-name="Starter Embracing Power">Starter «Embracing Power»</button>
      </div>
      <h3 style="margin-top:14px">Mazzi meta</h3>
      <div class="sub">Nessun sito li espone ancora via API, ma si possono consultare e poi incollare qui con «Importa testo» (<code>3 Nome carta</code> per riga, <code>Legend: Nome</code> per le Leggende).</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <a class="btn sm" href="https://exburst.dev/cyberpunk/tournaments/meta" target="_blank" rel="noopener noreferrer">ExBurst · tier list ↗</a>
        <a class="btn sm" href="https://exburst.dev/cyberpunk/tournaments" target="_blank" rel="noopener noreferrer">ExBurst · tornei ↗</a>
        <a class="btn sm" href="https://ripperdeck.gg/meta" target="_blank" rel="noopener noreferrer">Ripperdeck · meta ↗</a>
        <a class="btn sm" href="https://choom.gg/meta" target="_blank" rel="noopener noreferrer">Choom.gg · meta ↗</a>
      </div>
    </div>`;
}
function deckRowHTML(d){
  const legs = d.legends.filter(Boolean).map(l => DATA.byId.get(l.cid)).filter(Boolean);
  const n = deckSize(d), ok = isLegal(d), miss = missing(d);
  return `<div class="row" data-deck="${d.id}">
    <span class="ci" style="background:${legs[0] ? `var(--c${legs[0].color})` : "var(--line2)"}"></span>
    <div style="display:flex;gap:2px;flex:0 0 auto">${legs.map(c => `<img class="thumb" src="${thumbUrl(c.def.id)}" alt="" style="width:30px">`).join("") || `<span class="thumb"></span>`}</div>
    <div class="nm"><b>${esc(d.name)}</b><span>${n} carte · ${legs.map(c => esc(c.name)).join(", ") || "senza Leggende"}${miss.copies ? ` · mancano ${miss.copies} copie` : " · completo in collezione"}</span></div>
    ${d.format === "sealed" ? `<span class="chip">Sealed</span>` : ""}<span class="chip ${ok ? "good" : "bad"}">${ok ? "Legale" : "Non valido"}</span>
    <button class="btn sm icon" data-ddel="${d.id}" title="Elimina" aria-label="Elimina ${esc(d.name)}" style="color:var(--bad)">✕</button>
  </div>`;
}

/* ------------------------------------------------------------ editor */
export function openDeck(id){
  CUR = S.decks.find(d => d.id === id) || null;
  F.q = ""; F.owned = ""; F.ramOnly = false;   // i filtri del browser ripartono puliti a ogni mazzo
  if(CUR){ for(const e of CUR.cards) if(!e.pid || !DATA.byPrint.has(e.pid)) e.pid = DATA.byId.get(e.cid)?.def.id; }
  renderDeck();
}
function closeEditor(){ CUR = null; renderDeck(); }
function save(){ if(CUR) saveDeck(CUR); }

let filtOpen = false;
function renderEditor(){
  $("#deckList").hidden = true; const ed = $("#deckEdit"); ed.hidden = false;
  const d = CUR, lim = ramLimits(d), checks = validate(d), n = deckSize(d), miss = missing(d);
  const legsHTML = [0, 1, 2].map(i => {
    const l = d.legends[i], c = l && DATA.byId.get(l.cid);
    return c ? `<div class="lslot${d.format !== "sealed" && !cardQty(c) ? " unowned" : ""}" data-lslot="${i}" title="${esc(c.dn)}${d.format !== "sealed" && !cardQty(c) ? " (non in collezione)" : ""}"><img src="${thumbUrl(l.pid || c.def.id)}" alt="${esc(c.dn)}"><button class="x" data-lrm="${i}" aria-label="Togli">✕</button></div>`
             : `<div class="lslot" data-lslot="${i}">+ Leggenda</div>`;
  }).join("");
  const ram = d.format === "sealed" ? `<span class="chip">Sealed · max 3 colori · min 30 carte · senza RAM</span>` : COLORS.map(k => `<span><i class="pip ${k}"></i>${COLOR_IT[k]} ≤ ${lim[k]}</span>`).join("");
  const curve = [0, 1, 2, 3, 4, 5, 6, 7].map(v => { const cnt = d.cards.filter(e => { const c = DATA.byId.get(e.cid); const x = c?.cost ?? 0; return v === 7 ? x >= 7 : x === v; }).reduce((a, e) => a + e.n, 0); return cnt; });
  const mx = Math.max(1, ...curve);
  const sellable = d.cards.reduce((a, e) => a + (DATA.byId.get(e.cid)?.eddiable ? e.n : 0), 0);
  const groups = TYPES.filter(t => t !== "Legend").map(t => {
    const es = d.cards.filter(e => DATA.byId.get(e.cid)?.type === t).sort((a, b) => ((DATA.byId.get(a.cid).cost ?? 0) - (DATA.byId.get(b.cid).cost ?? 0)) || DATA.byId.get(a.cid).dn.localeCompare(DATA.byId.get(b.cid).dn));
    if(!es.length) return "";
    const cnt = es.reduce((a, e) => a + e.n, 0);
    return `<h3 style="margin:12px 0 4px">${TYPE_IT[t]} <small style="color:var(--mute)">${cnt}</small></h3><div class="rows dlist">${es.map(e => {
      const c = DATA.byId.get(e.cid), own = cardQty(c), ramKo = d.format !== "sealed" && (c.ramN || 0) > (lim[c.color] || 0);
      const html = rowHTML(c, e.pid, `<span class="qtyctl"><button data-dq="-1" data-cid="${c.id}" aria-label="meno">−</button><b>${e.n}</b><button data-dq="1" data-cid="${c.id}" aria-label="più">+</button></span>`,
        `${ramKo ? `<span class="chip bad">RAM ${c.ramN}</span>` : `<span class="chip">RAM ${c.ramN}</span>`}${d.format === "sealed" ? "" : own < e.n ? `<span class="chip bad">hai ${own}</span>` : ""}`, true, d.format === "sealed" ? `${e.n}/${poolCount(d, c.id)}x` : "");
      // copie che non possiedi: miniatura in bianco e nero (a colori nella scheda e nello zoom), così si vede se il mazzo è giocabile dal vivo
      return d.format !== "sealed" && own < e.n ? html.replace('class="row"', `class="row unowned" title="Ne possiedi ${own} su ${e.n}"`) : html;
    }).join("")}</div>`;
  }).join("");

  ed.innerHTML = `
    <div class="card">
      <div class="deckhead">
        <div class="dname"><button class="btn sm icon" id="deckBack" aria-label="Indietro">←</button><input class="inp wide" id="deckName" value="${esc(d.name)}" placeholder="Nome del mazzo" style="font-weight:700;font-size:16px"></div>
        <div class="dacts">
          <button class="btn sm acc2" id="deckPlay" title="${isLegal(CUR) ? "Prova nel simulatore" : "Completa il mazzo per giocarlo nel simulatore"}" ${isLegal(CUR) ? "" : "disabled"}>▶ Gioca</button>
          <button class="btn sm" id="deckCopy">Copia testo</button>
          <button class="btn sm acc2" id="deckShare">Condividi</button>
          <button class="btn sm" id="deckDup">Duplica</button>
          <button class="btn sm" id="deckDel" style="color:var(--bad)">Elimina</button>
        </div>
      </div>
      ${d.importErrors && d.importErrors.length ? `<div class="note" id="deckErrors" style="margin-top:12px;border-left-color:var(--bad)"><b>Righe non riconosciute (${d.importErrors.length})</b> — controlla nome o codice e aggiungile a mano:<br>${d.importErrors.map(l => `<code>${esc(l)}</code>`).join("<br>")}<div style="margin-top:8px"><button class="btn sm" id="deckErrorsOk">Ho capito</button></div></div>` : ""}
      <div class="legends">${legsHTML}</div>
      <div class="ram">${ram}</div>
      <ul class="legal" style="list-style:none;padding:0">${checks.map(v => `<li class="${v.ok ? "ok" : "ko"}">${v.ok ? "✔" : "✘"} ${esc(v.t)}</li>`).join("")}</ul>
      <div class="curve" style="margin:22px 4px 20px">${curve.map((c, i) => `<div style="height:${Math.round(c / mx * 100)}%" data-n="${c || ""}" data-c="${i === 7 ? "7+" : i}"></div>`).join("")}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:12.5px;color:var(--ink2)">
        <span class="chip">${n} carte</span><span class="chip" title="Carte con il simbolo €$: si possono vendere per 1 Eddie">vendibili ${sellable} (${n ? Math.round(sellable / n * 100) : 0}%)</span><span class="chip">valore ${eur(deckValue(d))}</span>
        ${miss.copies ? `<span class="chip bad">mancano ${miss.copies} copie ≈ ${eur(miss.cost)}${miss.unpriced ? " + " + miss.unpriced + " senza prezzo" : ""}</span>` : `<span class="chip good">hai tutte le carte</span>`}
      </div>
      ${groups || `<div class="empty">Aggiungi carte dall'elenco delle carte: tocca il nome per +1, la miniatura per scegliere l'artwork.</div>`}
    </div>

    <div class="card flush" id="deckBrowser">
      <div class="hdr" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="seg" id="deckBrowse"><button data-b="cards" aria-pressed="${browse === "cards"}">Carte</button><button data-b="legends" aria-pressed="${browse === "legends"}">Leggende</button></span>
        <span class="seg" id="deckOwned"><button data-o="" aria-pressed="${!F.owned}">Tutte</button><button data-o="yes" aria-pressed="${F.owned === "yes"}">Possedute</button><button data-o="no" aria-pressed="${F.owned === "no"}">Mancanti</button></span>
        ${d.format === "sealed" ? "" : `<button class="btn sm" id="deckRamOnly" aria-pressed="${!!F.ramOnly}">Solo entro RAM</button>`}
        <span class="count" style="font-size:12.5px;color:var(--mute)" id="deckCount"></span>
      </div>
      <div class="search"><input class="inp" id="deckQ" type="search" placeholder="Cerca carta…" value="${esc(F.q)}" autocomplete="off"><button class="btn sm" id="deckFilt">Filtri</button></div>
      <div class="filters${filtOpen ? " on" : ""}" id="deckFilters">${filtersHTML(F)}</div>
      <div class="rows" id="deckRows"></div>
    </div>`;
  renderBrowser();
}
function renderBrowser(){
  const d = CUR, lim = ramLimits(d);
  let list = DATA.cards.filter(c => browse === "legends" ? c.type === "Legend" : c.type !== "Legend").filter(c => passes(c, F));
  if(d.format === "sealed") list = list.filter(c => poolCount(d, c.id) > 0);
  if(F.ramOnly && browse === "cards" && d.format !== "sealed") list = list.filter(c => (c.ramN || 0) <= (lim[c.color] || 0));
  list = sortCards(list, F.sort || "color");
  $("#deckCount").textContent = `${list.length} carte`;
  $("#deckRows").innerHTML = list.map(c => {
    const e = d.cards.find(x => x.cid === c.id), inDeck = browse === "legends" ? d.legends.some(l => l && l.cid === c.id) : (e ? e.n : 0);
    const ramKo = browse === "cards" && d.format !== "sealed" && (c.ramN || 0) > (lim[c.color] || 0);
    // già nel mazzo: «−» per togliere senza tornare all'elenco del mazzo (il resto della riga aggiunge)
    const minus = inDeck ? `<button class="bminus" data-bminus="${c.id}" aria-label="Togli una copia">−</button>` : "";
    const right = browse === "legends" ? `<span class="bqty">${minus}<span class="chip${inDeck ? " acc" : ""}">${inDeck ? "nel mazzo" : "+"}</span></span>` : `<span class="bqty">${minus}<span class="chip${inDeck ? " acc" : ""}">${inDeck ? "×" + inDeck : "+"}</span></span>`;
    const pe = d.format === "sealed" ? d.pool.find(e => e.cid === c.id) : null;
    const extra = d.format === "sealed" ? "" : `<span class="chip${ramKo ? " bad" : ""}">RAM ${c.ramN}</span>${cardQty(c) ? `<span class="chip">hai ${cardQty(c)}</span>` : ""}`;
    const left = d.format === "sealed" ? poolCount(d, c.id) - (browse === "legends" ? (inDeck ? 1 : 0) : (inDeck || 0)) : 0;
    const html = rowHTML(c, pe ? pe.pid : null, right, extra, false, d.format === "sealed" ? `${left}x` : "");
    return d.format !== "sealed" && !cardQty(c) ? html.replace('class="row"', 'class="row unowned" title="Non in collezione"') : html;   // non posseduta: miniatura in bianco e nero
  }).join("") || `<div class="empty">Il tuo fixer non trova niente con questi filtri.</div>`;
}

/* aggiunte/rimozioni */
function addCard(cid, delta, where = "browser"){
  const c = DATA.byId.get(cid); if(!c || c.type === "Legend") return;
  let e = CUR.cards.find(x => x.cid === cid);
  if(!e){ if(delta <= 0) return; const pe = CUR.pool && CUR.pool.find(x => x.cid === cid); e = { cid, pid: pe ? pe.pid : c.def.id, n: 0 }; CUR.cards.push(e); }
  const cap = CUR.format === "sealed" ? poolCount(CUR, cid) : MAX_COPIES;
  e.n = Math.max(0, Math.min(cap, e.n + delta));
  if(e.n > cap) e.n = cap;
  if(!e.n) CUR.cards = CUR.cards.filter(x => x !== e);
  save(); keepPlace(cid, renderEditor, where);
}
/* il mazzo sta sopra l'elenco: quando cresce o si accorcia, l'elenco scenderebbe o salirebbe sotto il dito.
   Si misura dove si trova la riga toccata prima del ridisegno e si compensa lo scorrimento dopo. */
let anchorCid = null;
function keepPlace(cid, fn, where = "browser"){
  const inB = id => document.querySelector(`#deckRows .row[data-cid="${CSS.escape(id)}"]`), inD = id => document.querySelector(`.dlist .row[data-cid="${CSS.escape(id)}"]`);
  const sel = id => where === "deck" ? (inD(id) || inB(id)) : (inB(id) || inD(id));
  const el = (anchorCid && sel(anchorCid)) || (cid && sel(cid)), key = el && el.dataset.cid;
  const top = el ? el.getBoundingClientRect().top : null;
  const br = $("#deckBrowser"), bs = br ? br.scrollTop : 0, inBrowser = !!(el && el.closest("#deckRows"));
  fn();
  const br2 = $("#deckBrowser"); if(br2) br2.scrollTop = bs;
  if(top != null){
    const el2 = (inBrowser ? inB(key) : inD(key)) || sel(key);
    if(el2){ const dy = el2.getBoundingClientRect().top - top; if(Math.abs(dy) > 0.5) window.scrollBy(0, dy); }
  }
  anchorCid = null;
}
function setLegend(i, cid){
  const c = DATA.byId.get(cid); if(!c || c.type !== "Legend") return;
  if(CUR.legends.some((l, j) => l && j !== i && l.cid === cid)){ toast("Quella Leggenda è già nel mazzo"); return; }
  const pe = CUR.pool && CUR.pool.find(e => e.cid === cid);
  CUR.legends[i] = { cid, pid: pe ? pe.pid : c.def.id }; save(); keepPlace(cid, renderEditor);
}

function wire(){
  const list = $("#deckList"), ed = $("#deckEdit");
  list.addEventListener("input", e => { if(e.target.id === "deckListQ"){ LF.q = e.target.value; const pos = e.target.selectionStart; renderDeck(); const el = $("#deckListQ"); if(el){ el.focus(); el.setSelectionRange(pos, pos); } } });
  list.addEventListener("click", e => {
    const k = e.target.closest("#deckListKind button"); if(k){ LF.kind = k.dataset.v; renderDeck(); return; }
    if(e.target.closest("#deckNew")){ const d = { id: newId(), name: "Nuovo mazzo", legends: [null, null, null], cards: [], notes: "" }; saveDeck(d); CUR = d; browse = "legends"; renderDeck(); return; }
    if(e.target.closest("#deckImport")){ promptImport(); return; }
    const st = e.target.closest("[data-starter]"); if(st){ const d = starterDeck(st.dataset.starter, st.dataset.name); saveDeck(d); CUR = d; browse = "cards"; renderDeck(); toast("Bozza creata: controlla le quantità"); return; }
    const del = e.target.closest("[data-ddel]"); if(del){ e.stopPropagation(); const d = S.decks.find(x => x.id === del.dataset.ddel); if(d && confirm(`Eliminare «${d.name}»?`)){ deleteDeck(d.id); renderDeck(); toast("Mazzo mandato al trash"); } return; }
    const r = e.target.closest("[data-deck]"); if(r){ browse = "cards"; openDeck(r.dataset.deck); }
  });
  ed.addEventListener("click", e => {
    if(e.target.closest("#deckBack")){ closeEditor(); return; }
    if(e.target.closest("#deckErrorsOk")){ delete CUR.importErrors; save(); renderEditor(); return; }
    if(e.target.closest("#deckCopy")){ const t = exportText(CUR); (navigator.clipboard?.writeText(t) || Promise.reject()).then(() => toast("Lista copiata negli appunti")).catch(() => prompt("Copia la lista:", t)); return; }
    if(e.target.closest("#deckShare")){ shareDeck(CUR); return; }
    if(e.target.closest("#deckDup")){ const d = JSON.parse(JSON.stringify(CUR)); d.id = newId(); d.name += " (copia)"; saveDeck(d); CUR = d; renderEditor(); toast("Mazzo clonato"); return; }
    if(e.target.closest("#deckDel")){ if(confirm(`Eliminare «${CUR.name}»?`)){ deleteDeck(CUR.id); closeEditor(); } return; }
    if(e.target.closest("#deckPlay")){ location.hash = "#sim"; document.dispatchEvent(new CustomEvent("ncd:playdeck", { detail: CUR.id })); return; }
    const rm = e.target.closest("[data-lrm]"); if(rm){ e.stopPropagation(); CUR.legends[+rm.dataset.lrm] = null; save(); renderEditor(); return; }
    const ls = e.target.closest("[data-lslot]"); if(ls){
      const l = CUR.legends[+ls.dataset.lslot];
      if(l){ const i = +ls.dataset.lslot; openCard(l.cid, l.pid, { pick: pid => { CUR.legends[i].pid = pid; save(); renderEditor(); } }); }
      else { browse = "legends"; renderEditor(); $("#deckBrowser").scrollIntoView({ behavior: "smooth", block: "start" }); }
      return;
    }
    const dq = e.target.closest("[data-dq]"); if(dq){ addCard(dq.dataset.cid, +dq.dataset.dq, "deck"); return; }
    const b = e.target.closest("#deckBrowse button"); if(b){ browse = b.dataset.b; renderEditor(); return; }
    const ob = e.target.closest("#deckOwned button"); if(ob){ F.owned = ob.dataset.o; renderEditor(); return; }
    if(e.target.closest("#deckRamOnly")){ F.ramOnly = !F.ramOnly; renderEditor(); return; }
    if(e.target.closest("#deckFilt")){ filtOpen = $("#deckFilters").classList.toggle("on"); return; }
    if(e.target.closest("#deckFilters")){ return; } // gestito da bindFilters (delegato sotto)
    const bm = e.target.closest("[data-bminus]"); if(bm){
      const cid = bm.dataset.bminus; anchorCid = cid;
      if(browse === "legends"){ const i = CUR.legends.findIndex(l => l && l.cid === cid); if(i >= 0){ CUR.legends[i] = null; save(); keepPlace(cid, renderEditor); } return; }
      addCard(cid, -1); return;
    }
    const row = e.target.closest("#deckRows .row"); if(row){ anchorCid = row.dataset.cid;
      const cid = row.dataset.cid;
      if(e.target.closest(".thumb")){ openCard(cid, row.dataset.pid, { pick: pid => { const en = CUR.cards.find(x => x.cid === cid); if(en){ en.pid = pid; } else { addCard(cid, 1); CUR.cards.find(x => x.cid === cid).pid = pid; } save(); renderEditor(); } }); return; }
      if(browse === "legends"){ const i = CUR.legends.findIndex(l => !l); if(i < 0){ toast("Hai già 3 Leggende: togline una"); return; } setLegend(i, cid); return; }
      addCard(cid, 1); return;
    }
    const drow = e.target.closest(".dlist .row"); if(drow){
      const cid = drow.dataset.cid, en = CUR.cards.find(x => x.cid === cid);
      openCard(cid, en?.pid, { pick: pid => { if(en){ en.pid = pid; save(); renderEditor(); } } });
    }
  });
  // filtri (delegati: il contenitore viene ricreato a ogni render)
  ed.addEventListener("click", e => {
    const b = e.target.closest("#deckFilters [data-fk]");
    if(b){ const set = F[b.dataset.fk]; set.has(b.dataset.fv) ? set.delete(b.dataset.fv) : set.add(b.dataset.fv); $("#deckFilters").innerHTML = filtersHTML(F); $("#deckFilters").classList.add("on"); renderBrowser(); return; }
    if(e.target.closest("#deckFilters [data-fclsall]")){ F.clsAll = !F.clsAll; $("#deckFilters").innerHTML = filtersHTML(F); $("#deckFilters").classList.add("on"); return; }
    if(e.target.closest("#deckFilters [data-fclear]")){ for(const k of ["colors","types","rar","cls","cost","sets"]) F[k].clear(); $("#deckFilters").innerHTML = filtersHTML(F); renderBrowser(); }
  });
  ed.addEventListener("input", e => {
    if(e.target.id === "deckQ"){ F.q = e.target.value.trim(); renderBrowser(); }
    if(e.target.id === "deckName"){ CUR.name = e.target.value; save(); }
  });
  document.addEventListener("ncd:collection", () => { if(CUR && $("#p-deck").classList.contains("on")) renderEditor(); });
}

function promptImport(){
  let t = prompt("Incolla la lista (una carta per riga: «3 Nome carta», Leggende come «Legend: Nome») oppure il JSON esportato da un'altra app (Deckrunners…):");
  if(!t) return;
  let direct = [];
  if(/^\s*[\[{]/.test(t)){   // JSON (Deckrunners e simili): stesse regole dell'import della collezione
    let obj; try{ obj = JSON.parse(t); }catch(err){ toast("JSON non valido: " + err.message, 4000); return; }
    const r = jsonToLines(obj); direct = r.direct; t = r.lines + "\n" + direct.map(d => `${d.n} ${DATA.byPrint.get(d.pid).card.dn}`).join("\n");
  }
  const { deck, bad } = importText(t);
  for(const d of direct){ const c = DATA.byPrint.get(d.pid).card; const e = deck.cards.find(x => x.cid === c.id); if(e) e.pid = d.pid; const l = deck.legends.find(x => x && x.cid === c.id); if(l) l.pid = d.pid; }
  if(!deck.cards.length && !deck.legends.some(Boolean)){ toast("Nessuna carta riconosciuta"); return; }
  deck.importErrors = bad;
  saveDeck(deck); CUR = deck; renderDeck();
  toast(bad.length ? `Importato con ${bad.length} righe non riconosciute` : "Mazzo importato", 3000);
}
export const currentDeck = () => CUR;

/* ------------------------------------------------------------ condivisione
   Un mazzo diventa un link corto: nome, Leggende e carte indicate dalle prime 8 cifre dell'identificativo
   della stampa (uniche nel catalogo), così resta valido anche quando il catalogo cresce.
   https://deckshard.github.io/#d=Nome~leg1.leg2.leg3~stampa*copie.stampa*copie… */
const BASE = () => location.origin + location.pathname;
export function deckLink(d){
  const legs = d.legends.filter(Boolean).map(l => (l.pid || DATA.byId.get(l.cid).def.id).slice(0, 8));
  const cards = d.cards.filter(e => e.n > 0).map(e => (e.pid || DATA.byId.get(e.cid).def.id).slice(0, 8) + "*" + e.n);
  return `${BASE()}#d=${encodeURIComponent((d.name || "Mazzo").slice(0, 40)).replace(/~/g, "%7E")}~${legs.join(".")}~${cards.join(".")}`;
}
export function parseDeckLink(str){
  const m = /#d=([^~\s]*)~([0-9a-f.]*)~([0-9a-f.*]*)/i.exec(str || ""); if(!m) return null;
  const byPfx = new Map(); for(const c of DATA.cards) for(const p of c.prints) byPfx.set(p.id.slice(0, 8), p);
  const pr = x => byPfx.get(x.toLowerCase());
  let name = "Mazzo condiviso"; try{ name = decodeURIComponent(m[1]) || name; }catch(e){}
  const legends = m[2].split(".").filter(Boolean).map(pr).filter(Boolean).slice(0, 3).map(p => ({ cid: p.card.id, pid: p.id }));
  while(legends.length < 3) legends.push(null);
  const cards = []; for(const part of m[3].split(".").filter(Boolean)){ const [x, n] = part.split("*"); const p = pr(x); if(p && +n > 0) cards.push({ cid: p.card.id, pid: p.id, n: Math.min(9, +n) }); }
  return { name: name.slice(0, 60), legends, cards, notes: "" };
}
/* chi apre il link vede l'anteprima e può salvarne una copia tra i propri mazzi */
export function openSharedDeck(str, done){
  const d = parseDeckLink(str); if(!d){ done && done(); return; }
  const n = deckSize(d), el = document.createElement("div"); el.id = "mergeAsk";
  el.innerHTML = `<div class="box"><h3>Mazzo condiviso</h3><p><b>${esc(d.name)}</b> · ${n} carte · ${d.legends.filter(Boolean).length} Leggende</p>
    <div style="display:flex;gap:6px;margin:8px 0">${d.legends.filter(Boolean).map(l => `<img src="${thumbUrl(l.pid)}" alt="" style="width:31%;border-radius:4px">`).join("")}</div>
    <div class="opts"><button class="btn yel" data-a="save">Salva tra i miei mazzi</button><button class="btn" data-a="x">Non ora</button></div></div>`;
  el.addEventListener("click", ev => { const b = ev.target.closest("[data-a]"); if(!b && ev.target !== el) return; el.remove();
    if(b && b.dataset.a === "save"){ const copy = { ...d, id: newId(), name: d.name }; saveDeck(copy); toast("Mazzo salvato nel deckbuilder"); location.hash = "#deck"; CUR = copy; renderDeck(); }
    done && done(); });
  document.body.appendChild(el);
}
function shareDeck(d){
  const link = deckLink(d), friends = cloud.state.user ? cloud.friends.filter(f => f.status === "accepted") : [];
  const el = document.createElement("div"); el.id = "mergeAsk";
  el.innerHTML = `<div class="box fmenu"><h3>Condividi «${esc(d.name)}»</h3><p class="sub">Chi apre il link vede il mazzo e può salvarne una copia.</p>
    <div class="opts"><button class="btn" data-a="copy"><span>Copia il link</span></button>${navigator.share ? `<button class="btn" data-a="share"><span>Condividi…</span><small>WhatsApp, Telegram, email…</small></button>` : ""}
    ${friends.length ? `<h4 class="frh" style="margin:6px 0 0">Manda in chat a un amico</h4>${friends.map(f => `<button class="btn" data-f="${f.id}"><span>${esc(f.nick)}</span></button>`).join("")}` : cloud.state.user ? "" : `<small class="sub">Con un account puoi mandarlo direttamente in chat ai tuoi amici.</small>`}</div></div>`;
  el.addEventListener("click", async ev => {
    if(ev.target === el){ el.remove(); return; }
    const b = ev.target.closest("[data-a], [data-f]"); if(!b) return;
    try{
      if(b.dataset.a === "copy"){ await navigator.clipboard.writeText(link); toast("Link copiato"); }
      if(b.dataset.a === "share"){ await navigator.share({ title: d.name, text: `Il mio mazzo «${d.name}» su DeckShard`, url: link }); }
      if(b.dataset.f){ await cloud.sendMessage(b.dataset.f, `🃏 ${d.name}\n${link}`); toast("Mazzo mandato in chat"); }
      el.remove();
    }catch(err){ if(err && err.name !== "AbortError") toast(err.message || String(err), 4000); }
  });
  document.body.appendChild(el);
}
