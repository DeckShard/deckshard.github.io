/* Profilo: nick, percorso di vita, fazione Holophone, personaggio preferito
   come avatar, tema e accento, collegamenti a Melee/Holophone, record,
   backup dei dati.                                                       */

import { DATA, imgUrl, thumbUrl } from "./data.js";
import { S, DEFAULT_PROFILE, exportAll, importAll, wipe, storageOk } from "./store.js";
import { $, $$, esc, toast } from "./ui.js";
import { applyTheme } from "./app.js";

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
  { id: "samurai", n: "Samurai", a: "#f7d500", b: "#e11a3c" },
  { id: "netrunner", n: "Netrunner", a: "#00e5f2", b: "#ff3bd4" },
  { id: "arasaka", n: "Arasaka", a: "#d8323c", b: "#6a6a72" },
  { id: "nomad", n: "Nomad", a: "#f28c28", b: "#6fae52" },
  { id: "maelstrom", n: "Maelstrom", a: "#e11a3c", b: "#2a2a30" }
];

let wired = false;
const initials = s => s.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();

export function avatarHTML(p, cls = "avatar"){
  if(p.favImg) return `<img class="${cls}" src="${p.favImg}" alt="${esc(p.fav)}">`;
  return `<div class="${cls}" style="display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${cls === "avatar" ? 30 : 16}px;color:var(--acc)">${esc(initials(p.fav || p.nick || "NC"))}</div>`;
}

