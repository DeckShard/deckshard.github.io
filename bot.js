/* Bot: avversario euristico. Vende per crescere, chiama le Leggende presto,
   gioca le Unità più forti che può permettersi, attacca dove conviene (e toglie di mezzo le Unità
   spese che tornerebbero a rubare), blocca solo quando vince lo scontro o quando sta per perdere
   i Gig, e tiene le carte Quick di difesa per il turno del rivale.   */

import { legalActions, doAction, power, powerIn, ready, rival, streetCred, canAttack, hasKw, costOf, goSoloCost } from "./engine.js";

const val = c => (c.card.power ?? 0) + (c.card.type === "Program" ? 2 : 0) + (c.card.type === "Gear" ? (c.card.power ?? 0) + 1 : 0);

/* decisioni richieste dal motore (dado, blocco, furto, bersagli, scarti) */
export function botDecide(G, pi, kind, options, ctx){
  const P = G.players[pi], R = rival(G, P);
  switch(kind){
    case "die": return options.reduce((a, b) => b.sides > a.sides ? b : a);                   // dado più grande = più Street Cred
    case "block": {
      const att = ctx.attacker, pa = powerIn(G, G.players[G.active], att, { attacking: true });
      const q = quickReaction(G, P, options, att, ctx.target, pa); if(q) return q;
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
      const withCard = options.filter(o => o.c && !o.disabled);
      if(withCard.length) return withCard.reduce((a, b) => val(b.c) > val(a.c) ? b : a);
      const withGear = options.filter(o => o.g);
      if(withGear.length) return withGear.reduce((a, b) => (a.g.card.cost ?? 0) <= (b.g.card.cost ?? 0) ? a : b);
      return options[options.length - 1];   // «Nessuna» / «Ok, vanno in fondo al mazzo»
    }
    case "choice": {
      if(ctx.goFirst) return options[0];   // vinto il tiro: l'IA inizia (tempo e primo Gig)
      if(ctx.reveal) return (ctx.reveal.reduce((a, c) => a + (c.card.cost ?? 0), 0) >= 7 ? options[1] : options[0]) || options[0];   // Fool on the Hill: nega le carte care
      if(ctx.typeChoice){ const cnt = {}; for(const c of P.deck) cnt[c.card.type] = (cnt[c.card.type] || 0) + 1; return options.reduce((a, b) => (cnt[b.v] || 0) > (cnt[a.v] || 0) ? b : a); }
      if(!options[0].alt) return options[0];
      return options.reduce((a, b) => b.alt.ops.filter(o => o.op === "manual").length < a.alt.ops.filter(o => o.op === "manual").length ? b : a); }
    case "yesno": {
      if(ctx.save) return power(ctx.save) >= 5 ? options[0] : options[1];                       // Jackie: si sacrifica solo per un'Unità forte
      if(ctx.reroll) return ctx.reroll.value <= ctx.reroll.sides / 2 ? options[0] : options[1];  // Kerry: ritira i valori bassi
      return options.find(o => !o.disabled) || options[0]; }
    case "gigvalue": { const w = options.filter(o => o.v != null); return w.length ? w.reduce((a, b) => b.v > a.v ? b : a) : options[0]; }
    default: return options[0];
  }
}

/* carte Quick nella finestra di reazione: si giocano quando cambiano davvero l'esito dell'attacco */
const qops = c => (c.fx.passive || []).map(o => o.op);
function quickReaction(G, P, options, att, tu, pa){
  const qs = options.filter(o => o.kind === "quick" && o.c); if(!qs.length || !att) return null;
  const has = op => qs.find(o => qops(o.c).includes(op));
  const debuff = qs.find(o => (o.c.fx.passive || []).some(x => x.op === "debuff" && x.n));
  const dn = debuff ? debuff.c.fx.passive.find(x => x.op === "debuff").n : 0;
  const worth = u => (u.card.cost ?? 0) + power(u) / 2;
  if(tu){   // attaccano una nostra Unità spesa
    const pt = power(tu);
    if(pa < pt) return null;                                                   // vinciamo già
    if(debuff && pa - dn < pt) return debuff;                                   // con il -N vinciamo noi
    const save = has("flag") && qs.find(o => o.c.fx.passive.some(x => x.flag === "noDefeatNextFight"));
    if(save && !P.noDefeatNextFight) return save;                              // Reboot Optics: la nostra Unità resta
    const punish = qs.find(o => o.c.fx.passive.some(x => x.flag === "punishNextLoss"));
    if(punish && !P.punishNextLoss && pa > pt && worth(att) >= worth(tu)) return punish;   // Safety Override: cade anche l'attaccante
    if(debuff && pa - dn === pt && worth(att) >= worth(tu)) return debuff;     // pareggio: cadono entrambe
    return null;
  }
  if(pa < 1 || !P.gigs.length) return null;   // attacco all'area Gig
  const take = 1 + Math.floor(pa / 10);
  const less = has("stealLess"); if(less && !(att.stealLess > 0)) return less; // Take Control: un Gig in meno
  if(debuff && (pa - dn < 1 || 1 + Math.floor(Math.max(0, pa - dn) / 10) < take)) return debuff;   // Floor It: niente furto o un Gig in meno
  return null;
}

/* ------------------------------------------------------------ piano di gioco del turno
   Valore di una carta da giocare (Unità: potenza più bonus per abilità utili; Programmi e Gear
   solo se il motore sa applicarne l'effetto), e scelta dell'insieme di carte che rende di più
   con il denaro disponibile (le mani sono piccole: si provano tutte le combinazioni).          */
