/* Collection: tutte le carte, quante ne possiedi, quanto vale il raccolto. */

import { DATA, priceOf, cardPrice, eur, COLORS, COLOR_IT } from "./data.js";
import { S, qtyOf, setQty, cardQty } from "./store.js";
import { $, $$, esc, toast, tileHTML, rowHTML, makeFilters, filtersHTML, passes, bindFilters, sortCards, openCard } from "./ui.js";
import { openScanner } from "./scanner.js";
import { parseCardLines, collectionText } from "./deck.js";

const F = makeFilters("coll");
let wired = false;

export function renderCollection(){
  const root = $("#p-collection");
  if(!wired){ wire(root); wired = true; }
  $("#collFilters").innerHTML = filtersHTML(F);
  $("#collSort").value = S.settings.sort || "name";
  $$("#collOwned button").forEach(b => b.setAttribute("aria-pressed", String((F.owned || "") === b.dataset.o)));
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
  $("#collScan").addEventListener("click", openScanner);
  bindFilters($("#collFilters"), F, renderCollection);
  $("#collOwned").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; F.owned = b.dataset.o; renderCollection(); });
  $("#collSort").addEventListener("change", e => { S.settings.sort = e.target.value; S.save("settings"); renderCollection(); });
  $$("#collView button").forEach(b => b.addEventListener("click", () => { S.settings.view = b.dataset.v; S.save("settings"); renderCollection(); }));
  $("#collRows").addEventListener("click", e => {
    const t = e.target.closest("[data-cid]"); if(!t) return;
    openCard(t.dataset.cid, t.dataset.pid);
  });
  // niente menù "salva immagine" del telefono sulle tessere
  $("#collRows").addEventListener("contextmenu", e => { if(e.target.closest(".gc")) e.preventDefault(); });
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
  wireImport();
}

/* ---- import massivo (aggiorna o sostituisci) ed export in testo */
let impMode = "add", impParsed = null;
function wireImport(){
  const box = $("#collImport"), ta = $("#collImportText");
  const open = () => { box.hidden = false; ta.value = ""; impParsed = null; preview(); setTimeout(() => ta.focus(), 50); };
  const close = () => { box.hidden = true; };
  const preview = () => {
    const txt = ta.value.trim();
    if(!txt){ impParsed = null; $("#collImportPreview").textContent = ""; $("#collImportGo").disabled = true; return; }
    impParsed = parseCardLines(txt);
    const n = impParsed.entries.reduce((a, e) => a + e.n, 0), distinct = new Set(impParsed.entries.map(e => e.pid)).size;
    $("#collImportPreview").innerHTML = `<b>${n} copie</b> di ${distinct} stampe riconosciute${impParsed.bad.length ? ` · <span style="color:var(--bad)">${impParsed.bad.length} righe non riconosciute:</span> ${impParsed.bad.slice(0, 5).map(esc).join(" · ")}${impParsed.bad.length > 5 ? "…" : ""}` : ""}${impMode === "replace" ? " · <b>la collezione attuale verrà azzerata</b>" : ""}`;
    $("#collImportGo").disabled = !impParsed.entries.length;
  };
  $("#collImportBtn").addEventListener("click", open);
  $("#collImportClose").addEventListener("click", close);
  ta.addEventListener("input", preview);
  $("#collImportMode").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; impMode = b.dataset.v; $$("#collImportMode button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); preview(); });
  $("#collImportFile").addEventListener("click", () => $("#collImportInput").click());
  $("#collImportInput").addEventListener("change", async e => {
    const f = e.target.files[0]; if(!f) return;
    let txt = await f.text();
    // CSV: "nome o codice, quantità" (anche con ; e con intestazione)
    if(/\.csv$/i.test(f.name) || /[;,]\s*\d+\s*$/m.test(txt)){
      txt = txt.split(/\r?\n/).filter(l => l.trim() && !/^(name|nome|card|carta|code|codice)/i.test(l)).map(l => { const parts = l.split(/[;,\t]/).map(x => x.trim().replace(/^"|"$/g, "")); const q = parts.find((x, i) => i > 0 && /^\d+$/.test(x)); return q ? `${q} ${parts[0]}` : parts[0]; }).join("\n");
    }
    ta.value = txt; preview(); e.target.value = "";
  });
  $("#collImportGo").addEventListener("click", () => {
    if(!impParsed || !impParsed.entries.length) return;
    if(impMode === "replace" && !confirm("Sostituire tutta la collezione con questa lista?")) return;
    if(impMode === "replace"){ for(const pid of Object.keys(S.coll)) setQty(pid, 0); }
    let n = 0; for(const e of impParsed.entries){ setQty(e.pid, qtyOf(e.pid) + e.n); n += e.n; }
    close(); toast(`${n} copie ${impMode === "replace" ? "caricate" : "aggiunte"} alla collezione`); renderCollection();
  });
  $("#collExportBtn").addEventListener("click", () => {
    const txt = collectionText(S.coll);
    const blob = new Blob([txt], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `collezione-${new Date().toISOString().slice(0, 10)}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    (navigator.clipboard?.writeText(txt) || Promise.reject()).then(() => toast("Collezione esportata (file e appunti)")).catch(() => toast("Collezione esportata"));
  });
}