export function renderProfile(){
  const root = $("#p-profile"), p = S.profile;
  if(!wired){ wire(root); wired = true; }
  const legends = DATA.cards.filter(c => c.type === "Legend").sort((a, b) => a.dn.localeCompare(b.dn));
  const games = S.record.games || [], w = S.record.wins || 0, l = S.record.losses || 0;
  root.innerHTML = `
    <div class="card">
      <div class="phead">${avatarHTML(p)}
        <div style="min-width:0"><h2>${esc(p.nick || "Senza nome")}</h2>
          <div class="sub">${[p.lifepath, p.faction, p.fav].filter(Boolean).map(esc).join(" · ") || "Completa il profilo qui sotto"}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><span class="chip">${w}V – ${l}S nel simulatore</span>${games.length ? `<span class="chip">${games.length} partite</span>` : ""}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Identità</h3>
      <div class="field"><label for="pfNick">Nick</label><input class="inp" id="pfNick" value="${esc(p.nick)}" placeholder="Il tuo handle" maxlength="24" autocomplete="nickname"></div>
      <div class="field"><label>Percorso di vita<small>Da dove vieni a Night City</small></label>
        <span class="seg" id="pfLife">${LIFEPATHS.map(x => `<button data-v="${x}" aria-pressed="${p.lifepath === x}">${x}</button>`).join("")}</span></div>
      <div class="field"><label>Fazione Holophone<small>${esc(FACTIONS.find(f => f.id === p.faction)?.d || "La fazione scelta nel gioco organizzato ufficiale")}</small></label>
        <span class="seg" id="pfFaction">${FACTIONS.map(f => `<button data-v="${f.id}" aria-pressed="${p.faction === f.id}">${f.id}</button>`).join("")}</span></div>
      <div class="field" style="grid-template-columns:1fr"><label>Personaggio preferito<small>Le Leggende usano l'illustrazione della carta come avatar; gli altri personaggi le iniziali.</small></label>
        <input class="inp" id="pfCharQ" type="search" placeholder="Cerca personaggio…" autocomplete="off" style="margin-top:6px">
        <div class="chars" id="pfChars">${legends.map(c => `<button data-fav="${esc(c.dn)}" data-img="${imgUrl(c.def.id)}" class="${p.fav === c.dn ? "sel" : ""}" title="${esc(c.dn)}"><img src="${thumbUrl(c.def.id)}" alt="" loading="lazy"><span>${esc(c.name)}</span></button>`).join("")}
          ${EXTRA_CHARS.map(n => `<button data-fav="${esc(n)}" data-img="" class="${p.fav === n ? "sel" : ""}" title="${esc(n)}"><div class="ph">${esc(initials(n))}</div><span>${esc(n)}</span></button>`).join("")}</div>
      </div>
    </div>

    <div class="card">
      <h3>Aspetto</h3>
      <div class="field"><label>Tema<small>«Auto» segue il sistema</small></label>
        <span class="seg" id="pfTheme">${[["auto", "Auto"], ["light", "Chiaro"], ["dark", "Scuro"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${(p.theme || "auto") === v}">${t}</button>`).join("")}</span></div>
      <div class="field"><label>Colori d'accento<small>${esc(ACCENTS.find(a => a.id === p.accent)?.n || "Samurai")}</small></label>
        <span class="swatches" id="pfAccent">${ACCENTS.map(a => `<button class="sw${(p.accent || "samurai") === a.id ? " sel" : ""}" data-v="${a.id}" title="${a.n}" aria-label="${a.n}" style="--a:${a.a};--b:${a.b}"></button>`).join("")}</span></div>
    </div>

    <div class="card">
      <h3>Gioco organizzato</h3>
      <div class="field"><label for="pfMelee">Account Melee.gg<small>Serve per i tornei ufficiali; collegalo al tuo account cyberpunktcg.com</small></label><input class="inp" id="pfMelee" value="${esc(p.melee)}" placeholder="nome utente" autocomplete="off"></div>
      <div class="field"><label for="pfCp">Account cyberpunktcg.com<small>Per Holophone: fazioni, missioni e risultati</small></label><input class="inp" id="pfCp" value="${esc(p.cptcg)}" placeholder="email o nome utente" autocomplete="off"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <a class="btn sm" href="https://cyberpunktcg.com/holophone" target="_blank" rel="noopener noreferrer">Holophone ↗</a>
        <a class="btn sm" href="https://melee.gg" target="_blank" rel="noopener noreferrer">Melee.gg ↗</a>
        <a class="btn sm" href="https://cyberpunktcg.com/opfaq" target="_blank" rel="noopener noreferrer">FAQ account e tornei ↗</a>
        <a class="btn sm" href="https://cyberpunktcg.com/gameplay-guide" target="_blank" rel="noopener noreferrer">Guida alle regole ↗</a>
      </div>
      <p class="note" style="margin:12px 0 0"><b>Perché solo collegamenti.</b> Melee.gg e Holophone non espongono un'API pubblica per leggere missioni e risultati: li apri da qui con il tuo account. Se in futuro WeirdCo la pubblicherà, questa sezione mostrerà i dati direttamente.</p>
    </div>

    <div class="card">
      <h3>Dati</h3>
      <div class="sub">Tutto resta sul dispositivo${storageOk() ? "" : " (memoria non disponibile: nulla verrà salvato)"}. Esporta un backup per spostarti su un altro telefono.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn sm" id="pfExport">Esporta backup</button>
        <button class="btn sm" id="pfImport">Importa backup</button>
        <input type="file" id="pfFile" accept="application/json,.json" hidden>
        <button class="btn sm" id="pfWipe" style="color:var(--bad)">Azzera tutto</button>
      </div>
    </div>`;
}

function setP(k, v){ S.profile[k] = v; S.save("profile"); document.dispatchEvent(new CustomEvent("ncd:profile")); }

function wire(root){
  root.addEventListener("input", e => {
    const t = e.target;
    if(t.id === "pfNick") setP("nick", t.value.trim());
    if(t.id === "pfMelee") setP("melee", t.value.trim());
    if(t.id === "pfCp") setP("cptcg", t.value.trim());
    if(t.id === "pfCharQ"){ const q = t.value.trim().toLowerCase(); $$("#pfChars button").forEach(b => b.hidden = q && !b.dataset.fav.toLowerCase().includes(q)); }
  });
  root.addEventListener("change", e => { if(e.target.id === "pfNick") renderProfile(); });
  root.addEventListener("click", e => {
    const seg = e.target.closest("#pfLife button, #pfFaction button, #pfTheme button");
    if(seg){
      const k = seg.parentElement.id === "pfLife" ? "lifepath" : seg.parentElement.id === "pfFaction" ? "faction" : "theme";
      setP(k, S.profile[k] === seg.dataset.v && k !== "theme" ? "" : seg.dataset.v);
      if(k === "theme") applyTheme();
      renderProfile(); return;
    }
    const sw = e.target.closest("#pfAccent .sw"); if(sw){ setP("accent", sw.dataset.v); applyTheme(); renderProfile(); return; }
    const ch = e.target.closest("#pfChars button"); if(ch){
      const same = S.profile.fav === ch.dataset.fav;
      S.profile.fav = same ? "" : ch.dataset.fav; S.profile.favImg = same ? "" : ch.dataset.img; S.save("profile");
      renderProfile(); if(!same) $("#p-profile").scrollIntoView({ block: "start", behavior: "smooth" }); return;
    }
    if(e.target.closest("#pfExport")){
      const blob = new Blob([exportAll()], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `nightcity-deck-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000); return;
    }
    if(e.target.closest("#pfImport")){ $("#pfFile").click(); return; }
    if(e.target.closest("#pfWipe")){ if(confirm("Cancellare collezione, mazzi, profilo e record da questo dispositivo?")){ wipe(); applyTheme(); renderProfile(); toast("Dati azzerati"); document.dispatchEvent(new CustomEvent("ncd:collection")); } }
  });
  root.addEventListener("change", async e => {
    if(e.target.id !== "pfFile" || !e.target.files[0]) return;
    try{ importAll(JSON.parse(await e.target.files[0].text())); applyTheme(); renderProfile(); document.dispatchEvent(new CustomEvent("ncd:collection")); toast("Backup importato"); }
    catch(err){ toast("Backup non valido: " + err.message, 4000); }
    e.target.value = "";
  });
}
