/* Prerelease (sealed): apre un kit come quello vero, 6 buste da 12 carte,
   un pacchetto con 3 Leggende e il promo dell'espansione; con quello che
   esce si costruisce un mazzo da almeno 30 carte di massimo 3 colori e si
   gioca contro un bot che ha aperto a sua volta un kit.                 */

import { DATA, COLORS, thumbUrl, setName } from "./data.js";
import { S, newId, saveDeck } from "./store.js";
import { mulberry32 } from "./engine.js";

/* espansioni apribili: i set principali in inglese, con le rarità da busta */
export function expansions(){
  const out = [];
  for(const set of DATA.sets){
    const prints = []; for(const c of DATA.cards) for(const p of c.prints) if(p.set === set.code && p.lang === "en" && p.img) prints.push(p);
    const n = prints.filter(p => p.rarity === "Common").length;
    if(n >= 30) out.push({ code: set.code, name: setName(set.code), prints });
  }
  return out;
}
const SLOT_RARE = [["Rare", 0.72], ["Epic", 0.22], ["Secret", 0.06]];

/* apre un kit; seed per riprodurre la stessa apertura */
export function openKit(setCode, seed = Date.now() & 0xffffffff){
  const rng = mulberry32(seed);
  const exp = expansions().find(e => e.code === setCode); if(!exp) return null;
  const by = r => exp.prints.filter(p => p.rarity === r);
  const pick = arr => arr[Math.floor(rng() * arr.length)];
  const pickDistinct = (arr, n) => { const a = arr.slice(), out = []; while(out.length < n && a.length) out.push(a.splice(Math.floor(rng() * a.length), 1)[0]); return out; };
  const packs = [];
  for(let i = 0; i < 6; i++){
    const pack = [...pickDistinct(by("Common"), 7), ...pickDistinct(by("Uncommon"), 3)];
    for(let k = 0; k < 2; k++){
      let r = rng(), rar = "Rare"; for(const [name, p] of SLOT_RARE){ if(r < p){ rar = name; break; } r -= p; }
      let pool = by(rar); if(!pool.length) pool = by("Rare");
      pack.push(pick(pool));
    }
    packs.push(pack);
  }
  const legendPrints = exp.prints.filter(p => p.rarity && DATA.byPrint.get(p.id).card.type === "Legend");
  const legendPack = pickDistinct(legendPrints, 3);
  // promo dell'espansione: il Gorilla Arms della prerelease (o la stampa predefinita)
  const ga = DATA.cards.find(c => c.dn === "Gorilla Arms");
  const promo = ga ? (ga.prints.find(p => p.set === "prereleaseretail" && p.img) || ga.def) : null;
  return { set: setCode, seed, packs, legendPack, promo };
}

/* dal kit al mazzo sealed (da completare nel deckbuilder) */
export function sealedDeckFromKit(kit, name){
  const pool = new Map();
  const add = p => { const k = p.id; pool.set(k, (pool.get(k) || 0) + 1); };
  for(const pack of kit.packs) for(const p of pack) add(p);
  for(const p of kit.legendPack) add(p);
  if(kit.promo) add(kit.promo);
  const deck = { id: newId(), name, format: "sealed", kit: { set: kit.set, seed: kit.seed }, legends: [null, null, null], cards: [], notes: `Kit Prerelease ${setName(kit.set)} (seme ${kit.seed})`,
    pool: [...pool.entries()].map(([pid, n]) => ({ pid, cid: DATA.byPrint.get(pid).card.id, n })) };
  return deck;
}

/* mazzi Prerelease «veri»: il kit (espansione + seme) si riapre identico, quindi si può controllare che
   ogni carta del mazzo sia davvero uscita da quel kit. Un mazzo da 30 carte costruito a mano non passa. */
export function kitOf(d){
  if(!d) return null;
  if(d.kit && d.kit.set && d.kit.seed != null) return d.kit;
  const m = /\(seme (-?\d+)\)/.exec(d.notes || ""); if(!m || !d.pool) return null;   // mazzi creati prima che il kit venisse salvato
  const set = d.pool.map(e => DATA.byPrint.get(e.pid)).find(p => p && p.set !== "prereleaseretail")?.set;
  return set ? { set, seed: +m[1] } : null;
}
export function verifySealed(d){
  if(!d || d.format !== "sealed") return false;
  const k = kitOf(d); const kit = k && openKit(k.set, k.seed); if(!kit) return false;
  const cnt = new Map(), add = p => { const c = DATA.byPrint.get(p.id); if(c) cnt.set(c.card.id, (cnt.get(c.card.id) || 0) + 1); };
  for(const pk of kit.packs) for(const p of pk) add(p); for(const p of kit.legendPack) add(p); if(kit.promo) add(kit.promo);
  const legs = (d.legends || []).filter(Boolean), n = (d.cards || []).reduce((a, e) => a + e.n, 0);
  if(legs.length !== 3 || n < 30) return false;
  if(legs.some(l => !cnt.get(l.cid)) || new Set(legs.map(l => l.cid)).size !== 3) return false;
  if(d.cards.some(e => e.n > (cnt.get(e.cid) || 0))) return false;
  return new Set(d.cards.map(e => DATA.byId.get(e.cid)?.color).filter(Boolean)).size <= 3;
}

