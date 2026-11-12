/* Pezzi di interfaccia condivisi: toast, scheda carta (modale con
   trascinamento), lente con zoom, tessere e righe, filtri.               */

import { DATA, COLORS, COLOR_IT, TYPES, TYPE_IT, RARITY_IT, setName, imgUrl, thumbUrl,
         priceOf, cardPrice, eur, cardmarketUrl, rulesHTML, classificationsOf, setRank } from "./data.js";
import { S, qtyOf, setQty, cardQty } from "./store.js";
import { cardTextIt, itText, cardFaceHTML } from "./cardtext.js";

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function toast(msg, ms = 2400){
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("on"), ms);
}

/* finestre di conferma e di testo nello stile dell'app (al posto di confirm/prompt del telefono).
   Promettono true/false o il testo (null se si annulla). Esc chiude, Invio conferma (non nelle aree di testo). */
function dialog(msg, o, withText){
  return new Promise(done => {
    const el = document.createElement("div"); el.id = "appAsk"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    const field = !withText ? "" : o.multiline
      ? `<textarea class="inp" id="appAskIn" rows="${o.rows || 6}" ${o.readonly ? "readonly" : ""} placeholder="${esc(o.placeholder || "")}">${esc(o.value || "")}</textarea>`
      : `<input class="inp" id="appAskIn" maxlength="${o.max || 300}" placeholder="${esc(o.placeholder || "")}" value="${esc(o.value || "")}" autocomplete="off">`;
    el.innerHTML = `<div class="box${o.danger ? " danger" : ""}">${o.title ? `<div class="kick">${esc(o.title)}</div>` : ""}<p class="amsg">${esc(msg)}</p>${field}
      <div class="opts">${o.cancel === false ? "" : `<button class="btn" data-a="no">${esc(o.cancel || "Annulla")}</button>`}<button class="btn ${o.danger ? "bad" : "yel"}" data-a="ok">${esc(o.ok || "Conferma")}</button></div></div>`;
    const prev = document.activeElement; document.body.appendChild(el);
    const inp = el.querySelector("#appAskIn");
    const close = v => { el.remove(); document.removeEventListener("keydown", key, true); try{ prev?.focus?.(); }catch(e){} done(v); };
    const ok = () => close(withText ? (inp ? inp.value : "") : true), no = () => close(withText ? null : false);
    const key = e => { if(e.key === "Escape"){ e.preventDefault(); no(); } else if(e.key === "Enter" && !(e.target && e.target.tagName === "TEXTAREA")){ e.preventDefault(); ok(); } };
    document.addEventListener("keydown", key, true);
    el.addEventListener("click", e => { const b = e.target.closest("[data-a]"); if(b) (b.dataset.a === "ok" ? ok : no)(); else if(e.target === el) no(); });
    if(inp){ inp.focus(); if(o.readonly) inp.select(); } else el.querySelector('[data-a="ok"]').focus();
  });
}
export const askConfirm = (msg, o = {}) => dialog(msg, o, false);
export const askText = (msg, o = {}) => dialog(msg, o, true);

export const statsHTML = c => `
  ${c.cost != null ? `<span class="stat cost" title="Costo">€$ ${c.cost}</span>` : ""}
  ${c.power != null ? `<span class="stat pow" title="Potenza">⚡ ${c.power}</span>` : ""}
  ${c.ram != null ? `<span class="stat" title="RAM"><i class="pip ${c.color}"></i> RAM ${c.ram}</span>` : ""}
  <span class="stat">${TYPE_IT[c.type] || c.type}</span>`;

/* tessera per le griglie */
const RARITY_ORDER = { "Iconic Secret": 8, "Iconic Legend": 7, "Iconic Other": 6, "Nova Rare": 5, "Secret": 4, "Epic": 3, "Rare": 2, "Uncommon": 1, "Common": 0 };
/* la stampa da mostrare in collezione (modalità «una voce per carta»): quella preferita
   scelta nella scheda, altrimenti tra le possedute la più rara / la meno rara / la più recente
   (impostazioni), altrimenti quella predefinita */
