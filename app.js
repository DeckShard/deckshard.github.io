/* Avvio: dati, tema, navigazione, service worker. */

import { DATA, loadData } from "./data.js";
import { S, storageOk } from "./store.js";
import { $, $$, toast } from "./ui.js";
import { renderCollection } from "./collection.js";
import { renderDeck } from "./deck.js";
import { renderProfile, renderSettings } from "./profile.js";
import { renderSim } from "./sim.js";
import { renderRules } from "./rules.js";
import { initI18n } from "./i18n.js";
import { bootCloud, state as cloudState } from "./cloud.js";

export const APP_VERSION = "1.5.0";

const TABS = { collection: renderCollection, deck: renderDeck, profile: renderProfile, sim: renderSim, rules: renderRules, settings: renderSettings };

/* tema (auto/chiaro/scuro) + accento, letti dal profilo */
export function applyTheme(){
  const p = S.profile;
  const dark = !(p.theme === "light" || (p.theme === "auto" && !matchMedia("(prefers-color-scheme: dark)").matches));
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  if(p.accent && p.accent !== "holophone") document.documentElement.dataset.accent = p.accent; else delete document.documentElement.dataset.accent;
  // barre di sistema del telefono (stato e gesti): seguono la barra di navigazione dell'app, non un giallo fisso
  const nav = getComputedStyle(document.documentElement).getPropertyValue("--navBg").trim() || (dark ? "#0b0b0e" : "#f3efe2");
  const meta = $("#themeColor"); if(meta) meta.content = nav;
}
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);

export function showTab(name, push = true){
  if(!TABS[name]) name = "collection";
  $$("nav.tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  $$(".panel").forEach(p => p.classList.toggle("on", p.dataset.tab === name));
  $("#btnSettings").classList.toggle("on", name === "settings");
  if(push && location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  TABS[name]();
  window.scrollTo({ top: 0 });
}

async function boot(){
  applyTheme();
  initI18n(S.profile.lang);
  window.NCD_I18N = { apply(l){ S.profile.lang = l; S.save("profile"); location.reload(); } };
  $$("nav.tabs button").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
  window.addEventListener("hashchange", () => showTab(location.hash.slice(1), false));
  $("#btnSettings").addEventListener("click", e => { e.preventDefault(); showTab("settings"); });

  try{
    await loadData("./");
  }catch(e){
    $("#metaLine").textContent = "dati non disponibili";
    $("#p-collection").insertAdjacentHTML("afterbegin", `<div class="note"><b>Catalogo non trovato.</b> ${e.message}. Se stai aprendo il file in locale, servi la cartella con un server web (es. <code>python -m http.server</code>).</div>`);
    return;
  }
  const n = DATA.cards.length, np = DATA.cards.reduce((a, c) => a + c.prints.length, 0);
  $("#metaLine").textContent = `${n} carte · ${np} stampe`;
  $("#verLine").textContent = `v${APP_VERSION}` + (DATA.pricesAt ? ` · prezzi del ${new Date(DATA.pricesAt).toLocaleDateString("it-IT")}` : "");
  if(!storageOk()) toast("Memoria locale non disponibile: le modifiche non verranno salvate", 5000);

  showTab(location.hash.slice(1) || "collection", false);

  // account: dati arrivati da un altro dispositivo → si ridisegna la scheda aperta; badge di messaggi e richieste
  const current = () => ($(".panel.on") || {}).dataset?.tab || "collection";
  document.addEventListener("ncd:synced", () => { applyTheme(); TABS[current()](); });
  const badge = () => { const n = (cloudState.unread || 0) + (cloudState.requests || 0); const b = $('nav.tabs button[data-tab="profile"]'); let s = b.querySelector(".nbadge"); if(n){ if(!s){ s = document.createElement("span"); s.className = "nbadge"; b.appendChild(s); } s.textContent = n > 9 ? "9+" : n; } else if(s) s.remove(); };
  for(const ev of ["ncd:cloud", "ncd:social", "ncd:presence"]) document.addEventListener(ev, () => { badge(); if(current() === "profile" && !document.querySelector("#chat:not([hidden])")) TABS.profile(); });
  bootCloud();

  if("serviceWorker" in navigator && location.protocol.startsWith("http")){
    try{ await navigator.serviceWorker.register("./sw.js"); }catch(e){ /* senza SW funziona lo stesso */ }
  }
}
boot();
