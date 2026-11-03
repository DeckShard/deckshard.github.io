/* Pezzi di interfaccia condivisi: toast, scheda carta (modale con
   trascinamento), lente con zoom, tessere e righe, filtri.               */

import { DATA, COLORS, COLOR_IT, TYPES, TYPE_IT, RARITY_IT, setName, imgUrl, thumbUrl,
         priceOf, cardPrice, eur, cardmarketUrl, rulesHTML, classificationsOf, setRank } from "./data.js";
import { S, qtyOf, setQty, cardQty } from "./store.js";

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function toast(msg, ms = 2400){
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("on"), ms);
}

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
  return { q: "", colors: new Set(), types: new Set(), rar: new Set(), cls: new Set(), cost: new Set(), sets: new Set(), owned: false, scope };
}
export function filtersHTML(f){
  const pips = COLORS.map(c => `<button class="pipbtn" data-fk="colors" data-fv="${c}" aria-pressed="${f.colors.has(c)}" title="${COLOR_IT[c]}"><i class="pip ${c}" style="position:absolute;inset:7px;width:auto;height:auto"></i></button>`).join("");
  const types = TYPES.map(t => `<button class="tag" data-fk="types" data-fv="${t}" aria-pressed="${f.types.has(t)}">${TYPE_IT[t]}</button>`).join("");
  const costs = ["0","1","2","3","4","5","6","7+"].map(v => `<button class="tag" data-fk="cost" data-fv="${v}" aria-pressed="${f.cost.has(v)}">${v}</button>`).join("");
  const rar = Object.keys(RARITY_IT).map(r => `<button class="tag" data-fk="rar" data-fv="${r}" aria-pressed="${f.rar.has(r)}">${RARITY_IT[r]}</button>`).join("");
  // tratti: i 14 più comuni (più quelli già scelti); «Tutti i tratti» li mostra tutti in ordine alfabetico
  const allCls = classificationsOf(), top = allCls.slice(0, 14);
  const shown = f.clsAll ? allCls.slice().sort((a, b) => a.localeCompare(b, "it")) : [...top, ...allCls.slice(14).filter(k => f.cls.has(k))];
  const cls = shown.map(k => `<button class="tag" data-fk="cls" data-fv="${esc(k)}" aria-pressed="${f.cls.has(k)}">${esc(k)}</button>`).join("")
    + (allCls.length > 14 ? `<button class="tag more" data-fclsall="1">${f.clsAll ? "Solo i più comuni" : `Tutti i tratti (${allCls.length})`}</button>` : "");
  const n = f.colors.size + f.types.size + f.rar.size + f.cls.size + f.cost.size + f.sets.size;
  const row = (lbl, inner) => `<div class="frow"><span class="lbl">${lbl}</span><span class="fopts">${inner}</span></div>`;
  return `${row("Colore", pips)}${row("Tipo", types)}${row("Costo", costs)}${row("Rarità", rar)}${row("Tratti", cls)}
    ${n ? `<button class="btn sm" data-fclear="1">Azzera i ${n} filtri</button>` : ""}`;
}
export function passes(c, f){
  if(f.q){
    const q = f.q.toLowerCase();
    const hay = (c.dn + " " + c.text + " " + c.cls.join(" ")).toLowerCase();
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
  if((f.owned === true || f.owned === "yes") && !cardQty(c)) return false;
  if(f.owned === "no" && cardQty(c)) return false;
  return true;
}
export function bindFilters(container, f, onChange){
  container.addEventListener("click", e => {
    const b = e.target.closest("[data-fk]");
    if(b){ const set = f[b.dataset.fk]; set.has(b.dataset.fv) ? set.delete(b.dataset.fv) : set.add(b.dataset.fv); onChange(); return; }
    if(e.target.closest("[data-fclsall]")){ f.clsAll = !f.clsAll; onChange(); return; }
    if(e.target.closest("[data-fclear]")){ for(const k of ["colors","types","rar","cls","cost","sets"]) f[k].clear(); onChange(); }
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

/* apre la scheda; `opts.pick(pid)` se chi chiama vuole scegliere una stampa */
export function openCard(cid, pid, opts = {}){
  const c = DATA.byId.get(cid); if(!c) return;
  // `opts.only`: stampe ammesse (Prerelease: solo quelle aperte dal kit)
  const only = Array.isArray(opts.only) && opts.only.length ? opts.only : null;
  SHEET_CARD = c; SHEET_PRINT = DATA.byPrint.get(only && !only.includes(pid) ? only[0] : pid) || c.def; onPick = opts.pick || null;
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
      <div class="art">${p.img ? `<img id="sheetArt" src="${imgUrl(p.id)}" alt="${esc(c.dn)}">` : `<div class="ph">${esc(c.dn)}</div>`}</div>
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
      <button class="btn sm icon" id="closeSheet" aria-label="Chiudi">✕</button>
    </div>

    ${opts.pick ? `<div class="acts"><button class="btn yel" id="pickBtn">Usa questa stampa</button></div>` : `
    <div class="acts">
      <span class="qtyctl" title="Copie possedute di questa stampa">
        <button data-q="-1" aria-label="meno">−</button><b id="sheetQty">${q}</b><button data-q="1" aria-label="più">+</button>
      </span>
      <span class="chip" id="sheetTot">${tot} in collezione</span>
      ${(S.settings.collView || "card") === "card" ? `<button class="btn sm${(S.settings.favPrints || {})[c.id] === p.id ? " acc2" : ""}" id="favBtn" title="Mostra sempre questa stampa nella Collection">${(S.settings.favPrints || {})[c.id] === p.id ? "★ In Collection" : "☆ Mostra in Collection"}</button>` : ""}
      <a class="btn sm" href="${cardmarketUrl(c, p.id)}" target="_blank" rel="noopener noreferrer">Cardmarket ↗</a>
      <a class="btn sm" href="https://cyberpunktcg.com/cards/${esc(c.slug)}?printing=${p.id}" target="_blank" rel="noopener noreferrer">Ufficiale ↗</a>
    </div>`}

    <div class="rules">${rulesHTML(c.text) || "<i>Nessun testo.</i>"}${c.flavor ? `<div class="fl">${esc(c.flavor)}</div>` : ""}</div>

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
})();

/* ------------------------------------------------------------ lente con zoom */
export function openLens(src){
  const lens = $("#lens"), img = $("#lens img");
  img.src = src; img.style.transform = ""; lens.classList.add("on");
  let scale = 1, tx = 0, ty = 0, pts = new Map(), last = null, startDist = 0, startScale = 1;
  const apply = () => { img.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; };
  const down = e => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if(pts.size === 2){ const [a, b] = [...pts.values()]; startDist = Math.hypot(a.x - b.x, a.y - b.y); startScale = scale; } last = { x: e.clientX, y: e.clientY }; };
  const move = e => {
    if(!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if(pts.size === 2){ const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); scale = Math.min(5, Math.max(1, startScale * d / startDist)); apply(); }
    else if(pts.size === 1 && scale > 1 && last){ tx += e.clientX - last.x; ty += e.clientY - last.y; last = { x: e.clientX, y: e.clientY }; apply(); }
  };
  const up = e => { pts.delete(e.pointerId); if(!pts.size){ last = null; if(scale <= 1.02){ scale = 1; tx = ty = 0; apply(); } } };
  const wheel = e => { e.preventDefault(); scale = Math.min(5, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 0.87))); if(scale === 1){ tx = ty = 0; } apply(); };
  const dbl = () => { scale = scale > 1 ? 1 : 2.2; tx = ty = 0; apply(); };
  const close = e => { if(e.target === lens || e.target.classList.contains("hint")) hide(); };
  const hide = () => { lens.classList.remove("on"); img.onpointerdown = img.onpointermove = img.onpointerup = img.onpointercancel = null; lens.onclick = null; img.onwheel = null; img.ondblclick = null; };
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
