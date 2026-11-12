/* Dati: catalogo e prezzi pubblicati dal collector, con gli indici che
   servono alle sezioni. Le immagini stanno in ./img/<printing>.webp e
   ./img/t/<printing>.webp (miniature).                                   */

import { cardText } from "./cardtext.js";
export const DATA = { cards: [], sets: [], byId: new Map(), byPrint: new Map(),
                      prices: {}, pricesAt: null, generated: null, meta: null };

export const COLORS = ["Red", "Yellow", "Green", "Blue"];
export const COLOR_IT = { Red: "Rosso", Yellow: "Giallo", Green: "Verde", Blue: "Blu" };
export const TYPES = ["Legend", "Unit", "Program", "Gear"];
export const TYPE_IT = { Legend: "Leggenda", Unit: "Unità", Program: "Programma", Gear: "Equipaggiamento" };
export const RARITY_RANK = { "Common": 0, "Uncommon": 1, "Rare": 2, "Epic": 3, "Secret": 4,
  "Nova Rare": 5, "Iconic Other": 6, "Iconic Legend": 7, "Iconic Secret": 8 };
export const RARITY_IT = { "Common": "Comune", "Uncommon": "Non comune", "Rare": "Rara", "Epic": "Epica",
  "Secret": "Segreta", "Nova Rare": "Nova Rare", "Iconic Other": "Iconic", "Iconic Legend": "Iconic Legend", "Iconic Secret": "Iconic Secret" };

/* set in ordine di preferenza per scegliere la stampa "di default" di una carta */
const SET_PREF = ["welcometonightcityretail", "theheistretailstarterdeck", "embracingpowerretailstarterdeck",
  "welcometonightcitybeta", "theheistbetastarterdeck", "embracingpowerbetastarterdeck"];

export const SET_IT = {
  welcometonightcityretail: "Welcome to Night City", welcometonightcitybeta: "Welcome to Night City — Beta",
  "welcometonightcityretail-fr": "Welcome to Night City — FR", theheistretailstarterdeck: "Starter The Heist",
  theheistbetastarterdeck: "Starter The Heist — Beta", "theheistretailstarterdeck-fr": "Starter The Heist — FR",
  embracingpowerretailstarterdeck: "Starter Embracing Power", embracingpowerbetastarterdeck: "Starter Embracing Power — Beta",
  "embracingpowerretailstarterde-fr": "Starter Embracing Power — FR", edgerunneropens1: "Edgerunner Open S1",
  nightcitybrawls1: "Night City Brawl S1", "nightcitybrawls1-FR": "Night City Brawl S1 — FR",
  prereleaseretail: "Prerelease", prereleasebeta: "Prerelease — Beta", "prereleaseretail-FR": "Prerelease — FR",
  boxtoppersretail: "Box Topper", boxtoppersbeta: "Box Topper — Beta", "boxtoppersretail-fr": "Box Topper — FR",
  arasakademodeck: "Demo Deck Arasaka", mercdemodeck: "Demo Deck Merc", PRM01: "Promo", judgepromos: "Promo Judge"
};
export const setName = code => SET_IT[code] || (DATA.sets.find(s => s.code === code) || {}).name || code;

// solo lettere, cifre e trattini: un identificativo arrivato dalla rete non può uscire dall'attributo HTML
const safeId = pid => String(pid ?? "").replace(/[^A-Za-z0-9_-]/g, "");
export const imgUrl   = pid => `./img/${safeId(pid)}.webp`;
export const thumbUrl = pid => `./img/t/${safeId(pid)}.webp`;

