/* Draft contro l'IA (alpha). Un tavolo da 8: tu e 7 bot.
   - Giro delle Leggende: ognuno apre una busta da 4 Leggende (3 Rare e uno slot Epic+), ne prende una e passa le altre;
   - 4 buste da 12 carte come quelle del kit Prerelease, con il passaggio che alterna sinistra e destra;
   - con quello che hai preso costruisci un mazzo sealed (3 Leggende, almeno 30 carte, massimo 3 colori) e sfidi 3 bot del tavolo.
   Il draft si rigioca identico da espansione, seme e scelte: così il mazzo si può verificare (anche online) e le buste
   dei bot non vanno salvate. Le carte del draft non entrano nella collezione.                                         */

import { DATA, COLOR_IT, TYPE_IT, thumbUrl, imgUrl, setName, rulesHTML } from "./data.js";
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
let D = null;          // { set, seed, picks, timer }
let sel = null, poolOpen = false, ins = null, onBuildCb = null, hoverI = null;
let timerId = null, deadline = 0, perPick = 0;
const save = () => rawSet("draft", D);
export const savedDraft = () => { const d = rawGet("draft", null); return d && typeof d === "object" && Array.isArray(d.picks) && replay(d) ? d : null; };
export function discardDraft(){ rawDel("draft"); D = null; }

