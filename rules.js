/* Regole: «In breve» è il riassunto in italiano per chi inizia (riscritto
   dalla guida ufficiale, più costruzione, Prerelease e le letture del
   simulatore); «Complete» sono le Comprehensive Rules ufficiali di WeirdCo,
   nel testo originale inglese che fa fede, scaricate dal collector
   (public/rules.json) dalla stessa API della pagina ufficiale.          */

import { $, esc } from "./ui.js";

const SECTIONS = [
  ["Obiettivo", `Ogni giocatore ha sei dadi (d4, d6, d8, d10, d12, d20): sono i <b>Gig</b>. A ogni turno ne tiri uno dal <i>fixer</i> e lo metti nella tua area Gig; attaccando l'area Gig del rivale puoi rubarglieli. <b>Vince chi inizia il proprio turno con almeno 7 Gig</b>. Se il mazzo di un giocatore finisce e deve pescare, perde subito.`],
  ["Il mazzo", `3 <b>Leggende</b> con nomi diversi e un mazzo di 40–50 carte (Unità, Gear, Programmi) con al massimo 3 copie per carta. Ogni carta ha un valore di <b>RAM</b> di un colore: la somma dei RAM delle tue Leggende per ciascun colore è il massimo che una carta di quel colore può avere. Due Leggende verdi da 2 e una rossa da 2 permettono carte verdi fino a RAM 4 e rosse fino a RAM 2.`],
  ["Preparazione", `Mescola le Leggende e mettile coperte in fila. Entrambi tirano un d20: chi fa di più decide chi inizia; chi inizia <b>spende le sue due Leggende più a sinistra</b> e non le prepara nel primo turno. Si pescano 6 carte; una sola volta si può rimescolare la mano e pescarne 6 nuove (mulligan).`],
  ["Il turno", `<b>Inizio</b>: prepari tutte le carte spese, peschi 1, prendi un dado dal fixer (il d20 sempre per ultimo), lo tiri e lo metti nella tua area Gig. Se hai 7 o più Gig all'inizio del turno hai vinto.<br><b>Fase principale</b>, in qualsiasi ordine e quante volte vuoi: vendi (una volta per turno), gioca carte, chiama una Leggenda (una volta per turno), attacca con le Unità pronte.<br>Finito, passi il turno. Il <b>Lag</b> delle Unità giocate finisce con il turno.`],
  ["Eddies: il denaro", `Una volta per turno puoi <b>vendere</b> una carta dalla mano che ha il simbolo di vendita: la mostri e la metti coperta nella tua area Eddies. Ogni carta lì vale <b>1 €$</b> per turno, qualunque fosse il suo costo. Per pagare spendi Eddies (li giri) e, se vuoi, anche Leggende: ogni Leggenda, coperta o scoperta, vale 1 €$. Tutto ciò che hai speso si prepara all'inizio del tuo turno successivo.`],
  ["Giocare le carte", `Il costo è il numero in alto a sinistra. Le <b>Unità</b> entrano con Lag: non possono attaccare né usare abilità «spendi» nel turno in cui entrano (tranne con <b>Adrenaline</b>). I <b>Programmi</b> fanno il loro effetto e vanno nel trash. I <b>Gear</b> si equipaggiano a una tua Unità o a una Leggenda scoperta: la loro potenza si somma a quella della carta e si spostano con lei.`],
  ["Le Leggende", `Stanno nella loro area, coperte. <b>Chiamare</b> una Leggenda costa 1 €$ e si può fare una volta per turno, anche nel turno del rivale come reazione: la scopri senza averla guardata prima, e scattano i suoi effetti {Call}. Le Leggende scoperte hanno abilità continue o abilità «{Spend}» che usi spendendole. Con <b>Go Solo</b> paghi il costo della Leggenda e la giochi come Unità già pronta, che può attaccare subito; la Leggenda stessa può contribuire 1 €$ al proprio costo. Se lascia il campo esce dal gioco.`],
  ["Attaccare", `Un'Unità pronta e senza Lag attacca <b>spendendosi</b>, una alla volta. Due bersagli possibili:<br>• un'<b>Unità spesa</b> del rivale: è uno scontro, vince chi ha più potenza e l'altra va nel trash; a parità vanno nel trash entrambe (ma con potenza 0 contro 0 nessuna delle due);<br>• l'<b>area Gig</b> del rivale: se nessuno la ferma, rubi Gig a tua scelta in base alla potenza: 1 con potenza da 1 a 9, 2 da 10 a 19, 3 da 20 in su. Con potenza 0 l'attacco riesce ma non rubi nulla.<br>Le Unità pronte non si possono attaccare.`],
  ["Reagire a un attacco", `Dopo la dichiarazione dell'attacco il difensore può, anche più volte: <b>chiamare</b> una Leggenda (1 €$, se non l'ha già fatto nel turno), giocare Programmi o usare abilità con <b>{Quick}</b>, e <b>bloccare</b> spendendo un'Unità con {Blocker}: l'attacco viene deviato su di lei e si risolve come uno scontro, e in ogni caso nessun Gig viene rubato.`],
  ["Street Cred", `☆ è la somma dei valori mostrati dai tuoi dadi Gig. Molti effetti la confrontano con quella del rivale o ne guardano la parità. Un «value-pair» sono due Gig con lo stesso valore; un «min Gig» mostra 1, un «max Gig» mostra il valore massimo del dado.`],
  ["Overtime", `Dopo che entrambi i giocatori hanno completato il settimo turno inizia la <b>morte improvvisa</b>: vince all'istante chi arriva ad avere la maggioranza dei dadi, cioè 7 Gig, in qualunque momento.`],
  ["Parole chiave", `<b>{Play}</b> quando la carta entra · <b>{Call}</b> quando la Leggenda viene chiamata · <b>{Attack}</b> quando l'Unità attacca · <b>{Defeated}</b> quando va nel trash · <b>{Spend}</b> abilità attivata spendendo la carta · <b>Adrenaline</b> può attaccare subito · <b>Quick</b> usabile come reazione · <b>Blocker</b> può deviare un attacco su di sé · <b>Go Solo</b> la Leggenda si gioca come Unità · <b>Lag</b> appena entrata: niente attacchi né {Spend} fino a fine turno.`],
  ["Costruzione del mazzo", `Esattamente 3 Leggende con nomi diversi e da 40 a 50 altre carte; massimo 3 copie per carta (Leggende escluse dal conteggio). <b>RAM</b>: per ogni colore, sommi i RAM delle tue Leggende di quel colore; ogni carta del mazzo deve avere un RAM minore o uguale a quel totale per il suo colore. Le Leggende contano solo per il proprio colore. Esempio: Rogue (giallo 2) e due Leggende rosse da 2 permettono carte gialle fino a RAM 2 e rosse fino a RAM 4, e nessuna carta verde o blu.`],
  ["Prerelease (sealed) in questa app", `Il kit simulato è quello reale: 6 buste da 12 carte (7 comuni, 3 non comuni, 2 rare o meglio, che possono essere anche Leggende), un pacchetto con 3 Leggende e il promo dell'espansione. Con quello che apri costruisci un mazzo da <b>almeno 30 carte</b> oltre alle 3 Leggende, senza limiti di RAM né di copie, con Unità, Gear e Programmi di <b>al massimo 3 colori</b>; le Leggende sono libere. Poi ti alleni contro il bot, che gioca a sua volta con un kit aperto a caso.`],
  ["Letture applicate dal simulatore", `Dove la guida non entra nel dettaglio, l'app segue queste letture: la potenza dei Gear si somma a quella della carta che li porta; il Lag termina alla fine del turno in cui l'Unità è entrata, quindi nel turno del rivale l'Unità può bloccare; le reazioni a un attacco possono essere più di una; «…instead» sostituisce l'effetto precedente quando la condizione vale; gli effetti «la prima volta che… ogni turno» scattano una sola volta per turno per carta; una Leggenda in Go Solo esce dal gioco anche se viene messa in fondo al mazzo. Tutti gli effetti delle carte sono eseguiti dal motore e annotati nel registro.`],
];
const LINKS = [
  ["Guida ufficiale alle regole (inglese)", "https://cyberpunktcg.com/gameplay-guide"],
  ["Guida stampabile (PDF)", "https://cyberpunktcg.com/docs/printable-gameplay-guide.pdf"],
  ["Foglio promemoria (PDF)", "https://cyberpunktcg.com/docs/printable-reminder-sheet.pdf"],
  ["Regole complete ufficiali (Comprehensive Rules)", "https://cyberpunktcg.com/comprehensive-rules"],
  ["Regole dei tornei", "https://cyberpunktcg.com/tournament-rules"],
  ["Holophone", "https://cyberpunktcg.com/holophone"],
];


