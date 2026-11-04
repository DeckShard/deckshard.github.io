/* Home: pagina di accoglienza, volutamente vuota. L'emblema cambia con l'aspetto scelto nelle
   Impostazioni (simboli originali, ispirati allo spirito delle fazioni ma non i loro loghi),
   l'avatar in alto a destra porta al Social, e compaiono al massimo un paio di scorciatoie
   solo quando servono (partita da riprendere, sfide, messaggi).                          */

import { S } from "./store.js";
import { $, esc } from "./ui.js";
import { avatarHTML } from "./profile.js";
import { state as cloud } from "./cloud.js";
import { invitesForMe, activeTables, T as onlineT } from "./online.js";
import { simInProgress, resumeSim, showOnline } from "./sim.js";

/* ------------------------------------------------------------ emblemi (viewBox 120×120, tratto = colore d'accento) */
const spiral = (() => { let d = ""; for(let i = 0; i <= 200; i++){ const a = i / 200 * Math.PI * 6.2, r = 4 + i / 200 * 42; d += (i ? "L" : "M") + (60 + r * Math.cos(a)).toFixed(1) + " " + (60 + r * Math.sin(a)).toFixed(1); } return d; })();
const rose = (() => { let d = ""; for(let i = 0; i < 16; i++){ const a = i / 16 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 12 : (i % 4 ? 30 : 46); d += (i ? "L" : "M") + (60 + r * Math.cos(a)).toFixed(1) + " " + (60 + r * Math.sin(a)).toFixed(1); } return d + "Z"; })();
/* artigliata: quattro squarci affusolati e leggermente curvi, sfalsati come i graffi di una zampa */
const claw = (x0, y0, x1, y1, bend, w) => {
  const L = [], R = [], cx = (x0 + x1) / 2 + bend, cy = (y0 + y1) / 2 - bend * .4;
  for(let i = 0; i <= 24; i++){
    const t = i / 24, u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1, y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    const dx = 2 * u * (cx - x0) + 2 * t * (x1 - cx), dy = 2 * u * (cy - y0) + 2 * t * (y1 - cy), n = Math.hypot(dx, dy) || 1;
    const half = w * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), .7) / 2 * (t > .85 ? (1 - t) / .15 : 1);
    L.push([x - dy / n * half, y + dx / n * half]); R.push([x + dy / n * half, y - dx / n * half]);
  }
  return "M" + [...L, ...R.reverse()].map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + "Z";
};
const claws = [claw(62, 14, 20, 86, 14, 6.5), claw(80, 12, 30, 104, 16, 8.5), claw(98, 20, 48, 110, 16, 8.5), claw(108, 40, 68, 106, 13, 6.5)].map(d => `<path d="${d}" class="fill"/>`).join("");
const EMBLEMS = {
  shard: `<path d="M60 8 L94 44 L72 112 L34 66 Z"/><path d="M60 8 L54 60 L72 112 M34 66 L54 60 L94 44" class="thin"/><path d="M98 70 L110 82 L100 96" class="thin"/>`,
  sunblade: `<path d="M18 78 A42 42 0 0 1 102 78 Z" class="fill"/><path d="M60 24 V14 M33 35 L26 28 M87 35 L94 28 M22 60 H12 M98 60 H108" class="thin"/><path d="M10 90 H96 L110 84 L96 96 H10 Z"/><path d="M24 90 V96" class="thin"/>`,
  seal: `<rect x="16" y="16" width="88" height="88" rx="4"/><rect x="24" y="24" width="72" height="72" rx="2" class="thin"/><circle cx="60" cy="60" r="24"/><path d="M46 52h28M42 60h36M46 68h28" class="thin"/>`,
  bolt: `<circle cx="60" cy="60" r="46"/><circle cx="60" cy="60" r="38" class="thin"/><path d="M66 20 L42 64 H60 L50 100 L80 54 H62 Z" class="fill"/>`,
  circuit: `<path d="M60 10 L103 35 V85 L60 110 L17 85 V35 Z"/><path d="M60 30 V52 M60 52 L40 64 V82 M60 52 L80 64 V82 M40 46 H28 M80 46 H92" class="thin"/><circle cx="60" cy="30" r="5" class="fill"/><circle cx="40" cy="84" r="5" class="fill"/><circle cx="80" cy="84" r="5" class="fill"/>`,
  sparkle: `<path d="M60 12 C64 44 76 56 108 60 C76 64 64 76 60 108 C56 76 44 64 12 60 C44 56 56 44 60 12 Z"/><path d="M96 18 C97 26 100 29 108 30 C100 31 97 34 96 42 C95 34 92 31 84 30 C92 29 95 26 96 18 Z" class="fill"/><circle cx="24" cy="96" r="5" class="thin"/>`,
  compass: `<circle cx="60" cy="60" r="50" class="thin"/><path d="${rose}"/><circle cx="60" cy="60" r="6" class="fill"/>`,
  crown: `<path d="M14 92 L22 30 L42 58 L60 16 L78 58 L98 30 L106 92 Z"/><path d="M14 104 H106" /><circle cx="60" cy="74" r="8" class="fill"/>`,
  sunslash: `<defs><clipPath id="smUp"><polygon points="-10,-10 130,-10 130,34.9 6,110 -10,119.7"/></clipPath><clipPath id="smDn"><polygon points="-10,130 130,130 130,34.9 6,110 -10,119.7"/></clipPath></defs><g clip-path="url(#smDn)"><path d="M39 86 A21 21 0 0 1 81 86 Z" class="fill soft"/><path d="M39 86 A21 21 0 0 1 81 86"/><path d="M47 79 H73 M43 72 H77" class="thin"/><path d="M35.0 86.0 L21.0 86.0 M36.2 78.3 L13.4 70.9 M39.8 71.3 L25.2 60.7 M45.3 65.8 L27.7 41.5 M52.3 62.2 L45.8 42.3 M60.0 61.0 L60.0 28.0 M67.7 62.2 L74.2 42.3 M74.7 65.8 L92.3 41.5 M80.2 71.3 L94.8 60.7 M83.8 78.3 L106.6 70.9 M85.0 86.0 L99.0 86.0" stroke-width="4.6"/><circle cx="15.5" cy="86.0" r="2" class="fill"/><circle cx="8.2" cy="69.2" r="2" class="fill"/><circle cx="20.8" cy="57.5" r="2" class="fill"/><circle cx="24.4" cy="37.1" r="2" class="fill"/><circle cx="44.1" cy="37.0" r="2" class="fill"/><circle cx="60.0" cy="22.5" r="2" class="fill"/><circle cx="75.9" cy="37.0" r="2" class="fill"/><circle cx="95.6" cy="37.1" r="2" class="fill"/><circle cx="99.2" cy="57.5" r="2" class="fill"/><circle cx="111.8" cy="69.2" r="2" class="fill"/><circle cx="104.5" cy="86.0" r="2" class="fill"/><path d="M8 86 H112"/><path d="M24 94 H96 M40 101 H80" class="thin"/></g><g clip-path="url(#smUp)"><g transform="translate(-4 -8)"><path d="M39 86 A21 21 0 0 1 81 86 Z" class="fill soft"/><path d="M39 86 A21 21 0 0 1 81 86"/><path d="M47 79 H73 M43 72 H77" class="thin"/><path d="M35.0 86.0 L21.0 86.0 M36.2 78.3 L13.4 70.9 M39.8 71.3 L25.2 60.7 M45.3 65.8 L27.7 41.5 M52.3 62.2 L45.8 42.3 M60.0 61.0 L60.0 28.0 M67.7 62.2 L74.2 42.3 M74.7 65.8 L92.3 41.5 M80.2 71.3 L94.8 60.7 M83.8 78.3 L106.6 70.9 M85.0 86.0 L99.0 86.0" stroke-width="4.6"/><circle cx="15.5" cy="86.0" r="2" class="fill"/><circle cx="8.2" cy="69.2" r="2" class="fill"/><circle cx="20.8" cy="57.5" r="2" class="fill"/><circle cx="24.4" cy="37.1" r="2" class="fill"/><circle cx="44.1" cy="37.0" r="2" class="fill"/><circle cx="60.0" cy="22.5" r="2" class="fill"/><circle cx="75.9" cy="37.0" r="2" class="fill"/><circle cx="95.6" cy="37.1" r="2" class="fill"/><circle cx="99.2" cy="57.5" r="2" class="fill"/><circle cx="111.8" cy="69.2" r="2" class="fill"/><circle cx="104.5" cy="86.0" r="2" class="fill"/><path d="M8 86 H112"/><path d="M24 94 H96 M40 101 H80" class="thin"/></g></g><path d="M6.0 110.0 L69.7 74.3 L100.3 54.5 L113.1 45.1 L99.2 52.6 L67.8 71.2 Z" class="fill b2" style="stroke:none"/><path d="M106.0 41.0 l2 -6 M111.0 51.0 l5 1" class="thin b2"/>`,
  shardfly: `<g transform="rotate(-32 66 56)"><path d="M52 14 H80 L88 22 V80 L82 86 H56 L50 80 V18 Z"/><path d="M56 22 H80 M56 28 H82" class="thin"/><rect x="60" y="40" width="18" height="28" rx="2" class="fill soft b2"/><path d="M69 42 V66" class="b2"/><path d="M56 86 V98 H82 V86"/></g><rect x="14" y="96" width="7" height="7" class="fill b2"/><rect x="26" y="102" width="5" height="5" class="fill"/><rect x="10" y="80" width="5" height="5" class="fill"/><rect x="28" y="88" width="4" height="4" class="fill b2"/>`,
  mic: `<rect x="36" y="12" width="48" height="56" rx="24"/><path d="M36 30 H84 M36 44 H84 M36 58 H84" class="thin"/><path d="M62 12 L54 30 L66 40 L56 56 L62 68" class="b2" stroke-width="4"/><path d="M28 54 C28 76 42 86 60 86 C78 86 92 76 92 54"/><path d="M60 86 V104 M44 106 H76"/>`,
  veve: `<circle cx="60" cy="60" r="52" class="thin"/><path d="M60 14 V106 M24 40 L60 60 L96 40 M30 90 L60 72 L90 90"/><circle cx="60" cy="14" r="5" class="fill"/><circle cx="24" cy="40" r="5" class="fill b2"/><circle cx="96" cy="40" r="5" class="fill b2"/><circle cx="30" cy="90" r="4" class="fill"/><circle cx="90" cy="90" r="4" class="fill"/><path d="M48 52 a12 12 0 0 1 24 0" class="thin"/><path d="M42 30 h-10 v-8 M78 30 h10 v-8" class="thin"/>`,
  spiral: `<path d="${spiral}" class="thin"/><circle cx="60" cy="60" r="52"/>`,
  claws: `<path d="M60 8 A52 52 0 0 0 12 74 M108 46 A52 52 0 0 1 64 112" class="thin"/>${claws}`,
  chevrons: `<path d="M60 8 L104 24 V60 C104 86 86 104 60 112 C34 104 16 86 16 60 V24 Z"/><path d="M36 46 L60 60 L84 46 M36 64 L60 78 L84 64 M36 82 L60 96 L84 82" class="thin"/>`,
  pulse: `<path d="M46 14 H74 V46 H106 V74 H74 V106 H46 V74 H14 V46 H46 Z"/><path d="M8 62 H40 L48 46 L58 80 L66 54 L72 62 H112" class="thin"/>`,
  hourglass: `<circle cx="60" cy="60" r="50" class="thin"/><path d="M34 22 H86 M34 98 H86 M38 22 C38 48 60 52 60 60 C60 68 38 72 38 98 M82 22 C82 48 60 52 60 60 C60 68 82 72 82 98"/><path d="M48 92 C52 80 68 80 72 92 Z" class="fill"/>`,
  coin: `<path d="M40 12 H80 L108 40 V80 L80 108 H40 L12 80 V40 Z"/><rect x="46" y="46" width="28" height="28"/><circle cx="60" cy="26" r="4" class="fill"/><circle cx="60" cy="94" r="4" class="fill"/><circle cx="26" cy="60" r="4" class="fill"/><circle cx="94" cy="60" r="4" class="fill"/>`,
  wall: `<rect x="12" y="20" width="96" height="80"/><path d="M12 40 H108 M12 60 H108 M12 80 H108 M36 20 V40 M72 20 V40 M24 40 V60 M60 40 V60 M96 40 V60 M36 60 V80 M72 60 V80 M24 80 V100 M60 80 V100 M96 80 V100" class="thin"/><path d="M58 14 L66 38 L52 56 L70 74 L56 106" class="slash"/>`,
  radar: `<circle cx="60" cy="60" r="50"/><circle cx="60" cy="60" r="34" class="thin"/><circle cx="60" cy="60" r="18" class="thin"/><path d="M60 60 L96 24" /><path d="M60 60 L96 24 A50 50 0 0 1 110 60 Z" class="fill soft"/><circle cx="60" cy="60" r="5" class="fill"/>`
};
const BY_LOOK = { holophone: "shardfly", samurai: "sunslash", "l-samurai": "sunslash", netrunner: "circuit", girlypop: "mic", "l-mox": "mic", arasaka: "sunblade", "l-washi": "sunblade",
  nomad: "compass", "l-badlands": "compass", maelstrom: "crown", voodoo: "veve", tyger: "claws", militech: "chevrons", "l-militech": "chevrons",
  trauma: "pulse", "l-trauma": "pulse", afterlife: "hourglass", kangtao: "coin", "l-kangtao": "coin", blackwall: "wall", "l-netwatch": "radar", netwatch: "radar", "l-ash": "shardfly", "l-ice": "circuit", "l-chrome": "crown", "l-lavender": "veve", "l-petals": "claws", "l-absinthe": "hourglass", "l-redfog": "wall" };
