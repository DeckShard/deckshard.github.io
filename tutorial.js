/* Tutorial: partita guidata contro il bot. Una barra sopra la plancia dice
   cosa fare; ogni passo si completa da solo quando lo stato della partita
   lo mostra (o con «Avanti» per i passi informativi).                   */

import { streetCred, power, hasKw } from "./engine.js";

/* i primi passi (tour) presentano la plancia, con il pezzo di cui si parla evidenziato; il mulligan arriva dopo */
const STEPS = [
  { t: "Benvenuto, choom. Questa è la plancia: in alto c'è il rivale (il bot), in basso ci sei tu. Al centro la barra del turno, con «Fine turno», il registro ≡ e il menù ⋯.", tour: true, info: true, hl: ".bstrip" },
  { t: "Le tue pile: Mazzo, €$ (gli Eddies, la moneta del gioco: pronti/totali) e Trash (le carte scartate o sconfitte: toccalo per vederle).", tour: true, info: true, hl: ".bz.mine .brow:not(.field):not(.hand) .stack" },
  { t: "Le tue 3 Leggende, coperte. Una Leggenda pronta vale 1 €$ per pagare; puoi anche chiamarla (scoprirla, 1 €$) per usarne gli effetti, e alcune possono scendere in campo con Go Solo.", tour: true, info: true, hl: ".bz.mine [data-legend]" },
  { t: "I dadi. Quelli tratteggiati sono il tuo fixer: a ogni inizio turno ne tiri uno e diventa un Gig (dado pieno). Il numero dopo ☆ è lo Street Cred, la somma dei Gig. Chi inizia un turno con 7 Gig vince; attaccando si rubano i Gig del rivale.", tour: true, info: true, hl: ".bz.mine .dice" },
  { t: "Il campo, dove giocano le tue Unità, e sotto la mano. Tocca una carta per le azioni, tienila premuta per ingrandirla, oppure trascinala dalla mano sul campo per giocarla.", tour: true, info: true, hl: ".bz.mine .brow.field, .bz.mine .brow.hand" },
  { t: "Ora decidi se tenere la mano: con 6 carte di costo basso di solito si tiene. Il mulligan rimescola la mano nel mazzo e ne pesca 6 nuove.", done: G => G.players.every(p => p.mulliganed) },
  { t: "Il bot inizia: osserva il suo turno. Al tuo inizio di turno scegli quale dado tirare dal fixer: i dadi grandi danno più Street Cred (☆), il d20 va sempre per ultimo.", done: (G, me) => G.active === me && G.phase === "main" && G.players[me].gigs.length >= 1 },
  { t: "Vendi una carta: trascina sulla pila €$ una carta con il simbolo di vendita (o toccala → «Vendi»). Vale 1 €$ per turno, qualunque fosse il suo costo.", done: (G, me) => G.players[me].eddies.length >= 1 },
  { t: "Gioca un'Unità con potenza (per esempio Dexter DeShawn): trascinala sulla tua metà di plancia o toccala → «Gioca», e paga toccando Eddies o Leggende. Entra con Lag: attaccherà dal prossimo turno.", done: (G, me) => G.players[me].field.some(u => power(u) >= 1) },
  { t: "Chiama una Leggenda: tocca una Leggenda coperta → «Chiama» (1 €$). La scopri senza sapere quale sia e ne attivi gli effetti {Call}. Una Chiamata per turno, anche nel turno del rivale.", done: (G, me) => G.players[me].legends.some(l => l.faceUp) },
  { t: "Quando hai finito premi «Fine turno». Il bot gioca il suo turno: guarda cosa fa nella barra e nel registro (≡).", done: (G, me) => G.active !== me && G.players[me].turns >= 1 },
  { t: "Secondo turno: le tue carte spese si preparano, peschi e tiri un altro dado. Vendi di nuovo e gioca Secondhand Bombus, l'Unità con {Blocker}: ti servirà per reagire agli attacchi del bot.", done: (G, me) => G.active === me && G.players[me].field.some(u => hasKw(u, "Blocker")) },
  { t: "Attacca: tocca l'Unità che hai giocato nel primo turno → «Attacca l'area Gig». Con potenza 1–9 rubi un Gig, 10–19 due, 20+ tre. Se il bot ha Unità spese puoi invece attaccarle per uno scontro.", done: (G, me) => G.log.some(l => l.kind === "attack" && l.p === me) },
  { t: "Premi «Fine turno» e tieni gli occhi aperti: ora il bot ha Unità pronte e attaccherà. Il Lag di Bombus finisce con il tuo turno, quindi nel turno del bot può bloccare.", done: (G, me) => G.active !== me && G.players[me].turns >= 2 },
  { t: "Il bot attacca: reagisci! Blocca con Secondhand Bombus (l'attacco viene deviato su di lei), oppure chiama una Leggenda coperta (1 €$) o usa una carta {Quick} dalla mano; puoi reagire anche più volte. «Non reagire» lascia passare l'attacco.", done: (G, me) => !!G.tutReacted || (G.active === me && G.players[me].turns >= 3) },
  { t: "Street Cred ☆ è la somma dei tuoi dadi: molte carte la confrontano con quella del rivale. Continua a vendere, giocare e attaccare: vinci se inizi un turno con 7 Gig.", done: (G, me) => G.players[me].turns >= 5, info: true },
  { t: "Dopo il settimo turno di entrambi scatta l'overtime: vince subito chi arriva a 7 Gig. Da qui in poi giochi da solo: buona fortuna, choom.", done: () => false, info: true, last: true },
];
let active = false, idx = 0;
export const tutorialActive = () => active;
export function startTutorial(){ active = true; idx = 0; }
export function stopTutorial(){ active = false; }
export const TUTORIAL_SEED = 20771;
/* durante il tour della plancia il mulligan aspetta, e il pezzo di cui si parla è evidenziato */
export const tutorialTour = () => active && !!STEPS[idx].tour;
export const tutorialHighlight = () => active ? STEPS[idx].hl || "" : "";
/* la mano del tutorial deve sempre permettere i passi: una carta vendibile, un'Unità
   con potenza da 3 €$ o meno e Secondhand Bombus (l'Unità con Blocker) */
