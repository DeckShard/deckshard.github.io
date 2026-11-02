/* Tutorial: partita guidata contro il bot. Una barra sopra la plancia dice
   cosa fare; ogni passo si completa da solo quando lo stato della partita
   lo mostra (o con «Avanti» per i passi informativi).                   */

import { streetCred } from "./engine.js";

const STEPS = [
  { t: "Benvenuto. Questa è una partita guidata: segui i passi nella barra. Prima decidi se tenere la mano: con 6 carte di costo basso di solito si tiene.", done: G => G.players.every(p => p.mulliganed) },
  { t: "Se il bot inizia, osserva il suo turno. Al tuo inizio di turno scegli quale dado tirare dal fixer: i dadi grandi danno più Street Cred (☆), il d20 va sempre per ultimo.", done: (G, me) => G.active === me && G.phase === "main" && G.players[me].gigs.length >= 1 },
  { t: "Vendi una carta: trascina sulla pila €$ una carta con il simbolo di vendita (o toccala → «Vendi»). Vale 1 €$ per turno, qualunque fosse il suo costo.", done: (G, me) => G.players[me].eddies.length >= 1 },
  { t: "Gioca un'Unità: trascinala sulla tua metà di plancia (o toccala → «Gioca») e paga toccando Eddies o Leggende. Entra con Lag: attaccherà dal prossimo turno.", done: (G, me) => G.players[me].field.length > 0 },
  { t: "Chiama una Leggenda: tocca una Leggenda coperta → «Chiama» (1 €$). La scopri senza sapere quale sia e ne attivi gli effetti {Call}. Una Chiamata per turno.", done: (G, me) => G.players[me].legends.some(l => l.faceUp) },
  { t: "Quando hai finito premi «Fine turno». Il bot gioca il suo turno: guarda cosa fa nella barra e nel registro (≡).", done: (G, me) => G.active !== me && G.players[me].turns >= 1 },
  { t: "Se il bot attacca ti si apre la finestra di reazione: puoi bloccare con un'Unità con {Blocker}, chiamare una Leggenda o usare carte Quick. «Non reagire» lascia passare l'attacco.", done: (G, me) => G.active === me && G.players[me].turns >= 2, info: true },
  { t: "È di nuovo il tuo turno: le tue Unità sono pronte. Tocca un'Unità → «Attacca l'area Gig»: con potenza 1–9 rubi un Gig, 10–19 due, 20+ tre. Se il bot ha Unità spese puoi invece attaccarle per uno scontro.", done: (G, me) => G.log.some(l => l.kind === "attack" && l.p === me) },
  { t: "Ottimo. Street Cred ☆ è la somma dei tuoi dadi: molte carte la confrontano con quella del rivale. Continua a vendere, giocare e attaccare: vinci se inizi un turno con 7 Gig.", done: (G, me) => G.players[me].turns >= 4, info: true },
  { t: "Dopo il settimo turno di entrambi scatta l'overtime: vince subito chi arriva a 7 Gig. Da qui in poi giochi da solo: buona fortuna, choom.", done: () => false, info: true, last: true },
];
let active = false, idx = 0;
export const tutorialActive = () => active;
export function startTutorial(){ active = true; idx = 0; }
export function stopTutorial(){ active = false; }
/* avanza se il passo corrente risulta completato; ritorna true se è avanzato */
export function tutorialStep(G, me, force = false){
  if(!active || !G) return false;
  const s = STEPS[idx];
  if(force || s.done(G, me)){ if(s.last){ if(force) stopTutorial(); return force; } idx++; return true; }
  return false;
}
export function tutorialBarHTML(G, me){
  const s = STEPS[idx];
  return `<div class="tutbar"><span class="n">${idx + 1}/${STEPS.length}</span><span class="tx">${s.t}</span>
    ${s.info || s.last ? `<button class="btn sm yel" id="tutNext">${s.last ? "Chiudi il tutorial" : "Avanti"}</button>` : ""}<button class="btn sm icon" id="tutSkip" title="Chiudi il tutorial">✕</button></div>`;
}
export const tutorialHTML = () => "";