export const emblemSVG = look => `<svg class="emblem" viewBox="0 0 120 120" aria-hidden="true">${EMBLEMS[BY_LOOK[look] || "shardfly"]}</svg>`;

/* una frase al giorno, sotto il saluto */
const LINES = ["Night City non dorme mai.", "Il tuo fixer ha un lavoro per te.", "Sette Gig e la città è tua.", "Gli Eddies non dormono, e nemmeno tu.", "Ogni leggenda è iniziata con una mano da sei carte.", "Il Blackwall regge. Per ora."];

export function renderHome(){
  const root = $("#p-home"), p = S.profile;
  const nick = (cloud.profile && cloud.profile.nick) || p.nick || "";
  const social = (cloud.unread || 0) + (cloud.requests || 0), inv = invitesForMe().length;
  const game = simInProgress(), online = activeTables().length && !onlineT.row;
  const day = Math.floor(Date.now() / 86400000);
  const shortcuts = [
    game ? `<button class="hshort" data-h="resume"><b>Riprendi la partita</b><span>${game === "online" ? "Partita online in corso" : "La partita che hai lasciato è ancora sul tavolo"}</span></button>` : online ? `<button class="hshort" data-h="online"><b>Partita online in corso</b><span>Riprendila entro un minuto dal Simulator</span></button>` : "",
    inv ? `<button class="hshort" data-h="online"><b>${inv === 1 ? "1 sfida ricevuta" : inv + " sfide ricevute"}</b><span>Accetta dal Simulator → Online</span></button>` : "",
    social ? `<button class="hshort" data-h="social"><b>${[cloud.unread ? (cloud.unread === 1 ? "1 messaggio" : cloud.unread + " messaggi") : "", cloud.requests ? (cloud.requests === 1 ? "1 richiesta di amicizia" : cloud.requests + " richieste di amicizia") : ""].filter(Boolean).join(" · ")}</b><span>Apri il Social</span></button>` : ""
  ].filter(Boolean).slice(0, 2);
  // l'emblema entra con un glitch solo quando si apre la Home; i ridisegni dovuti al cloud (presenza, messaggi)
  // non rifanno l'animazione e, se non è cambiato niente, non toccano la pagina
  const enter = root.dataset.enter === "1"; delete root.dataset.enter;
  const html = `<div class="home">
    <button class="hav" id="homeSocial" aria-label="Social e profilo" title="Social e profilo">
      <span class="hid"><b>${esc(nick || "Choom senza nome")}</b><span>${esc([p.lifepath, p.faction].filter(Boolean).join(" · ") || (cloud.user ? "Nessuna affiliazione" : "Ospite · entra nel Social"))}</span></span>
      <span class="havw">${avatarHTML(p, "havatar")}${social ? `<span class="nbadge">${social > 9 ? "9+" : social}</span>` : ""}</span></button>
    <div class="hcenter">
      ${emblemSVG(p.accent || "holophone")}
      <div class="hname">DeckShard</div>
      <div class="hhello">${nick ? `Bentornato, <b>${esc(nick)}</b>.` : "Benvenuto, choom."}</div>
      <div class="hline">${LINES[day % LINES.length]}</div>
      ${shortcuts.length ? `<div class="hshorts">${shortcuts.join("")}</div>` : ""}
    </div>
  </div>`;
  if(!enter && root.__html === html) return;
  root.__html = html; root.innerHTML = html;
  const em = root.querySelector(".emblem"); if(em) em.classList.add(enter ? "enter" : "calm");
}

export function wireHome(go){
  $("#p-home").addEventListener("click", e => {
    if(e.target.closest("#homeSocial")){ go("profile"); return; }
    const b = e.target.closest("[data-h]"); if(!b) return;
    if(b.dataset.h === "social") go(cloud.unread && !cloud.requests ? "chat" : "profile");   // solo messaggi: la scheda Chat
    if(b.dataset.h === "online"){ go("sim"); showOnline(); }
    if(b.dataset.h === "resume"){ go("sim"); resumeSim(); }
  });
}
