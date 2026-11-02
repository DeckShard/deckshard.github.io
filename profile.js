/* Profilo: nick, percorso di vita, fazione Holophone, personaggio preferito
   come avatar, tema e accento, collegamenti a Melee/Holophone, record,
   backup dei dati.                                                       */

import { DATA, imgUrl, thumbUrl, RARITY_IT, TYPE_IT } from "./data.js";
import { S, DEFAULT_PROFILE, exportAll, importAll, wipe, storageOk } from "./store.js";
import { $, $$, esc, toast } from "./ui.js";
import { applyTheme, APP_VERSION } from "./app.js";
import { accountHTML, friendsHTML, wireSocial, feedbackHTML, wireFeedback, safeWipe } from "./social.js";
import { state as cloudState } from "./cloud.js";

export const LIFEPATHS = ["Corpo", "Street Kid", "Nomad"];
export const FACTIONS = [
  { id: "Arasaka", c: "Gunnar", d: "Megacorporazione. Contatto Holophone: Gunnar." },
  { id: "Aldecaldos", c: "Monise", d: "Clan nomade delle Badlands. Contatto: Monise." },
  { id: "Maelstrom", c: "Forge", d: "Gang cyberpsico di Watson. Contatto: Forge." }
];
/* personaggi celebri senza (ancora) una carta Leggenda: avatar con iniziali */
export const EXTRA_CHARS = ["Lucy", "David Martinez", "Maine", "Dorio", "Kiwi", "Pilar", "Faraday", "Placide", "Brigitte",
  "Meredith Stout", "Mr. Hands", "Songbird", "Solomon Reed", "Rosalind Myers", "Misty Olszewski", "T-Bug", "Delamain", "Lizzy Wizzy", "Us Cracks", "Morgan Blackhand", "Adam Smasher (2013)"];
export const ACCENTS = [
  { id: "holophone", n: "Holophone (rosso e cyan)", a: "#ff3b3b", b: "#00e5f2" },
  { id: "samurai", n: "Samurai (giallo e rosso)", a: "#fcee0a", b: "#e11a3c" },
  { id: "netrunner", n: "Netrunner", a: "#00e5f2", b: "#ff3bd4" },
  { id: "girlypop", n: "Girlypop (rosa e cyan)", a: "#ff3bd4", b: "#00e5f2" },
  { id: "arasaka", n: "Arasaka", a: "#d8323c", b: "#6a6a72" },
  { id: "nomad", n: "Nomad", a: "#f28c28", b: "#6fae52" },
  { id: "maelstrom", n: "Maelstrom", a: "#e11a3c", b: "#fcee0a" },
  { id: "voodoo", n: "Voodoo Boys (viola e lime)", a: "#a855f7", b: "#c6ff00" },
  { id: "tyger", n: "Tyger Claws (magenta e giada)", a: "#ff2bd6", b: "#2bd9a3" },
  { id: "militech", n: "Militech (verde acido e arancio)", a: "#b8e000", b: "#ff6a00" },
  { id: "trauma", n: "Trauma Team (arancio e ghiaccio)", a: "#ff7a00", b: "#bfe9ff" },
  { id: "afterlife", n: "Afterlife (verde neon e rosso)", a: "#39ff14", b: "#ff1744" },
  { id: "kangtao", n: "Kang Tao (oro e giada)", a: "#ffcc33", b: "#00c48c" },
  { id: "blackwall", n: "Blackwall (rosso e viola)", a: "#ff1e3c", b: "#8a2be2" }
];

const wired = new Set();
const initials = s => s.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();

/* solo l'illustrazione della carta: la Leggenda ha il titolo in alto e il
   testo in basso, l'arte sta circa tra il 17% e il 60% dell'altezza */
export function avatarHTML(p, cls = "avatar"){
  if(p.favImg) return `<div class="${cls} art" role="img" aria-label="${esc(p.fav)}" style="background-image:url('${p.favImg}');background-position:50% ${p.favPos ?? 34}%;background-size:${p.favZoom ?? 150}% auto"></div>`;
  return `<div class="${cls}" style="display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${cls === "avatar" ? 30 : 16}px;color:var(--acc)">${esc(initials(p.fav || p.nick || "NC"))}</div>`;
}

