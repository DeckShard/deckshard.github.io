/* Bot: avversario euristico. Vende per crescere, chiama le Leggende presto,
   gioca le Unità più forti che può permettersi, attacca dove conviene,
   blocca solo quando vince lo scontro o quando sta per perdere i Gig.   */

import { legalActions, doAction, power, ready, rival, streetCred, canAttack, hasKw } from "./engine.js";

const val = c => (c.card.power ?? 0) + (c.card.type === "Program" ? 2 : 0) + (c.card.type === "Gear" ? (c.card.power ?? 0) + 1 : 0);

/* decisioni richieste dal motore (dado, blocco, furto, bersagli, scarti) */
export function botDecide(G, pi, kind, options, ctx){
  const P = G.players[pi], R = rival(G, P);
  switch(kind){
    case "die": return options.reduce((a, b) => b.sides > a.sides ? b : a);                   // dado più grande = più Street Cred
    case "block": {
      const att = ctx.attacker, pa = power(att);
      const winners = options.filter(o => o.unit && power(o.unit) > pa);
      if(winners.length) return winners.reduce((a, b) => power(a.unit) < power(b.unit) ? a : b);  // vince col blocker più economico
      const ties = options.filter(o => o.unit && power(o.unit) === pa && (o.unit.card.cost ?? 0) <= (att.card.cost ?? 0));
      if(ties.length) return ties[0];
      // attacco ai Gig: blocca sacrificando un'Unità debole se i Gig sono pochi o il furto è multiplo
      if(!ctx.target && (P.gigs.length <= 2 || pa >= 10 || R.gigs.length >= 5)){ const cheap = options.filter(o => o.unit).sort((a, b) => power(a.unit) - power(b.unit))[0]; if(cheap) return cheap; }
      return options[0];
    }
    case "steal": { const w = options.filter(o => o.gig); return w.length ? w.reduce((a, b) => b.gig.value > a.gig.value ? b : a) : options[0]; }
    case "discard": { const w = options.filter(o => o.c); return w.length ? w.reduce((a, b) => val(b.c) < val(a.c) ? b : a) : options[0]; }
    case "target": {
      // preferisci Unità rivali più forti; per i buff la propria Unità pronta più forte
      const rivals = options.filter(o => o.unit && R.field.includes(o.unit));
      if(rivals.length) return rivals.reduce((a, b) => power(b.unit) > power(a.unit) ? b : a);
      const mine = options.filter(o => o.unit && P.field.includes(o.unit) && !o.unit.spent && !o.unit.lag);
      if(mine.length) return mine.reduce((a, b) => power(b.unit) > power(a.unit) ? b : a);
      return options[0];
    }
    case "gigpick": { const w = options.filter(o => o.gig); return w.length ? w.reduce((a, b) => (b.gig.sides - b.gig.value) > (a.gig.sides - a.gig.value) ? b : a) : options[0]; }
    case "pickcard": {   // carte da prendere in mano / Gear da sacrificare: la più utile; "Nessuna" solo se non c'è altro
      const withCard = options.filter(o => o.c);
      if(withCard.length) return withCard.reduce((a, b) => val(b.c) > val(a.c) ? b : a);
      const withGear = options.filter(o => o.g);
      if(withGear.length) return withGear.reduce((a, b) => (a.g.card.cost ?? 0) <= (b.g.card.cost ?? 0) ? a : b);
      return options[options.length - 1];
    }
    case "choice": return options.reduce((a, b) => b.alt.ops.filter(o => o.op === "manual").length < a.alt.ops.filter(o => o.op === "manual").length ? b : a);
    case "yesno": return options.find(o => !o.disabled) || options[0];
    case "gigvalue": { const w = options.filter(o => o.v != null); return w.length ? w.reduce((a, b) => b.v > a.v ? b : a) : options[0]; }
    default: return options[0];
  }
}