export function shownPrint(c, among){
  const fav = (S.settings.favPrints || {})[c.id];
  if(fav && !among){ const p = DATA.byPrint.get(fav); if(p && p.card === c) return p; }
  const pool = (among || c.prints).filter(p => p.img && (among ? true : qtyOf(p.id)));
  if(!pool.length) return among ? among[0] : c.def;
  return pool.reduce(pickBetter(S.settings.collPick || "rarest"));
}
/* a parità: prima le stampe in inglese, poi la più recente (così la scelta non si blocca sulla prima trovata) */
const age = p => setRank(p.set) * 1000 + (parseInt(String(p.num).replace(/\D/g, "")) || 0);
const en = p => p.lang === "en" ? 1 : 0;
const pickBetter = mode => {
  const score = p => mode === "newest" ? en(p) * 1e8 + age(p) * 100 + (RARITY_ORDER[p.rarity] ?? 0)
    : (RARITY_ORDER[p.rarity] ?? 0) * (mode === "common" ? -1 : 1) * 1e9 + en(p) * 1e8 + age(p);
  return (a, b) => score(b) > score(a) ? b : a;
};
/* quante carte cambiano davvero con la scelta (le altre: una sola stampa posseduta, o illustrazione fissata) */
export function pickMatters(){
  let n = 0; const fav = S.settings.favPrints || {};
  for(const c of DATA.cards){
    if(fav[c.id]) continue;
    const pool = c.prints.filter(p => p.img && qtyOf(p.id)); if(pool.length < 2) continue;
    if(new Set(["rarest", "common", "newest"].map(m => pool.reduce(pickBetter(m)).id)).size > 1) n++;
  }
  return n;
}
export function tileHTML(c, pid, opts = {}){
  const p = pid ? DATA.byPrint.get(pid) : (opts.owned ? shownPrint(c) : c.def);
  const q = opts.qty != null ? opts.qty : cardQty(c);
  const pr = opts.price !== false ? (priceOf(p.id) || cardPrice(c)) : null;
  return `<div class="gc${opts.dim && !q ? " dim" : ""}" data-cid="${c.id}" data-pid="${p.id}">
    ${p.img ? `<img src="${thumbUrl(p.id)}" alt="${esc(c.dn)}" loading="lazy" decoding="async">` : `<div class="ph">${esc(c.dn)}</div>`}
    ${opts.qty !== false ? `<span class="qty${q ? "" : " zero"}">${q ? "×" + q : "0"}</span>` : ""}
    ${p.rarity && p.rarity !== "Common" && opts.rarity !== false ? `<span class="tr">${esc(RARITY_IT[p.rarity] || p.rarity)}</span>` : ""}
    ${opts.star ? (() => { const on = !!(S.settings.favCards || {})[c.id]; return `<button class="favst${on ? " on" : ""}" data-favcard="${c.id}" aria-label="${on ? "Togli dalle carte preferite" : "Aggiungi alle carte preferite"}" title="${on ? "Carta preferita" : "Aggiungi alle carte preferite"}">${on ? "★" : "☆"}</button>`; })() : ""}
    <div class="cap"><b>${pr ? eur(pr.trend) + (pr.approx ? " ~" : "") : "—"}</b>${esc(c.dn)}${opts.sub ? `<small>${esc(opts.sub)}</small>` : ""}</div>
  </div>`;
}
/* etichetta breve di una stampa (set · numero · rarità) per le voci per artwork/edizione */
export const printLabel = (p, withNum = true) => `${setShort(p.set)}${withNum ? " #" + p.num : ""}${p.rarity && p.rarity !== "Common" ? " · " + (RARITY_IT[p.rarity] || p.rarity) : ""}${p.lang !== "en" ? " · " + p.lang.toUpperCase() : ""}`;
const setShort = code => setName(code).replace("Welcome to Night City", "WNC").replace(" — Retail", "").replace("Starter Deck", "Starter").replace("Edgerunner Open S 1", "Edgerunner Open S1").replace("Night City Brawl S 1", "Night City Brawl S1");
/* riga compatta: con `compact` le statistiche sono testo breve (€$ · ⚡ · RAM) che va a capo, mai troncato */
export function rowHTML(c, pid, right = "", extra = "", compact = false, badge = ""){
  const p = pid ? DATA.byPrint.get(pid) : c.def;
  const stats = compact ? `<span class="st">${c.cost != null ? `€$ ${c.cost}` : ""}${c.power != null ? ` · ⚡ ${c.power}` : ""} · ${TYPE_IT[c.type] || c.type}</span>` : statsHTML(c);
  return `<div class="row" data-cid="${c.id}" data-pid="${p.id}">
    <span class="ci" style="background:var(--c${c.color || "Mute"})"></span>
    ${p.img ? `<span class="thumbwrap"><img class="thumb" src="${thumbUrl(p.id)}" alt="" loading="lazy">${badge ? `<span class="tq">${badge}</span>` : ""}</span>` : `<span class="thumb"></span>`}
    <div class="nm"><b>${esc(c.dn)}</b><span>${stats} ${extra}</span></div>
    ${right}
  </div>`;
}

/* ------------------------------------------------------------ filtri */
export function makeFilters(scope){
  return { q: "", colors: new Set(), types: new Set(), rar: new Set(), cls: new Set(), cost: new Set(), sets: new Set(), kw: new Set(), fx: new Set(), fav: false, favArt: false, open: new Set(), owned: false, scope };
}
/* parole chiave del gioco (quelle a inizio riga: una citata nel testo di un'altra carta non conta) e abilità a innesco */
const KW_FILTERS = [["Blocker", c => c.kw.includes("Blocker")], ["Go Solo", c => c.kw.includes("Go Solo")], ["Quick", c => c.kw.includes("Quick") || /(^|\n)\{Quick\}/.test(c.text || "")], ["Adrenaline", c => c.kw.includes("Adrenaline")],
  ["Play", c => /\{Play\}/.test(c.text || "")], ["Attack", c => /\{Attack\}/.test(c.text || "")], ["Spend", c => /\{Spend\}/.test(c.text || "")], ["Call", c => /\{Call\}/.test(c.text || "")], ["Defeated", c => /\{Defeated\}/.test(c.text || "")]];