const playable = c => c.card.type === "Unit" || ((c.card.type === "Program" || c.card.type === "Gear") && c.fx.manual.length < 2 && (c.fx.passive.length || c.fx.play.length || c.card.type === "Gear"));
function cardValue(G, P, c){
  const t = c.card.type, pw = c.card.power ?? 0;
  if(t === "Unit") return pw + 1.5 + (hasKw(c, "Blocker") ? 1 : 0) + (hasKw(c, "Adrenaline") ? 1.5 : 0) + (c.fx.play.length ? 1.5 : 0) + (c.fx.spend && c.fx.spend.length ? 1 : 0);
  if(t === "Gear") return P.field.some(u => !u.spent || u.lag) ? pw + 2 : 0;
  if(t === "Program"){
    if(c.fx.quick){   // le Quick di difesa si tengono per la finestra di reazione (quickReaction); le altre si giocano come sempre
      const ops = qops(c);
      if(ops.every(o => o === "flag" || o === "stealLess") || ops.includes("debuff")) return 0;
    }
    return 3 + (c.fx.play.length ? 1 : 0);
  }
  return 0;
}
function bestPlan(G, P, hand, budget){
  const cand = hand.filter(playable).map(c => ({ c, cost: costOf(G, P, c), v: cardValue(G, P, c) })).filter(x => x.v > 0 && x.cost <= budget).slice(0, 10);
  let best = { v: 0, cost: 0, set: [] }; const room = 7 - P.field.length;
  for(let m = 1; m < (1 << cand.length); m++){
    let v = 0, cost = 0, units = 0; const set = [];
    for(let i = 0; i < cand.length; i++) if(m & (1 << i)){ v += cand[i].v; cost += cand[i].cost; if(cand[i].c.card.type === "Unit") units++; set.push(cand[i]); }
    if(cost > budget || units > room) continue;
    if(v > best.v || (v === best.v && cost > best.cost)) best = { v, cost, set };
  }
  return best;
}
const eddieWorth = P => P.eddies.length < 4 ? 3.5 : P.eddies.length < 6 ? 2 : P.eddies.length < 8 ? 0.8 : 0;

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
  let attacks = by("attack");
  const must = attacks.filter(a => a.unit.mustAttack);   // "must attack next turn if it can"
  if(must.length) attacks = must;
  if(attacks.length){
    const blockers = R.field.filter(b => !b.spent && !b.lag && (hasKw(b, "Blocker") || b.kwBlockerThisTurn));
    const bestBlock = blockers.length ? Math.max(...blockers.map(power)) : -1;
    let best = null, bestScore = 0;
    for(const a of attacks){
      const pa = powerIn(G, P, a.unit, { attacking: true }); let score = 0;
      if(a.target.kind === "unit"){ const t = a.targetObj, pt = power(t);
        // un'Unità che al prossimo turno può tornare a rubarci Gig vale di più (la si toglie di mezzo finché è spesa)
        const threat = pt >= 1 && !t.fx.cantAttack && !t.fx.onlyUnits ? 2 + Math.floor(pt / 10) * 3 : 0;
        if(pa > pt) score = 3 + pt + threat; else if(pa === pt && (a.unit.card.cost ?? 0) < (t.card.cost ?? 0)) score = 1; }
      else { score = 4 + (1 + Math.floor(pa / 10)) * 3 + (R.gigs.length >= 5 ? 4 : 0); }
      if(bestBlock >= pa) score -= 4; // probabile blocco perdente
      if(score > bestScore){ bestScore = score; best = a; }
    }
    if(best || must.length){ go(best || attacks[0]); return true; }
  }
  // 4) gioca il piano migliore per il denaro disponibile, dalla carta più cara
  const plays = by("play"), plan = bestPlan(G, P, P.hand, ready(P));
  for(const x of plan.set.sort((a, b) => b.cost - a.cost)){
    const opts = plays.filter(a => a.card === x.c);
    if(x.c.card.type === "Gear"){
      // il Gear va sull'Unità che lo sfrutta meglio: pronta per attaccare, poi la più forte
      const g = opts.filter(a => a.targetObj && !a.targetObj.isLegend && P.field.includes(a.targetObj))
        .sort((a, b) => (canAttack(G, P, b.targetObj) ? 10 : 0) + power(b.targetObj) - (canAttack(G, P, a.targetObj) ? 10 : 0) - power(a.targetObj))[0];
      if(g){ go(g); return true; }
      continue;
    }
    if(opts.length){ go(opts[0]); return true; }
  }
  // 5) Go Solo quando il campo è vuoto e c'è denaro
  const solo = by("gosolo"); if(solo.length && P.field.length <= 1 && ready(P) >= (solo[0].legend.card.cost ?? 0) + 1){ go(solo[0]); return true; }
  // 5b) giocata normale (con Lag) solo se il Go Solo è rincarato dal Gear del rivale e costerebbe di più
  const lp = by("legendplay").find(a => goSoloCost(G, P, a.legend) > (a.legend.card.cost ?? 0)); if(lp && P.field.length <= 1 && ready(P) >= (lp.legend.card.cost ?? 0) + 2){ go(lp); return true; }
  // 6) abilità {Spend} interpretabili
  const sp = by("spend").filter(a => a.src.fx.spend.some(o => o.op !== "manual") && !(P.field.includes(a.obj) && canAttack(G, P, a.obj)));
  if(sp.length){ go(sp[0]); return true; }
  if(doAction(G, pi, { t: "end" }) === false){   // un'Unità deve ancora attaccare: lo fa
    const m = legalActions(G, pi).filter(a => a.t === "attack" && a.unit.mustAttack);
    if(m.length){ go(m[0]); return true; }
  }
  return false;
}

/* gioca l'intero turno del bot (con un limite di sicurezza) */
export function botTurn(G, pi){
  let n = 0;
  while(n++ < 60 && botStep(G, pi)){ if(G.pending) break; }
}