/* un passo del bot: sceglie e applica UNA azione; ritorna false quando ha finito il turno */
export function botStep(G, pi){
  if(G.winner != null || G.pending || G.active !== pi || G.phase !== "main") return false;
  const P = G.players[pi], R = rival(G, P);
  // azioni fallite in questo turno: non vanno ritentate (altrimenti il bot gira a vuoto)
  if(G._skipTurn !== G.turn){ G._skipTurn = G.turn; G._skip = new Set(); }
  const key = a => a.t + ":" + (a.uid || a.idx || "") + ":" + (a.target ? a.target.kind + (a.target.uid || "") : "");
  const acts = legalActions(G, pi).filter(a => !G._skip.has(key(a)));
  const by = t => acts.filter(a => a.t === t);
  const go = a => { const ok = doAction(G, pi, a); if(ok === false) G._skip.add(key(a)); return true; };

  // 1) vendita: una carta che non giocheremo presto (costo alto) o la meno utile se la mano è piena
  const sells = by("sell");
  if(sells.length && P.hand.length >= 3){
    const money = ready(P);
    const cand = sells.filter(a => (a.card.card.cost ?? 0) > money + 2).sort((a, b) => val(a.card) - val(b.card))[0]
              || (P.hand.length >= 5 ? sells.sort((a, b) => val(a.card) - val(b.card))[0] : null)
              || (P.eddies.length < 4 ? sells.sort((a, b) => val(a.card) - val(b.card))[0] : null);
    if(cand){ go(cand); return true; }
  }
  // 2) chiama una Leggenda nei primi turni o quando c'è denaro in abbondanza
  if(by("call").length && (P.turns <= 2 || ready(P) >= 3)){ go(by("call")[0]); return true; }
  // 3) attacchi (prima di spendere, così le Unità spese del rivale sono già note)
  const attacks = by("attack");
  if(attacks.length){
    const blockers = R.field.filter(b => !b.spent && !b.lag && hasKw(b, "Blocker"));
    const bestBlock = blockers.length ? Math.max(...blockers.map(power)) : -1;
    let best = null, bestScore = 0;
    for(const a of attacks){
      const pa = power(a.unit); let score = 0;
      if(a.target.kind === "unit"){ const pt = power(a.targetObj); if(pa > pt) score = 3 + pt; else if(pa === pt && (a.unit.card.cost ?? 0) < (a.targetObj.card.cost ?? 0)) score = 1; }
      else { score = 4 + (1 + Math.floor(pa / 10)) * 3 + (R.gigs.length >= 5 ? 4 : 0); }
      if(bestBlock >= pa) score -= 4; // probabile blocco perdente
      if(score > bestScore){ bestScore = score; best = a; }
    }
    if(best){ go(best); return true; }
  }
  // 4) gioca: l'Unità più forte che può permettersi, poi Gear sull'Unità migliore, poi Programmi interpretabili
  const plays = by("play");
  const units = plays.filter(a => a.card.card.type === "Unit").sort((a, b) => power(b.card) - power(a.card) || (a.card.card.cost ?? 0) - (b.card.card.cost ?? 0));
  if(units.length && P.field.length < 7){ go(units[0]); return true; }
  const gears = plays.filter(a => a.card.card.type === "Gear" && a.targetObj && !a.targetObj.isLegend && P.field.includes(a.targetObj)).sort((a, b) => power(b.targetObj) - power(a.targetObj));
  if(gears.length){ go(gears[0]); return true; }
  const progs = plays.filter(a => a.card.card.type === "Program" && a.card.fx.manual.length < 2 && (a.card.fx.passive.length || a.card.fx.play.length));
  if(progs.length && ready(P) >= (progs[0].card.card.cost ?? 0)){ go(progs[0]); return true; }
  // 5) Go Solo quando il campo è vuoto e c'è denaro
  const solo = by("gosolo"); if(solo.length && P.field.length <= 1 && ready(P) >= (solo[0].legend.card.cost ?? 0) + 1){ go(solo[0]); return true; }
  // 6) abilità {Spend} interpretabili
  const sp = by("spend").filter(a => a.obj.fx.spend.some(o => o.op !== "manual") && !(P.field.includes(a.obj) && canAttack(G, P, a.obj)));
  if(sp.length){ go(sp[0]); return true; }
  doAction(G, pi, { t: "end" });
  return false;
}

/* gioca l'intero turno del bot (con un limite di sicurezza) */
export function botTurn(G, pi){
  let n = 0;
  while(n++ < 60 && botStep(G, pi)){ if(G.pending) break; }
}