/* ---------------- Regole complete ufficiali (testo inglese, da public/rules.json) */
let fullMode = false, RULES = null, rulesErr = null, query = "";
async function loadRules(){
  if(RULES || rulesErr) return;
  try{ const r = await fetch("./rules.json", { cache: "no-store" }); if(!r.ok) throw new Error("rules.json " + r.status); RULES = await r.json(); }
  catch(e){ rulesErr = e.message; }
}
/* markdown ridotto → HTML (testo già protetto da esc) */
function md(s){
  let t = esc(s);
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, u) => `<img class="rfig" src="${u}" alt="${alt}" loading="lazy">`);
  t = t.replace(/\{\[([^\]]+)\]\(([^)\s]+)\)\}/g, "[$1]($2)");
  t = t.replace(/\[([^\]]+)\]\((#rule-[^)\s]+)\)/g, (m, x, a) => `<a href="${a}" class="rlink">${x}</a>`);
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, x, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${x} ↗</a>`);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<i>$2</i>");
  const blocks = t.split(/\n{2,}/).map(b => b.trim()).filter(Boolean).map(b => {
    if(/^#{1,6}\s/.test(b)) return `<b class="rh">${b.replace(/^#{1,6}\s+/, "")}</b>`;
    if(/^&gt;\s?/.test(b)) return `<blockquote>${b.split(/\n/).map(l => l.replace(/^&gt;\s?/, "")).join("<br>")}</blockquote>`;
    if(/^[-*]\s/m.test(b)) return `<ul>${b.split(/\n/).map(l => `<li>${l.replace(/^[-*]\s+/, "")}</li>`).join("")}</ul>`;
    return `<p>${b.replace(/\n/g, "<br>")}</p>`;
  });
  return blocks.join("");
}
const dateIt = d => d ? new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }) : "";
function fullHTML(){
  if(rulesErr) return `<div class="card"><h3>Regole complete non disponibili</h3><p class="sub">Il file delle regole non è ancora stato pubblicato dal collector (${esc(rulesErr)}). Le trovi sul sito ufficiale: <a href="https://cyberpunktcg.com/comprehensive-rules" target="_blank" rel="noopener noreferrer">cyberpunktcg.com/comprehensive-rules ↗</a>.</p></div>`;
  if(!RULES) return `<div class="card"><p class="sub">Carico le regole complete…</p></div>`;
  const items = RULES.items, byParent = new Map();
  for(const it of items){ const k = it.parent || ""; if(!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(it); }
  const q = query.trim().toLowerCase();
  const matches = it => !q || (it.num + " " + it.title + " " + it.body).toLowerCase().includes(q);
  const anyIn = it => matches(it) || (byParent.get(it.id) || []).some(anyIn);
  const node = it => {
    const kids = byParent.get(it.id) || [];
    if(q && !anyIn(it)) return "";
    if(it.kind === "section"){
      const h = it.depth === 0 ? "" : `<h4 class="rsec d${it.depth}" id="${esc(it.anchor)}">${it.num ? `<span class="num">${esc(it.num)}</span>` : ""}${esc(it.title)}</h4>`;
      return h + kids.map(node).join("");
    }
    const changed = it.changed ? `<span class="rchg" title="Regola ${it.changed === "added" ? "aggiunta" : "modificata"} nell'ultima revisione">${it.changed === "added" ? "nuova" : "modificata"}</span>` : "";
    return `<div class="rule d${it.depth}${q && matches(it) ? " hit" : ""}" id="${esc(it.anchor)}"><span class="num">${esc(it.num)}</span><div class="rb">${md(it.body || it.title)}${changed}</div></div>` + kids.map(node).join("");
  };
  const tops = byParent.get("") || [];
  const nav = tops.map(t => `<a href="#${esc(t.anchor)}" class="chip rtoc">${t.num ? t.num + " " : ""}${esc(t.title)}</a>`).join("");
  const body = tops.map(t => { const inner = node(t); if(q && !inner) return ""; return `<details class="card rulesec rfull" id="sec-${esc(t.anchor)}" ${q ? "open" : ""}><summary><h3>${t.num ? `<span class="num">${esc(t.num)}</span>` : ""}${esc(t.title)}</h3></summary>${inner}</details>`; }).join("");
  const n = items.filter(i => i.kind === "rule").length, hits = q ? items.filter(i => i.kind === "rule" && matches(i)).length : 0;
  return `<div class="card">
      <div class="sub"><b>Comprehensive Rules</b> ufficiali di WeirdCo: ${n} regole numerate, testo originale in inglese (è la versione che fa fede nei tornei; vale più della guida e di ogni riassunto). Aggiornate il ${dateIt(RULES.updatedAt)} · <a href="${esc(RULES.url)}" target="_blank" rel="noopener noreferrer">pagina ufficiale ↗</a></div>
      <input class="inp" id="rulesQ" type="search" placeholder="Cerca una regola (es. blocker, lag, steal, tie…)" value="${esc(query)}" autocomplete="off" style="margin-top:8px">
      ${q ? `<div class="sub" style="margin-top:6px">${hits} regole trovate</div>` : ""}
      <div class="rulesnav" style="margin-top:8px">${nav}</div>
    </div>${body}`;
}
export function renderRules(){
  const root = $("#p-rules");
  if(fullMode && !RULES && !rulesErr){ loadRules().then(renderRules); }
  root.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between"><h2>${fullMode ? "Regole complete" : "Regole in breve"}</h2>
        <span class="seg" id="rulesMode"><button data-v="0" aria-pressed="${!fullMode}">In breve</button><button data-v="1" aria-pressed="${fullMode}">Complete (ufficiali)</button></span></div>
      <div class="sub">${fullMode ? "Il regolamento ufficiale completo, per risolvere ogni dubbio o conflitto in partita: tocca una sezione per aprirla, cerca una parola, segui i rimandi tra le regole." : "Quello che serve per giocare la prima partita, in italiano. Per i casi particolari e le dispute ci sono le regole complete ufficiali."}</div>
      ${fullMode ? "" : `<div class="rulesnav">${SECTIONS.map(([t], i) => `<a href="#rules-${i}" class="chip">${esc(t)}</a>`).join("")}</div>`}
    </div>
    ${fullMode ? fullHTML() : SECTIONS.map(([t, body], i) => `<div class="card rulesec" id="rules-${i}"><h3>${esc(t)}</h3><p>${body}</p></div>`).join("")}
    <div class="card">
      <h3>Fonti ufficiali</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${LINKS.map(([t, u]) => `<a class="btn sm" href="${u}" target="_blank" rel="noopener noreferrer">${esc(t)} ↗</a>`).join("")}</div>
    </div>`;
  if(!root.dataset.wired){ root.dataset.wired = "1";
    root.addEventListener("input", e => { if(e.target.id === "rulesQ"){ query = e.target.value; clearTimeout(root._qt); root._qt = setTimeout(() => { const pos = e.target.selectionStart; renderRules(); const el = $("#rulesQ"); if(el){ el.focus(); el.setSelectionRange(pos, pos); } }, 250); } });
    root.addEventListener("click", e => {
      const m = e.target.closest("#rulesMode button"); if(m){ fullMode = m.dataset.v === "1"; renderRules(); window.scrollTo({ top: 0 }); return; }
      const a = e.target.closest('a[href^="#rules-"], a.rlink, a.rtoc'); if(!a) return; e.preventDefault();
      const id = a.getAttribute("href").slice(1);
      // le sezioni principali sono i riquadri apribili (id «sec-…»): l'indice punta a quelli
      const el = document.getElementById(id) || document.getElementById("sec-" + id); if(!el) return;
      if(el.tagName === "DETAILS") el.open = true;
      const d = el.closest("details"); if(d) d.open = true;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      if(el.classList.contains("rule")){ el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600); }
    }); }
}