export function renderProfile(){
  const root = $("#p-profile"), p = S.profile;
  if(!wired.has(root)){ wire(root); wireSocial(root, () => { if(root.classList.contains("on")) renderProfile(); }); wired.add(root); }
  // personaggi: le Leggende e le Unità che ritraggono una Leggenda, con tutte le
  // illustrazioni alternative (Secret, Iconic, Nova Rare), in ordine alfabetico
  const legendNames = new Set(DATA.cards.filter(c => c.type === "Legend").map(c => c.name));
  const ALT = new Set(["Secret", "Iconic Other", "Iconic Legend", "Iconic Secret", "Nova Rare"]);
  const chars = [];
  for(const c of DATA.cards.filter(c => c.type === "Legend" || legendNames.has(c.name))){
    const seen = new Set();
    const prints = [c.def, ...c.prints.filter(p => p.img && ALT.has(p.rarity))];
    for(const p of prints){ const k = (p.artist || "") + "|" + (ALT.has(p.rarity) ? p.rarity : ""); if(seen.has(k)) continue; seen.add(k);
      chars.push({ key: c.dn + (p === c.def ? "" : " · " + (RARITY_IT[p.rarity] || p.rarity)), dn: c.dn, name: c.name, pid: p.id, tag: p === c.def ? (c.type === "Legend" ? "" : TYPE_IT[c.type]) : (RARITY_IT[p.rarity] || p.rarity) }); }
  }
  for(const n of EXTRA_CHARS) chars.push({ key: n, dn: n, name: n, pid: null, tag: "" });
  chars.sort((a, b) => a.dn.localeCompare(b.dn, "it") || a.key.localeCompare(b.key, "it"));
  const games = S.record.games || [], w = S.record.wins || 0, l = S.record.losses || 0;
  const keep = root.querySelector("#frQ, #acEmail, #acCode, #acNick");   // non perdere ciò che si sta scrivendo durante un aggiornamento in tempo reale
  const typing = keep && document.activeElement === keep ? { id: keep.id, v: keep.value } : null;
  root.innerHTML = `
    ${accountHTML()}
    ${friendsHTML()}
    <div class="card">
      <div class="phead">${avatarHTML(p)}
        <div style="min-width:0"><h2>${esc(p.nick || "Senza nome")}</h2>
          <div class="sub">${[p.lifepath, p.faction, p.fav].filter(Boolean).map(esc).join(" · ") || "Completa il profilo qui sotto"}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><span class="chip">${w}V – ${l}S nel simulatore</span>${games.length ? `<span class="chip">${games.length} partite</span>` : ""}${p.melee ? `<span class="chip">melee: ${esc(p.melee)}</span>` : ""}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Identità</h3>
      ${cloudState.user ? `<div class="field"><label>Nick<small>È il nick pubblico dell'account: si cambia nella scheda Account qui sopra</small></label><b>${esc(p.nick)}</b></div>`
        : `<div class="field"><label for="pfNick">Nick</label><input class="inp" id="pfNick" value="${esc(p.nick)}" placeholder="Il tuo handle" maxlength="24" autocomplete="nickname"></div>`}
      <div class="field"><label>Percorso di vita<small>Da dove vieni a Night City</small></label>
        <span class="seg" id="pfLife">${LIFEPATHS.map(x => `<button data-v="${x}" aria-pressed="${p.lifepath === x}">${x}</button>`).join("")}</span></div>
      <div class="field"><label>Fazione Holophone<small>${esc(FACTIONS.find(f => f.id === p.faction)?.d || "La fazione scelta nel gioco organizzato ufficiale")}</small></label>
        <span class="seg" id="pfFaction">${FACTIONS.map(f => `<button data-v="${f.id}" aria-pressed="${p.faction === f.id}">${f.id}</button>`).join("")}</span></div>
      <div class="field" style="grid-template-columns:1fr"><label>Personaggio preferito<small>Tutte le illustrazioni di Leggende e Unità dei personaggi (anche Secret, Iconic e Nova Rare), in ordine alfabetico; i personaggi senza carta usano le iniziali.</small></label>
        ${p.favImg ? `<details class="fold" style="margin:8px 0 4px"><summary>Regola l'inquadratura dell'avatar</summary><div style="display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;margin-top:8px;font-size:12.5px;color:var(--mute)">
          <span>Inquadratura</span><input type="range" id="pfPos" min="0" max="100" value="${p.favPos ?? 34}" aria-label="Posizione verticale del ritaglio">
          <span>Zoom</span><input type="range" id="pfZoom" min="100" max="260" value="${p.favZoom ?? 150}" aria-label="Zoom del ritaglio"></div></details>` : ""}
        <input class="inp" id="pfCharQ" type="search" placeholder="Cerca personaggio…" autocomplete="off" style="margin-top:6px">
        <div class="chars" id="pfChars">${chars.map(x => `<button data-fav="${esc(x.key)}" data-img="${x.pid ? imgUrl(x.pid) : ""}" class="${p.fav === x.key ? "sel" : ""}" title="${esc(x.key)}">${x.pid ? `<div class="art" style="background-image:url('${thumbUrl(x.pid)}')"></div>` : `<div class="ph">${esc(initials(x.name))}</div>`}<span>${esc(x.name)}${x.tag ? ` <i>${esc(x.tag)}</i>` : ""}</span></button>`).join("")}</div>
      </div>
    </div>

    <div class="card">
      <h3>Gioco organizzato</h3>
      <div class="field"><label for="pfMelee">Nome utente Melee.gg<small>Solo un promemoria: resta sul dispositivo e viene mostrato nel profilo</small></label><input class="inp" id="pfMelee" value="${esc(p.melee)}" placeholder="nome utente" autocomplete="off"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <a class="btn sm" href="https://cyberpunktcg.com/holophone" target="_blank" rel="noopener noreferrer">Holophone ↗</a>
        <a class="btn sm" href="https://melee.gg" target="_blank" rel="noopener noreferrer">Melee.gg ↗</a>
        <a class="btn sm" href="https://cyberpunktcg.com/opfaq" target="_blank" rel="noopener noreferrer">FAQ account e tornei ↗</a>
        <a class="btn sm" href="https://cyberpunktcg.com/gameplay-guide" target="_blank" rel="noopener noreferrer">Guida alle regole ↗</a>
      </div>
      <p class="note" style="margin:12px 0 0"><b>Perché solo collegamenti.</b> Melee.gg e Holophone non espongono un'API pubblica per leggere missioni, risultati o classifiche: si aprono da qui e si usano con il proprio account. Se in futuro WeirdCo la pubblicherà, questa sezione mostrerà i dati direttamente.</p>
    </div>

    <p class="note" style="margin:0">Tema, colori, pagamento automatico nel simulatore, lingua, backup e versione sono nelle <a href="#settings">Impostazioni</a> (l'ingranaggio in alto).</p>`;
  if(typing){ const el = root.querySelector("#" + typing.id); if(el){ el.value = typing.v; el.focus(); } }
}

