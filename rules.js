/* Regole: il riassunto di base per chi inizia, riscritto in italiano dalla
   guida ufficiale, più le regole di costruzione e del Prerelease come
   le applica l'app. Nessun testo copiato: per il regolamento completo ci
   sono i collegamenti in fondo.                                         */

import { $, esc } from "./ui.js";

const SECTIONS = [
  ["Obiettivo", `Ogni giocatore ha sei dadi (d4, d6, d8, d10, d12, d20): sono i <b>Gig</b>. A ogni turno ne tiri uno dal <i>fixer</i> e lo metti nella tua area Gig; attaccando l'area Gig del rivale puoi rubarglieli. <b>Vince chi inizia il proprio turno con almeno 7 Gig</b>. Se il mazzo di un giocatore finisce e deve pescare, perde subito.`],
  ["Il mazzo", `3 <b>Leggende</b> con nomi diversi e un mazzo di 40–50 carte (Unità, Gear, Programmi) con al massimo 3 copie per carta. Ogni carta ha un valore di <b>RAM</b> di un colore: la somma dei RAM delle tue Leggende per ciascun colore è il massimo che una carta di quel colore può avere. Due Leggende verdi da 2 e una rossa da 2 permettono carte verdi fino a RAM 4 e rosse fino a RAM 2.`],
  ["Preparazione", `Mescola le Leggende e mettile coperte in fila. Entrambi tirano un d20: chi fa di più decide chi inizia; chi inizia <b>spende le sue due Leggende più a sinistra</b> e non le prepara nel primo turno. Si pescano 6 carte; una sola volta si può rimescolare la mano e pescarne 6 nuove (mulligan).`],
  ["Il turno", `<b>Inizio</b>: prepari tutte le carte spese, peschi 1, prendi un dado dal fixer (il d20 sempre per ultimo), lo tiri e lo metti nella tua area Gig. Se hai 7 o più Gig all'inizio del turno hai vinto.<br><b>Fase principale</b>, in qualsiasi ordine e quante volte vuoi: vendi (una volta per turno), gioca carte, chiama una Leggenda (una volta per turno), attacca con le Unità pronte.<br>Finito, passi il turno. Il <b>Lag</b> delle Unità giocate finisce con il turno.`],
  ["Eddies: il denaro", `Una volta per turno puoi <b>vendere</b> una carta dalla mano che ha il simbolo di vendita: la mostri e la metti coperta nella tua area Eddies. Ogni carta lì vale <b>1 €$</b> per turno, qualunque fosse il suo costo. Per pagare spendi Eddies (li giri) e, se vuoi, anche Leggende: ogni Leggenda, coperta o scoperta, vale 1 €$. Tutto ciò che hai speso si prepara all'inizio del tuo turno successivo.`],
  ["Giocare le carte", `Il costo è il numero in alto a sinistra. Le <b>Unità</b> entrano con Lag: non possono attaccare né usare abilità «spendi» nel turno in cui entrano (tranne con <b>Adrenaline</b>). I <b>Programmi</b> fanno il loro effetto e vanno nel trash. I <b>Gear</b> si equipaggiano a una tua Unità o a una Leggenda scoperta: la loro potenza si somma a quella della carta e si spostano con lei.`],
  ["Le Leggende", `Stanno nella loro area, coperte. <b>Chiamare</b> una Leggenda costa 1 €$ e si può fare una volta per turno, anche nel turno del rivale come reazione: la scopri senza averla guardata prima, e scattano i suoi effetti {Call}. Le Leggende scoperte hanno abilità continue o abilità «{Spend}» che usi spendendole. Con <b>Go Solo</b> paghi il costo della Leggenda e la giochi come Unità già pronta, che può attaccare subito; la Leggenda stessa può contribuire 1 €$ al proprio costo. Se lascia il campo esce dal gioco.`],
  ["Attaccare", `Un'Unità pronta e senza Lag attacca <b>spendendosi</b>, una alla volta. Due bersagli possibili:<br>• un'<b>Unità spesa</b> del rivale: è uno scontro, vince chi ha più potenza e l'altra va nel trash; a parità vanno nel trash entrambe;<br>• l'<b>area Gig</b> del rivale: se nessuno la ferma, rubi Gig a tua scelta in base alla potenza: 1 con potenza da 1 a 9, 2 da 10 a 19, 3 da 20 in su. Con potenza 0 l'attacco riesce ma non rubi nulla.<br>Le Unità pronte non si possono attaccare.`],
  ["Reagire a un attacco", `Dopo la dichiarazione dell'attacco il difensore può, anche più volte: <b>chiamare</b> una Leggenda (1 €$, se non l'ha già fatto nel turno), giocare Programmi o usare abilità con <b>{Quick}</b>, e <b>bloccare</b> spendendo un'Unità con {Blocker}: l'attacco viene deviato su di lei e si risolve come uno scontro, e in ogni caso nessun Gig viene rubato.`],
  ["Street Cred", `☆ è la somma dei valori mostrati dai tuoi dadi Gig. Molti effetti la confrontano con quella del rivale o ne guardano la parità. Un «value-pair» sono due Gig con lo stesso valore; un «min Gig» mostra 1, un «max Gig» mostra il valore massimo del dado.`],
  ["Overtime", `Dopo che entrambi i giocatori hanno completato il settimo turno inizia la <b>morte improvvisa</b>: vince all'istante chi arriva ad avere la maggioranza dei dadi, cioè 7 Gig, in qualunque momento.`],
  ["Parole chiave", `<b>{Play}</b> quando la carta entra · <b>{Call}</b> quando la Leggenda viene chiamata · <b>{Attack}</b> quando l'Unità attacca · <b>{Defeated}</b> quando va nel trash · <b>{Spend}</b> abilità attivata spendendo la carta · <b>Adrenaline</b> può attaccare subito · <b>Quick</b> usabile come reazione · <b>Blocker</b> può deviare un attacco su di sé · <b>Go Solo</b> la Leggenda si gioca come Unità · <b>Lag</b> appena entrata: niente attacchi né {Spend} fino a fine turno.`],
  ["Prerelease (sealed) in questa app", `Il kit simulato è quello reale: 6 buste da 12 carte (7 comuni, 3 non comuni, 2 rare o meglio, che possono essere anche Leggende), un pacchetto con 3 Leggende e il promo dell'espansione. Con quello che apri costruisci un mazzo da <b>almeno 30 carte</b> oltre alle 3 Leggende, senza limiti di RAM né di copie, con Unità, Gear e Programmi di <b>al massimo 3 colori</b>; le Leggende sono libere. Poi ti alleni contro il bot, che gioca a sua volta con un kit aperto a caso.`],
];
const LINKS = [
  ["Guida ufficiale alle regole (inglese)", "https://cyberpunktcg.com/gameplay-guide"],
  ["Guida stampabile (PDF)", "https://cyberpunktcg.com/docs/printable-gameplay-guide.pdf"],
  ["Foglio promemoria (PDF)", "https://cyberpunktcg.com/docs/printable-reminder-sheet.pdf"],
  ["Regole dei tornei e Holophone", "https://cyberpunktcg.com/holophone"],
];

export function renderRules(){
  const root = $("#p-rules");
  if(root.dataset.done) return;
  root.dataset.done = "1";
  root.innerHTML = `
    <div class="card">
      <h2>Regole in breve</h2>
      <div class="sub">Quello che serve per giocare la prima partita, nei termini che usa anche il simulatore. Per i casi particolari fa fede la guida ufficiale, in fondo.</div>
      <div class="rulesnav">${SECTIONS.map(([t], i) => `<a href="#rules-${i}" class="chip">${esc(t)}</a>`).join("")}</div>
    </div>
    ${SECTIONS.map(([t, body], i) => `<div class="card rulesec" id="rules-${i}"><h3>${esc(t)}</h3><p>${body}</p></div>`).join("")}
    <div class="card">
      <h3>Fonti ufficiali</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${LINKS.map(([t, u]) => `<a class="btn sm" href="${u}" target="_blank" rel="noopener noreferrer">${esc(t)} ↗</a>`).join("")}</div>
    </div>`;
  root.addEventListener("click", e => { const a = e.target.closest('a[href^="#rules-"]'); if(!a) return; e.preventDefault(); const el = $(a.getAttribute("href")); if(el) el.scrollIntoView({ behavior: "smooth", block: "start" }); });
}
