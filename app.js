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
import { renderChatTab, openChatWith } from "./social.js";
import { initI18n } from "./i18n.js";
import { bootCloud, state as cloudState } from "./cloud.js";

export const APP_VERSION = "1.9.18";
/* novità mostrate alla prima apertura dopo un aggiornamento (solo l'ultima versione; chi installa da zero non le vede) */
const NEWS = { v: "1.9.18", items: [
  "Nuova scheda <b>Chat</b> nella barra in basso; le <b>Regole</b> sono la terza scheda del Simulator. Una notifica di messaggio apre la conversazione, e in partita puoi rispondere al tuo amico.",
  "Partita offline sullo stesso telefono: dopo il mulligan c'è la schermata di passaggio, e chi prende il telefono vede cosa ha fatto l'altro nel suo turno.",
  "Collection: <b>★ Artwork preferito</b> direttamente sulla carta, filtro delle preferite e scorrimento a destra e sinistra tra le carte aperte.",
  "Filtri più compatti (al massimo due righe, poi «Tutti…»), con i nuovi filtri <b>Parole chiave</b> ed <b>Effetti</b>.",
  "Deckbuilder: l'elenco si divide in <b>Nel mazzo</b> e <b>Non nel mazzo</b>, a scomparsa.",
  "Nuovo aspetto scuro <b>NetWatch</b> e sette nuovi aspetti chiari; Girlypop diventa <b>Us Cracks</b>; nuovi emblemi per Holophone, Samurai, Us Cracks e Voodoo Boys.",
  "Nell'app installata la plancia non chiede più lo schermo intero (niente avviso del telefono); nel browser si può spegnere dalle Impostazioni.",
  "Nel feedback puoi indicare se scrivi da telefono, tablet o PC."
] };
function showNews(){
  const seen = S.settings.seenVer; S.settings.seenVer = APP_VERSION; S.save("settings");
  if(!seen || seen === APP_VERSION || NEWS.v !== APP_VERSION) return;   // prima installazione o nessuna novità per questa versione
  const el = document.createElement("div"); el.id = "newsAsk"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "newsT");
  el.innerHTML = `<div class="box"><div class="kick">Aggiornamento · v${APP_VERSION}</div><h3 id="newsT">Novità in DeckShard</h3><ul>${NEWS.items.map(t => `<li>${t}</li>`).join("")}</ul><div class="opts"><button class="btn yel" id="newsOk">Ricevuto, choom</button></div></div>`;
  document.body.appendChild(el);
  const close = () => { el.remove(); document.removeEventListener("keydown", esc); }, esc = e => { if(e.key === "Escape") close(); };
  el.addEventListener("click", e => { if(e.target === el || e.target.closest("#newsOk")) close(); }); document.addEventListener("keydown", esc);
  $("#newsOk").focus();
}
setOnlineVersion(APP_VERSION);

const TABS = { home: renderHome, collection: renderCollection, deck: renderDeck, profile: renderProfile, sim: renderSim, rules: renderRules, settings: renderSettings, chat: renderChatTab };

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
  // le Regole sono la terza scheda del Simulator: nella barra resta acceso Simulator
  $$("nav.tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === name || (name === "profile" && b.dataset.tab === "home") || (name === "rules" && b.dataset.tab === "sim"))));
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
  // notifica di un messaggio: #chat/<id> apre la scheda Chat e la conversazione con quell'amico (appena gli amici sono caricati)
  const chatLink = () => { const m = /^#chat\/([\w-]{8,64})$/.exec(location.hash); if(!m) return false; history.replaceState(null, "", "#chat"); showTab("chat", false); openChatWith(m[1]); return true; };
  const sharedDeck = () => { if(chatLink()) return true; if(!location.hash.startsWith("#d=")) return false; const h = location.hash; history.replaceState(null, "", "#home"); showTab("home", false); openSharedDeck(h); return true; };
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
  showNews();
  // su PC la barra delle sezioni resta appiccicata sotto l'intestazione: le si passa l'altezza (al netto dello zoom del testo)
  const hdr = $("header.top"), nav = $("nav.tabs");
  const navTop = () => { const z = parseFloat(getComputedStyle(nav).zoom) || 1; document.documentElement.style.setProperty("--hdrH", (hdr.getBoundingClientRect().height / z).toFixed(1) + "px"); };
  navTop(); if(typeof ResizeObserver !== "undefined") new ResizeObserver(navTop).observe(hdr); window.addEventListener("resize", navTop);

  // account: dati arrivati da un altro dispositivo → si ridisegna la scheda aperta; badge di messaggi e richieste
  const current = () => ($(".panel.on") || {}).dataset?.tab || "home";
  document.addEventListener("ncd:synced", () => { applyTheme(); TABS[current()](); });
  const chatBadge = () => { const n = cloudState.unread || 0, b = $('nav.tabs button[data-tab="chat"]'); if(!b) return; let s = b.querySelector(".nbadge"); if(n){ if(!s){ s = document.createElement("span"); s.className = "nbadge"; b.appendChild(s); } s.textContent = n > 9 ? "9+" : n; } else if(s) s.remove(); };
  const badge = () => { chatBadge(); const n = (cloudState.requests || 0) + invitesForMe().length; const b = $('nav.tabs button[data-tab="home"]'); if(!b) return; let s = b.querySelector(".nbadge"); if(n){ if(!s){ s = document.createElement("span"); s.className = "nbadge"; b.appendChild(s); } s.textContent = n > 9 ? "9+" : n; } else if(s) s.remove(); };
  for(const ev of ["ncd:cloud", "ncd:social", "ncd:presence", "ncd:tables"]) document.addEventListener(ev, () => { badge(); if(current() === "home") TABS.home(); if(current() === "chat") TABS.chat(); if(current() === "profile" && !document.querySelector("#chat:not([hidden])") && document.activeElement?.type !== "range") TABS.profile(); });
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
