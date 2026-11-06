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

export const APP_VERSION = "1.9.32";
// tappetini del Simulator: id → nome (le immagini sono mat-<id>.svg e la miniatura mat-<id>-t.svg (immagini dentro un svg: jpg e webp non arrivano sul sito))
export const PLAYMATS = [["skyline", "Night City"], ["corpo", "Torre corporativa"], ["badlands", "Badlands"], ["pacifica", "Lungomare"], ["wall", "Il Muro"]];
/* novità mostrate alla prima apertura dopo un aggiornamento (solo l'ultima versione; chi installa da zero non le vede) */
const NEWS = { v: "1.9.32", items: [
  "<b>Draft contro l'IA</b> (alpha): nel Simulator, scheda Prerelease e draft. Siedi a un tavolo da 8 con 7 bot: giro delle Leggende, 4 buste da 12 carte, poi costruisci il mazzo e sfidi 3 bot del tavolo. Le carte del draft non entrano nella collezione.",
  "Nel draft ogni carta si legge: tieni premuto (o passa il mouse) per il testo e le parole chiave spiegate. Trascina la carta nel pool per prenderla e ricontrolla il pool quando vuoi, per costo o per colore.",
  "<b>Scanner</b>: il riquadro corrisponde a ciò che viene letto e puoi indicare l'edizione (Retail, Beta, Starter…) per riconoscere meglio le varianti.",
  "Mulligan: i Programmi rimessi nel mazzo non sembrano più giocati. I mazzi Prerelease si giocano contro l'IA anche dopo aver riaperto l'app."
] };
// chi usava già l'app prima che esistesse seenVer: ha dati salvati (letti prima che l'avvio scriva qualcosa)
const HAD_DATA = (() => { try{ return ["settings", "decks", "coll", "record", "recent"].some(k => localStorage.getItem("ncd:" + k) != null); }catch(e){ return false; } })();
function showNews(){
  const seen = S.settings.seenVer || (HAD_DATA ? "old" : null); S.settings.seenVer = APP_VERSION; S.save("settings");
  // si mostrano se l'ultima versione vista è precedente a quella delle novità (le correzioni piccole non le ripropongono)
  const older = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for(let i = 0; i < 3; i++){ if((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
  if(!seen || !(seen === "old" || older(seen, NEWS.v))) return;   // prima installazione, o novità già viste
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
  const mat = S.settings.playmat; if(PLAYMATS.some(m => m[0] === mat)) root.dataset.mat = mat; else delete root.dataset.mat;
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
  if(name === "home") $("#p-home").dataset.enter = "1";   // ingresso nella Home: l'emblema fa il suo glitch
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
  // Impostazioni aperte durante il ricollegamento dell'account (es. dopo un refresh): si ridisegnano quando cambia l'utente,
  // così compaiono le notifiche (non mentre si scrive in un campo)
  let lastUser = cloudState.user ? cloudState.user.id : null;
  document.addEventListener("ncd:cloud", () => { const u = cloudState.user ? cloudState.user.id : null; if(u === lastUser) return; lastUser = u;
    if(current() === "settings" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) TABS.settings(); });
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