export async function loadData(base = "./"){
  const bust = u => u + "?t=" + Date.now();
  const [cards, prices] = await Promise.all([
    fetch(bust(base + "cards.json"), { cache: "no-store" }).then(r => { if(!r.ok) throw new Error("cards.json " + r.status); return r.json(); }),
    fetch(bust(base + "prices.json"), { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null)
  ]);
  DATA.cards = cards.cards; DATA.sets = cards.sets; DATA.generated = cards.generated;
  DATA.byId.clear(); DATA.byPrint.clear();
  for(const c of DATA.cards){
    DATA.byId.set(c.id, c);
    // la stampa predefinita: inglese, dal set retail se esiste, con immagine
    c.prints.sort((a, b) => prefRank(a) - prefRank(b));
    c.def = c.prints.find(p => p.img && p.lang === "en") || c.prints.find(p => p.img) || c.prints[0];
    c.ramN = c.ram ?? 0;
    c.kw = ownKeywords(c);
    for(const p of c.prints){ p.card = c; DATA.byPrint.set(p.id, p); }
    // illustrazioni distinte (p.art dal collector; senza, illustratore + rarità alternativa)
    const ALT = new Set(["Secret", "Iconic Other", "Iconic Legend", "Iconic Secret", "Nova Rare"]);
    const groups = new Map();
    for(const p of c.prints){ const k = p.art != null ? "a" + p.art : (p.artist || "") + "|" + (ALT.has(p.rarity) ? p.rarity : ""); if(!groups.has(k)) groups.set(k, { key: k, prints: [] }); groups.get(k).prints.push(p); }
    c.arts = [...groups.values()];
  }
  DATA.prices = (prices && prices.prices) || {};
  DATA.pricesAt = prices ? (prices.cardmarketCreatedAt || prices.generated) : null;
  return DATA;
}
/* ordine di uscita dei set (dal più vecchio): per «artwork più recente» */
/* parole chiave che la carta ha davvero: nel testo stanno a inizio riga («{Blocker} (You may…»).
   Quelle citate in mezzo a una frase sono riferimenti ad altre carte («può attaccare Unità con {Blocker}»,
   «dai {Adrenaline} a un'altra Unità») o condizioni gestite dal motore, non abilità della carta. */
export function ownKeywords(c){
  const all = c.kw || [], t = c.text || "", own = new Set();
  for(const m of t.matchAll(/\{([^}]+)\}/g)){ const k = m[1]; if(!all.includes(k)) continue; if(/(^|\n)\s*$/.test(t.slice(0, m.index))) own.add(k); }
  return all.filter(k => own.has(k));
}
export const SET_ORDER = ["welcometonightcitybeta", "theheistbetastarterdeck", "embracingpowerbetastarterdeck", "boxtoppersbeta", "prereleasebeta", "PRM01", "mercdemodeck", "arasakademodeck", "judgepromos", "edgerunneropens1", "nightcityshowdowns1", "nightcitybrawls1",
  "welcometonightcityretail", "theheistretailstarterdeck", "embracingpowerretailstarterdeck", "boxtoppersretail", "prereleaseretail", "welcometonightcityretail-fr", "theheistretailstarterdeck-fr", "embracingpowerretailstarterde-fr", "boxtoppersretail-fr", "prereleaseretail-FR", "nightcityshowdowns1-FR", "nightcitybrawls1-FR"];
export const setRank = code => { const i = SET_ORDER.indexOf(code); return i < 0 ? SET_ORDER.length : i; };
function prefRank(p){
  const i = SET_PREF.indexOf(p.set);
  return (p.lang === "en" ? 0 : 100) + (i < 0 ? 50 : i) + (RARITY_RANK[p.rarity] || 0) * 0.01;
}

/* prezzo di una stampa: trend Cardmarket; `approx` quando l'abbinamento al
   listino è per solo nome (versione base e variante non distinguibili) */
export function priceOf(pid){
  const p = DATA.prices[pid];
  if(!p) return null;
  // trend normale; se il prodotto esiste solo foil usa il trend foil; se è
  // appena uscito e non ha ancora un trend usa la media, infine il "da"
  let v = null, src = "trend";
  if(p.trend > 0){ v = p.trend; }
  else if(p.trendFoil > 0){ v = p.trendFoil; src = "foil"; }
  else if(p.avg > 0){ v = p.avg; src = "media"; }
  else if(p.low > 0){ v = p.low; src = "da"; }
  if(v == null) return null;
  return { trend: v, src, low: p.low, avg7: p.avg7, avg30: p.avg30, cm: p.cm, approx: !!p.approx };
}
/* prezzo "migliore" di una carta: la stampa predefinita, altrimenti la più economica con prezzo */
export function cardPrice(c){
  const d = priceOf(c.def.id); if(d) return d;
  let best = null;
  for(const p of c.prints){ const v = priceOf(p.id); if(v && (!best || v.trend < best.trend)) best = v; }
  return best;
}
export const eur = n => n == null ? "—" : n.toLocaleString("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* link Cardmarket: la scheda prodotto quando conosciamo l'id, altrimenti la ricerca */
export function cardmarketUrl(c, pid){
  const pr = pid ? DATA.prices[pid] : null;
  if(pr && pr.cm) return `https://www.cardmarket.com/it/Cyberpunk/Products?idProduct=${pr.cm}`;
  const q = encodeURIComponent(c.name + (c.sub ? " - " + c.sub : ""));
  return `https://www.cardmarket.com/it/Cyberpunk/Products/Search?searchString=${q}`;
}

/* testo delle regole: i marcatori {Blocker} ecc. diventano etichette */
export function rulesHTML(text, raw){
  if(!raw) text = cardText(text);   // in italiano, se scelto (traduzione non ufficiale); raw: sempre l'originale
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return esc(text).replace(/\{([^}]+)\}/g, (_, k) => {
    const trig = ["Play", "Call", "Attack", "Defeated", "Spend"].includes(k);
    return `<span class="kw${trig ? " trig" : ""}">${k}</span>`;
  }).replace(/€\$/g, "€$").replace(/☆/g, "☆");
}

export const classificationsOf = () => {
  const n = new Map();
  for(const c of DATA.cards) for(const k of c.cls) n.set(k, (n.get(k) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
};
