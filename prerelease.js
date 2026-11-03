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
  // le stampe dichiarate per ogni copia devono essere uscite dal kit, ognuna al massimo quante volte è uscita
  const byPrint = new Map(), addP = p => byPrint.set(p.id, (byPrint.get(p.id) || 0) + 1);
  for(const pk of kit.packs) for(const p of pk) addP(p); for(const p of kit.legendPack) addP(p); if(kit.promo) addP(kit.promo);
  for(const e of d.cards) for(const pid of (Array.isArray(e.prints) ? e.prints : [])){ const k = byPrint.get(pid) || 0; if(k <= 0) return false; byPrint.set(pid, k - 1); }
  return new Set(d.cards.map(e => DATA.byId.get(e.cid)?.color).filter(Boolean)).size <= 3;
}

/* mazzo dell'IA. Regole tarate facendo giocare migliaia di partite IA contro IA con mazzi dallo
   stesso kit (contro il costruttore precedente vince circa 63 partite su 100):
   - punteggio delle carte: potenza prima di tutto, poco peso al costo, +1 per Blocker e Adrenaline;
   - colori: i 2 più forti se bastano, altrimenti 3;
   - 38 carte, con almeno 14 carte da 3 €$ in giù e al massimo 4 da 6 €$ in su;
   - Leggende: Go Solo, potenza, effetti e colore in comune con il mazzo.                          */
const cardScore = c => (c.power || 0) + (c.type === "Program" ? 2 : 0) + (c.type === "Gear" ? (c.power || 0) : 0) - (c.cost || 0) * 0.3
  + ((c.kw || []).includes("Blocker") ? 1 : 0) + ((c.kw || []).includes("Adrenaline") ? 1 : 0);
const SIZE = 38, CHEAP = 14, BIG = 4;
export function botSealedDeck(kit){
  const deck = sealedDeckFromKit(kit, "IA (Prerelease)");
  const others = deck.pool.filter(e => DATA.byId.get(e.cid).type !== "Legend");
  const copies = []; for(const e of others){ const c = DATA.byId.get(e.cid); for(let k = 0; k < e.n; k++) copies.push({ e, c, s: cardScore(c) }); }
  copies.sort((a, b) => b.s - a.s);
  // colori: somma dei punteggi delle 15 carte migliori di ciascuno
  const colors = [...new Set(copies.map(x => x.c.color).filter(Boolean))];
  const strength = col => copies.filter(x => x.c.color === col).slice(0, 15).reduce((a, x) => a + Math.max(0, x.s + 3), 0);
  const ranked = colors.sort((a, b) => strength(b) - strength(a));
  const usable = cols => copies.filter(x => !x.c.color || cols.includes(x.c.color)).filter(x => x.s > -0.5);
  let cols = ranked.slice(0, 2); if(usable(cols).length < SIZE) cols = ranked.slice(0, 3);
  // riempimento con la curva
  const pool = usable(cols).length >= SIZE ? usable(cols) : copies.filter(x => !x.c.color || cols.includes(x.c.color));
  const pick = [], cheap = pool.filter(x => (x.c.cost ?? 0) <= 3);
  for(const x of cheap.slice(0, CHEAP)) pick.push(x);
  for(const x of pool){ if(pick.length >= SIZE) break; if(pick.includes(x)) continue; if((x.c.cost ?? 0) >= 6 && pick.filter(y => (y.c.cost ?? 0) >= 6).length >= BIG) continue; pick.push(x); }
  for(const x of pool){ if(pick.length >= SIZE) break; if(!pick.includes(x)) pick.push(x); }
  const byCid = new Map(); for(const x of pick){ const en = byCid.get(x.c.id) || { cid: x.c.id, pid: x.e.pid, n: 0, prints: [] }; en.n++; en.prints.push(x.e.pid); byCid.set(x.c.id, en); }
  deck.cards = [...byCid.values()];
  // Leggende: 3 nomi diversi, le migliori per il mazzo
  const legs = deck.pool.filter(e => DATA.byId.get(e.cid).type === "Legend").map(e => ({ e, c: DATA.byId.get(e.cid) }));
  const lscore = ({ c }) => ((c.kw || []).includes("Go Solo") ? 3 : 0) + (c.power ?? 0) * 0.4 + (cols.includes(c.color) ? 1.5 : 0) + (/\{(Spend|Attack|Play|Call)\}|When /.test(c.text || "") ? 1 : 0);
  const chosen = []; for(const x of legs.sort((a, b) => lscore(b) - lscore(a))) if(!chosen.some(y => y.c.dn === x.c.dn || y.c.name === x.c.name) && chosen.length < 3) chosen.push(x);
  deck.legends = chosen.map(x => ({ cid: x.c.id, pid: x.e.pid }));
  while(deck.legends.length < 3) deck.legends.push(null);
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
    <div class="sub">Apri un kit come quello del negozio (6 buste, 3 Leggende, promo) e costruisci un mazzo sealed da almeno 30 carte di massimo 3 colori; poi allenati contro l'IA, che apre un kit a sua volta.</div>
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
