/* Profilo: nick, percorso di vita, fazione Holophone, personaggio preferito
   come avatar, tema e accento, collegamenti a Melee/Holophone, record,
   backup dei dati.                                                       */

import { DATA, imgUrl, thumbUrl, RARITY_IT, TYPE_IT } from "./data.js";
import { S, DEFAULT_PROFILE, exportAll, importAll, wipe, storageOk } from "./store.js";
import { $, $$, esc, toast, pickMatters } from "./ui.js";
import { applyTheme, APP_VERSION } from "./app.js";
import { accountHTML, friendsHTML, wireSocial, feedbackHTML, wireFeedback, safeWipe } from "./social.js";
import { state as cloudState, pushSupported, pushNeedsInstall, enablePush, disablePush } from "./cloud.js";

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
  { id: "girlypop", n: "Us Cracks (rosa e cyan)", a: "#ff3bd4", b: "#00e5f2" },
  { id: "arasaka", n: "Arasaka", a: "#d8323c", b: "#6a6a72" },
  { id: "nomad", n: "Nomad", a: "#f28c28", b: "#6fae52" },
  { id: "maelstrom", n: "Maelstrom", a: "#e11a3c", b: "#fcee0a" },
  { id: "voodoo", n: "Voodoo Boys (viola e lime)", a: "#a855f7", b: "#c6ff00" },
  { id: "tyger", n: "Tyger Claws (magenta e giada)", a: "#ff2bd6", b: "#2bd9a3" },
  { id: "militech", n: "Militech (verde acido e arancio)", a: "#b8e000", b: "#ff6a00" },
  { id: "trauma", n: "Trauma Team (arancio e ghiaccio)", a: "#ff7a00", b: "#bfe9ff" },
  { id: "afterlife", n: "Afterlife (verde neon e rosso)", a: "#39ff14", b: "#ff1744" },
  { id: "kangtao", n: "Kang Tao (oro e giada)", a: "#ffcc33", b: "#00c48c" },
  { id: "blackwall", n: "Blackwall (rosso e viola)", a: "#ff1e3c", b: "#8a2be2" },
  { id: "netwatch", n: "NetWatch (viola e ciano)", a: "#8b5cf6", b: "#22d3ee" },
  // aspetti chiari: basi tenui e colorate (mai bianco pieno), ognuno legato a una fazione o a un luogo del gioco
  { id: "l-ash", light: true, n: "Holophone (cenere e rosso)", bg: "#e3d8d6", a: "#c41230", b: "#007f8a" },
  { id: "l-samurai", light: true, n: "Samurai (giallo concerto)", bg: "#efe8b8", a: "#d6142a", b: "#14130a" },
  { id: "l-ice", light: true, n: "Netrunner (ghiaccio digitale)", bg: "#d6e6ea", a: "#007f8f", b: "#c0189e" },
  { id: "l-mox", light: true, n: "Us Cracks (rosa Mox)", bg: "#f0d9e3", a: "#e0179d", b: "#00a9bb" },
  { id: "l-washi", light: true, n: "Arasaka Washi (carta di riso e rosso)", bg: "#e6ddd0", a: "#c41e2a", b: "#2d2d33" },
  { id: "l-badlands", light: true, n: "Badlands (sabbia Aldecaldo)", bg: "#e6d8bf", a: "#d4620f", b: "#4f8a35" },
  { id: "l-chrome", light: true, n: "Maelstrom (cromo e sangue)", bg: "#d9d9dc", a: "#c4122f", b: "#8a7600" },
  { id: "l-lavender", light: true, n: "Voodoo Boys (lavanda e lime)", bg: "#e2dceb", a: "#6d28d9", b: "#5f7a00" },
  { id: "l-petals", light: true, n: "Tyger Claws (petali e giada)", bg: "#eddbe7", a: "#b0127f", b: "#0b8a66" },
  { id: "l-militech", light: true, n: "Militech (cachi da campo)", bg: "#dfdfc9", a: "#7f9600", b: "#d9530a" },
  { id: "l-trauma", light: true, n: "Trauma Team (ghiaccio e arancio)", bg: "#d9e6ee", a: "#ff7a00", b: "#2b7fb3" },
  { id: "l-absinthe", light: true, n: "Afterlife (assenzio)", bg: "#dbe6d9", a: "#1f8a0f", b: "#c4122f" },
  { id: "l-kangtao", light: true, n: "Kang Tao (giada e oro)", bg: "#d8e6dc", a: "#00a372", b: "#c99a00" },
  { id: "l-redfog", light: true, n: "Blackwall (nebbia rossa)", bg: "#e2d6dc", a: "#c4122f", b: "#6a1fb8" },
  { id: "l-netwatch", light: true, n: "NetWatch (lavanda e ciano)", bg: "#dedcef", a: "#6a3fe0", b: "#0094b3" }
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
      ${cloudState.user ? ""   /* con l'account il nick è quello pubblico, già nella scheda Account */
        : `<div class="field"><label for="pfNick">Nick</label><input class="inp" id="pfNick" value="${esc(p.nick)}" placeholder="Il tuo handle" maxlength="24" autocomplete="nickname"></div>`}
      <div class="field"><label>Percorso di vita<small>Da dove vieni a Night City</small></label>
        <span class="seg" id="pfLife">${LIFEPATHS.map(x => `<button data-v="${x}" aria-pressed="${p.lifepath === x}">${x}</button>`).join("")}</span></div>
      <div class="field"><label>Fazione Holophone<small>${esc(FACTIONS.find(f => f.id === p.faction)?.d || "La fazione scelta nel gioco organizzato ufficiale")}</small></label>
        <span class="seg" id="pfFaction">${FACTIONS.map(f => `<button data-v="${f.id}" aria-pressed="${p.faction === f.id}">${f.id}</button>`).join("")}</span></div>
      <div class="field" style="grid-template-columns:1fr"><label>Personaggio preferito<small>Tutte le illustrazioni di Leggende e Unità dei personaggi (anche Secret, Iconic e Nova Rare), in ordine alfabetico; i personaggi senza carta usano le iniziali.</small></label>
        ${p.favImg ? `<details class="fold" id="pfCrop" style="margin:8px 0 4px"${cropOpen ? " open" : ""}><summary>Regola l'inquadratura dell'avatar</summary><div style="display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;margin-top:8px;font-size:12.5px;color:var(--mute)">
          <span>Inquadratura</span><input type="range" id="pfPos" min="0" max="100" value="${p.favPos ?? 34}" aria-label="Posizione verticale del ritaglio">
          <span>Zoom</span><input type="range" id="pfZoom" min="100" max="260" value="${p.favZoom ?? 150}" aria-label="Zoom del ritaglio"></div></details>` : ""}
        <input class="inp" id="pfCharQ" type="search" placeholder="Cerca personaggio…" autocomplete="off" style="margin-top:6px">
        <div class="chars" id="pfChars">${chars.map(x => `<button data-fav="${esc(x.key)}" data-img="${x.pid ? imgUrl(x.pid) : ""}" class="${p.fav === x.key ? "sel" : ""}" title="${esc(x.key)}">${x.pid ? `<div class="art" style="background-image:url('${thumbUrl(x.pid)}')"></div>` : `<div class="ph">${esc(initials(x.name))}</div>`}<span>${esc(x.name)}${x.tag ? ` <i>${esc(x.tag)}</i>` : ""}</span></button>`).join("")}</div>
      </div>
    </div>

    <div class="card">
      <h3>Gioco organizzato</h3>
      <div class="field"><label for="pfMelee">Nome utente Melee.gg<small>Solo un promemoria</small></label><input class="inp" id="pfMelee" value="${esc(p.melee)}" placeholder="nome utente" autocomplete="off"></div>
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
      ${(() => { const cur = ACCENTS.find(a => a.id === (p.accent || "holophone")) || ACCENTS[0];
        const sw = a => `<button class="sw${cur.id === a.id ? " sel" : ""}${a.light ? " lt" : ""}" data-v="${a.id}" title="${a.n}" aria-label="${a.n}" style="--a:${a.a};--b:${a.b}${a.bg ? `;--bgc:${a.bg}` : ""}"></button>`;
        return `<div class="field fcol"><label>Aspetti scuri<small>${cur.light ? "" : esc(cur.n)}</small></label><span class="swatches" id="pfAccent">${ACCENTS.filter(a => !a.light).map(sw).join("")}</span></div>
      <div class="field fcol"><label>Aspetti chiari<small>${cur.light ? esc(cur.n) : "Basi tenui ispirate alle fazioni, mai bianco pieno"}</small></label><span class="swatches" id="pfAccentL">${ACCENTS.filter(a => a.light).map(sw).join("")}</span></div>`; })()}
    </div>

    <div class="card">
      <h3>Notifiche</h3>
      ${(() => { const P = S.settings.push || {}, seg = (id, cur, opts) => `<span class="seg" id="${id}">${opts.map(([v, t]) => `<button data-v="${v}" aria-pressed="${cur === v}">${t}</button>`).join("")}</span>`;
        if(!cloudState.user) return `<p class="sub" style="margin:4px 0 0">Accedi dal Social per ricevere sul telefono un avviso quando arriva un messaggio, una sfida o una richiesta d'amicizia.</p>`;
        if(pushNeedsInstall()) return `<p class="sub" style="margin:4px 0 0">Su iPhone e iPad le notifiche funzionano solo con DeckShard sulla schermata Home: in Safari tocca Condividi → «Aggiungi alla schermata Home», apri l'app da lì e attivale qui (serve iOS 16.4 o successivo).</p>`;
        if(!pushSupported()) return `<p class="sub" style="margin:4px 0 0">Questo browser non supporta le notifiche.</p>`;
        const yn = (id, k) => seg(id, P[k] === false ? "0" : "1", [["1", "Sì"], ["0", "No"]]);
        return `<div class="field"><label>Notifiche sul dispositivo<small>Anche ad app chiusa. Arrivano solo su questo dispositivo: attivale su ognuno che usi.</small></label>${seg("pfPush", P.on ? "1" : "0", [["1", "Attive"], ["0", "Spente"]])}</div>
        ${P.on ? `<div class="field"><label>Messaggi degli amici</label>${yn("pfPushM", "messages")}</div>
        <div class="field"><label>Sfide a una partita</label>${yn("pfPushC", "challenges")}</div>
        <div class="field"><label>Richieste d'amicizia</label>${yn("pfPushR", "requests")}</div>` : ""}`; })()}
    </div>

    <div class="card">
      <h3>Accessibilità</h3>
      ${(() => { const a = S.settings.a11y || {}, seg = (id, cur, opts) => `<span class="seg" id="${id}">${opts.map(([v, t]) => `<button data-v="${v}" aria-pressed="${cur === v}">${t}</button>`).join("")}</span>`;
        return `<div class="field fcol"><label>Dimensione del testo<small>Ingrandisce testi e pulsanti dell'app (la plancia del Simulator si adatta da sola allo schermo)</small></label>${seg("pfText", a.text || "m", [["m", "Normale"], ["l", "Grande"], ["xl", "Molto grande"]])}</div>
      <div class="field"><label>Contrasto elevato<small>Testi secondari e bordi più marcati</small></label>${seg("pfContrast", a.contrast ? "1" : "0", [["0", "No"], ["1", "Sì"]])}</div>
      <div class="field fcol"><label>Animazioni<small>«Ridotte» toglie movimenti, lampeggi e bagliori; «Come il sistema» segue l'impostazione del dispositivo</small></label>${seg("pfMotion", a.motion || "auto", [["auto", "Come il sistema"], ["reduce", "Ridotte"]])}</div>`; })()}
    </div>

    <div class="card">
      <h3>Simulator</h3>
      <div class="field fcol"><label>Plancia<small>«A colonna» (beta): contatori, Leggende e dadi in una colonna a sinistra, così le carte in campo e in mano sono più grandi, soprattutto sul telefono; su schermi larghi il registro resta aperto a destra.</small></label>
        <span class="seg" id="pfLayout">${[["classic", "Classica"], ["rail", "A colonna (beta)"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${(S.settings.boardLayout || "classic") === v}">${t}</button>`).join("")}</span></div>
      <div class="field fcol"><label>Grafiche avanzate (beta)<small>Effetti in più sulla plancia: le carte giocate dall'avversario si mostrano grandi al centro prima di andare al loro posto, ogni Gig tirato gira al centro dentro un anello, una fascia annuncia il cambio di turno e, mentre trascini una carta, le zone dove puoi lasciarla si accendono con un'area «Vendi» grande. La durata segue i ritmi qui sotto; con «Animazioni ridotte» restano spente.</small></label>
        <span class="seg" id="pfFx">${[["1", "Sì"], ["0", "No"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${(S.settings.fx ? "1" : "0") === v}">${t}</button>`).join("")}</span></div>
      <div class="field"><label>Suoni (beta)<small>Effetti sonori sintetizzati sulla plancia: carte, dadi, colpi, cambio di turno. Nessun file da scaricare; partono al primo tocco.</small></label>
        <span class="seg" id="pfSfx">${[["1", "Sì"], ["0", "No"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${(S.settings.sfx ? "1" : "0") === v}">${t}</button>`).join("")}</span></div>
      <div class="field"><label>Schermo intero sulla plancia<small>Nel browser la plancia prova a prendersi tutto lo schermo e a girarsi in orizzontale; il telefono mostra il suo avviso per uscire. Nell'app installata non serve: si gira e basta, senza avviso.</small></label>
        <span class="seg" id="pfFull">${[["1", "Sì"], ["0", "No"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${(S.settings.fullscreen === false ? "0" : "1") === v}">${t}</button>`).join("")}</span></div>
      <div class="field fcol"><label>Ritmo dell'avversario<small>Quanto aspetta l'IA (o l'avversario online) tra una mossa e l'altra, e quanto durano le animazioni delle sue carte. «Istantanea»: niente pause né movimenti.</small></label>
        <span class="seg" id="pfOppSpeed">${[["slow", "Lento"], ["normal", "Normale"], ["fast", "Veloce"], ["instant", "Istantaneo"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${(S.settings.oppSpeed || "normal") === v}">${t}</button>`).join("")}</span></div>
      <div class="field fcol"><label>Velocità delle tue animazioni<small>Le carte che giochi, vendi o spendi si muovono sulla plancia. «Istantanea»: la plancia cambia e basta, come prima.</small></label>
        <span class="seg" id="pfAnimMine">${[["slow", "Lenta"], ["normal", "Normale"], ["fast", "Veloce"], ["instant", "Istantanea"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${(S.settings.animMine || "normal") === v}">${t}</button>`).join("")}</span></div>
      <div class="field"><label>Riquadro delle mosse avversarie<small>Il testo di ogni mossa dell'avversario al centro della plancia</small></label>
        <span class="seg" id="pfOppFeed">${[["1", "Sì"], ["0", "No"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${(S.settings.oppFeed !== false ? "1" : "0") === v}">${t}</button>`).join("")}</span></div>
    </div>

    <div class="card">
      <h3>Collection</h3>
      <div class="field"><label>Voci della collezione<small>Una per carta (151), una per illustrazione (ogni arte diversa conta a sé) o una per edizione (ogni stampa: set, lingua, variante). Il completamento segue la stessa scelta.</small></label>
        <span class="seg" id="pfCollView">${[["card", "Per carta"], ["art", "Per illustrazione"], ["print", "Per edizione"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${(S.settings.collView || "card") === v}">${t}</button>`).join("")}</span></div>
      ${(S.settings.collView || "card") === "card" ? `<div class="field"><label>Illustrazione mostrata<small>Tra le stampe che possiedi di ogni carta. Nella scheda di una carta puoi fissarne una con «☆ Mostra in Collection»: vince su questa regola.</small></label>
        <span class="seg" id="pfCollPick">${[["rarest", "La più rara"], ["common", "La meno rara"], ["newest", "La più recente"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${(S.settings.collPick || "rarest") === v}">${t}</button>`).join("")}</span></div>
      ${(n => `<div class="sub" style="margin-top:6px">${n ? `Cambia l'illustrazione di <b>${n} ${n === 1 ? "carta" : "carte"}</b>: le altre le possiedi in una sola stampa (o le hai fissate).` : "Per ora non cambia nulla: di ogni carta possiedi una sola stampa (o l'hai fissata). Conta quando ne hai più versioni, ad esempio la Rara e la Secret."}</div>`)(pickMatters())}
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
      <details class="fold" style="margin-top:12px"><summary>Privacy</summary><div class="sub" style="margin-top:6px">Senza account tutto resta su questo dispositivo. Con l'account vengono salvati su Supabase (server nell'Unione Europea, Francoforte): email di accesso, nick e profilo pubblico (avatar, fazione, record), collezione, mazzi e impostazioni per la sincronizzazione, amicizie, blocchi e messaggi. L'email non è mai visibile agli altri giocatori; la collezione la vedono gli amici solo se lo scegli. «Elimina account» cancella tutto in modo definitivo. Il feedback arriva in una casella privata e contiene solo ciò che scrivi, la versione dell'app e il tipo di dispositivo.
        <div style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap"><a href="privacy.html" target="_blank" rel="noopener">Informativa completa</a><a href="delete-account.html" target="_blank" rel="noopener">Eliminare l'account dal web</a></div></div></details>
    </div>`;
}

function setP(k, v){ S.profile[k] = v; S.save("profile"); document.dispatchEvent(new CustomEvent("ncd:profile")); }

let cropOpen = false;
function wire(root){
  // la regolazione dell'avatar resta aperta finché non si tocca il suo titolo, anche se la pagina si ridisegna
  root.addEventListener("toggle", e => { if(e.target.id === "pfCrop") cropOpen = e.target.open; }, true);
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
    const pu = e.target.closest("#pfPush button, #pfPushM button, #pfPushC button, #pfPushR button"); if(pu){
      const P = S.settings.push = { messages: true, challenges: true, requests: true, ...(S.settings.push || {}) }, id = pu.parentElement.id, v = pu.dataset.v === "1";
      if(id === "pfPushM") P.messages = v; if(id === "pfPushC") P.challenges = v; if(id === "pfPushR") P.requests = v;
      const prefs = { messages: P.messages, challenges: P.challenges, requests: P.requests };
      pu.parentElement.querySelectorAll("button").forEach(x => x.disabled = true);
      (async () => {
        try{
          if(id === "pfPush" && !v){ await disablePush(); P.on = false; toast("Notifiche spente su questo dispositivo"); }
          else if(id === "pfPush" || P.on){ await enablePush(prefs, S.profile.lang); if(id === "pfPush") toast("Notifiche attive: ti avviso io, choom"); P.on = true; }
        }catch(err){ toast(err.message || String(err), 5000); if(id === "pfPush") P.on = false; }
        S.save("settings"); rerender();
      })();
      return;
    }
    const os = e.target.closest("#pfOppSpeed button"); if(os){ S.settings.oppSpeed = os.dataset.v; S.save("settings"); rerender(); return; }
    const ly = e.target.closest("#pfLayout button"); if(ly){ S.settings.boardLayout = ly.dataset.v; S.save("settings"); rerender(); return; }
    const am = e.target.closest("#pfAnimMine button"); if(am){ S.settings.animMine = am.dataset.v; S.save("settings"); rerender(); return; }
    const fu = e.target.closest("#pfFull button"); if(fu){ S.settings.fullscreen = fu.dataset.v === "1"; S.save("settings"); rerender(); return; }
    const sx = e.target.closest("#pfSfx button"); if(sx){ S.settings.sfx = sx.dataset.v === "1"; S.save("settings"); rerender(); return; }
    const fx = e.target.closest("#pfFx button"); if(fx){ S.settings.fx = fx.dataset.v === "1"; S.save("settings"); rerender(); return; }
    const of = e.target.closest("#pfOppFeed button"); if(of){ S.settings.oppFeed = of.dataset.v === "1"; S.save("settings"); rerender(); return; }
    const ax = e.target.closest("#pfText button, #pfContrast button, #pfMotion button"); if(ax){
      const a = S.settings.a11y = { ...(S.settings.a11y || {}) }, id = ax.parentElement.id, v = ax.dataset.v;
      if(id === "pfText") a.text = v; if(id === "pfContrast") a.contrast = v === "1"; if(id === "pfMotion") a.motion = v;
      S.save("settings"); applyTheme(); rerender(); return;
    }
    const seg = e.target.closest("#pfLife button, #pfFaction button, #pfLang button");
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
    const sw = e.target.closest("#pfAccent .sw, #pfAccentL .sw"); if(sw){ setP("accent", sw.dataset.v); applyTheme(); rerender(); return; }
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
    if(e.target.closest("#pfWipe")){ if(confirm(cloudState.user ? "Cancellare collezione, mazzi, profilo e record da questo dispositivo? Esci anche dall'account: i dati nel cloud restano." : "Cancellare collezione, mazzi, profilo e record da questo dispositivo?")){ safeWipe().then(() => { applyTheme(); renderSettings(); toast("Memoria formattata: si riparte da zero"); document.dispatchEvent(new CustomEvent("ncd:collection")); }); } }
  });
  root.addEventListener("change", async e => {
    if(e.target.id !== "pfFile" || !e.target.files[0]) return;
    try{ importAll(JSON.parse(await e.target.files[0].text())); applyTheme(); renderSettings(); document.dispatchEvent(new CustomEvent("ncd:collection")); toast("Backup importato"); }
    catch(err){ toast("Backup non valido: " + err.message, 4000); }
    e.target.value = "";
  });
}