export function ensureHand(G, me){
  const P = G.players[me];
  const need = [c => c.card.eddiable && c.card.type !== "Unit", c => c.card.type === "Unit" && (c.card.power ?? 0) >= 1 && (c.card.cost ?? 0) <= 3, c => c.card.type === "Unit" && hasKw(c, "Blocker") && (c.card.cost ?? 0) <= 2];
  for(const test of need){
    if(P.hand.some(test)) continue;
    const i = P.deck.findIndex(test); if(i < 0) continue;
    const card = P.deck.splice(i, 1)[0];
    // scambia con una carta della mano che non serve agli altri passi
    const j = P.hand.findIndex(c => !need.some(t2 => t2(c))); const out = j >= 0 ? P.hand.splice(j, 1)[0] : P.hand.pop();
    P.hand.push(card); if(out) P.deck.push(out);
  }
}
/* azioni permesse nel passo corrente: nei passi "fai X" si può fare solo X (e reagire) */
export function tutorialAllows(kind, card){
  if(!active) return true;
  const only = { 7: "sell", 8: "playUnit", 9: "call", 10: "end", 11: "playBlocker", 12: "attack", 13: "end" }[idx];
  if(!only) return true;
  if(kind === "react" || kind === "pay") return true;
  if(only === "playUnit") return kind === "play" && card && card.card.type === "Unit" && (card.card.power ?? 0) >= 1;
  if(only === "playBlocker") return kind === "sell" || (kind === "play" && card && card.card.type === "Unit" && hasKw(card, "Blocker"));
  return kind === only;
}
/* avanza se il passo corrente risulta completato; ritorna true se è avanzato */
export function tutorialStep(G, me, force = false){
  if(!active || !G) return false;
  const s = STEPS[idx];
  if(force || (s.done && s.done(G, me))){ if(s.last){ if(force) stopTutorial(); return force; } idx++; return true; }
  return false;
}
export function tutorialBarHTML(G, me){
  const s = STEPS[idx];
  return `<div class="tutbar"><span class="n">${idx + 1}/${STEPS.length}</span><span class="tx">${s.t}</span>
    ${s.info || s.last ? `<button class="btn sm yel" id="tutNext">${s.last ? "Chiudi il tutorial" : "Avanti"}</button>` : ""}</div>`;
}
export const tutorialHTML = () => "";
