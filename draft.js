/* Draft contro l'IA (alpha). Un tavolo da 8: tu e 7 bot.
   - Giro delle Leggende: ognuno apre una busta da 4 Leggende (3 Rare e uno slot Epic+), ne prende una e passa le altre;
   - 4 buste da 12 carte come quelle del kit Prerelease, con il passaggio che alterna sinistra e destra;
   - con quello che hai preso costruisci un mazzo sealed (3 Leggende, almeno 30 carte, massimo 3 colori) e sfidi 3 bot del tavolo.
   Il draft si rigioca identico da espansione, seme e scelte: così il mazzo si può verificare (anche online) e le buste
   dei bot non vanno salvate. Le carte del draft non entrano nella collezione.                                         */

import { DATA, COLOR_IT, TYPE_IT, thumbUrl, imgUrl, setName, rulesHTML } from "./data.js";
import { openLens } from "./ui.js";
import { S, saveDeck, rawGet, rawSet, rawDel } from "./store.js";
import { mulberry32 } from "./engine.js";
import { expansions, cardScore, botFromDeck, poolToDeck } from "./prerelease.js";

const SEATS = 8, ROUNDS = 5;            // giro 0 = Leggende, 1–4 = buste
const DIR = [1, 1, -1, 1, -1];          // +1: la busta passa a sinistra (al posto successivo)
const SLOT_RARE = [["Rare", 0.72], ["Epic", 0.22], ["Secret", 0.06]];
const COLS = ["Red", "Blue", "Yellow", "Green"];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cardOf = p => DATA.byPrint.get(p.id).card;

/* ------------------------------------------------------------ buste */
const PACK_CACHE = new Map();
function packsFor(set, seed){
  const key = set + ":" + seed; if(PACK_CACHE.has(key)) return PACK_CACHE.get(key);
  const exp = expansions().find(e => e.code === set); if(!exp) return null;
  const rng = mulberry32(seed >>> 0);
  const by = r => exp.prints.filter(p => p.rarity === r);
  const pickOne = arr => arr[Math.floor(rng() * arr.length)];
  const distinct = (arr, n, used = new Set()) => { const a = arr.filter(p => !used.has(cardOf(p).id)), out = []; while(out.length < n && a.length){ const p = a.splice(Math.floor(rng() * a.length), 1)[0]; if(used.has(cardOf(p).id)) continue; used.add(cardOf(p).id); out.push(p); } return out; };
  const legs = exp.prints.filter(p => cardOf(p).type === "Legend");
  const lRare = legs.filter(p => p.rarity === "Rare"), lEpic = legs.filter(p => p.rarity === "Epic"), lSecret = legs.filter(p => p.rarity === "Secret");
  const rounds = [];
  rounds.push(Array.from({ length: SEATS }, () => {
    let top = rng() < 0.8 ? lEpic : lSecret; if(!top.length) top = lEpic.length ? lEpic : lSecret.length ? lSecret : lRare;
    const used = new Set(), epic = distinct(top, 1, used);
    return [...distinct(lRare, 3, used), ...epic];
  }));
  for(let r = 1; r < ROUNDS; r++) rounds.push(Array.from({ length: SEATS }, () => {
    const pack = [...distinct(by("Common"), 7), ...distinct(by("Uncommon"), 3)];
    for(let k = 0; k < 2; k++){
      let x = rng(), rar = "Rare"; for(const [name, p] of SLOT_RARE){ if(x < p){ rar = name; break; } x -= p; }
      const pool = by(rar).length ? by(rar) : by("Rare"); pack.push(pickOne(pool));
    }
    return pack;
  }));
  PACK_CACHE.set(key, rounds); if(PACK_CACHE.size > 6) PACK_CACHE.delete(PACK_CACHE.keys().next().value);
  return rounds;
}

/* ------------------------------------------------------------ bot */
const RB = { Common: 0, Uncommon: 0.3, Rare: 0.8, Epic: 1.3, Secret: 1.6 };
const legendScore = c => ((c.kw || []).includes("Go Solo") ? 3 : 0) + (c.power ?? 0) * 0.4 + (/\{(Spend|Attack|Play|Call)\}|When /.test(c.text || "") ? 1 : 0);
/* i bot prendono la carta più forte finché il loro pool è piccolo, poi si fissano sui 2 colori in cui hanno
   le carte migliori (le Leggende non vincolano i colori, come nelle regole del sealed) */
export function lanesOf(cards){
  const non = cards.filter(c => c.type !== "Legend"); if(non.length < 5) return null;
  const st = {}; for(const c of non) if(c.color) st[c.color] = (st[c.color] || 0) + Math.max(0, cardScore(c) + 3);
  return Object.keys(st).sort((a, b) => st[b] - st[a]).slice(0, 2);
}
function pickScore(p, round, cards, lanes){
  const c = cardOf(p);
  if(c.type === "Legend") return legendScore(c) + (RB[p.rarity] || 0) + (round === 0 ? 0 : -3);
  const n = cards.filter(x => x.type !== "Legend").length;
  return cardScore(c) + (RB[p.rarity] || 0) + (lanes ? (lanes.includes(c.color) ? 2.5 : (n >= 12 ? -2 : -0.5)) : 0);
}
function botPick(seat, pool, pack, round, seed, k){
  const rng = mulberry32(((seed >>> 0) ^ Math.imul(seat + 1, 2654435761) ^ Math.imul(k + 1, 40503)) >>> 0);
  const cards = pool.map(cardOf), lanes = lanesOf(cards);
  let best = 0, bs = -1e9;
  pack.forEach((p, i) => { const s = pickScore(p, round, cards, lanes) + rng() * 0.8; if(s > bs){ bs = s; best = i; } });
  return best;
}

