/* Avvio: dati, tema, navigazione, service worker. */

import { DATA, loadData } from "./data.js";
import { S, storageOk } from "./store.js";
import { $, $$, toast } from "./ui.js";
import { renderCollection } from "./collection.js";
import { renderDeck, openSharedDeck } from "./deck.js";
import { renderProfile, renderSettings, ACCENTS } from "./profile.js";
import { renderSim, setChallenge } from "./sim.js";
import { setOnlineVersion, invitesForMe, activeTables, T as onlineT } from "./online.js";
import { renderRules } from "./rules.js";
import { renderHome, wireHome } from "./home.js";
import { initI18n } from "./i18n.js";
import { bootCloud, state as cloudState } from "./cloud.js";

export const APP_VERSION = "1.9.4";
setOnlineVersion(APP_VERSION);

const TABS = { home: renderHome, collection: renderCollection, deck: renderDeck, profile: renderProfile, sim: renderSim, rules: renderRules, settings: renderSettings };

/* aspetto, letto dal profilo: ogni aspetto è scuro o chiaro (il vecchio «tema chiaro» non c'è più) */
export function applyTheme(){
  const p = S.profile;
  const pal = ACCENTS.find(a => a.id === p.accent) || ACCENTS[0];
  document.documentElement.dataset.theme = pal.light ? "light" : "dark";
  if(pal.id !== "holophone") document.documentElement.dataset.accent = pal.id; else delete document.documentElement.dataset.accent;
  // barre di sistema del telefono (stato e gesti): seguono la barra di navigazione dell'app, non un giallo fisso
  // accessibilità: dimensione del testo, contrasto, animazioni
  const a = S.settings.a11y || {}, root = document.documentElement;
  root.dataset.text = a.text || "m"; root.dataset.contrast = a.contrast ? "high" : "normal";
  root.dataset.motion = a.motion === "reduce" || (a.motion !== "never" && matchMedia("(prefers-reduced-motion: reduce)").matches) ? "reduce" : "full";
  const nav = getComputedStyle(document.documentElement).getPropertyValue("--navBg").trim() || "#0b0b0e";
  const meta = $("#themeColor"); if(meta) meta.content = nav;
}

export function showTab(name, push = true){
  if(!TABS[name]) name = "home";
  // il Social si apre dall'avatar della Home: nella barra resta acceso il pulsante Home
  $$("nav.tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === name || (name === "profile" && b.dataset.tab === "home"))));
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
  // un link a un mazzo condiviso (#d=…) apre l'anteprima per salvarlo
  const sharedDeck = () => { if(!location.hash.startsWith("#d=")) return false; const h = location.hash; history.replaceState(null, "", "#home"); showTab("home", false); openSharedDeck(h); return true; };
  window.addEventListener("hashchange", () => { if(!sharedDeck()) showTab(location.hash.slice(1), false); });
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

  wireHome(t => showTab(t));
  if(!sharedDeck()) showTab(location.hash.slice(1) || "home", false);

  // account: dati arrivati da un altro dispositivo → si ridisegna la scheda aperta; badge di messaggi e richieste
  const current = () => ($(".panel.on") || {}).dataset?.tab || "home";
  document.addEventListener("ncd:synced", () => { applyTheme(); TABS[current()](); });
  const badge = () => { const n = (cloudState.unread || 0) + (cloudState.requests || 0) + invitesForMe().length; const b = $('nav.tabs button[data-tab="home"]'); if(!b) return; let s = b.querySelector(".nbadge"); if(n){ if(!s){ s = document.createElement("span"); s.className = "nbadge"; b.appendChild(s); } s.textContent = n > 9 ? "9+" : n; } else if(s) s.remove(); };
  for(const ev of ["ncd:cloud", "ncd:social", "ncd:presence", "ncd:tables"]) document.addEventListener(ev, () => { badge(); if(current() === "home") TABS.home(); if(current() === "profile" && !document.querySelector("#chat:not([hidden])") && document.activeElement?.type !== "range") TABS.profile(); });
  // tavoli online: badge sulle sfide ricevute, avviso all'arrivo di una sfida o di una partita lasciata aperta
  const simBadge = () => { const n = invitesForMe().length; const b = $('nav.tabs button[data-tab="sim"]'); if(!b) return; let s = b.querySelector(".nbadge"); if(n){ if(!s){ s = document.createElement("span"); s.className = "nbadge"; b.appendChild(s); } s.textContent = n; } else if(s) s.remove(); };
  let warnedActive = false;
  document.addEventListener("ncd:tables", () => { simBadge(); if(!warnedActive && !onlineT.row && activeTables().length){ warnedActive = true; toast("Hai una partita online in corso: riprendila dal Simulator entro un minuto", 5000); } });
  document.addEventListener("ncd:invite", e => { const t = e.detail || {}; toast(`${t.host_nick || "Un amico"} ti sfida: apri il Simulator → Online`, 5000); });
  document.addEventListener("ncd:challenge", e => { setChallenge(e.detail); if(current() === "sim") renderSim(); else showTab("sim"); });
  bootCloud();

  if("serviceWorker" in navigator && location.protocol.startsWith("http")){
    try{ await navigator.serviceWorker.register("./sw.js"); }catch(e){ /* senza SW funziona lo stesso */ }
  }
}
boot();
