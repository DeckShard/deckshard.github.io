/* Collection: tutte le carte, quante ne possiedi, quanto vale il raccolto. */

import { DATA, priceOf, cardPrice, eur, COLORS, COLOR_IT } from "./data.js";
import { S, qtyOf, setQty, cardQty } from "./store.js";
import { $, $$, esc, toast, tileHTML, rowHTML, makeFilters, filtersHTML, passes, bindFilters, sortCards, openCard } from "./ui.js";

const F = makeFilters("coll");
let wired = false;

export function renderCollection(){
  const root = $("#p-collection");
  if(!wired){ wire(root); wired = true; }
  $("#collFilters").innerHTML = filtersHTML(F);
  $("#collSort").value = S.settings.sort || "name";
  $("#collOwned").setAttribute("aria-pressed", String(!!F.owned));
  $("#collView button").forEach?.call($$("#collView button"), b => b.setAttribute("aria-pressed", String(b.dataset.v === (S.settings.view || "grid"))));

  // tessere di riepilogo
  let owned = 0, distinct = 0, value = 0, priced = 0;
  for(const c of DATA.cards){
    let any = false;
    for(const p of c.prints){
      const q = qtyOf(p.id); if(!q) continue;
      owned += q; any = true;
      const pr = priceOf(p.id) || cardPrice(c);
      if(pr){ value += pr.trend * q; priced += q; }
    }
    if(any) distinct++;
  }
  $("#tOwned").textContent = owned; $("#tOwnedN").textContent = `${distinct} di ${DATA.cards.length} carte diverse`;
  $("#tValue").textContent = eur(value); $("#tValueN").textContent = priced < owned ? `${owned - priced} copie senza prezzo` : "trend Cardmarket";
  const pct = Math.round(distinct / DATA.cards.length * 100);
  $("#tSet").textContent = pct + "%"; $("#tSetN").textContent = "del catalogo";
  $("#tPrices").textContent = DATA.pricesAt ? new Date(DATA.pricesAt).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) : "—";
  $("#tPricesN").textContent = "listino Cardmarket";

  let list = DATA.cards.filter(c => passes(c, F));
  list = sortCards(list, S.settings.sort);
  $("#collCount").textContent = `${list.length} carte`;
  const box = $("#collRows");
  if(!list.length){ box.className = "rows"; box.innerHTML = `<div class="empty">Nessuna carta con questi filtri.</div>`; return; }
  if((S.settings.view || "grid") === "grid"){
    box.className = "grid";
    box.innerHTML = list.map(c => tileHTML(c, null, { dim: true })).join("");
  } else {
    box.className = "rows";
    box.innerHTML = list.map(c => {
      const q = cardQty(c), pr = cardPrice(c);
      return rowHTML(c, null, `<div class="pr"><b>${pr ? eur(pr.trend) + (pr.approx ? " ~" : "") : "—"}</b><span class="chip${q ? " acc" : ""}">${q ? "×" + q : "0"}</span></div>`);
    }).join("");
  }
}

function wire(root){
  $("#collQ").addEventListener("input", e => { F.q = e.target.value.trim(); renderCollection(); });
  $("#collFilt").addEventListener("click", () => $("#collFilters").classList.toggle("on"));
  bindFilters($("#collFilters"), F, renderCollection);
  $("#collOwned").addEventListener("click", () => { F.owned = !F.owned; renderCollection(); });
  $("#collSort").addEventListener("change", e => { S.settings.sort = e.target.value; S.save("settings"); renderCollection(); });
  $$("#collView button").forEach(b => b.addEventListener("click", () => { S.settings.view = b.dataset.v; S.save("settings"); renderCollection(); }));
  $("#collRows").addEventListener("click", e => {
    const t = e.target.closest("[data-cid]"); if(!t) return;
    openCard(t.dataset.cid, t.dataset.pid);
  });
  // pressione lunga su una tessera: +1 copia della stampa predefinita, senza aprire la scheda
  let timer = null, fired = false;
  $("#collRows").addEventListener("pointerdown", e => {
    const t = e.target.closest(".gc"); if(!t) return;
    fired = false;
    timer = setTimeout(() => { fired = true; const c = DATA.byId.get(t.dataset.cid); setQty(c.def.id, qtyOf(c.def.id) + 1); navigator.vibrate?.(12); toast(`+1 ${c.dn}`); renderCollection(); }, 480);
  });
  const cancel = () => { clearTimeout(timer); };
  $("#collRows").addEventListener("pointerup", cancel); $("#collRows").addEventListener("pointercancel", cancel); $("#collRows").addEventListener("pointerleave", cancel);
  $("#collRows").addEventListener("click", e => { if(fired){ e.stopImmediatePropagation(); fired = false; } }, true);
  document.addEventListener("ncd:collection", renderCollection);
}