/* ------------------------------------------------------------ rigioco */
/* dr = { set, seed, picks: [indice scelto in ogni busta, in ordine] } */
let lastKey = null, lastSt = null;   // l'ultimo rigioco: l'interfaccia lo chiede più volte per ogni tocco
export function replay(dr){
  if(!dr || !Array.isArray(dr.picks)) return null;
  const key = dr.set + ":" + dr.seed + ":" + dr.picks.join(",");
  if(key === lastKey) return lastSt;
  lastSt = replayRaw(dr); lastKey = key; return lastSt;
}
function replayRaw(dr){
  const R = packsFor(dr.set, dr.seed); if(!R) return null;
  const pools = Array.from({ length: SEATS }, () => []);
  let k = 0;
  for(let r = 0; r < ROUNDS; r++){
    let packs = R[r].map(p => p.slice()), pick = 0;
    while(packs[0].length){
      if(k >= dr.picks.length) return { round: r, pick, packs, pools, done: false, k };
      const ui = dr.picks[k];
      if(!Number.isInteger(ui) || ui < 0 || ui >= packs[0].length) return null;
      const chosen = packs.map((pk, s) => s === 0 ? ui : botPick(s, pools[s], pk, r, dr.seed, k));
      chosen.forEach((i, s) => pools[s].push(packs[s][i]));
      packs = packs.map((pk, s) => pk.filter((_, i) => i !== chosen[s]));
      const d = DIR[r]; packs = packs.map((_, s) => packs[(s - d + SEATS) % SEATS]);
      k++; pick++;
    }
  }
  return { round: ROUNDS, pick: 0, packs: [], pools, done: k === dr.picks.length, k };
}
/* le carte prese da te (per il controllo del mazzo) */
export function draftPool(dr){ const st = replay(dr); return st && st.done ? st.pools[0] : null; }