/* ---------------- Impostazioni: aspetto, lingua, simulatore, prezzi, dati, info */
export const LANGS = [["it", "Italiano"], ["en", "English"]];
export function renderSettings(){
  const root = $("#p-settings"), p = S.profile;
  if(!wired.has(root)){ wire(root); wireFeedback(root, APP_VERSION); wired.add(root); }
  const n = DATA.cards.length, np = DATA.cards.reduce((a, c) => a + c.prints.length, 0);
  const pricesAt = DATA.pricesAt ? new Date(DATA.pricesAt).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "non ancora scaricato";
  root.innerHTML = `
    <div class="card">
      <h2>Impostazioni</h2>
      <div class="sub">Tutto resta su questo dispositivo${storageOk() ? "" : " (memoria non disponibile: nulla verrà salvato)"}.</div>
    </div>

    <div class="card">
      <h3>Lingua</h3>
      <div class="field"><label>Lingua dell'app<small>Le carte restano nella lingua stampata (inglese).</small></label>
        <span class="seg" id="pfLang">${LANGS.map(([v, t]) => `<button data-v="${v}" aria-pressed="${(p.lang || "it") === v}">${t}</button>`).join("")}</span></div>
    </div>

    <div class="card">
      <h3>Aspetto</h3>
      <div class="field"><label>Tema<small>«Come il sistema» segue l'impostazione del dispositivo</small></label>
        <span class="seg" id="pfTheme">${[["dark", "Scuro"], ["light", "Chiaro"], ["auto", "Come il sistema"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${(p.theme || "dark") === v}">${t}</button>`).join("")}</span></div>
      <div class="field"><label>Colori d'accento<small>${esc(ACCENTS.find(a => a.id === p.accent)?.n || "Holophone")}</small></label>
        <span class="swatches" id="pfAccent">${ACCENTS.map(a => `<button class="sw${(p.accent || "holophone") === a.id ? " sel" : ""}" data-v="${a.id}" title="${a.n}" aria-label="${a.n}" style="--a:${a.a};--b:${a.b}"></button>`).join("")}</span></div>
    </div>

    <div class="card">
      <h3>Collection</h3>
      <div class="field"><label>Voci della collezione<small>Una per carta (151), una per illustrazione (ogni arte diversa conta a sé) o una per edizione (ogni stampa: set, lingua, variante). Il completamento segue la stessa scelta.</small></label>
        <span class="seg" id="pfCollView">${[["card", "Per carta"], ["art", "Per illustrazione"], ["print", "Per edizione"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${(S.settings.collView || "card") === v}">${t}</button>`).join("")}</span></div>
      ${(S.settings.collView || "card") === "card" ? `<div class="field"><label>Illustrazione mostrata<small>Tra le stampe che possiedi di ogni carta. Nella scheda di una carta puoi fissarne una con «☆ Mostra in Collection»: vince su questa regola.</small></label>
        <span class="seg" id="pfCollPick">${[["rarest", "La più rara"], ["common", "La meno rara"], ["newest", "La più recente"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${(S.settings.collPick || "rarest") === v}">${t}</button>`).join("")}</span></div>
      ${Object.keys(S.settings.favPrints || {}).length ? `<div class="sub" style="margin-top:6px">${Object.keys(S.settings.favPrints).length} carte con illustrazione fissata · <a href="#" id="pfFavClear">togli tutte</a></div>` : ""}` : ""}
    </div>

    <div class="card">
      <h3>Simulatore</h3>
      <div class="field"><label>Pagamento degli Eddies<small>Manuale: scegli ogni volta cosa spendere. Automatico: paga da solo e chiede solo quando dovrebbe spendere una Leggenda con un'abilità Spend ancora utilizzabile.</small></label>
        <span class="seg" id="pfPay"><button data-v="0" aria-pressed="${!p.autoPay}">Manuale</button><button data-v="1" aria-pressed="${!!p.autoPay}">Automatico</button></span></div>
    </div>

    <div class="card">
      <h3>Prezzi</h3>
      <div class="field"><label>Origine dei prezzi<small>Per ora l'unico listino pubblico leggibile è quello di Cardmarket (trend giornaliero, in euro). TCGplayer e gli altri non pubblicano un listino aperto: se arriverà, comparirà qui.</small></label>
        <span class="seg" id="pfPrices"><button data-v="cardmarket" aria-pressed="true">Cardmarket</button><button data-v="tcgplayer" disabled title="Non disponibile: nessun listino pubblico">TCGplayer</button></span></div>
      <div class="sub" style="margin-top:6px">Ultimo aggiornamento del listino: <b>${esc(pricesAt)}</b> · si rinnova ogni notte con la pubblicazione del sito.</div>
    </div>

    <div class="card">
      <h3>Dati</h3>
      <div class="sub">Catalogo: <b>${n} carte · ${np} stampe</b> (da cyberpunktcg.com). ${cloudState.user ? "Con l'account collezione, mazzi, profilo e record si sincronizzano su tutti i tuoi dispositivi; il backup resta utile come copia di sicurezza." : "Collezione, mazzi, profilo e record restano sul dispositivo: esporta un backup per spostarti su un altro telefono, oppure accedi con un account dalla scheda Social."}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn sm" id="pfExport">Esporta backup</button>
        <button class="btn sm" id="pfImport">Importa backup</button>
        <input type="file" id="pfFile" accept="application/json,.json" hidden>
        <button class="btn sm" id="pfWipe" style="color:var(--bad)">Azzera tutto</button>
      </div>
    </div>

    ${feedbackHTML()}

    <div class="card">
      <h3>Informazioni</h3>
      <div class="sub">DeckShard <b>v${APP_VERSION}</b> · app gratuita e non ufficiale per il Cyberpunk TCG, senza pubblicità e senza account. <i>Cyberpunk</i>, <i>Cyberpunk 2077</i> e le immagini delle carte sono © CD PROJEKT S.A. / WeirdCo. Dati delle carte da cyberpunktcg.com, prezzi dal listino pubblico Cardmarket.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <a class="btn sm" href="https://github.com/DeckShard/deckshard.github.io" target="_blank" rel="noopener noreferrer">Codice su GitHub ↗</a>
        <a class="btn sm" href="https://cyberpunktcg.com" target="_blank" rel="noopener noreferrer">cyberpunktcg.com ↗</a>
      </div>
      <details class="fold" style="margin-top:12px"><summary>Privacy</summary><div class="sub" style="margin-top:6px">Senza account tutto resta su questo dispositivo. Con l'account vengono salvati su Supabase (server nell'Unione Europea, Francoforte): email di accesso, nick e profilo pubblico (avatar, fazione, record), collezione, mazzi e impostazioni per la sincronizzazione, amicizie, blocchi e messaggi. L'email non è mai visibile agli altri giocatori; la collezione la vedono gli amici solo se lo scegli. «Elimina account» cancella tutto in modo definitivo. Il feedback arriva in una casella privata e contiene solo ciò che scrivi, la versione dell'app e il tipo di dispositivo.</div></details>
    </div>`;
}

function setP(k, v){ S.profile[k] = v; S.save("profile"); document.dispatchEvent(new CustomEvent("ncd:profile")); }

function wire(root){
  root.addEventListener("input", e => {
    const t = e.target;
    if(t.id === "pfNick") setP("nick", t.value.trim());
    if(t.id === "pfMelee") setP("melee", t.value.trim());
    if(t.id === "pfCp") setP("cptcg", t.value.trim());
    if(t.id === "pfPos" || t.id === "pfZoom"){ S.profile[t.id === "pfPos" ? "favPos" : "favZoom"] = +t.value; S.save("profile"); const a = $(".phead .avatar.art"); if(a){ a.style.backgroundPosition = `50% ${S.profile.favPos ?? 34}%`; a.style.backgroundSize = `${S.profile.favZoom ?? 150}% auto`; } return; }
    if(t.id === "pfCharQ"){ const q = t.value.trim().toLowerCase(); $$("#pfChars button").forEach(b => b.hidden = q && !b.dataset.fav.toLowerCase().includes(q)); }
  });
  root.addEventListener("change", e => { if(e.target.id === "pfNick") renderProfile(); });
  root.addEventListener("click", e => {
    const rerender = () => root.id === "p-settings" ? renderSettings() : renderProfile();
    const seg = e.target.closest("#pfLife button, #pfFaction button, #pfTheme button, #pfLang button");
    if(seg){
      const k = { pfLife: "lifepath", pfFaction: "faction", pfTheme: "theme", pfLang: "lang" }[seg.parentElement.id];
      setP(k, S.profile[k] === seg.dataset.v && (k === "lifepath" || k === "faction") ? "" : seg.dataset.v);
      if(k === "theme") applyTheme();
      if(k === "lang" && window.NCD_I18N){ window.NCD_I18N.apply(seg.dataset.v); return; }
      rerender(); return;
    }
    const pb = e.target.closest("#pfPay button"); if(pb){ setP("autoPay", pb.dataset.v === "1"); rerender(); return; }
    const cv = e.target.closest("#pfCollView button"); if(cv){ S.settings.collView = cv.dataset.v; S.save("settings"); document.dispatchEvent(new CustomEvent("ncd:collection")); rerender(); return; }
    const cp = e.target.closest("#pfCollPick button"); if(cp){ S.settings.collPick = cp.dataset.v; S.save("settings"); document.dispatchEvent(new CustomEvent("ncd:collection")); rerender(); return; }
    if(e.target.closest("#pfFavClear")){ e.preventDefault(); S.settings.favPrints = {}; S.save("settings"); document.dispatchEvent(new CustomEvent("ncd:collection")); rerender(); return; }
    const sw = e.target.closest("#pfAccent .sw"); if(sw){ setP("accent", sw.dataset.v); applyTheme(); rerender(); return; }
    const ch = e.target.closest("#pfChars button"); if(ch){
      const same = S.profile.fav === ch.dataset.fav;
      S.profile.fav = same ? "" : ch.dataset.fav; S.profile.favImg = same ? "" : ch.dataset.img; S.profile.favPos = 34; S.profile.favZoom = 150; S.save("profile");
      renderProfile(); if(!same) $("#p-profile").scrollIntoView({ block: "start", behavior: "smooth" }); return;
    }
    if(e.target.closest("#pfExport")){
      const blob = new Blob([exportAll()], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `nightcity-deck-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000); return;
    }
    if(e.target.closest("#pfImport")){ $("#pfFile").click(); return; }
    if(e.target.closest("#pfWipe")){ if(confirm(cloudState.user ? "Cancellare collezione, mazzi, profilo e record da questo dispositivo? Esci anche dall'account: i dati nel cloud restano." : "Cancellare collezione, mazzi, profilo e record da questo dispositivo?")){ safeWipe().then(() => { applyTheme(); renderSettings(); toast("Dati azzerati"); document.dispatchEvent(new CustomEvent("ncd:collection")); }); } }
  });
  root.addEventListener("change", async e => {
    if(e.target.id !== "pfFile" || !e.target.files[0]) return;
    try{ importAll(JSON.parse(await e.target.files[0].text())); applyTheme(); renderSettings(); document.dispatchEvent(new CustomEvent("ncd:collection")); toast("Backup importato"); }
    catch(err){ toast("Backup non valido: " + err.message, 4000); }
    e.target.value = "";
  });
}