/* effetti principali, letti dal testo inglese delle carte */
const FX_FILTERS = [["Pesca", /\bdraws? (\d|a|an|one|two|three)\b/i], ["Sconfigge", /\bdefeats?\b/i], ["Prepara", /\bready\b/i], ["Gig in più", /\b(also steals? a gig|steal a rival gig|steals? (an )?(extra|additional|\d+ more) gigs?)\b/i], ["Quando ruba", /\b(when|whenever|the first time)\b[^.]*\bsteals?\b/i], ["Difende i Gig", /\b(can't steal|steals? \d+ fewer|would steal)\b/i], ["± Potenza", /[+−-]\d+ power/i], ["Scarta", /\bdiscard/i], ["Valore dei Gig", /(increase|decrease|adjust|set|change)\b.{0,40}\bgig|\bgig\b.{0,30}\bvalue/i]];
const kwOk = (c, k) => { const d = KW_FILTERS.find(x => x[0] === k); return d ? d[1](c) : false; };
// il testo di promemoria tra parentesi (es. «Units with power 0 don't steal Gigs») non conta come effetto
const fxText = c => c.__fx ?? (c.__fx = (c.text || "").replace(/\([^)]*\)/g, ""));
const fxOk = (c, k) => { const d = FX_FILTERS.find(x => x[0] === k); return d ? d[1].test(fxText(c)) : false; };
/* le carte su cui il filtro lavora: Leggende o le altre nel deckbuilder, tutte nella Collection (serve per nascondere le voci vuote) */
const filterPool = f => f.scope === "deck" ? DATA.cards.filter(c => f.browse === "legends" ? c.type === "Legend" : c.type !== "Legend") : DATA.cards;
export function filtersHTML(f){
  const pool = filterPool(f);
  const pips = COLORS.map(c => `<button class="pipbtn" data-fk="colors" data-fv="${c}" aria-pressed="${f.colors.has(c)}" title="${COLOR_IT[c]}"><i class="pip ${c}" style="position:absolute;inset:7px;width:auto;height:auto"></i></button>`).join("");
  // nel deckbuilder il selettore Carte/Leggende in alto sceglie già le Leggende: qui solo gli altri tre tipi (e niente tipo con le Leggende)
  const typeList = f.scope === "deck" ? (f.browse === "legends" ? [] : TYPES.filter(t => t !== "Legend")) : TYPES;
  const types = typeList.map(t => `<button class="tag" data-fk="types" data-fv="${t}" aria-pressed="${f.types.has(t)}">${TYPE_IT[t]}</button>`).join("");
  const costs = ["0","1","2","3","4","5","6","7+"].map(v => `<button class="tag" data-fk="cost" data-fv="${v}" aria-pressed="${f.cost.has(v)}">${v}</button>`).join("");
  const rar = Object.keys(RARITY_IT).filter(r => f.rar.has(r) || pool.some(c => c.prints.some(p => p.rarity === r))).map(r => `<button class="tag" data-fk="rar" data-fv="${r}" aria-pressed="${f.rar.has(r)}">${RARITY_IT[r]}</button>`).join("");
  const cls = classificationsOf().filter(k => f.cls.has(k) || pool.some(c => c.cls.includes(k))).map(k => `<button class="tag" data-fk="cls" data-fv="${esc(k)}" aria-pressed="${f.cls.has(k)}">${esc(k)}</button>`).join("");
  const kws = KW_FILTERS.filter(([k]) => f.kw.has(k) || pool.some(c => kwOk(c, k))).map(([k]) => `<button class="tag kwt" data-fk="kw" data-fv="${k}" aria-pressed="${f.kw.has(k)}">${k}</button>`).join("");
  const fxs = FX_FILTERS.filter(([k]) => f.fx.has(k) || pool.some(c => fxOk(c, k))).map(([k]) => `<button class="tag" data-fk="fx" data-fv="${k}" aria-pressed="${f.fx.has(k)}">${k}</button>`).join("");
  const n = f.colors.size + f.types.size + f.rar.size + f.cls.size + f.cost.size + f.sets.size + f.kw.size + f.fx.size + (f.fav ? 1 : 0) + (f.favArt ? 1 : 0);
  const row = (lbl, inner) => inner ? `<div class="frow"><span class="lbl">${lbl}</span><span class="fopts">${inner}</span></div>` : "";
  // le righe lunghe mostrano al massimo due righe di valori; «Tutti…» le apre
  const clamp = (key, lbl, inner, more) => inner ? `<div class="frow"><span class="lbl">${lbl}</span><div class="fcol"><span class="fopts clamp${f.open.has(key) ? " open" : ""}" data-row="${key}">${inner}</span><button class="tag more" data-fmore="${key}">${f.open.has(key) ? "Meno" : more}</button></div></div>` : "";
  return `${row("Colore", pips)}${row("Tipo", types)}${row("Costo", costs)}${clamp("rar", "Rarità", rar, "Tutte le rarità")}${clamp("cls", "Tratti", cls, "Tutti i tratti")}
    ${clamp("kw", "Parole chiave", kws, "Tutte le parole chiave")}${clamp("fx", "Effetti", fxs, "Tutti gli effetti")}
    ${f.scope === "coll" || f.scope === "deck" ? row("Preferite", `<button class="tag" data-ffav="1" aria-pressed="${!!f.fav}">★ Carte preferite</button>${f.scope === "coll" ? `<button class="tag" data-ffavart="1" aria-pressed="${!!f.favArt}">◆ Con artwork preferito</button>` : ""}`) : ""}
    ${n ? `<button class="btn sm" data-fclear="1">Azzera i ${n} filtri</button>` : ""}`;
}
/* dopo il disegno: le righe che stanno già in due righe non mostrano «Tutti…» */
export function fitFilters(el){
  if(!el) return;
  for(const box of el.querySelectorAll(".fopts.clamp")){
    const btn = box.parentElement.querySelector("[data-fmore]"); if(!box.firstElementChild) continue;
    box.style.maxHeight = ""; if(!box.offsetHeight){ btn.hidden = false; continue; }   // filtri chiusi: si misura quando si aprono
    const tops = [...new Set([...box.children].map(x => x.offsetTop))].sort((a, b) => a - b);
    if(tops.length <= 2){ btn.hidden = true; continue; }   // già in due righe: niente «Tutti…»
    btn.hidden = false; if(!box.classList.contains("open")) box.style.maxHeight = (tops[2] - tops[0] - 4) + "px";
  }
}
export function setFilters(el, f){ if(!el) return; el.innerHTML = filtersHTML(f); fitFilters(el); }
/* clic dentro i filtri: true se è cambiato qualcosa (da ridisegnare) */
export function filterClick(f, target){
  const b = target.closest("[data-fk]"); if(b){ const set = f[b.dataset.fk]; set.has(b.dataset.fv) ? set.delete(b.dataset.fv) : set.add(b.dataset.fv); return "list"; }
  const m = target.closest("[data-fmore]"); if(m){ f.open.has(m.dataset.fmore) ? f.open.delete(m.dataset.fmore) : f.open.add(m.dataset.fmore); return "filters"; }
  if(target.closest("[data-ffav]")){ f.fav = !f.fav; return "list"; }
  if(target.closest("[data-ffavart]")){ f.favArt = !f.favArt; return "list"; }
  if(target.closest("[data-fclear]")){ for(const k of ["colors", "types", "rar", "cls", "cost", "sets", "kw", "fx"]) f[k].clear(); f.fav = false; f.favArt = false; return "list"; }
  return null;
}
export function passes(c, f){
  if(f.q){
    const q = f.q.toLowerCase();
    const hay = (c.dn + " " + c.text + " " + (cardTextIt() ? (c.__it ??= itText(c.text) || "") : "") + " " + c.cls.join(" ")).toLowerCase();   // si cerca anche nel testo tradotto
    if(!hay.includes(q)) return false;
  }
  if(f.colors.size && !f.colors.has(c.color)) return false;
  if(f.types.size && !f.types.has(c.type)) return false;
  if(f.cost.size){
    const v = c.cost; if(v == null) return false;
    if(![...f.cost].some(t => t === "7+" ? v >= 7 : v === +t)) return false;
  }
  if(f.rar.size && !c.prints.some(p => f.rar.has(p.rarity))) return false;
  if(f.cls.size && ![...f.cls].some(k => c.cls.includes(k))) return false;
  if(f.sets.size && !c.prints.some(p => f.sets.has(p.set))) return false;
  if(f.kw && f.kw.size && ![...f.kw].some(k => kwOk(c, k))) return false;
  if(f.fx && f.fx.size && ![...f.fx].some(k => fxOk(c, k))) return false;
  if((f.owned === true || f.owned === "yes") && !cardQty(c)) return false;
  if(f.owned === "no" && cardQty(c)) return false;
  return true;
}
export function bindFilters(container, f, onChange){
  container.addEventListener("click", e => {
    const r = filterClick(f, e.target); if(!r) return;
    if(r === "filters") setFilters(container, f); else onChange();
  });
}
export function sortCards(list, mode){
  const by = {
    name: (a, b) => a.dn.localeCompare(b.dn, "it"),
    cost: (a, b) => ((a.cost ?? 99) - (b.cost ?? 99)) || a.dn.localeCompare(b.dn, "it"),
    power: (a, b) => ((b.power ?? -1) - (a.power ?? -1)) || a.dn.localeCompare(b.dn, "it"),
    pdesc: (a, b) => ((cardPrice(b) || {}).trend || -1) - ((cardPrice(a) || {}).trend || -1),
    pasc: (a, b) => ((cardPrice(a) || {}).trend ?? 1e9) - ((cardPrice(b) || {}).trend ?? 1e9),
    color: (a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color) || ((a.cost ?? 99) - (b.cost ?? 99)) || a.dn.localeCompare(b.dn, "it"),
    rarity: (a, b) => (RARITY_RANK_OF(b) - RARITY_RANK_OF(a)) || a.dn.localeCompare(b.dn, "it"),
  }[mode] || ((a, b) => a.dn.localeCompare(b.dn, "it"));
  return list.slice().sort(by);
}
const RR = { "Common": 0, "Uncommon": 1, "Rare": 2, "Epic": 3, "Secret": 4, "Nova Rare": 5, "Iconic Other": 6, "Iconic Legend": 7, "Iconic Secret": 8 };
const RARITY_RANK_OF = c => RR[c.rarity] ?? 0;

/* ------------------------------------------------------------ scheda carta */
let SHEET_PRINT = null, SHEET_CARD = null, onPick = null;
/* elenco da cui è stata aperta la scheda (Collection): swipe a destra/sinistra o ‹ › per la carta accanto */
let SHEET_LIST = null, SHEET_IDX = -1, SHEET_OPTS = {};
function sheetStep(d){
  if(!SHEET_LIST) return; const i = SHEET_IDX + d; if(i < 0 || i >= SHEET_LIST.length) return;
  const it = SHEET_LIST[i], c = DATA.byId.get(it.cid); if(!c) return;
  SHEET_IDX = i; SHEET_CARD = c; SHEET_PRINT = DATA.byPrint.get(it.pid) || c.def;
  const box = $("#sheetBox"); renderSheet(SHEET_OPTS); box.scrollTop = 0;
  box.animate([{ transform: `translateX(${d * 40}px)`, opacity: .3 }, { transform: "none", opacity: 1 }], { duration: 180, easing: "ease-out" });
}

/* apre la scheda; `opts.pick(pid)` se chi chiama vuole scegliere una stampa */
export function openCard(cid, pid, opts = {}){
  const c = DATA.byId.get(cid); if(!c) return;
  // `opts.only`: stampe ammesse (Prerelease: solo quelle aperte dal kit)
  const only = Array.isArray(opts.only) && opts.only.length ? opts.only : null;
  SHEET_CARD = c; SHEET_PRINT = DATA.byPrint.get(only && !only.includes(pid) ? only[0] : pid) || c.def; onPick = opts.pick || null;
  SHEET_LIST = Array.isArray(opts.list) && opts.list.length > 1 ? opts.list : null; SHEET_IDX = SHEET_LIST ? Math.max(0, SHEET_LIST.findIndex(x => x.cid === cid && (!pid || x.pid === pid))) : -1; SHEET_OPTS = opts;
  renderSheet(opts);
  $("#sheet").classList.add("on");
  $("#sheetBox").style.transform = ""; $("#sheetBox").scrollTop = 0;
}
function renderSheet(opts){
  const c = SHEET_CARD, p = SHEET_PRINT, pr = priceOf(p.id);
  const q = qtyOf(p.id), tot = cardQty(c);
  const kw = c.kw.map(k => `<span class="kw">${k}</span>`).join(" ");
  $("#sheetBox").innerHTML = `
    <div class="grab"><i></i></div>
    <div class="shd">
      <div class="art">${p.img ? `<img id="sheetArt" src="${imgUrl(p.id)}" alt="${esc(c.dn)}">` : `<div class="ph">${esc(c.dn)}</div>`}${opts.pick ? "" : `<button class="favst big${(S.settings.favCards || {})[c.id] ? " on" : ""}" id="favStar" aria-label="Carta preferita" title="${(S.settings.favCards || {})[c.id] ? "Carta preferita" : "Aggiungi alle carte preferite"}">${(S.settings.favCards || {})[c.id] ? "★" : "☆"}</button>`}</div>
      <div style="flex:1;min-width:0">
        <h3>${esc(c.dn)}</h3>
        <div class="ln"><i class="pip ${c.color}"></i> ${COLOR_IT[c.color] || ""} · ${TYPE_IT[c.type] || c.type}${c.cls.length ? " · " + esc(c.cls.join(", ")) : ""}</div>
        <div class="ln">${esc(setName(p.set))} · #${esc(p.num)} · ${esc(RARITY_IT[p.rarity] || p.rarity)}${p.artist ? " · ill. " + esc(p.artist) : ""}</div>
        <div class="statline">${statsHTML(c)} ${kw}</div>
        <div class="statline" style="align-items:center">
          <b class="num" style="font-size:18px">${pr ? eur(pr.trend) : "—"}</b>
          ${pr ? `<span class="chip">${pr.approx ? "stimato · " : ""}${pr.src === "trend" ? "trend" : pr.src === "foil" ? "trend foil" : pr.src === "media" ? "prezzo medio" : "prezzo minimo"}${pr.low > 0 && pr.src !== "da" ? " · da " + eur(pr.low) : ""}</span>` : `<span class="chip">senza prezzo</span>`}
          ${pr && pr.avg30 != null ? `<span class="chip">30gg ${eur(pr.avg30)}</span>` : ""}
        </div>
      </div>
      <div class="shnav">${SHEET_LIST ? `<button class="btn sm icon" id="sheetPrev" aria-label="Carta precedente" ${SHEET_IDX > 0 ? "" : "disabled"}>‹</button><button class="btn sm icon" id="sheetNext" aria-label="Carta successiva" ${SHEET_IDX < SHEET_LIST.length - 1 ? "" : "disabled"}>›</button>` : ""}<button class="btn sm icon" id="closeSheet" aria-label="Chiudi">✕</button></div>
    </div>

    ${opts.pick ? `<div class="acts"><button class="btn yel" id="pickBtn">Usa questa stampa</button></div>` : `
    <div class="acts">
      <span class="qtyctl" title="Copie possedute di questa stampa">
        <button data-q="-1" aria-label="meno">−</button><b id="sheetQty">${q}</b><button data-q="1" aria-label="più">+</button>
      </span>
      <span class="chip" id="sheetTot">${tot} in collezione</span>
      <button class="btn sm${(S.settings.favPrints || {})[c.id] === p.id ? " acc2" : ""}" id="favBtn" title="L'artwork preferito è quello mostrato per questa carta nella Collection">${(S.settings.favPrints || {})[c.id] === p.id ? "◆ Artwork preferito" : "◇ Artwork preferito"}</button>
      <a class="btn sm" href="${cardmarketUrl(c, p.id)}" target="_blank" rel="noopener noreferrer">Cardmarket ↗</a>
      <a class="btn sm" href="https://cyberpunktcg.com/cards/${esc(c.slug)}?printing=${p.id}" target="_blank" rel="noopener noreferrer">Ufficiale ↗</a>
    </div>`}

    ${(() => { const it = cardTextIt() && c.text && itText(c.text) != null;   // traduzione: con l'originale a un tocco
      return `<div class="rules" id="rulesBox">${rulesHTML(c.text) || "<i>Nessun testo.</i>"}${c.flavor ? `<div class="fl">${esc(c.flavor)}</div>` : ""}</div>${it ? `<div class="rulesSw"><small>Traduzione non ufficiale</small><button class="lnk" id="rulesOrig" aria-pressed="false">Mostra l'originale</button></div>` : ""}`; })()}

    ${(() => { const only = Array.isArray(opts.only) && opts.only.length ? opts.only : null, list = only ? c.prints.filter(x => only.includes(x.id)) : c.prints;
      return `<h3 style="margin-top:16px">${only ? `Stampe aperte nel kit (${only.length} ${only.length === 1 ? "copia" : "copie"})` : `Stampe (${c.prints.length})`}</h3>
    <div class="prints">${list.map(x => { const nOpen = only ? only.filter(y => y === x.id).length : 0;
      const xp = priceOf(x.id), xq = qtyOf(x.id);
      return `<div class="pt${x.id === p.id ? " sel" : ""}" data-print="${x.id}" title="${esc(setName(x.set))} #${esc(x.num)}">
        ${x.img ? `<img src="${thumbUrl(x.id)}" alt="" loading="lazy">` : `<div style="aspect-ratio:733/1024"></div>`}
        <div class="cap"><b>${nOpen ? `aperte ×${nOpen}` : xp ? eur(xp.trend) + (xp.approx ? "~" : "") : "—"}${!nOpen && xq ? ` · ×${xq}` : ""}</b>${esc(setName(x.set))} · ${esc(x.lang.toUpperCase())}${x.rarity && x.rarity !== "Common" ? " · " + esc(RARITY_IT[x.rarity] || x.rarity) : ""}</div>
      </div>`; }).join("")}</div>`; })()}`;

  $("#closeSheet").onclick = closeSheet;
  $("#sheetArt")?.addEventListener("click", () => openLens(imgUrl(p.id)));
  $$("#sheetBox [data-q]").forEach(b => b.onclick = () => {
    setQty(p.id, qtyOf(p.id) + (+b.dataset.q));
    $("#sheetQty").textContent = qtyOf(p.id); $("#sheetTot").textContent = cardQty(c) + " in collezione";
    document.dispatchEvent(new CustomEvent("ncd:collection"));
  });
  $$("#sheetBox [data-print]").forEach(el => el.onclick = () => { SHEET_PRINT = DATA.byPrint.get(el.dataset.print); renderSheet(opts); });
  $("#pickBtn")?.addEventListener("click", () => { onPick && onPick(SHEET_PRINT.id); closeSheet(); });
  $("#sheetPrev")?.addEventListener("click", () => sheetStep(-1)); $("#sheetNext")?.addEventListener("click", () => sheetStep(1));
  // la stella è la CARTA preferita (vale per tutte le sue stampe); «Artwork preferito» sceglie quale stampa mostrare: sono indipendenti
  $("#favStar")?.addEventListener("click", e => { e.stopPropagation(); const f = S.settings.favCards = S.settings.favCards || {}; if(f[c.id]) delete f[c.id]; else f[c.id] = true; S.save("settings"); renderSheet(opts); document.dispatchEvent(new CustomEvent("ncd:collection")); });
  $("#rulesOrig")?.addEventListener("click", e => { const b = e.currentTarget, orig = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(orig)); b.textContent = orig ? "Mostra la traduzione" : "Mostra l'originale"; $("#rulesBox").innerHTML = (rulesHTML(c.text, orig) || "<i>Nessun testo.</i>") + (c.flavor ? `<div class="fl">${esc(c.flavor)}</div>` : ""); });
  $("#favBtn")?.addEventListener("click", () => { S.settings.favPrints = S.settings.favPrints || {}; if(S.settings.favPrints[c.id] === p.id) delete S.settings.favPrints[c.id]; else S.settings.favPrints[c.id] = p.id; S.save("settings"); renderSheet(opts); document.dispatchEvent(new CustomEvent("ncd:collection")); });
}
export function closeSheet(){
  const box = $("#sheetBox"); box.classList.remove("drag", "snap"); box.style.transform = "";
  $("#sheet").classList.remove("on");
}

/* trascinamento della modale verso il basso, solo da mobile */
(function sheetDrag(){
  const sheet = document.getElementById("sheet"), box = document.getElementById("sheetBox");
  if(!sheet) return;
  let startY = 0, dy = 0, dragging = false;
  box.addEventListener("pointerdown", e => {
    if(window.innerWidth >= 700) return;
    if(!(e.target.closest(".grab") || e.target.closest(".shd"))) return;
    if(e.target.closest("button, a, input, img")) return;
    if(box.scrollTop > 2) return;
    dragging = true; startY = e.clientY; dy = 0; box.classList.add("drag"); box.classList.remove("snap");
    box.setPointerCapture?.(e.pointerId);
  });
  box.addEventListener("pointermove", e => { if(!dragging) return; dy = Math.max(0, e.clientY - startY); box.style.transform = `translateY(${dy}px)`; });
  const end = () => { if(!dragging) return; dragging = false; box.classList.remove("drag"); box.classList.add("snap");
    if(dy > 110){ box.style.transform = "translateY(100%)"; setTimeout(closeSheet, 200); } else box.style.transform = ""; };
  box.addEventListener("pointerup", end); box.addEventListener("pointercancel", end);
  sheet.addEventListener("click", e => { if(e.target === sheet) closeSheet(); });
  // swipe orizzontale (non sulle stampe, che scorrono di lato): carta precedente o successiva dell'elenco
  let sx = null, sy = 0;
  box.addEventListener("touchstart", e => { if(!SHEET_LIST || e.touches.length !== 1 || e.target.closest(".prints, input")) { sx = null; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  box.addEventListener("touchend", e => { if(sx == null) return; const t = e.changedTouches[0], dx = t.clientX - sx, dy2 = t.clientY - sy; sx = null; if(Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy2) * 1.6) sheetStep(dx < 0 ? 1 : -1); }, { passive: true });
  document.addEventListener("keydown", e => { if(!sheet.classList.contains("on") || e.target.closest?.("input, textarea")) return; if(e.key === "ArrowRight") sheetStep(1); else if(e.key === "ArrowLeft") sheetStep(-1); else if(e.key === "Escape") closeSheet(); });
})();

/* ------------------------------------------------------------ lente con zoom */
/* testo italiano sulla carta ingrandita (Impostazioni → Lingua → «Testo delle carte: Italiano»): un riquadro con i colori
   del riquadro stampato copre le righe inglesi (posizioni in cardbox.js); se la stampa non è nell'elenco, il testo va sotto
   la carta. «Originale» in alto rimette il testo stampato. */
let BOXES = null;
async function lensText(lens, wrap, src){
  lens.querySelectorAll(".ltx, .ltxcap, .ltog").forEach(e => e.remove());
  const pid = decodeURIComponent((String(src).match(/img\/([^/?#]+)\.webp/) || [])[1] || ""), pr = DATA.byPrint.get(pid), card = pr && pr.card;
  if(!cardTextIt() || !card || !card.text) return;
  const it = itText(card.text); if(it == null) return;
  if(!BOXES){ let js = {}, nw = {};
    try{ js = (await import("./cardbox.js")).CARD_BOX; }catch(e){}
    try{ const r = await fetch("./cardbox.json"); if(r.ok) nw = await r.json(); }catch(e){}   // le carte uscite dopo cardbox.js (workflow notturno)
    BOXES = { ...nw, ...js }; }
  if(!lens.classList.contains("on") || !wrap.isConnected) return;
  const b = BOXES[pid], img = wrap.querySelector("img");
  let el;
  if(b){
    const [t0, t1, c0, c1] = b, top = Math.max(.3, t0 - .009), bot = Math.min(.935, t1 + .012);
    el = document.createElement("div"); el.className = c0 ? "ltx" : "ltx fa";   // senza colori: stampa ad arte piena, velo scuro (CSS)
    el.style.cssText = `top:${(top * 100).toFixed(2)}%;height:${((bot - top) * 100).toFixed(2)}%` + (c0 ? `;background:linear-gradient(#${c0},#${c1})` : "");
    el.innerHTML = `<div class="in">${cardFaceHTML(it)}</div>`; wrap.appendChild(el);
    // la traduzione è spesso più lunga: il carattere scende finché il testo entra, poi il riquadro cresce verso l'alto
    const fit = () => { if(!el.isConnected || !img.clientHeight) return; const inn = el.firstChild; let fs = 2.55, h = bot - top, tp = top;
      const set = () => { inn.style.fontSize = (fs * img.clientHeight / 100).toFixed(2) + "px"; el.style.top = (tp * 100).toFixed(2) + "%"; el.style.height = (h * 100).toFixed(2) + "%";
        // il riquadro della potenza (in basso a destra su Unità, Leggende e Gear) resta scoperto
        if(card.type !== "Program"){ const yl = Math.max(0, Math.min(100, (.88 - tp) / h * 100)).toFixed(1); el.style.clipPath = `polygon(0 0,100% 0,100% ${yl}%,90.5% ${yl}%,90.5% 100%,0 100%)`; } };
      set(); while(inn.scrollHeight > el.clientHeight + 1 && fs > 1.6){ fs -= .06; set(); }
      while(inn.scrollHeight > el.clientHeight + 1 && tp > top - .025){ tp -= .005; h += .005; set(); } };   // al massimo poco sopra: titolo e classi restano visibili
    if(img.complete && img.naturalWidth) requestAnimationFrame(fit); else img.addEventListener("load", () => requestAnimationFrame(fit), { once: true });
  } else { el = document.createElement("div"); el.className = "ltxcap"; el.innerHTML = cardFaceHTML(it); lens.appendChild(el); }
  const tog = document.createElement("button"); tog.className = "ltog"; tog.type = "button"; tog.textContent = "Originale"; tog.setAttribute("aria-pressed", "false");
  tog.addEventListener("click", e => { e.stopPropagation(); const orig = tog.getAttribute("aria-pressed") !== "true"; tog.setAttribute("aria-pressed", String(orig)); tog.textContent = orig ? "Italiano" : "Originale"; el.hidden = orig; });
  lens.appendChild(tog);
}
export function openLens(src){
  const lens = $("#lens"), img = $("#lens img");
  let wrap = img.parentElement.classList.contains("lcard") ? img.parentElement : null;
  if(!wrap){ wrap = document.createElement("div"); wrap.className = "lcard"; img.replaceWith(wrap); wrap.appendChild(img); }
  img.src = src; img.style.transform = ""; wrap.style.transform = ""; lens.classList.add("on");
  lensText(lens, wrap, src);
  let scale = 1, tx = 0, ty = 0, pts = new Map(), last = null, startDist = 0, startScale = 1;
  const apply = () => { wrap.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; };
  const down = e => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if(pts.size === 2){ const [a, b] = [...pts.values()]; startDist = Math.hypot(a.x - b.x, a.y - b.y); startScale = scale; } last = { x: e.clientX, y: e.clientY }; };
  const move = e => {
    if(!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if(pts.size === 2){ const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); scale = Math.min(5, Math.max(1, startScale * d / startDist)); apply(); }
    else if(pts.size === 1 && scale > 1 && last){
      // con la plancia aperta su un telefono in verticale la lente è ruotata di 90°: lo spostamento del dito va riportato ai suoi assi
      const dx = e.clientX - last.x, dy = e.clientY - last.y, rot = matchMedia("(orientation: portrait) and (max-width: 760px)").matches && document.querySelector("#board:not([hidden])");
      if(rot){ tx += dy; ty -= dx; } else { tx += dx; ty += dy; } last = { x: e.clientX, y: e.clientY }; apply(); }
  };
  const up = e => { pts.delete(e.pointerId); if(!pts.size){ last = null; if(scale <= 1.02){ scale = 1; tx = ty = 0; apply(); } } };
  const wheel = e => { e.preventDefault(); scale = Math.min(5, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 0.87))); if(scale === 1){ tx = ty = 0; } apply(); };
  const dbl = () => { scale = scale > 1 ? 1 : 2.2; tx = ty = 0; apply(); };
  const close = e => { if(e.target === lens || e.target.classList.contains("hint")) hide(); };
  const hide = () => { lens.classList.remove("on"); lens.querySelectorAll(".ltx, .ltxcap, .ltog").forEach(e => e.remove()); img.onpointerdown = img.onpointermove = img.onpointerup = img.onpointercancel = null; lens.onclick = null; img.onwheel = null; img.ondblclick = null; };
  img.onpointerdown = down; img.onpointermove = move; img.onpointerup = up; img.onpointercancel = up; img.onwheel = wheel; img.ondblclick = dbl; lens.onclick = close;
  lens._hide = hide;
}
/* pressione lunga su una miniatura (elenco carte, deckbuilder): lente, senza aprire la scheda */
(function longPressZoom(){
  let t = null, fired = false, start = null;
  document.addEventListener("pointerdown", e => {
    const img = e.target.closest(".row .thumb, .row .thumbwrap, .lslot, .pt img"); if(!img || e.target.closest("#board, .lslot .x")) return;
    const row = img.closest("[data-pid], [data-print], .lslot"); const pid = row ? (row.dataset.pid || row.dataset.print) : null; if(!pid) return;
    fired = false; start = { x: e.clientX, y: e.clientY };
    t = setTimeout(() => { fired = true; openLens(imgUrl(pid)); }, 420);
  });
  const cancel = () => { clearTimeout(t); t = null; };
  document.addEventListener("pointermove", e => { if(t && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
  document.addEventListener("pointerup", cancel); document.addEventListener("pointercancel", cancel);
  document.addEventListener("click", e => { if(fired){ fired = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  document.addEventListener("contextmenu", e => { if(e.target.closest(".row .thumb, .row .thumbwrap, .lslot, .pt img, .gc")) e.preventDefault(); });
})();
document.addEventListener("keydown", e => {
  if(e.key !== "Escape") return;
  const lens = $("#lens");
  if(lens && lens.classList.contains("on")) lens._hide ? lens._hide() : lens.classList.remove("on");
  else closeSheet();
});