/* chi siede al tavolo: un personaggio per ogni bot (dalle Leggende dell'espansione) */
function seatsOf(dr){
  const exp = expansions().find(e => e.code === dr.set);
  const chars = []; const seen = new Set();
  for(const p of (exp ? exp.prints : [])){ const c = cardOf(p); if(c.type !== "Legend" || seen.has(c.name)) continue; seen.add(c.name); chars.push({ name: c.name, img: thumbUrl(c.def.id) }); }
  const rng = mulberry32(((dr.seed >>> 0) ^ 0x5eed) >>> 0);
  for(let i = chars.length - 1; i > 0; i--){ const j = Math.floor(rng() * (i + 1)); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  const out = [{ name: S.profile.nick || "Tu", me: true }];
  for(let s = 1; s < SEATS; s++) out.push({ name: "Bot " + ((chars[s - 1] || {}).name || s), img: (chars[s - 1] || {}).img });
  const order = [1, 2, 3, 4, 5, 6, 7]; for(let i = order.length - 1; i > 0; i--){ const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return { seats: out, opps: order.slice(0, 3).sort((a, b) => a - b) };
}
/* i 3 avversari: nome, foto e il mazzo che il bot costruisce con le sue scelte */
const OPP_CACHE = new Map();
export function draftOpponents(dr){
  const key = dr.set + ":" + dr.seed + ":" + dr.picks.join(","); if(OPP_CACHE.has(key)) return OPP_CACHE.get(key);
  const st = replay(dr); if(!st || !st.done) return [];
  const { seats, opps } = seatsOf(dr);
  const out = opps.map(s => ({ seat: s, name: seats[s].name, img: seats[s].img, deck: botFromDeck(poolToDeck(st.pools[s], seats[s].name)) }));
  OPP_CACHE.set(key, out); return out;
}

/* ------------------------------------------------------------ stato salvato */
let D = null;          // { set, seed, picks, timer, side: [indici del pool messi in sideboard] }
let sel = null, poolSt = 0, ins = null, onBuildCb = null, hoverI = null;
let timerId = null, deadline = 0, perPick = 0;
const save = () => rawSet("draft", D);
const fixSide = d => { const st = replay(d), n = st ? st.pools[0].length : 0; d.side = [...new Set((Array.isArray(d.side) ? d.side : []).filter(x => Number.isInteger(x) && x >= 0 && x < n))]; return d; };
export const savedDraft = () => { const d = rawGet("draft", null); return d && typeof d === "object" && Array.isArray(d.picks) && replay(d) ? fixSide(d) : null; };
export function discardDraft(){ rawDel("draft"); D = null; }
const inSide = i => D.side.includes(i);

export function startDraft(set, opts = {}){
  D = { set, seed: (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0, picks: [], timer: !!opts.timer, side: [] };
  save(); openDraft(opts.onBuild);
}
export function openDraft(onBuild){
  if(!D) D = savedDraft(); if(!D) return;
  if(onBuild) onBuildCb = onBuild;
  sel = null; ins = null; poolSt = 0;
  const root = document.getElementById("draft"); root.hidden = false; document.body.style.overflow = "hidden";
  if(!root.dataset.wired){ wire(root); root.dataset.wired = "1"; }
  render(true);
}
function closeDraft(){
  stopTimer(); const root = document.getElementById("draft"); root.hidden = true; root.innerHTML = ""; document.body.style.overflow = "";
  document.dispatchEvent(new CustomEvent("ncd:draft"));
}

/* ------------------------------------------------------------ disegno */
const avatarStyle = () => { const p = S.profile; return p.favImg ? `background-image:url(${esc(p.favImg)});background-size:${p.favZoom ?? 150}% auto;background-position:50% ${p.favPos ?? 34}%` : ""; };
const initials = s => (s || "NC").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
function ringHTML(seats, dir){
  const pos = s => { const a = Math.PI / 2 + s * Math.PI / 4; return [50 + 38 * Math.cos(a), 50 + 38 * Math.sin(a)]; };
  const arc = dir > 0 ? `M45.7 74.6 A25 25 0 0 1 30.8 66.1` : `M54.3 74.6 A25 25 0 0 0 69.2 66.1`;
  return `<div class="dRing" aria-label="Il tavolo: 8 giocatori, la busta passa a ${dir > 0 ? "sinistra" : "destra"}">
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="38" fill="none" stroke="var(--line2)" stroke-width="1" stroke-dasharray="2 4"/><defs><marker id="dAr" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--acc2)"/></marker></defs><path d="${arc}" fill="none" stroke="var(--acc2)" stroke-width="2.4" marker-end="url(#dAr)"/></svg>
    ${seats.map((x, s) => { const [l, t] = pos(s); return `<span class="seat${x.me ? " me" : ""}" style="left:${l.toFixed(1)}%;top:${t.toFixed(1)}%;${x.me ? avatarStyle() : `background-image:url(${x.img})`}" title="${esc(x.name)}">${x.me && !S.profile.favImg ? esc(S.profile.nick ? initials(S.profile.nick) : "TU") : ""}</span>`; }).join("")}
    <span class="dRingC">Passa a<b>${dir > 0 ? "sinistra" : "destra"}</b></span></div>`;
}
const strip = (p, i, n = 1) => { const c = cardOf(p); return `<button class="dStrip" data-pool="${i}" style="--c:var(--c${c.color || "Red"});background-image:linear-gradient(90deg,var(--surf) 38%,color-mix(in srgb,var(--surf) 35%,transparent)),url(${thumbUrl(p.id)})"><b>${c.type === "Legend" ? "L" : c.cost ?? "–"}</b><span>${esc(c.name)}</span>${c.eddiable && c.type !== "Legend" ? `<i class="dEd" title="Vendibile">€$</i>` : ""}${n > 1 ? `<em>×${n}</em>` : ""}</button>`; };
/* copie della stessa carta: una striscia sola con ×N */
const grouped = xs => { const m = new Map(); for(const x of xs){ const g = m.get(x.c.id); if(g) g.n++; else m.set(x.c.id, { ...x, n: 1 }); } return [...m.values()]; };
const items = pool => pool.map((p, i) => ({ p, i, c: cardOf(p) }));
const mainCards = pool => items(pool).filter(x => x.c.type !== "Legend" && !inSide(x.i));
function poolHTML(pool, mode){
  const xs0 = mainCards(pool);
  if(!xs0.length) return `<div class="sub" style="padding:8px 2px">Le carte che prendi finiscono qui, divise per ${mode === "color" ? "colore" : "costo"}.</div>`;
  const groups = mode === "color"
    ? COLS.map(k => [COLOR_IT[k], xs0.filter(x => x.c.color === k)])
    : [0, 1, 2, 3, 4, 5, 6].map(k => [k === 6 ? "6+" : String(k), xs0.filter(x => Math.min(6, x.c.cost ?? 0) === k)]);
  return `<div class="dCols ${mode}">${groups.map(([lab, xs]) => `<div class="dCol${xs.length ? "" : " none"}"><div class="dColH"><span>${mode === "color" ? "" : "Costo "}${esc(lab)}</span><b>${xs.length}</b></div>${grouped(xs).sort((a, b) => (a.c.cost ?? 0) - (b.c.cost ?? 0) || String(a.c.color).localeCompare(b.c.color) || a.c.name.localeCompare(b.c.name)).map(x => strip(x.p, x.i, x.n)).join("")}</div>`).join("")}</div>`;
}
function sideHTML(pool){
  const xs = items(pool).filter(x => inSide(x.i));
  return `<div class="dSB" id="dSB" data-drop="side"><div class="dColH"><span>Sideboard</span><b>${xs.length}</b></div>
    ${xs.length ? grouped(xs).sort((a, b) => (a.c.type === "Legend") - (b.c.type === "Legend") || (a.c.cost ?? 0) - (b.c.cost ?? 0) || a.c.name.localeCompare(b.c.name)).map(x => strip(x.p, x.i, x.n)).join("") : `<div class="dSBe">Trascina qui le carte che non vuoi nel mazzo: restano nel pool, fuori dal mazzo proposto.</div>`}</div>`;
}
function statsOf(pool){
  const n = {}; let ed = 0;
  for(const x of mainCards(pool)){ if(x.c.color) n[x.c.color] = (n[x.c.color] || 0) + 1; if(x.c.eddiable) ed++; }
  return { n, ed, main: mainCards(pool).length, side: D.side.length };
}
const chipsHTML = pool => { const s = statsOf(pool); return COLS.map(k => `<span class="dChip" title="${COLOR_IT[k]}"><i style="background:var(--c${k})"></i>${s.n[k] || 0}</span>`).join("") + `<span class="dChip ed" title="Vendibili">€$ ${s.ed}</span>`; };
const legsOf = pool => items(pool).filter(x => x.c.type === "Legend" && !inSide(x.i));
const legBtns = legs => legs.map(x => `<button class="dLeg" data-pool="${x.i}"><img src="${thumbUrl(x.p.id)}" alt="${esc(cardOf(x.p).dn)}" draggable="false"></button>`).join("");
function barsHTML(pool){
  const s = statsOf(pool), mx = Math.max(1, ...COLS.map(k => s.n[k] || 0));
  return COLS.map(k => `<div class="dBar"><span><i style="background:var(--c${k})"></i>${COLOR_IT[k]}</span><em><i style="width:${((s.n[k] || 0) / mx * 100).toFixed(0)}%;background:var(--c${k})"></i></em><b>${s.n[k] || 0}</b></div>`).join("")
    + `<div class="dEdLine"><span>Vendibili <b>${s.ed}</b>${s.main ? ` (${Math.round(s.ed / s.main * 100)}%)` : ""}</span><span>Sideboard <b>${s.side}</b></span></div>`;
}
function previewHTML(p){
  if(!p) return `<div class="dPrevE">Passa il mouse su una carta per leggerla · tasto destro o tieni premuto per ingrandirla</div>`;
  const c = cardOf(p);
  return `<img src="${imgUrl(p.id)}" alt="${esc(c.dn)}"><div class="dPrevT"><b>${esc(c.name)}</b>${c.sub ? `<small>${esc(c.sub)}</small>` : ""}<div class="dMeta"><i class="pip ${c.color || ""}"></i> ${COLOR_IT[c.color] || ""} · ${TYPE_IT[c.type] || c.type}${c.eddiable && c.type !== "Legend" ? " · €$" : ""}</div><div class="dStats"><span>Costo <b>${c.cost ?? "–"}</b></span>${c.power != null ? `<span>Potenza <b>${c.power}</b></span>` : ""}${c.ram != null ? `<span>RAM <b>${c.ram}</b></span>` : ""}</div><div class="dRules">${rulesHTML(c.text) || ""}</div>${glossHTML(c)}</div>`;
}
/* parole chiave spiegate (dal regolamento ufficiale) */
const GLOSS = [
  ["Play", "quando giochi questa carta."], ["Attack", "quando questa Unità attacca."], ["Call", "quando scopri questa Leggenda con la Chiamata."],
  ["Defeated", "quando questa carta viene sconfitta."], ["Spend", "costo di attivazione: spendi questa Unità o Leggenda per usare l'effetto."],
  ["Blocker", "quando un'Unità rivale attacca, puoi spendere questa Unità per dirottare l'attacco su di lei."],
  ["Adrenaline", "questa Unità può attaccare nel turno in cui viene giocata."],
  ["Go Solo", "paghi il costo della Leggenda e la giochi come Unità pronta: può attaccare subito; se lascia il campo, è rimossa dal gioco."],
  ["Quick", "puoi usare l'effetto (o giocare il Programma) anche in risposta all'attacco di un'Unità rivale."],
  ["Call a Legend", "scoprire una tua Leggenda coperta pagando 1 €$ (una volta per turno)."]
];
function glossHTML(c){
  const t = c.text || "", kw = c.kw || [];
  return GLOSS.filter(([k]) => k === "Call a Legend" ? /Call a Legend/i.test(t) : (t.includes("{" + k + "}") || kw.includes(k))).map(([k, v]) => `<div class="dGl"><b>${k}</b> ${v}</div>`).join("");
}
function inspectorHTML(){
  if(!ins) return "";
  const p = ins.list[ins.idx], c = cardOf(p), n = ins.list.length, pi = ins.take ? -1 : ins.pool[ins.idx];
  const acts = ins.take
    ? `<button class="btn" id="dInsClose">Chiudi</button><button class="btn" id="dInsSide">In sideboard</button><button class="btn yel" id="dInsTake">Prendi ${esc(c.name)}</button>`
    : `<button class="btn" id="dInsClose">Chiudi</button><button class="btn${inSide(pi) ? " acc2" : ""}" id="dInsMove">${inSide(pi) ? "Rimetti nel mazzo" : "Sposta in sideboard"}</button>`;
  return `<div class="dIns" id="dIns"><div class="dInsBox" role="dialog" aria-label="${esc(c.dn)}">
    <div class="dInsNav">${n > 1 ? `<button class="btn sm icon" data-insstep="-1" aria-label="Carta precedente"${ins.idx ? "" : " disabled"}>‹</button>` : ""}<span>${ins.take ? `Carta ${ins.idx + 1} di ${n} nella busta` : inSide(pi) ? "In sideboard" : `Il tuo pool · ${ins.idx + 1} di ${n}`}</span>${n > 1 ? `<button class="btn sm icon" data-insstep="1" aria-label="Carta successiva"${ins.idx < n - 1 ? "" : " disabled"}>›</button>` : ""}</div>
    <div class="dInsGrid"><img class="dInsImg" id="dInsImg" src="${imgUrl(p.id)}" alt="${esc(c.dn)}" title="Tocca per ingrandire">
      <div class="dInsInfo"><h3>${esc(c.name)}</h3>${c.sub ? `<small>${esc(c.sub)}</small>` : ""}
        <div class="dMeta"><i class="pip ${c.color || ""}"></i> ${COLOR_IT[c.color] || ""} · ${TYPE_IT[c.type] || c.type}${c.cls && c.cls.length ? " · " + esc(c.cls.join(", ")) : ""}</div>
        <div class="dStats"><span>Costo <b>${c.cost ?? "–"}</b></span>${c.power != null ? `<span>Potenza <b>${c.power}</b></span>` : ""}${c.ram != null ? `<span>RAM <b>${c.ram}</b></span>` : ""}${c.eddiable && c.type !== "Legend" ? `<span>Vendibile €$</span>` : ""}${p.rarity && p.rarity !== "Common" ? `<span>${esc(p.rarity)}</span>` : ""}</div></div>
      <div class="dInsTxt"><div class="dRules big">${rulesHTML(c.text) || "<i>Nessun testo.</i>"}</div>${glossHTML(c)}</div></div>
    <div class="dInsAct">${acts}</div>
  </div></div>`;
}
function stepsHTML(round){ return `<div class="dSteps">${["Leggende", "Busta 1", "Busta 2", "Busta 3", "Busta 4"].map((t, i) => `<span class="${i < round ? "done" : i === round ? "on" : ""}">${t}</span>`).join("")}</div>`; }

function render(newPick){
  const root = document.getElementById("draft"); if(!root || root.hidden) return;
  const st = replay(D);
  if(!st){ discardDraft(); closeDraft(); return; }
  const { seats } = seatsOf(D);
  const pool = st.pools[0], legs = legsOf(pool), stt = statsOf(pool);
  const mode = S.settings.draftPool === "color" ? "color" : "cost";
  const alpha = `<b class="dAlpha" title="Modalità in prova: possono esserci errori">ALPHA</b>`;
  const legsBlock = legs.length ? `<div class="dColH legs"><span>Leggende</span><b>${legs.length}</b></div><div class="dLegBox"><div class="dLegs">${legBtns(legs)}</div></div>` : "";
  if(st.done){
    stopTimer();
    const opps = draftOpponents(D);
    root.innerHTML = `<div class="dEnd">
      <div class="dHd"><div class="dTitle"><span class="k">Draft contro l'IA<span class="dSet"> · ${esc(setName(D.set))}</span> ${alpha}</span><h2>Draft completo</h2></div><button class="btn sm icon dExit" id="dExit" aria-label="Chiudi">✕</button></div>
      <div class="dEndBody">
        <div class="card"><h3>Il tuo pool · ${stt.main} carte + ${legs.length} Leggende</h3>
          <div class="dLegBox"><div class="dLegs">${legBtns(legs)}</div></div>
          ${barsHTML(pool)}
          <p class="sub">Ti proponiamo un mazzo con tutte le carte del pool tranne quelle in sideboard: poi scegli <b>3 Leggende</b> e almeno <b>30 carte</b> di massimo 3 colori (le Leggende non contano). Le carte del draft non entrano nella collezione.</p>
          <button class="btn yel" id="dBuild">Costruisci il mazzo</button></div>
        <div class="card"><h3>Le sfide del tuo tavolo</h3>
          ${opps.map(o => `<div class="dOpp"><span class="seat" style="background-image:url(${o.img})"></span><b>${esc(o.name)}</b></div>`).join("")}
          <p class="sub">3 partite contro i bot del tuo tavolo: le trovi nel Simulator, scheda Prerelease e draft, scegliendo questo mazzo.</p></div>
        <div class="card dPoolEnd dPool" data-drop="main"><div class="dPoolBody"><div class="dPoolB">${poolHTML(pool, mode)}</div>${sideHTML(pool)}</div></div>
      </div></div>${inspectorHTML()}`;
    return;
  }
  const pack = st.packs[0], r = st.round, dir = DIR[r];
  const total = r === 0 ? 4 : 12;
  const title = r === 0 ? `Giro delle Leggende · Scelta ${st.pick + 1}` : `Busta ${r} · Scelta ${st.pick + 1}`;
  if(sel != null && sel >= pack.length) sel = null;
  const prevP = pack[hoverI ?? sel ?? -1] || null;
  const card = (p, i) => { const c = cardOf(p), ep = r === 0 && (p.rarity === "Epic" || p.rarity === "Secret"); return `<button class="dc${i === sel ? " sel" : ""}" data-i="${i}" aria-label="${esc(c.dn)}"><img src="${thumbUrl(p.id)}" alt="" draggable="false">${ep ? `<span class="dEpic">EPIC+</span>` : ""}</button>`; };
  const takeLbl = sel != null ? `Prendi «${esc(cardOf(pack[sel]).name)}»` : "Scegli una carta";
  root.innerHTML = `<div class="dft${poolSt === 2 ? " poolOpen" : poolSt === 1 ? " poolHalf" : ""}">
    <div class="dHd">
      <div class="dTitle"><span class="k">Draft contro l'IA<span class="dSet"> · ${esc(setName(D.set))}</span> ${alpha}</span><h2>${title}</h2><span class="dDir">${`Scelta ${st.pick + 1} di ${total}`} · passa a ${dir > 0 ? "sinistra" : "destra"}</span></div>
      ${stepsHTML(r)}
      <div class="dTimer"${D.timer ? "" : " hidden"}><em><i id="dTb"></i></em><b id="dT"></b></div>
      ${ringHTML(seats, dir)}
      <button class="btn sm icon dExit" id="dExit" aria-label="Esci dal draft (lo riprendi quando vuoi)" title="Esci: il draft resta salvato">✕</button>
    </div>
    <div class="dPack" id="dPack"><div class="dPackH"><span class="k">${pack.length} ${pack.length === 1 ? "carta" : "carte"} · ${r === 0 ? "scegli una Leggenda" : "scegline una"}</span><span class="dHint">Clic per scegliere · doppio clic per prendere · tasto destro o tieni premuto per ingrandire · trascina nel pool o in sideboard</span></div>
      <div class="dGrid${r === 0 ? " legs" : ""}">${pack.map(card).join("")}</div></div>
    <aside class="dSide">
      <div class="card dPrev" id="dPrev">${previewHTML(prevP)}</div>
      <div class="card"><h3>Le tue Leggende · ${legs.length}</h3><div class="dLegBox"><div class="dLegs">${legBtns(legs)}${"<span class='dLegE'></span>".repeat(Math.max(0, 4 - legs.length))}</div></div><div class="sub">Nel mazzo ne vanno 3.</div></div>
      <div class="card"><h3>Colori</h3>${barsHTML(pool)}<div class="sub">Nel mazzo al massimo <b>3 colori</b> (le Leggende non contano). I conteggi escludono la sideboard.</div></div>
      <button class="btn yel dTake" ${sel == null ? "disabled" : ""}>${takeLbl}</button>
    </aside>
    <section class="dPool" id="dPool" data-drop="main">
      <button class="dGrab" id="dGrab" aria-label="${poolSt ? "Chiudi il pool" : "Apri il pool"}"><i></i></button>
      <div class="dPoolH"><button class="dPoolT" id="dPoolT"><span class="k">Il tuo pool · ${stt.main}${stt.side ? ` + ${stt.side} SB` : ""}</span><span class="dArr">${poolSt === 2 ? "▼" : "▲"}</span></button><span class="dChips">${chipsHTML(pool)}</span>
        <span class="seg dSeg" id="dSeg"><button data-v="cost" aria-pressed="${mode === "cost"}">Costo</button><button data-v="color" aria-pressed="${mode === "color"}">Colore</button></span></div>
      <div class="dPoolMini"><div class="dLegs mini">${legBtns(legs.slice(0, 3))}${legs.length > 3 ? `<span class="dLegMore">+${legs.length - 3}</span>` : ""}</div><span style="flex:1"></span><button class="btn yel dTake" ${sel == null ? "disabled" : ""}>Prendi</button></div>
      <div class="dDrops"><div data-drop="main">Nel pool</div><div data-drop="side">In sideboard</div></div>
      <div class="dPoolBody" id="dPoolBody"><div class="dPoolB" id="dPoolB">${legsBlock}${poolHTML(pool, mode)}</div>${sideHTML(pool)}</div>
    </section>
  </div>${inspectorHTML()}`;
  if(newPick) startTimer(pack.length, r);
  else tickTimer();
}
function refreshSel(){
  const root = document.getElementById("draft"); const st = replay(D); if(!st || st.done) return;
  const pack = st.packs[0];
  root.querySelectorAll(".dc").forEach(b => b.classList.toggle("sel", +b.dataset.i === sel));
  root.querySelectorAll(".dTake").forEach(b => { b.disabled = sel == null; if(b.closest(".dSide")) b.textContent = sel != null ? `Prendi «${cardOf(pack[sel]).name}»` : "Scegli una carta"; });
  const pv = root.querySelector("#dPrev"); if(pv) pv.innerHTML = previewHTML(pack[hoverI ?? sel ?? -1] || null);
}
/* ridisegno che non perde lo scorrimento del pool */
function rerender(newPick){
  const sb = document.getElementById("dPoolBody"), y = sb ? sb.scrollTop : 0, pb = document.getElementById("dPoolB"), y2 = pb ? pb.scrollTop : 0;
  render(newPick);
  const sb2 = document.getElementById("dPoolBody"); if(sb2) sb2.scrollTop = y; const pb2 = document.getElementById("dPoolB"); if(pb2) pb2.scrollTop = y2;
}

/* ------------------------------------------------------------ azioni */
function take(i, toSide = false){
  const st = replay(D); if(!st || st.done) return;
  if(!(i >= 0 && i < st.packs[0].length)) return;
  const at = st.pools[0].length;
  D.picks.push(i); if(toSide) D.side.push(at); save(); sel = null; ins = null; hoverI = null;
  rerender(true);
  const pc = document.querySelector("#dPoolT .k"); if(pc){ pc.classList.remove("bump"); void pc.offsetWidth; pc.classList.add("bump"); }
}
function setSide(i, on){
  const has = inSide(i); if(on === has) return;
  if(on) D.side.push(i); else D.side = D.side.filter(x => x !== i);
  save();
}
function autoPick(){ const st = replay(D); if(!st || st.done) return; take(sel ?? botPick(0, st.pools[0], st.packs[0], st.round, D.seed, st.k)); }

function stopTimer(){ if(timerId){ clearInterval(timerId); timerId = null; } }
function startTimer(n, round){
  stopTimer(); if(!D.timer) return;
  perPick = (round === 0 ? 30 : 15 + 5 * n) * 1000; deadline = Date.now() + perPick;
  timerId = setInterval(tickTimer, 250); tickTimer();
}
function tickTimer(){
  if(!D || !D.timer || !timerId) return;
  const left = Math.max(0, deadline - Date.now()), s = Math.ceil(left / 1000);
  const t = document.getElementById("dT"), b = document.getElementById("dTb");
  if(t) t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if(b){ b.style.width = (left / perPick * 100).toFixed(1) + "%"; b.parentElement.classList.toggle("low", s <= 10); }
  if(left <= 0){ stopTimer(); autoPick(); }
}

/* scheda ingrandita: carta della busta (si può prendere) o del pool (si sposta in sideboard e ritorno) */
function openPackIns(i){ const st = replay(D); if(!st || st.done) return; sel = i; ins = { list: st.packs[0], idx: i, take: true }; rerender(); }
function openPoolIns(i){
  const st = replay(D); if(!st) return; const pool = st.pools[0];
  // si sfogliano le carte dello stesso gruppo: mazzo o sideboard
  const idx = items(pool).filter(x => inSide(x.i) === inSide(i)).map(x => x.i);
  ins = { list: idx.map(k => pool[k]), pool: idx, idx: Math.max(0, idx.indexOf(i)), take: false }; rerender();
}

let sheet = null;   // trascinamento della tendina del pool (telefono in verticale)
function wire(root){
  let press = null, drag = null, hot = null, swallow = 0;
  const phone = () => matchMedia("(max-width: 699px)").matches;
  root.addEventListener("pointerdown", e => {
    if(!phone() || ins || !e.target.closest("#dGrab, .dPoolH") || e.target.closest("#dSeg, .dChips")) return;
    const el = root.querySelector(".dPool"); if(!el) return;
    const r = el.getBoundingClientRect();
    sheet = { y0: e.clientY, top0: r.top, el, moved: false, closedTop: poolSt === 0 ? r.top : innerHeight - 150 };
  });
  window.addEventListener("pointermove", e => {
    if(!sheet) return;
    const dy = e.clientY - sheet.y0; if(!sheet.moved && Math.abs(dy) < 6) return;
    if(!sheet.moved){ sheet.moved = true; root.querySelector(".dft")?.classList.add("poolDrag"); }
    sheet.el.style.top = Math.max(64, Math.min(sheet.closedTop, sheet.top0 + dy)) + "px";
  });
  const endSheet = () => {
    if(!sheet) return; const s = sheet;
    if(s.moved){
      const top = s.el.getBoundingClientRect().top, snaps = [[0, s.closedTop], [1, innerHeight * 0.5], [2, 64]];
      poolSt = snaps.reduce((a, b) => Math.abs(b[1] - top) < Math.abs(a[1] - top) ? b : a)[0];
      s.el.style.top = ""; root.querySelector(".dft")?.classList.remove("poolDrag");
      rerender(); setTimeout(() => { sheet = null; }, 0);   // il clic che segue il trascinamento non apre/chiude di nuovo
    } else sheet = null;
  };
  window.addEventListener("pointerup", endSheet); window.addEventListener("pointercancel", endSheet);
  const packList = () => { const st = replay(D); return st && !st.done ? st.packs[0] : []; };
  const target = (x, y) => { const el = document.elementFromPoint(x, y); const t = el && el.closest("[data-drop]"); return t && root.contains(t) ? t : null; };
  const endDrag = (x, y, drop) => {
    if(!drag) return;
    const t = drop ? target(x, y) : null;   // prima di nascondere le zone di rilascio
    drag.ghost.remove(); hot?.classList.remove("drop"); hot = null; root.querySelector(".dft")?.classList.remove("dragging");
    const d = drag; drag = null; if(!t) return; const side = t.dataset.drop === "side";
    if(d.kind === "pack") take(d.i, side);
    else { setSide(d.i, side); rerender(); }
  };
  root.addEventListener("click", e => {
    const t = e.target;
    if(Date.now() - swallow < 450 && !t.closest(".dInsBox")){ e.preventDefault(); return; }   // il rilascio dopo una pressione lunga non deve chiudere la scheda appena aperta
    if(t.closest("#dExit")){ closeDraft(); return; }
    if(t.closest("#dBuild")){ build(); return; }
    if(t.closest("#dInsImg") && ins){ openLens(imgUrl(ins.list[ins.idx].id)); return; }
    if(t.closest("#dInsClose") || t.id === "dIns"){ ins = null; rerender(); return; }
    if(t.closest("#dInsTake") && ins){ take(ins.idx); return; }
    if(t.closest("#dInsSide") && ins){ take(ins.idx, true); return; }
    if(t.closest("#dInsMove") && ins){ const i = ins.pool[ins.idx]; setSide(i, !inSide(i)); ins = null; rerender(); return; }
    const st = t.closest("[data-insstep]"); if(st && ins){ ins.idx = Math.max(0, Math.min(ins.list.length - 1, ins.idx + +st.dataset.insstep)); if(ins.take) sel = ins.idx; rerender(); return; }
    if(t.closest(".dTake")){ if(sel != null) take(sel); return; }
    if(t.closest("#dGrab") || t.closest("#dPoolT")){ if(sheet && sheet.moved) return; poolSt = poolSt ? 0 : 1; rerender(); return; }
    const sg = t.closest("#dSeg button"); if(sg){ S.settings.draftPool = sg.dataset.v; S.save("settings"); rerender(); return; }
    const pl = t.closest("[data-pool]"); if(pl){ if(pl.dataset.noclick){ delete pl.dataset.noclick; return; } openPoolIns(+pl.dataset.pool); return; }
    const c = t.closest(".dc"); if(c){ if(c.dataset.noclick){ delete c.dataset.noclick; return; } sel = +c.dataset.i; refreshSel(); return; }
  });
  root.addEventListener("dblclick", e => { const c = e.target.closest(".dc"); if(c) take(+c.dataset.i); });
  root.addEventListener("pointerover", e => { if(e.pointerType !== "mouse") return; const c = e.target.closest(".dc"); const v = c ? +c.dataset.i : null; if(v !== hoverI){ hoverI = v; const pv = root.querySelector("#dPrev"); if(pv) pv.innerHTML = previewHTML(packList()[hoverI ?? sel ?? -1] || null); } });
  // tasto destro: ingrandisce
  root.addEventListener("contextmenu", e => {
    const c = e.target.closest(".dc"), pl = e.target.closest("[data-pool]");
    if((c || pl) && (drag || (press && !press.mouse))){ e.preventDefault(); return; }   // al tocco ci pensa la pressione lunga
    if(c){ e.preventDefault(); openPackIns(+c.dataset.i); } else if(pl){ e.preventDefault(); openPoolIns(+pl.dataset.pool); }
  });
  root.addEventListener("pointerdown", e => {
    if(e.button > 0 || ins) return;
    const c = e.target.closest(".dc"), pl = !c && e.target.closest("[data-pool]"); const el = c || pl; if(!el) return;
    press = { el, kind: c ? "pack" : "pool", i: +(c ? c.dataset.i : pl.dataset.pool), x: e.clientX, y: e.clientY, mouse: e.pointerType === "mouse", lifted: false };
    if(press.mouse) press.timer = setTimeout(() => { if(!press || drag) return; const p = press; press = null; swallow = Date.now(); p.el.dataset.noclick = "1"; p.kind === "pack" ? openPackIns(p.i) : openPoolIns(p.i); }, 500);   // tenuto fermo col mouse: ingrandisce
    else press.timer = setTimeout(() => { if(!press) return; press.lifted = true; el.classList.add("lift"); el.insertAdjacentHTML("beforeend", `<span class="dTip">Rilascia per ingrandire · trascina per prendere</span>`); navigator.vibrate?.(15); }, 300);
  });
  const startDrag = (e) => {
    clearTimeout(press.timer);
    const r = press.el.getBoundingClientRect(), g = document.createElement("div");
    const src = press.kind === "pack" ? press.el.querySelector("img").src : thumbUrl(replay(D).pools[0][press.i].id);
    const w = press.kind === "pack" ? r.width : 110;
    g.className = "dGhost"; g.style.width = w + "px"; g.innerHTML = `<img src="${src}" alt="">`; document.body.appendChild(g);
    drag = { kind: press.kind, i: press.i, ghost: g, w, h: w * 1024 / 733 }; press.el.dataset.noclick = "1"; press.el.classList.remove("lift");
    root.querySelector(".dft")?.classList.add("dragging");
    moveGhost(e.clientX, e.clientY);
  };
  const moveGhost = (x, y) => {
    if(!drag) return; drag.ghost.style.transform = `translate(${x - drag.w / 2}px, ${y - drag.h * 0.6}px) rotate(-6deg)`;
    const t = target(x, y); if(t !== hot){ hot?.classList.remove("drop"); hot = t; hot?.classList.add("drop"); }
  };
  window.addEventListener("pointermove", e => {
    if(drag){ moveGhost(e.clientX, e.clientY); return; }
    if(!press) return;
    const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8;
    if(!far) return;
    if(press.mouse || press.lifted) startDrag(e);
    else { clearTimeout(press.timer); press = null; }   // è uno scorrimento
  });
  window.addEventListener("pointerup", e => {
    if(drag){ endDrag(e.clientX, e.clientY, true); press = null; return; }
    if(press){ clearTimeout(press.timer); if(press.lifted){ swallow = Date.now(); press.el.classList.remove("lift"); press.el.dataset.noclick = "1"; press.kind === "pack" ? openPackIns(press.i) : openPoolIns(press.i); } press = null; }
  });
  window.addEventListener("pointercancel", () => { if(drag) endDrag(0, 0, false); if(press){ clearTimeout(press.timer); press.el.classList.remove("lift"); press = null; } });
  // durante il trascinamento col dito la pagina non deve scorrere
  window.addEventListener("touchmove", e => { if(drag || press?.lifted || sheet?.moved) e.preventDefault(); }, { passive: false });
  window.addEventListener("keydown", e => { if(root.hidden) return; if(e.key === "Escape"){ if(ins){ ins = null; rerender(); } } if(e.key === "Enter" && sel != null && !ins) take(sel); });
}

/* a draft finito: il mazzo proposto ha tutte le carte del pool tranne la sideboard (che resta «non nel mazzo»);
   come Leggende le 3 migliori tra quelle non in sideboard */
function build(){
  const st = replay(D); if(!st || !st.done) return;
  const pool = st.pools[0];
  const deck = poolToDeck(pool, `Draft ${setName(D.set)}`);
  deck.draft = { set: D.set, seed: D.seed, picks: D.picks.slice(), res: "---" };
  deck.notes = `Draft ${setName(D.set)} contro l'IA (alpha)`;
  const byCid = new Map();
  for(const x of mainCards(pool)){ const e = byCid.get(x.c.id) || { cid: x.c.id, pid: x.p.id, n: 0, prints: [] }; e.n++; e.prints.push(x.p.id); byCid.set(x.c.id, e); }
  deck.cards = [...byCid.values()];
  const cols = new Set(deck.cards.map(e => DATA.byId.get(e.cid).color));
  const legs = legsOf(pool).map(x => ({ x, s: legendScore(x.c) + (cols.has(x.c.color) ? 1.5 : 0) })).sort((a, b) => b.s - a.s);
  const chosen = []; for(const { x } of legs) if(chosen.length < 3 && !chosen.some(y => y.c.id === x.c.id)) chosen.push(x);
  deck.legends = chosen.map(x => ({ cid: x.c.id, pid: x.p.id })); while(deck.legends.length < 3) deck.legends.push(null);
  saveDeck(deck); discardDraft(); closeDraft();
  if(onBuildCb) onBuildCb(deck.id);
}