/* mazzo del bot: 3 Leggende dal suo kit, i 3 colori più ricchi, le carte migliori fino a ≥30 */
export function botSealedDeck(kit){
  const deck = sealedDeckFromKit(kit, "Bot (Prerelease)");
  const legs = deck.pool.filter(e => DATA.byId.get(e.cid).type === "Legend").map(e => DATA.byId.get(e.cid));
  const uniq = []; for(const c of legs) if(!uniq.some(x => x.dn === c.dn)) uniq.push(c);
  uniq.sort((a, b) => ((b.kw || []).includes("Go Solo") ? 1 : 0) - ((a.kw || []).includes("Go Solo") ? 1 : 0));
  deck.legends = uniq.slice(0, 3).map(c => ({ cid: c.id, pid: deck.pool.find(e => e.cid === c.id).pid }));
  while(deck.legends.length < 3) deck.legends.push(null);
  const others = deck.pool.filter(e => DATA.byId.get(e.cid).type !== "Legend");
  const byColor = {}; for(const e of others){ const c = DATA.byId.get(e.cid); byColor[c.color] = (byColor[c.color] || 0) + e.n * (1 + (c.power || 0) / 10); }
  const colors = Object.keys(byColor).sort((a, b) => byColor[b] - byColor[a]).slice(0, 3);
  const score = e => { const c = DATA.byId.get(e.cid); return (c.power || 0) + (c.type === "Program" ? 2 : 0) + (c.type === "Gear" ? (c.power || 0) : 0) - (c.cost || 0) * 0.3; };
  const cand = others.filter(e => colors.includes(DATA.byId.get(e.cid).color)).sort((a, b) => score(b) - score(a));
  let n = 0; for(const e of cand){ deck.cards.push({ cid: e.cid, pid: e.pid, n: e.n }); n += e.n; if(n >= 34) break; }
  return deck;
}

/* ---------------- interfaccia di apertura (nella pagina del simulatore) */
let kit = null;
export function kitHTML(k){
  const tile = p => `<div class="bc pk" data-zoom="${p.id}" title="${esc(DATA.byPrint.get(p.id).card.dn)}"><img src="${thumbUrl(p.id)}" alt="" loading="lazy">${p.rarity !== "Common" ? `<span class="rt ${p.rarity.replace(/\s/g, "")}">${esc(p.rarity)}</span>` : ""}</div>`;
  return `<div class="kit">
    ${k.packs.map((pack, i) => `<div class="pack"><div class="pkh">Busta ${i + 1}</div><div class="pkg">${pack.map(tile).join("")}</div></div>`).join("")}
    <div class="pack"><div class="pkh">Pacchetto Leggende</div><div class="pkg">${k.legendPack.map(tile).join("")}</div></div>
    ${k.promo ? `<div class="pack"><div class="pkh">Promo</div><div class="pkg">${tile(k.promo)}</div></div>` : ""}
  </div>`;
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function prereleaseSetupHTML(){
  const exps = expansions();
  return `<div class="card">
    <h3>Prerelease</h3>
    <div class="sub">Apri un kit come quello del negozio (6 buste, 3 Leggende, promo) e costruisci un mazzo sealed da almeno 30 carte di massimo 3 colori; poi allenati contro il bot, che apre un kit a sua volta.</div>
    <div class="field" style="margin-top:6px"><label>Espansione</label><select class="inp" id="prSet">${exps.map(e => `<option value="${e.code}">${esc(e.name)}</option>`).join("")}</select></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn acc2" id="prOpen">Apri il kit</button>${S.decks.some(d => d.format === "sealed") ? `<span class="chip">${S.decks.filter(d => d.format === "sealed").length} mazzi sealed nel deckbuilder</span>` : ""}</div>
    <div id="prKit"></div>
  </div>`;
}
export function wirePrerelease(root, onBuild){
  root.addEventListener("click", e => {
    if(e.target.closest("#prOpen")){
      kit = openKit(root.querySelector("#prSet").value);
      root.querySelector("#prKit").innerHTML = kitHTML(kit) + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn yel" id="prBuild">Costruisci il mazzo con queste carte</button><button class="btn sm" id="prAgain">Apri un altro kit</button></div>`;
      root.querySelector("#prKit").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if(e.target.closest("#prAgain")){ root.querySelector("#prOpen").click(); return; }
    if(e.target.closest("#prBuild") && kit){
      const deck = sealedDeckFromKit(kit, `Prerelease ${setName(kit.set)}`);
      deck.botDeck = botSealedDeck(openKit(kit.set, kit.seed + 7));
      saveDeck(deck); onBuild(deck.id); return;
    }
  });
}