export function startDraft(set, opts = {}){
  D = { set, seed: (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0, picks: [], timer: !!opts.timer };
  save(); openDraft(opts.onBuild);
}
export function openDraft(onBuild){
  if(!D) D = savedDraft(); if(!D) return;
  if(onBuild) onBuildCb = onBuild;
  sel = null; ins = null; poolOpen = false;
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
const strip = (p, i, n = 1) => { const c = cardOf(p); return `<button class="dStrip" data-pool="${i}" style="--c:var(--c${c.color || "Red"});background-image:linear-gradient(90deg,var(--surf) 38%,color-mix(in srgb,var(--surf) 35%,transparent)),url(${thumbUrl(p.id)})"><b>${c.cost ?? "–"}</b><span>${esc(c.name)}</span>${n > 1 ? `<em>×${n}</em>` : ""}</button>`; };
/* copie della stessa carta: una striscia sola con ×N */
const grouped = xs => { const m = new Map(); for(const x of xs){ const g = m.get(x.c.id); if(g) g.n++; else m.set(x.c.id, { ...x, n: 1 }); } return [...m.values()]; };
function poolHTML(pool, mode){
  const items = pool.map((p, i) => ({ p, i, c: cardOf(p) })).filter(x => x.c.type !== "Legend");
  const groups = mode === "color"
    ? COLS.map(k => [COLOR_IT[k], items.filter(x => x.c.color === k)])
    : [0, 1, 2, 3, 4, 5, 6].map(k => [k === 6 ? "6+" : String(k), items.filter(x => Math.min(6, x.c.cost ?? 0) === k)]);
  return `<div class="dCols ${mode}">${groups.map(([lab, xs]) => `<div class="dCol${xs.length ? "" : " none"}"><div class="dColH"><span>${mode === "color" ? "" : "Costo "}${esc(lab)}</span><b>${xs.length}</b></div>${grouped(xs).sort((a, b) => (a.c.cost ?? 0) - (b.c.cost ?? 0) || String(a.c.color).localeCompare(b.c.color) || a.c.name.localeCompare(b.c.name)).map(x => strip(x.p, x.i, x.n)).join("")}</div>`).join("")}</div>`;
}
const chipsHTML = pool => { const n = {}; for(const p of pool){ const c = cardOf(p); if(c.type !== "Legend" && c.color) n[c.color] = (n[c.color] || 0) + 1; } return COLS.map(k => `<span class="dChip" title="${COLOR_IT[k]}"><i style="background:var(--c${k})"></i>${n[k] || 0}</span>`).join(""); };
const legsOf = pool => pool.map((p, i) => ({ p, i })).filter(x => cardOf(x.p).type === "Legend");
function barsHTML(pool){
  const n = {}; for(const p of pool){ const c = cardOf(p); if(c.type !== "Legend" && c.color) n[c.color] = (n[c.color] || 0) + 1; }
  const mx = Math.max(1, ...COLS.map(k => n[k] || 0));
  return COLS.map(k => `<div class="dBar"><span><i style="background:var(--c${k})"></i>${COLOR_IT[k]}</span><em><i style="width:${((n[k] || 0) / mx * 100).toFixed(0)}%;background:var(--c${k})"></i></em><b>${n[k] || 0}</b></div>`).join("");
}
function previewHTML(p){
  if(!p) return `<div class="dPrevE">Passa il mouse su una carta per leggerla</div>`;
  const c = cardOf(p);
  return `<img src="${imgUrl(p.id)}" alt="${esc(c.dn)}"><div><b>${esc(c.name)}</b>${c.sub ? `<small>${esc(c.sub)}</small>` : ""}<div class="dMeta"><i class="pip ${c.color || ""}"></i> ${COLOR_IT[c.color] || ""} · ${TYPE_IT[c.type] || c.type}</div><div class="dStats"><span>Costo <b>${c.cost ?? "–"}</b></span>${c.power != null ? `<span>Potenza <b>${c.power}</b></span>` : ""}${c.ram != null ? `<span>RAM <b>${c.ram}</b></span>` : ""}</div><div class="dRules">${rulesHTML(c.text) || ""}</div></div>`;
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
function inspectorHTML(st){
  if(!ins) return "";
  const p = ins.list[ins.idx], c = cardOf(p), n = ins.list.length;
  return `<div class="dIns" id="dIns"><div class="dInsBox" role="dialog" aria-label="${esc(c.dn)}">
    <div class="dInsNav">${n > 1 ? `<button class="btn sm icon" data-insstep="-1" aria-label="Carta precedente"${ins.idx ? "" : " disabled"}>‹</button>` : ""}<span>${ins.take ? `Carta ${ins.idx + 1} di ${n} nella busta` : `Il tuo pool · ${ins.idx + 1} di ${n}`}</span>${n > 1 ? `<button class="btn sm icon" data-insstep="1" aria-label="Carta successiva"${ins.idx < n - 1 ? "" : " disabled"}>›</button>` : ""}</div>
    <div class="dInsTop"><img src="${imgUrl(p.id)}" alt="${esc(c.dn)}"><div><h3>${esc(c.name)}</h3>${c.sub ? `<small>${esc(c.sub)}</small>` : ""}
      <div class="dMeta"><i class="pip ${c.color || ""}"></i> ${COLOR_IT[c.color] || ""} · ${TYPE_IT[c.type] || c.type}${c.cls && c.cls.length ? " · " + esc(c.cls.join(", ")) : ""}</div>
      <div class="dStats"><span>Costo <b>${c.cost ?? "–"}</b></span>${c.power != null ? `<span>Potenza <b>${c.power}</b></span>` : ""}${c.ram != null ? `<span>RAM <b>${c.ram}</b></span>` : ""}${p.rarity && p.rarity !== "Common" ? `<span>${esc(p.rarity)}</span>` : ""}</div></div></div>
    <div class="dRules big">${rulesHTML(c.text) || "<i>Nessun testo.</i>"}</div>${glossHTML(c)}
    <div class="dInsAct"><button class="btn" id="dInsClose">Chiudi</button>${ins.take ? `<button class="btn yel" id="dInsTake">Prendi ${esc(c.name)}</button>` : ""}</div>
  </div></div>`;
}
function stepsHTML(round){ return `<div class="dSteps">${["Leggende", "Busta 1", "Busta 2", "Busta 3", "Busta 4"].map((t, i) => `<span class="${i < round ? "done" : i === round ? "on" : ""}">${t}</span>`).join("")}</div>`; }

function render(newPick){
  const root = document.getElementById("draft"); if(!root || root.hidden) return;
  const st = replay(D);
  if(!st){ discardDraft(); closeDraft(); return; }
  const { seats } = seatsOf(D);
  const pool = st.pools[0], legs = legsOf(pool);
  const mode = S.settings.draftPool === "color" ? "color" : "cost";
  const alpha = `<b class="dAlpha" title="Modalità in prova: possono esserci errori">ALPHA</b>`;
  if(st.done){
    stopTimer();
    const opps = draftOpponents(D);
    root.innerHTML = `<div class="dEnd">
      <div class="dHd"><div class="dTitle"><span class="k">Draft contro l'IA · ${esc(setName(D.set))} ${alpha}</span><h2>Draft completo</h2></div><span style="flex:1"></span><button class="btn sm icon" id="dExit" aria-label="Chiudi">✕</button></div>
      <div class="dEndBody">
        <div class="card"><h3>Il tuo pool · ${pool.length - legs.length} carte + ${legs.length} Leggende</h3>
          <div class="dLegs">${legs.map(x => `<button class="dLeg" data-pool="${x.i}"><img src="${thumbUrl(x.p.id)}" alt="${esc(cardOf(x.p).dn)}"></button>`).join("")}</div>
          ${barsHTML(pool)}
          <p class="sub">Scegli <b>3 Leggende</b> e almeno <b>30 carte</b> di massimo 3 colori (le Leggende non contano). Le carte del draft non entrano nella collezione.</p>
          <button class="btn yel" id="dBuild">Costruisci il mazzo</button></div>
        <div class="card"><h3>Le sfide del tuo tavolo</h3>
          ${opps.map(o => `<div class="dOpp"><span class="seat" style="background-image:url(${o.img})"></span><b>${esc(o.name)}</b></div>`).join("")}
          <p class="sub">3 partite contro i bot del tuo tavolo: le trovi nel Simulator, scheda Prerelease e draft, scegliendo questo mazzo.</p></div>
        <div class="card dPoolEnd">${poolHTML(pool, mode)}</div>
      </div></div>${inspectorHTML(st)}`;
    return;
  }
  const pack = st.packs[0], r = st.round, dir = DIR[r];
  const total = r === 0 ? 4 : 12;
  const title = r === 0 ? `Giro delle Leggende · Scelta ${st.pick + 1}` : `Busta ${r} · Scelta ${st.pick + 1}`;
  if(sel != null && sel >= pack.length) sel = null;
  const prevP = pack[hoverI ?? sel ?? -1] || null;
  const card = (p, i) => { const c = cardOf(p), ep = r === 0 && (p.rarity === "Epic" || p.rarity === "Secret"); return `<button class="dc${i === sel ? " sel" : ""}" data-i="${i}" aria-label="${esc(c.dn)}"><img src="${thumbUrl(p.id)}" alt="" draggable="false">${ep ? `<span class="dEpic">EPIC+</span>` : ""}</button>`; };
  const takeLbl = sel != null ? `Prendi «${esc(cardOf(pack[sel]).name)}»` : "Scegli una carta";
  root.innerHTML = `<div class="dft${poolOpen ? " poolOpen" : ""}">
    <div class="dHd">
      <div class="dTitle"><span class="k">Draft contro l'IA<span class="dSet"> · ${esc(setName(D.set))}</span> ${alpha}</span><h2>${title}</h2><span class="dDir">${r === 0 ? `Scelta ${st.pick + 1} di ${total}` : `Scelta ${st.pick + 1} di ${total}`} · passa a ${dir > 0 ? "sinistra" : "destra"}</span></div>
      ${stepsHTML(r)}
      <div class="dTimer"${D.timer ? "" : " hidden"}><em><i id="dTb"></i></em><b id="dT"></b></div>
      ${ringHTML(seats, dir)}
      <button class="btn sm icon dExit" id="dExit" aria-label="Esci dal draft (lo riprendi quando vuoi)" title="Esci: il draft resta salvato">✕</button>
    </div>
    <div class="dPack" id="dPack"><div class="dPackH"><span class="k">${pack.length} ${pack.length === 1 ? "carta" : "carte"} · ${r === 0 ? "scegli una Leggenda" : "scegline una"}</span><span class="dHint">Tocca per scegliere · tieni premuto per leggere o trascinare nel pool</span></div>
      <div class="dGrid${r === 0 ? " legs" : ""}">${pack.map(card).join("")}</div></div>
    <aside class="dSide">
      <div class="card dPrev" id="dPrev">${previewHTML(prevP)}</div>
      <div class="card"><h3>Le tue Leggende · ${legs.length}</h3><div class="dLegs">${legs.map(x => `<button class="dLeg" data-pool="${x.i}"><img src="${thumbUrl(x.p.id)}" alt="${esc(cardOf(x.p).dn)}"></button>`).join("")}${"<span class='dLegE'></span>".repeat(Math.max(0, 4 - legs.length))}</div><div class="sub">Nel mazzo ne vanno 3.</div></div>
      <div class="card"><h3>Colori</h3>${barsHTML(pool)}<div class="sub">Nel mazzo al massimo <b>3 colori</b> (le Leggende non contano).</div></div>
      <button class="btn yel dTake" ${sel == null ? "disabled" : ""}>${takeLbl}</button>
    </aside>
    <section class="dPool" id="dPool">
      <button class="dGrab" id="dGrab" aria-label="${poolOpen ? "Chiudi il pool" : "Apri il pool"}"><i></i></button>
      <div class="dPoolH"><button class="dPoolT" id="dPoolT"><span class="k">Il tuo pool · ${pool.length - legs.length}</span><span class="dArr">${poolOpen ? "▼" : "▲"}</span></button><span class="dChips">${chipsHTML(pool)}</span>
        <span class="seg dSeg" id="dSeg"><button data-v="cost" aria-pressed="${mode === "cost"}">Costo</button><button data-v="color" aria-pressed="${mode === "color"}">Colore</button></span></div>
      <div class="dPoolMini"><div class="dLegs mini">${legs.map(x => `<button class="dLeg" data-pool="${x.i}"><img src="${thumbUrl(x.p.id)}" alt="${esc(cardOf(x.p).dn)}"></button>`).join("")}</div><span style="flex:1"></span><button class="btn yel dTake" ${sel == null ? "disabled" : ""}>Prendi</button></div>
      <div class="dPoolB" id="dPoolB">${legs.length ? `<div class="dColH legs"><span>Leggende</span><b>${legs.length}</b></div><div class="dLegs">${legs.map(x => `<button class="dLeg" data-pool="${x.i}"><img src="${thumbUrl(x.p.id)}" alt="${esc(cardOf(x.p).dn)}"></button>`).join("")}</div>` : ""}${pool.length - legs.length ? poolHTML(pool, mode) : `<div class="sub" style="padding:8px 2px">Le carte che prendi finiscono qui, divise per ${mode === "color" ? "colore" : "costo"}.</div>`}</div>
    </section>
  </div>${inspectorHTML(st)}`;
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

/* ------------------------------------------------------------ azioni */
function take(i){
  const st = replay(D); if(!st || st.done) return;
  if(!(i >= 0 && i < st.packs[0].length)) return;
  D.picks.push(i); save(); sel = null; ins = null; hoverI = null;
  render(true);
  const pc = document.querySelector("#dPoolT .k"); if(pc){ pc.classList.remove("bump"); void pc.offsetWidth; pc.classList.add("bump"); }
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

function wire(root){
  let press = null, drag = null;
  const packList = () => { const st = replay(D); return st && !st.done ? st.packs[0] : []; };
  const poolList = () => { const st = replay(D); return st ? st.pools[0] : []; };
  const overPool = (x, y) => { const el = root.querySelector(".dPool"); if(!el) return false; const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  const endDrag = (x, y, drop) => {
    if(!drag) return; drag.ghost.remove(); root.querySelector(".dPool")?.classList.remove("drop");
    const i = drag.i; drag = null; if(drop && overPool(x, y)) take(i);
  };
  root.addEventListener("click", e => {
    const t = e.target;
    if(t.closest("#dExit")){ closeDraft(); return; }
    if(t.closest("#dBuild")){ build(); return; }
    if(t.closest("#dInsClose") || t.id === "dIns"){ ins = null; render(); return; }
    if(t.closest("#dInsTake") && ins){ take(ins.idx); return; }
    const st = t.closest("[data-insstep]"); if(st && ins){ ins.idx = Math.max(0, Math.min(ins.list.length - 1, ins.idx + +st.dataset.insstep)); if(ins.take) sel = ins.idx; render(); return; }
    if(t.closest(".dTake")){ if(sel != null) take(sel); return; }
    if(t.closest("#dGrab") || t.closest("#dPoolT")){ poolOpen = !poolOpen; render(); return; }
    const sg = t.closest("#dSeg button"); if(sg){ S.settings.draftPool = sg.dataset.v; S.save("settings"); render(); return; }
    const pl = t.closest("[data-pool]"); if(pl){ const list = poolList(); ins = { list, idx: +pl.dataset.pool, take: false }; render(); return; }
    const c = t.closest(".dc"); if(c){ if(c.dataset.noclick){ delete c.dataset.noclick; return; } sel = +c.dataset.i; refreshSel(); return; }
  });
  root.addEventListener("dblclick", e => { const c = e.target.closest(".dc"); if(c) take(+c.dataset.i); });
  root.addEventListener("pointerover", e => { if(e.pointerType !== "mouse") return; const c = e.target.closest(".dc"); const v = c ? +c.dataset.i : null; if(v !== hoverI){ hoverI = v; const pv = root.querySelector("#dPrev"); if(pv) pv.innerHTML = previewHTML(packList()[hoverI ?? sel ?? -1] || null); } });
  root.addEventListener("pointerdown", e => {
    const c = e.target.closest(".dc"); if(!c || e.button > 0) return;
    press = { c, i: +c.dataset.i, x: e.clientX, y: e.clientY, mouse: e.pointerType === "mouse", lifted: false, id: e.pointerId };
    if(!press.mouse) press.timer = setTimeout(() => { if(!press) return; press.lifted = true; c.classList.add("lift"); navigator.vibrate?.(15); }, 320);
  });
  const startDrag = (e) => {
    const r = press.c.getBoundingClientRect(), g = press.c.cloneNode(true);
    g.className = "dGhost"; g.style.width = r.width + "px"; document.body.appendChild(g);
    drag = { i: press.i, ghost: g, w: r.width, h: r.height }; press.c.dataset.noclick = "1"; press.c.classList.remove("lift");
    if(!poolOpen && window.matchMedia("(max-width: 699px)").matches){ /* sul telefono la tendina chiusa resta il bersaglio */ }
    moveGhost(e.clientX, e.clientY);
  };
  const moveGhost = (x, y) => { if(!drag) return; drag.ghost.style.transform = `translate(${x - drag.w / 2}px, ${y - drag.h * 0.6}px) rotate(-6deg)`; root.querySelector(".dPool")?.classList.toggle("drop", overPool(x, y)); };
  window.addEventListener("pointermove", e => {
    if(drag){ moveGhost(e.clientX, e.clientY); return; }
    if(!press) return;
    const dx = e.clientX - press.x, dy = e.clientY - press.y, far = Math.hypot(dx, dy) > 8;
    if(!far) return;
    if(press.mouse || press.lifted) startDrag(e);
    else { clearTimeout(press.timer); press = null; }   // è uno scorrimento
  });
  window.addEventListener("pointerup", e => {
    if(drag){ endDrag(e.clientX, e.clientY, true); press = null; return; }
    if(press){ clearTimeout(press.timer); if(press.lifted){ press.c.classList.remove("lift"); press.c.dataset.noclick = "1"; const list = packList(); sel = press.i; ins = { list, idx: press.i, take: true }; render(); } press = null; }
  });
  window.addEventListener("pointercancel", () => { if(drag) endDrag(0, 0, false); if(press){ clearTimeout(press.timer); press.c.classList.remove("lift"); press = null; } });
  // durante il trascinamento col dito la pagina non deve scorrere
  window.addEventListener("touchmove", e => { if(drag || press?.lifted) e.preventDefault(); }, { passive: false });
  root.addEventListener("contextmenu", e => { if(e.target.closest(".dc")) e.preventDefault(); });
  window.addEventListener("keydown", e => { if(root.hidden) return; if(e.key === "Escape"){ if(ins){ ins = null; render(); } } if(e.key === "Enter" && sel != null && !ins) take(sel); });
}

function build(){
  const st = replay(D); if(!st || !st.done) return;
  const deck = poolToDeck(st.pools[0], `Draft ${setName(D.set)}`);
  deck.draft = { set: D.set, seed: D.seed, picks: D.picks.slice(), res: "---" };
  deck.notes = `Draft ${setName(D.set)} contro l'IA (alpha)`;
  saveDeck(deck); discardDraft(); closeDraft();
  if(onBuildCb) onBuildCb(deck.id);
}
