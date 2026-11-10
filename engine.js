/* Motore di regole del Cyberpunk TCG — puro, senza DOM, collaudabile in Node.

   Regole di base applicate per intero: fasi del turno, Eddies e vendita,
   Chiamata delle Leggende, Leggende spese come 1 €$, Go Solo, Lag e
   Adrenaline, attacchi a Unità spese o all'area Gig, Blocker, furto dei Gig
   in base alla potenza, Street Cred, vittoria a 7 Gig, overtime, deck-out.

   Effetti delle carte: tutti interpretati dal testo (parser.js) ed eseguiti
   qui: pesca, ±potenza, trash, Gig ±N, sconfiggi/spendi/bottom-deck, scarti,
   sconti, limiti al furto, effetti «la prossima volta che…», sacrifici e
   difese (Jackie, Alt Cunningham), Chiamate e giocate gratis.             */

export const DICE = [4, 6, 8, 10, 12, 20];
export const MAX_TURNS_BEFORE_OT = 7;

/* ------------------------------------------------------------ utilità */
export function mulberry32(seed){
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (arr, rng) => { for(let i = arr.length - 1; i > 0; i--){ const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const rollDie = (sides, rng) => 1 + Math.floor(rng() * sides);

/* ------------------------------------------------------------ effetti dal testo: vedi parser.js */
import { parseEffects, parseBody } from "./parser.js";
export { parseEffects };

/* ------------------------------------------------------------ creazione partita */
let UID = 1;
/* la stampa deve essere davvero una stampa di quella carta: un mazzo che arriva dalla rete (partite online)
   potrebbe contenere qualsiasi testo, e il pid finisce negli indirizzi delle immagini */
const printOf = (card, pid) => (pid && Array.isArray(card.prints) && card.prints.some(p => p.id === pid)) ? pid : ((card.def && card.def.id) || null);
function inst(card, pid){ return { uid: UID++, cid: card.id, pid: printOf(card, pid), card, fx: parseEffects(card.text) }; }

/* deck: { name, legends:[{cid,pid}], cards:[{cid,pid,n}] }; cards: Map id → carta */
export function createGame(decks, cardsById, opts = {}){
  UID = 1;   // stessi identificativi su ogni dispositivo: le partite online si rigiocano mossa per mossa
  const rng = opts.rng || mulberry32(opts.seed ?? (Date.now() & 0xffffffff));
  const G = { turn: 0, active: 0, first: 0, phase: "setup", log: [], winner: null, reason: "", overtime: false, rng, pending: null, players: [], auto: [!!opts.bot0, !!opts.bot1], autoPay: opts.autoPay || [false, false], events: [] };
  decks.forEach((d, i) => {
    const P = { id: i, name: d.name || `Giocatore ${i + 1}`, deck: [], hand: [], trash: [], eddies: [], legends: [], field: [], fixer: DICE.slice(), gigs: [], sold: false, called: false, turns: 0, removed: [] };
    // copie per voce limitate (un mazzo arrivato dalla rete con n enorme bloccherebbe il telefono), al massimo 3 Leggende
    const cards = Array.isArray(d.cards) ? d.cards.slice(0, 200) : [], legs = Array.isArray(d.legends) ? d.legends.filter(Boolean).slice(0, 3) : [];
    for(const e of cards){ const c = e && cardsById.get(e.cid); if(!c) continue; const n = Math.max(0, Math.min(50, Math.floor(Number(e.n)) || 0)); for(let k = 0; k < n && P.deck.length < 100; k++) P.deck.push(inst(c, Array.isArray(e.prints) && e.prints[k] ? e.prints[k] : e.pid)); }   // Prerelease: una stampa per copia
    for(const l of legs){ const c = cardsById.get(l.cid); if(c) P.legends.push({ ...inst(c, l.pid), faceUp: false, spent: false, gear: [] }); }
    shuffle(P.deck, rng); shuffle(P.legends, rng);
    G.players.push(P);
  });
  // tiro del d20 per chi inizia: il vincitore sceglie, qui inizia sempre lui
  // con opts.first (partite online: lo decide il database) si ritira finché il tiro non dà quel risultato,
  // così il registro resta coerente su entrambi i telefoni
  let a, b, n = 0; do { a = rollDie(20, rng); b = rollDie(20, rng); } while(a === b || (opts.first != null && (a > b ? 0 : 1) !== opts.first && ++n < 200));
  const winner = opts.first != null ? opts.first : (a > b ? 0 : 1);
  for(const P of G.players){ draw(G, P, 6, true); }
  const begin = first => {
    G.first = first; G.active = first;
    // chi inizia spende le 2 Leggende più a sinistra e non le prepara al primo turno
    const F = G.players[first]; F.legends[0].spent = true; F.legends[1].spent = true; F.skipReadyLegends = true;
    G.phase = "mulligan";
  };
  if(opts.pickFirst){
    // partita offline sullo stesso dispositivo: niente tiro, decidono i giocatori chi inizia
    G.phase = "roll";
    say(G, "Partita offline: decidete chi inizia.");
    ask(G, 0, "choice", [{ label: `Inizia ${G.players[0].name}`, v: 0 }, { label: `Inizia ${G.players[1].name}`, v: 1 }], o => { const f = o ? o.v : 0; say(G, `Inizia ${G.players[f].name}.`); begin(f); }, { pickFirst: true });
  } else if(opts.chooseFirst){
    // come dal vivo: chi vince il tiro sceglie se iniziare o far iniziare l'avversario
    G.phase = "roll";
    say(G, `Tiro iniziale: ${G.players[0].name} ${a} – ${G.players[1].name} ${b}. ${G.players[winner].name} vince il tiro e sceglie chi inizia.`);
    ask(G, winner, "choice", [{ label: "Inizio io", v: winner }, { label: `Inizia ${G.players[1 - winner].name}`, v: 1 - winner }], o => { const f = o ? o.v : winner; say(G, `${G.players[winner].name} decide: inizia ${G.players[f].name}.`); begin(f); }, { goFirst: true });
  } else {
    say(G, `Tiro iniziale: ${G.players[0].name} ${a} – ${G.players[1].name} ${b}. Inizia ${G.players[winner].name}.`);
    begin(winner);
  }
  return G;
}
export function mulligan(G, pi, doIt){
  const P = G.players[pi]; if(G.phase !== "mulligan") return false;   // prima si decide chi inizia
  if(doIt){ P.deck.push(...P.hand); P.hand = []; shuffle(P.deck, G.rng); draw(G, P, 6, true); say(G, `${P.name} fa mulligan.`); }
  P.mulliganed = true;
  if(G.players.every(p => p.mulliganed)) startTurn(G);
}

/* ------------------------------------------------------------ fasi */
function say(G, text, kind = "info", d){ G.log.push({ t: G.turn, p: G.active, text, kind, ...(d ? { d } : {}) }); if(G.log.length > 400) G.log.shift(); }
/* regia del tavolo: chi ha causato un effetto e su cosa agisce. Sono solo dati nel registro (riga vuota, kind "fx"):
   la plancia li anima, il motore non li rilegge mai, quindi non cambiano le regole né il rigioco online */
const fxCard = c => ({ uid: c.uid, pid: c.pid, dn: c.card.dn, ty: c.card.type });
function fxEv(G, f, d){ say(G, "", "fx", { f, ...d }); }
export const rival = (G, P) => G.players[1 - P.id];
export const streetCred = P => P.gigs.reduce((a, g) => a + g.value, 0);
export const power = u => Math.max(0, (u.card.power ?? 0) + (u.gear || []).reduce((a, g) => a + (g.card.power ?? 0), 0) + (u.mod || 0));
export const ready = P => P.eddies.filter(e => !e.spent).length + P.legends.filter(l => !l.spent && !l.removed && !l.onField).length;
export const readyEddies = P => P.eddies.filter(e => !e.spent).length;
export const hasKw = (u, k) => (u.card.kw || []).includes(k) || (u.gear || []).some(g => (g.card.kw || []).includes(k));

function draw(G, P, n, silent){
  for(let i = 0; i < n; i++){
    if(!P.deck.length){ if(!silent && G.winner == null){ G.winner = 1 - P.id; G.reason = `${P.name} deve pescare da un mazzo vuoto`; G.phase = "over"; say(G, G.reason, "end"); } return; }
    P.hand.push(P.deck.shift());
  }
  if(!silent) say(G, `${P.name} pesca ${n}.`);
}

function startTurn(G){
  if(G.winner != null) return;
  const P = G.players[G.active];
  G.turn++; P.turns++; G.phase = "start"; P.sold = false; P.playedProgram = false;
  for(const Q of G.players) Q.called = false;   // "una Chiamata per turno" vale anche come reazione nel turno altrui
  say(G, `— Turno ${G.turn}: ${P.name} (${P.turns}º) —`, "turn");
  // vittoria a 7 Gig / overtime
  if(P.gigs.length >= 7){ win(G, P.id, `${P.name} inizia il turno con ${P.gigs.length} Gig`); return; }

  // 1) prepara
  for(const e of P.eddies) e.spent = false;
  if(P.skipReadyLegends){ P.skipReadyLegends = false; } else for(const l of P.legends) l.spent = false;
  for(const u of P.field){ if(u.cantReady){ u.cantReady = false; } else u.spent = false; u.lag = false; u.mod = 0; u.lagRival = false; u.stoleThisTurn = false; u.kwBlockerThisTurn = false; u.onlyUnitsThisTurn = false; u.onlyGigsThisTurn = false; u.attackReady = false; u.fightBuffPerLegend = 0; u.stealLess = 0; u.doomIfActs = false; u.doomed = false; if(u.lockAttackBy === P.id) u.lockAttackBy = null; }
  for(const u of rival(G, P).field){ u.mod = 0; if(u.lockAttackBy === P.id) u.lockAttackBy = null; u.kwBlockerThisTurn = false; u.fightBuffPerLegend = 0; u.stealLess = 0; u.doomIfActs = false; u.doomed = false; }
  P.stealLess = 0; P.programDiscountMin = null; P.goSoloDiscount = null; P.stealLimit = null; P.playedGearCls = {};
  for(const Q of G.players){ Q.winBySteal = null; Q.noDefeatNextFight = null; Q.punishNextLoss = null; }   // effetti "questo turno"
  // 2) pesca
  draw(G, P, 1); if(G.winner != null) return;
  // 3) Gig: scelta del dado (il d20 sempre per ultimo)
  const choices = P.fixer.filter(s => s !== 20).length ? P.fixer.filter(s => s !== 20) : P.fixer.slice();
  if(!choices.length){ G.phase = "main"; return; }
  ask(G, P.id, "die", choices.map(s => ({ label: `d${s}`, sides: s })), ch => {
    const s = ch.sides; P.fixer.splice(P.fixer.indexOf(s), 1);
    const v = rollDie(s, G.rng); P.gigs.push({ sides: s, value: v, uid: UID++ });
    say(G, `${P.name} tira un d${s} dal fixer: ${v}.`, "gig");
    G.phase = "main";
    const g = P.gigs[P.gigs.length - 1];
    // "When you roll in a Gig…" (Kerry: puoi ritirare una volta), poi gli effetti su min/max e quelli di inizio turno
    fireEvent(G, P, "rollIn", { gig: g }, () => {
      if(g.value === 1 || g.value === s) fireEvent(G, P, "roll", { gig: g }, () => fireEvent(G, P, "startTurn", {}));
      else fireEvent(G, P, "startTurn", {});
    });
  });
}
function win(G, pi, reason){ G.winner = pi; G.reason = reason; G.phase = "over"; say(G, reason, "end"); }

/* "A rival Unit must attack next turn if it can": l'Unità che deve ancora attaccare, se ne ha la possibilità */
export function mustAttackPending(G, P){
  const R = rival(G, P);
  return P.field.find(u => u.mustAttack && canAttack(G, P, u) && ((R.gigs.length && !u.fx.onlyUnits && !u.onlyUnitsThisTurn && (power(u) >= 1 || u.fx.attack.length)) || R.field.some(t => t.spent))) || null;
}
export function endTurn(G){
  if(G.winner != null || G.pending) return false;
  const P = G.players[G.active];
  const must = mustAttackPending(G, P); if(must) return err(G, `${must.card.dn} deve attaccare in questo turno`);
  G.phase = "end";
  // effetti "alla fine del tuo turno", poi le Unità condannate (Cyberpsychosis)
  fireEvent(G, P, "endTurn", {}, () => doomStep(G, () => { if(G.pending){ G.pendingEnd = true; return; } finishEnd(G); }));
  if(G.pending){ G.pendingEnd = true; return true; }
  return true;
}
function doomStep(G, done){
  const d = [];
  for(const Q of G.players) for(const u of Q.field) if(u.doomed) d.push([Q, u]);
  const run = i => { if(i >= d.length){ done(); return; } const [Q, u] = d[i]; if(!Q.field.includes(u)){ run(i + 1); return; } say(G, `${u.card.dn} viene sconfitta a fine turno (Cyberpsychosis).`, "fight"); defeat(G, Q, u, () => run(i + 1)); };
  run(0);
}
function finishEnd(G){
  const P = G.players[G.active];
  for(const u of P.field){ u.mod = 0; u.lag = false; u.lagRival = false; u.mustAttack = false; }   // il Lag dura fino alla fine del turno
  P.goSoloDiscount = null;
  // overtime: dopo il 7º turno dell'ultimo giocatore
  if(!G.overtime && G.players.every(p => p.turns >= MAX_TURNS_BEFORE_OT) && G.active !== G.first){ G.overtime = true; say(G, "Overtime! Morte improvvisa: vince subito chi arriva a 7 Gig (la maggioranza dei dadi).", "turn"); if(checkMajority(G)) return; }
  G.active = 1 - G.active;
  startTurn(G);
}

/* ------------------------------------------------------------ decisioni */
/* ask: se il giocatore è un bot, decide subito con `G.decide`; altrimenti
   la richiesta resta in G.pending finché l'interfaccia chiama resolve(). */
function ask(G, pi, kind, options, cb, ctx = {}){
  if(!options.length){ cb(null); return; }
  if(options.length === 1 && kind !== "block" && kind !== "yesno"){ cb(options[0]); return; }
  if(G.auto[pi] && G.decide){ const o = G.decide(G, pi, kind, options, ctx); cb(o === undefined ? options[0] : o); return; }
  G.pending = { player: pi, kind, options, ctx, cb };
}
export function resolve(G, index){
  const p = G.pending; if(!p) return false;
  G.pending = null;
  const o = index == null || index < 0 ? null : p.options[index];
  p.cb(o);
  return true;
}

/* ------------------------------------------------------------ pagamento */
/* pagamento automatico: Eddies pronti, poi Leggende coperte, poi scoperte senza
   abilità {Spend}, infine quelle con un'abilità (che varrebbe la pena tenere) */
function pay(G, P, cost){
  let left = cost;
  for(const e of P.eddies){ if(left && !e.spent){ e.spent = true; left--; } }
  const legs = P.legends.filter(l => !l.spent && !l.removed && !l.onField);
  for(const l of legs.filter(l => !l.faceUp)){ if(left){ l.spent = true; left--; } }
  for(const l of legs.filter(l => l.faceUp && !keepReady(l))){ if(left){ l.spent = true; left--; } }
  for(const l of legs.filter(l => keepReady(l))){ if(left){ l.spent = true; left--; } }
  return left === 0;
}
/* Leggende che conviene non spendere per pagare: hanno un'abilità {Spend}, oppure (loro o un Gear
   equipaggiato, es. Zetatech Faceplate) un effetto «quando questa Leggenda è spesa» */
const spentText = x => x.fx.spend.length || (x.fx.on.hostSpent || []).length || (x.fx.on.firstSpent || []).length;
export const keepReady = l => l.faceUp && (spentText(l) || (l.gear || []).some(g => spentText(g)));
export const canPay = (P, cost) => ready(P) >= cost;
const legendLabel = (P, l) => l.faceUp ? `Leggenda ${l.card.dn}${l.fx.spend.length ? " (ha un'abilità Spend)" : keepReady(l) ? " (ha un effetto quando è spesa)" : ""}` : `Leggenda coperta ${P.legends.indexOf(l) + 1}`;
/* pagamento con scelta del giocatore. Bot e giocatori con il pagamento automatico
   pagano da soli; a loro viene chiesto solo quando toccherebbe spendere una
   Leggenda scoperta con un'abilità {Spend} ancora utilizzabile.
   cb() quando il pagamento è completo; onCancel() se il giocatore rinuncia. */
function payAsk(G, P, cost, cb0, onCancel){
  if(cost <= 0){ cb0(); return; }
  // le Leggende spese per pagare sono «spese» a tutti gli effetti: scattano i loro Gear (Zetatech Faceplate,
  // Tetratronic Rippler…) e gli effetti «quando una Leggenda è spesa», dopo il pagamento e prima dell'azione
  const readyBefore = P.legends.filter(l => !l.spent);
  const cb = () => spentChain(G, P, readyBefore.filter(l => l.spent && l.faceUp && !l.removed && !l.onField), cb0);
  if(!canPay(P, cost)){ onCancel && onCancel(); return; }
  const legs = () => P.legends.filter(l => !l.spent && !l.removed && !l.onField);
  const autoPay = G.auto[P.id] || (G.autoPay && G.autoPay[P.id]);
  if(autoPay){
    const needLeg = Math.max(0, cost - readyEddies(P));
    const abilityLegs = legs().filter(keepReady);
    const freeLegs = legs().length - abilityLegs.length;
    if(G.auto[P.id] || needLeg === 0 || needLeg <= freeLegs){ pay(G, P, cost); cb(); return; }
    // deve spendere almeno una Leggenda con abilità: chiede quali (gli Eddies e le altre vanno da sé)
    const picked = [];
    const mustAll = needLeg - freeLegs >= abilityLegs.length;
    if(mustAll){   // vanno spese tutte: una sola conferma
      ask(G, P.id, "pay", [{ label: `Sì, spendi ${abilityLegs.map(l => l.card.dn).join(" e ")}`, l: abilityLegs }, { label: "Annulla", l: null }], o => {
        if(o && o.l){ pay(G, P, cost); cb(); } else onCancel && onCancel();
      }, { cost, paid: 0, need: cost, confirm: true, all: true });
      return;
    }
    const pickLeg = () => {
      const stillNeed = needLeg - freeLegs - picked.length;
      if(stillNeed <= 0){ for(const e of P.eddies) if(!e.spent) e.spent = true; for(const l of legs().filter(l => !keepReady(l))) l.spent = true; for(const l of picked) l.spent = true; cb(); return; }
      const opts = abilityLegs.filter(l => !picked.includes(l)).map(l => ({ label: `Spendi ${legendLabel(P, l)}`, l }));
      ask(G, P.id, "pay", [...opts, { label: "Annulla", l: null }], o => { if(o && o.l){ picked.push(o.l); pickLeg(); } else onCancel && onCancel(); }, { cost, paid: cost - stillNeed, need: stillNeed, confirm: true });
    };
    pickLeg(); return;
  }
  // se il costo prende tutte le risorse disponibili non c'è nulla da scegliere
  if(ready(P) === cost){ pay(G, P, cost); cb(); return; }
  // scelta manuale, una fonte alla volta (con la scorciatoia "tutto con Eddies")
  const spent = [];
  const step = () => {
    const paid = spent.length, left = cost - paid;
    if(left <= 0){ cb(); return; }
    const eddies = P.eddies.filter(e => !e.spent), opts = [];
    if(eddies.length >= left && left > 1) opts.push({ label: `Paga tutto con ${left} Eddies`, kind: "alleddies" });
    if(eddies.length) opts.push({ label: `1 Eddie (${eddies.length} pronti)`, kind: "eddie" });
    for(const l of legs()) opts.push({ label: `Spendi ${legendLabel(P, l)}`, kind: "legend", l });
    opts.push({ label: "Annulla", kind: "cancel" });
    ask(G, P.id, "pay", opts, o => {
      if(!o || o.kind === "cancel"){ for(const x of spent) x.spent = false; onCancel && onCancel(); return; }
      if(o.kind === "alleddies"){ for(const e of eddies.slice(0, left)){ e.spent = true; spent.push(e); } step(); return; }
      if(o.kind === "eddie"){ eddies[0].spent = true; spent.push(eddies[0]); step(); return; }
      o.l.spent = true; spent.push(o.l); step();
    }, { cost, paid, need: left });
  };
  step();
}

/* ------------------------------------------------------------ azioni */
export function sell(G, pi, uid){
  const P = G.players[pi]; if(G.active !== pi || G.phase !== "main" || G.pending || P.sold) return err(G, "Puoi vendere una sola carta per turno");
  const i = P.hand.findIndex(c => c.uid === uid); if(i < 0) return err(G, "Carta non in mano");
  const c = P.hand[i]; if(!c.card.eddiable) return err(G, `${c.card.dn} non ha il simbolo di vendita`);
  P.hand.splice(i, 1); P.eddies.push({ ...c, spent: false }); P.sold = true;
  say(G, `${P.name} vende ${c.card.dn} (ora ${P.eddies.length} €$).`, "eddie");
  return true;
}
function err(G, m){ G.lastError = m; return false; }

/* costo della Chiamata: 1 €$, gratis nel proprio turno con Panam Palmer (Strength Through Family) in campo */
export function callCost(G, P){ return G.active === P.id && P.field.some(u => u.fx.freeCallAnytime) ? 0 : 1; }
export function callLegend(G, pi, idx, done){
  const P = G.players[pi]; if(G.pending || P.called) return err(G, "Hai già chiamato una Leggenda in questo turno");
  const faceDown = P.legends.filter(l => !l.faceUp && !l.removed);
  if(!faceDown.length) return err(G, "Nessuna Leggenda coperta");
  const cc = callCost(G, P);
  if(!canPay(P, cc)) return err(G, "Serve 1 €$");
  // non puoi guardarle prima: la scelta è di fatto casuale
  const l = idx != null && P.legends[idx] && !P.legends[idx].faceUp ? P.legends[idx] : faceDown[Math.floor(G.rng() * faceDown.length)];
  payAsk(G, P, cc, () => {
    if(l.spent && !l.faceUp){ /* ha pagato spendendo proprio questa Leggenda coperta: vale lo stesso */ }
    l.faceUp = true; P.called = true;
    say(G, `${P.name} chiama ${l.card.dn}!`, "call");
    runEffects(G, P, l, l.fx.call, "Call", done);
  }, done);
  return true;
}

export function goSolo(G, pi, idx){
  const P = G.players[pi]; if(G.active !== pi || G.phase !== "main" || G.pending) return false;
  const l = P.legends[idx]; if(!l || l.removed || l.onField) return err(G, "Leggenda non disponibile");
  if(!l.faceUp) return err(G, "Go Solo solo con una Leggenda scoperta");
  if(!(l.card.kw || []).includes("Go Solo") || l.card.cost == null) return err(G, `${l.card.dn} non ha Go Solo`);
  const total = goSoloCost(G, P, l);
  if(!canPay(P, total)) return err(G, `Servono ${total} €$`);
  // la Leggenda può spendere sé stessa come 1 €$ del proprio costo: entra comunque come Unità pronta
  payAsk(G, P, total, () => {
    if(P.goSoloDiscount) P.goSoloDiscount = null;
    l.onField = true; l.spent = false;
    const u = { ...l, spent: false, lag: false, mod: 0, isLegend: true, legendRef: l }; delete u.onField;
    P.field.push(u);
    say(G, `${P.name} manda ${l.card.dn} in Go Solo (${power(u)} potenza).`, "play");
    runEffects(G, P, u, u.fx.play, "Play");
  });
  return true;
}

/* giocata normale di una Leggenda (regole 4.5 e 5.7.5): paghi il costo stampato (niente sconto di Nocturne né
   sovrapprezzo sul Go Solo) ed entra come Unità con il Lag, nello stesso orientamento che aveva nell'area Leggende:
   se si è spesa da sola per pagare, entra spesa. Se lascia il campo esce dal gioco (4.4.1). */
export function legendPlay(G, pi, idx){
  const P = G.players[pi]; if(G.active !== pi || G.phase !== "main" || G.pending) return false;
  const l = P.legends[idx]; if(!l || l.removed || l.onField) return err(G, "Leggenda non disponibile");
  if(!l.faceUp) return err(G, "Si gioca in campo solo una Leggenda scoperta");
  if(l.card.cost == null) return err(G, `${l.card.dn} non ha un costo: non può entrare in campo`);
  const total = l.card.cost;
  if(!canPay(P, total)) return err(G, `Servono ${total} €$`);
  // se bastano le altre risorse, la Leggenda non paga sé stessa (entrerebbe spesa): la si tiene fuori dal pagamento
  const keep = !l.spent && ready(P) - 1 >= total; if(keep) l.onField = true;
  payAsk(G, P, total, () => {
    const spent = !!l.spent;
    l.onField = true; l.spent = false;
    const u = { ...l, spent, lag: true, mod: 0, isLegend: true, legendRef: l }; delete u.onField;
    P.field.push(u);
    say(G, `${P.name} gioca ${l.card.dn} come Unità (${power(u)} potenza, con Lag${spent ? ", spesa" : ""}).`, "play");
    runEffects(G, P, u, u.fx.play, "Play");
  }, () => { if(keep) l.onField = false; });
  return true;
}

/* costo del Go Solo: sconto di Nocturne, sovrapprezzo di Rival Gear */
export function goSoloCost(G, P, l){
  let cost = l.card.cost ?? 0;
  if(P.goSoloDiscount) cost = Math.max(P.goSoloDiscount.min, cost - P.goSoloDiscount.n);
  const extra = Math.max(0, ...rival(G, P).field.flatMap(u => (u.gear || []).map(g => g.fx.goSoloTax || 0)), 0);
  return cost + extra;
}
export function play(G, pi, uid, targetUid){
  const P = G.players[pi]; if(G.active !== pi || G.phase !== "main" || G.pending) return err(G, "Non è il momento");
  const i = P.hand.findIndex(c => c.uid === uid); if(i < 0) return err(G, "Carta non in mano");
  const c = P.hand[i], card = c.card;
  let cost = costOf(G, P, c);
  if(card.type === "Gear"){
    const t = [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)].find(x => x.uid === targetUid);
    if(!t) return err(G, "Scegli un'Unità o una Leggenda scoperta a cui equipaggiare");
    if(!canPay(P, cost)) return err(G, `Servono ${cost} €$`);
    payAsk(G, P, cost, () => {
      P.hand.splice(P.hand.indexOf(c), 1);
      t.gear = t.gear || []; t.gear.push(c);
      P.playedGearCls = P.playedGearCls || {}; for(const k of card.cls || []) P.playedGearCls[k.toUpperCase()] = true;
      say(G, `${P.name} equipaggia ${card.dn} a ${t.card.dn}.`, "play");
      runEffects(G, P, t, c.fx.play, "Play", null, { srcCard: c });
    });
    return true;
  }
  if(!canPay(P, cost)) return err(G, `Servono ${cost} €$ (ne hai ${ready(P)})`);
  payAsk(G, P, cost, () => { P.hand.splice(P.hand.indexOf(c), 1); putInPlay(G, P, c); });
  return true;
}
function putInPlay(G, P, c, how = "", done, o = {}){
  const card = c.card, R = rival(G, P);
  if(card.type === "Unit"){
    const adrenaline = hasKw(c, "Adrenaline") || (c.fx.adrenalineIf && testCond(G, P, c, c.fx.adrenalineIf));
    const u = { ...c, spent: false, lag: !adrenaline, mod: 0, gear: [], lagRival: true };
    if(o.noLagUnits || u.fx.noLagUnits){ u.lag = false; u.onlyUnitsThisTurn = true; }   // «può attaccare Unità rivali nel turno in cui è giocata»
    if(u.fx.noLagGigsIf && testCond(G, P, u, u.fx.noLagGigsIf)){ u.lag = false; u.onlyGigsThisTurn = true; }
    P.field.push(u);
    say(G, `${P.name} gioca ${card.dn} (${power(u)})${how ? " " + how : ""}.`, "play");
    const isBlue = card.color === "Blue";
    runEffects(G, P, u, u.fx.play, "Play", () => { if(isBlue) fireEvent(G, P, "playBlue", { unit: u }, done); else done && done(); });
  } else { // Program
    say(G, `${P.name} usa ${card.dn}${how ? " " + how : ""}.`, "play"); P.playedProgram = true; P.programDiscountMin = null;
    if(c.fx.quickBuffPerLegend){ /* "A friendly Unit has +1 power for each friendly face-up Legend while fighting rival Units this turn" */
      ask(G, P.id, "target", P.field.map(u => ({ label: `${u.card.dn} (${power(u)})`, unit: u })), o2 => { if(o2){ o2.unit.fightBuffPerLegend = c.fx.quickBuffPerLegend; say(G, `${o2.unit.card.dn} combatte con +${c.fx.quickBuffPerLegend} per ogni Leggenda scoperta.`); } P.trash.push(c); done && done(); });
      return;
    }
    const ops = [...c.fx.play, ...(c.fx.passiveAll || c.fx.passive)].filter((x, k, arr) => arr.findIndex(y => y.text === x.text && y.op === x.op) === k);
    runEffects(G, P, c, ops, "Program", () => { if(!P.trash.includes(c)) P.trash.push(c); fireEvent(G, P, "playProgram", { card: c }, done); });
  }
}

/* la carta che porta l'abilità {Spend}: l'Unità/Leggenda stessa o un Gear equipaggiato (Overwatch) */
export const spendSrc = x => x.fx.spend.length ? x : (x.gear || []).find(g => g.fx.spend.length) || null;
export const hasSpend = x => !!spendSrc(x);
/* costo in €$ di un'abilità {Spend} (Johnny: "costs -1 €$ for each friendly Gig with 8+ value") */
export function spendCost(G, P, x){
  const s = spendSrc(x) || x;
  let c = +((s.card.text.match(/(\d+)\s*€\$,\s*\{Spend\}/) || [])[1] || 0);
  if(s.fx.spendCostReduce) c = Math.max(0, c - s.fx.spendCostReduce.n * count(G, P, x, s.fx.spendCostReduce.per));
  return c;
}
/* abilità {Spend} di Unità sul campo o Leggende scoperte */
export function spendAbility(G, pi, uid, done, reaction = false){
  const P = G.players[pi]; if(G.pending || (!reaction && (G.active !== pi || G.phase !== "main"))) return false;
  const x = P.field.find(u => u.uid === uid) || P.legends.find(l => l.uid === uid && l.faceUp && !l.removed && !l.onField);
  if(!x) return err(G, "Carta non trovata");
  if(x.spent || x.lag) return err(G, "Già spesa o con Lag");
  const s = spendSrc(x); if(!s) return err(G, "Nessuna abilità {Spend}");
  const costM = spendCost(G, P, x);
  const selfIsResource = P.legends.includes(x) ? 1 : 0;   // una Leggenda che si spende per l'abilità non può anche pagare
  if(costM && ready(P) - selfIsResource < costM) return err(G, `Servono ${costM} €$ oltre alla carta stessa`);
  x.spent = true;
  payAsk(G, P, costM, () => {
    say(G, `${P.name} spende ${x.card.dn} per l'abilità.`, "play");
    runEffects(G, P, x, s.fx.spend, "Spend", () => onSpent(G, P, x, done), { holder: x, srcName: s.card.dn, srcCard: s });
  }, () => { x.spent = false; done && done(); });
  return true;
}
/* Programma con {Quick} giocato come reazione nel turno del rivale */
export function playQuick(G, pi, uid, done){
  const P = G.players[pi]; const i = P.hand.findIndex(c => c.uid === uid); if(i < 0) return false;
  const c = P.hand[i]; if(!c.fx.quick || c.card.type !== "Program" || !canPay(P, costOf(G, P, c))) return false;
  payAsk(G, P, costOf(G, P, c), () => { P.hand.splice(P.hand.indexOf(c), 1); putInPlay(G, P, c, "come reazione", done); }, done);
  return true;
}

/* ------------------------------------------------------------ attacco */
export function canAttack(G, P, u){
  if(u.spent || u.lag) return false;
  if(u.fx.cantAttack) return false;
  if(u.fx.needsProgram && !P.playedProgram) return false;
  if(u.lockAttackBy != null) return false;                       // "non può attaccare fino al mio prossimo turno"
  if(u.lagRival && rival(G, P).field.some(x => x.fx.auraRivalLag)) return false;   // MaxTac Suppression Team
  return true;
}
/* potenza in combattimento: tiene conto di aure e bonus situazionali */
export function powerIn(G, P, u, ctx = {}){
  let p = power(u);
  if(ctx.attacking){
    for(const a of P.field) if(a !== u && a.fx.auraAttack && a.fx.auraAttack.others) p += a.fx.auraAttack.n;
    for(const a of [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)]) if(a.fx.auraAttack && a.fx.auraAttack.cls && (u.card.cls || []).some(k => k.toUpperCase() === a.fx.auraAttack.cls)) p += a.fx.auraAttack.n;
  }
  if(ctx.vsLegend && u.fx.powerVsLegend) p += u.fx.powerVsLegend;
  if((u.isLegend || P.legends.includes(u)) && u.fx.powerPerGear && G.active === P.id) p += u.fx.powerPerGear * (u.gear || []).length;   // Royce: anche in Go Solo
  if(ctx.fightingUnit && u.fightBuffPerLegend) p += u.fightBuffPerLegend * P.legends.filter(l => l.faceUp && !l.removed).length;
  return p;
}
export function attack(G, pi, uid, target){
  const P = G.players[pi], R = rival(G, P);
  if(G.active !== pi || G.phase !== "main" || G.pending) return err(G, "Non è il momento");
  const u = P.field.find(x => x.uid === uid); if(!u) return err(G, "Unità non trovata");
  if(!canAttack(G, P, u)) return err(G, `${u.card.dn} non può attaccare`);
  let tu = null;
  if(target.kind === "unit"){
    if(u.onlyGigsThisTurn) return err(G, `${u.card.dn} in questo turno può attaccare solo l'area Gig`);
    tu = R.field.find(x => x.uid === target.uid); if(!tu) return err(G, "Bersaglio non trovato");
    const readyOk = (hasKw(tu, "Blocker") && u.fx.attackReadyBlockersIf && testCond(G, P, u, u.fx.attackReadyBlockersIf)) || u.attackReady;
    if(!tu.spent && !readyOk) return err(G, "Puoi attaccare solo Unità spese");
  } else {
    if(u.fx.onlyUnits || u.onlyUnitsThisTurn) return err(G, `${u.card.dn} può attaccare solo Unità`);
    if(!R.gigs.length) return err(G, "Il rivale non ha Gig");
  }
  u.spent = true; u.attackReady = false; u.mustAttack = false; G.attacker = u;
  say(G, `${P.name}: ${u.card.dn} (${powerIn(G, P, u, { attacking: true })}) attacca ${tu ? tu.card.dn + " (" + power(tu) + ")" : "l'area Gig"}.`, "attack", { a: u.uid, t: tu ? tu.uid : null, pa: powerIn(G, P, u, { attacking: true }), pd: tu ? power(tu) : null, who: pi });
  // finestra di reazione del difensore: Chiamata, Quick, Blocker
  const proceed = blocker => {
    if(G.winner != null) return;
    if(blocker){
      blocker.spent = true;
      say(G, `${R.name}: ${blocker.card.dn} blocca (${power(blocker)}).`, "attack", { block: blocker.uid, a: u.uid, pb: power(blocker) });
      onSpent(G, R, blocker, () => fireEvent(G, R, "block", { unit: blocker }, () => fireEvent(G, R, "friendlyBlock", { unit: blocker }, () => fight(G, P, u, R, blocker, true))));
      return;
    }
    if(!P.field.includes(u)){ say(G, `${u.card.dn} non è più in campo: l'attacco si annulla.`); return; }
    if(tu && !R.field.includes(tu)){ say(G, `${tu.card.dn} non è più in campo: l'attacco si annulla.`); return; }
    if(tu) fight(G, P, u, R, tu, false); else steal(G, P, u, R);
  };
  // prima gli effetti {Attack} dell'Unità e dei suoi Gear, poi la finestra di reazione
  const atk = [...u.fx.attack, ...(u.gear || []).flatMap(g => g.fx.attack)];
  runEffects(G, P, u, atk, "Attack", () => onSpent(G, P, u, () => fireEvent(G, P, "friendlyAttack", { unit: u }, () => reactionWindow(G, R, u, tu, proceed))));
  return true;
}
function reactionWindow(G, R, au, tu, proceed){
  const opts = [{ label: "Non reagire", kind: "none", uid: null }];
  const unblockable = au.fx.unblockableIf && testCond(G, G.players[1 - R.id], au, au.fx.unblockableIf);
  if(!unblockable) for(const b of R.field) if(!b.spent && !b.lag && (hasKw(b, "Blocker") || b.kwBlockerThisTurn) && b !== tu) opts.push({ label: `Blocca con ${b.card.dn} (${power(b)})`, kind: "block", uid: b.uid, unit: b });
  if(!R.called && canPay(R, 1)) R.legends.forEach((l, i) => { if(!l.faceUp && !l.removed) opts.push({ label: `Chiama la Leggenda ${i + 1} (1 €$)`, kind: "call", idx: i }); });
  for(const c of R.hand){ const qc = costOf(G, R, c); if(c.fx.quick && c.card.type === "Program" && canPay(R, qc)) opts.push({ label: `Quick: ${c.card.dn} (${qc} €$)`, kind: "quick", uid: c.uid, c }); }
  for(const x of [...R.field, ...R.legends.filter(l => l.faceUp && !l.removed && !l.onField)]) if(spendSrc(x) && spendSrc(x).fx.quick && !x.spent && !x.lag && ready(R) - (R.legends.includes(x) ? 1 : 0) >= spendCost(G, R, x)) opts.push({ label: `Quick: abilità di ${spendSrc(x).card.dn}`, kind: "qspend", uid: x.uid });
  if(opts.length === 1){ proceed(null); return; }
  ask(G, R.id, "block", opts, o => {
    if(!o || o.kind === "none"){ proceed(null); return; }
    if(o.kind === "block"){ proceed(o.unit); return; }
    const again = () => reactionWindow(G, R, au, tu, proceed);
    if(o.kind === "call"){ if(!callLegend(G, R.id, o.idx, again)) again(); return; }
    if(o.kind === "quick"){ if(!playQuick(G, R.id, o.uid, again)) again(); return; }
    if(o.kind === "qspend"){ if(!spendAbility(G, R.id, o.uid, again, true)) again(); return; }
    proceed(null);
  }, { attacker: au, target: tu });
}
function fight(G, A, au, D, du, blocked){
  let pa = powerIn(G, A, au, { attacking: true, vsLegend: !!du.isLegend, fightingUnit: true }), pd = powerIn(G, D, du, { vsLegend: !!au.isLegend, fightingUnit: true });
  const cls = u => (u.card.cls || []).map(k => k.toUpperCase());
  let aWins = pa > pd, dWins = pd > pa;
  if(au.fx.winsVs && cls(du).includes(au.fx.winsVs)){ aWins = true; dWins = false; }
  if(du.fx.winsVs && cls(au).includes(du.fx.winsVs)){ dWins = true; aWins = false; }
  if(au.cantBeDefeatedInFight){ dWins = false; }
  if(du.cantBeDefeatedInFight){ aWins = false; }
  // Reboot Optics: "la prossima volta che un'Unità rivale combatte, non sconfigge l'Unità amica opposta"
  if(D.noDefeatNextFight){ D.noDefeatNextFight = null; if(aWins){ aWins = false; say(G, `${du.card.dn} non viene sconfitta (Reboot Optics).`); } }
  if(A.noDefeatNextFight){ A.noDefeatNextFight = null; if(dWins){ dWins = false; say(G, `${au.card.dn} non viene sconfitta (Reboot Optics).`); } }
  for(const u of [au, du]) if(u.doomIfActs) u.doomed = true;   // Cyberpsychosis
  const after = () => { if(blocked) say(G, "Attacco deviato: nessun Gig rubato.", "fight"); };
  // Appetite for Destruction: vince per 3+ → ruba anche un Gig; Safety Override: perde → sconfitta anche l'avversaria
  const bonus = (W, wu, L, lu, margin, cb) => {
    const step2 = () => { if(W.winBySteal && margin >= W.winBySteal && L.gigs.length){ W.winBySteal = null; say(G, `${wu.card.dn} vince di ${margin}: ruba anche un Gig (Appetite for Destruction).`, "steal"); stealOne(G, W, wu, L, cb); } else cb(); };
    if(L.punishNextLoss && W.field.includes(wu)){ L.punishNextLoss = null; say(G, `${wu.card.dn} viene sconfitta a sua volta (Safety Override).`, "fight"); defeat(G, W, wu, step2); } else step2();
  };
  if(aWins && !dWins){ say(G, `${au.card.dn} vince ${pa}–${pd}: ${du.card.dn} sconfitta.`, "fight"); defeat(G, D, du, () => fireEvent(G, D, "loseFight", { unit: du, opponent: au }, () => fireEvent(G, A, "winFight", { unit: au, opponent: du, margin: pa - pd }, () => fireEvent(G, A, "firstWin", { unit: au, opponent: du }, () => bonus(A, au, D, du, pa - pd, after))))); }
  else if(dWins && !aWins){ say(G, `${du.card.dn} vince ${pd}–${pa}: ${au.card.dn} sconfitta.`, "fight"); defeat(G, A, au, () => fireEvent(G, A, "loseFight", { unit: au, opponent: du }, () => fireEvent(G, D, "winFight", { unit: du, opponent: au, margin: pd - pa }, () => fireEvent(G, D, "firstWin", { unit: du, opponent: au }, () => bonus(D, du, A, au, pd - pa, after))))); }   // «la prima volta che vince uno scontro ogni turno» (Johnny Silverhand), anche in difesa
  else if(!aWins && !dWins && pa === pd && pa === 0){ say(G, `Pareggio 0–0: nessuna delle due viene sconfitta.`, "fight"); after(); }   // con potenza 0 non si sconfigge nessuno
  else if(!aWins && !dWins && pa === pd){ say(G, `Pareggio ${pa}–${pd}: entrambe sconfitte.`, "fight"); defeat(G, D, du, () => defeat(G, A, au, after)); }
  else { say(G, `Nessuna delle due viene sconfitta (${pa}–${pd}).`, "fight"); after(); }
}
/* ruba un singolo Gig (scelto da A) con gli eventi del caso */
function stealOne(G, A, au, D, done){
  const pool = stealable(G, D, au, D.gigs);
  if(!pool.length){ say(G, `Nessun Gig rubabile.`); done && done(); return; }
  ask(G, A.id, "steal", pool.map(g => ({ label: `d${g.sides} = ${g.value}`, gig: g })), o => {
    const g = o.gig; D.gigs.splice(D.gigs.indexOf(g), 1); A.gigs.push(g); au.stoleThisTurn = true; if(au.doomIfActs) au.doomed = true;
    say(G, `${A.name} ruba un d${g.sides} (${g.value}) — ${A.gigs.length} Gig.`, "steal");
    if(checkMajority(G)) return;
    fireEvent(G, A, "steal", { unit: au, gig: g }, () => fireEvent(G, A, "friendlySteal", { unit: au, gig: g }, () => { if(au.isLegend) fireEvent(G, A, "legendSteal", { unit: au, gig: g }, done); else done && done(); }));
  });
}
/* Gig rubabili da un'Unità: Chrome Fang / Westbrook Netrunner limitano in base al valore */
function stealable(G, D, au, gigs){
  const lim = D.stealLimit; if(!lim) return gigs;
  const pw = powerIn(G, rival(G, D), au, { attacking: true });
  if(lim.units && !au.isLegend) gigs = gigs.filter(g => !(g.value > pw));
  if(lim.legends && au.isLegend) gigs = gigs.filter(g => !(g.value < pw));
  return gigs;
}
function steal(G, A, au, D, extra = 0){
  const pw = powerIn(G, A, au, { attacking: true });
  const base = pw < 1 ? 0 : 1 + Math.floor(pw / 10);
  const n = Math.min(D.gigs.length, Math.max(0, base - (D.stealLess || 0) - (au.stealLess || 0)) + extra);
  if(!n){ say(G, `${au.card.dn} arriva all'area Gig ma con potenza ${pw} non ruba nulla.`, "steal"); return; }
  const stolen = [];
  const pickOne = k => {
    if(k >= n || !D.gigs.length){ done(); return; }
    const pool = stealable(G, D, au, D.gigs);
    if(!pool.length){ say(G, `${au.card.dn} non può rubare nessuno dei Gig di ${D.name} (limite di valore).`, "steal"); done(); return; }
    ask(G, A.id, "steal", pool.map(g => ({ label: `d${g.sides} = ${g.value}`, gig: g })), o => {
      const g = o.gig;
      const take = () => {
        D.gigs.splice(D.gigs.indexOf(g), 1); A.gigs.push(g); stolen.push(g);
        say(G, `${A.name} ruba un d${g.sides} (${g.value}) — ${A.gigs.length} Gig.`, "steal");
        if(checkMajority(G)) return;
        pickOne(k + 1);
      };
      // Alt Cunningham: il difensore può scartare una carta con costo pari al valore del Gig per impedire il furto
      const guard = D.field.some(u => u.fx.preventStealDiscard), cards = D.hand.filter(c => (c.card.cost ?? -1) === g.value);
      if(guard && cards.length){
        ask(G, D.id, "discard", [...cards.map(c => ({ label: `Scarta ${c.card.dn} (${c.card.cost} €$): il Gig non viene rubato`, c })), { label: "Lascia rubare il Gig", c: null }], o2 => {
          if(o2 && o2.c){ D.hand.splice(D.hand.indexOf(o2.c), 1); D.trash.push(o2.c); say(G, `${D.name} scarta ${o2.c.card.dn}: il d${g.sides} (${g.value}) non viene rubato (Alt Cunningham).`, "steal"); pickOne(k + 1); } else take();
        }, { src: "Alt Cunningham", text: "When a rival Unit would steal a Gig, you may discard 1 with cost equal to that Gig's value. If you do, the Gig isn't stolen." });
      } else take();
    });
  };
  const done = () => {
    if(!stolen.length) return;
    au.stoleThisTurn = true; if(au.doomIfActs) au.doomed = true;
    // eventi: dell'Unità che ruba, delle Unità amiche, delle Leggende
    const chain = [];
    for(const g of stolen){ chain.push(cb => fireEvent(G, A, "steal", { unit: au, gig: g }, cb)); chain.push(cb => fireEvent(G, A, "friendlySteal", { unit: au, gig: g }, cb)); if(au.isLegend) chain.push(cb => fireEvent(G, A, "legendSteal", { unit: au, gig: g }, cb)); }
    chain.push(cb => fireEvent(G, A, "firstSteal", { unit: au, gigs: stolen }, cb));
    const run = i => { if(i >= chain.length) return; chain[i](() => run(i + 1)); };
    run(0);
  };
  pickOne(0);
}
/* in overtime la partita finisce appena qualcuno ha la maggioranza dei dadi (7) */
function checkMajority(G){
  if(!G.overtime || G.winner != null) return false;
  for(const P of G.players) if(P.gigs.length >= 7){ win(G, P.id, `Overtime: ${P.name} arriva a ${P.gigs.length} Gig`); return true; }
  return false;
}

export function defeat(G, P, u, done){
  const i = P.field.indexOf(u); if(i < 0){ done && done(); return; }
  const dm = (u.gear || []).find(g => g.fx.deadman);
  if(dm){ u.gear.splice(u.gear.indexOf(dm), 1); P.trash.push(dm); say(G, `${dm.card.dn} viene sconfitto al posto di ${u.card.dn}.`); done && done(); return; }
  // Jackie Welles: "se un'Unità amica sta per essere sconfitta, puoi pagare 1 €$ per sconfiggere questa Leggenda al suo posto"
  const saver = !u.isLegend && P.legends.find(l => l.faceUp && !l.removed && !l.onField && l.fx.saveUnitPay && canPay(P, l.fx.saveUnitPay));
  if(saver && !u._noSave){
    ask(G, P.id, "yesno", [{ label: `Paga ${saver.fx.saveUnitPay} €$: ${saver.card.dn} esce dal gioco al posto di ${u.card.dn}`, v: true }, { label: `No, ${u.card.dn} viene sconfitta`, v: false }], o => {
      const no = () => { u._noSave = true; defeat(G, P, u, done); };
      if(o && o.v) payAsk(G, P, saver.fx.saveUnitPay, () => { saver.removed = true; say(G, `${saver.card.dn} esce dal gioco al posto di ${u.card.dn}.`, "fight"); done && done(); }, no);
      else no();
    }, { src: saver.card.dn, text: saver.card.text.replace(/\s+/g, " "), save: u });
    return;
  }
  u._noSave = false;
  P.field.splice(i, 1);
  const wasEquipped = (u.gear || []).length > 0;
  if(u.isLegend){ u.legendRef.removed = true; u.legendRef.onField = false; say(G, `${u.card.dn} esce dal gioco (Go Solo).`); }
  else { P.trash.push(u); for(const g of u.gear || []) P.trash.push(g); }
  const gears = (u.gear || []).slice();
  runEffects(G, P, u, u.fx.defeated, "Defeated", () => {
    const run = k => { if(k >= gears.length){ fireEvent(G, P, "friendlyDefeated", { unit: u, equipped: wasEquipped }, () => fireEvent(G, P, "defeatedFriendly", { unit: u, equipped: wasEquipped }, done)); return; } runEffects(G, P, u, gears[k].fx.defeated, "Defeated", () => run(k + 1), { srcCard: gears[k] }); };
    run(0);
  });
}

/* ------------------------------------------------------------ condizioni e conteggi */
const vals = P => P.gigs.map(g => g.value);
const isMin = g => g.value === 1, isMax = g => g.value === g.sides;
export function testCond(G, P, src, cond, ctx = {}){
  if(!cond) return true;
  const R = rival(G, P), v = vals(P);
  switch(cond.c){
    case "evenAndOdd": return v.some(x => x % 2 === 0) && v.some(x => x % 2 === 1);
    case "gigAtLeast": return v.some(x => x >= cond.n);
    case "gigParity": return v.some(x => (x % 2 === 0) === (cond.p === "even"));
    case "valuePair": return new Set(v).size < v.length;
    case "distinctGigs": return new Set(v).size >= cond.n;
    case "minGig": return P.gigs.some(isMin);
    case "gigsAtLeastCount": return v.filter(x => x >= cond.v).length >= cond.n;
    case "credCmp": return cond.d === "more" ? streetCred(P) > streetCred(R) : streetCred(P) < streetCred(R);
    case "credEven": return streetCred(P) % 2 === 0;
    case "credDiff": return Math.abs(streetCred(P) - streetCred(R)) >= cond.n;
    case "rivalMoreGigs": return R.gigs.length - P.gigs.length >= cond.n;
    case "allLegendsUp": return P.legends.every(l => l.faceUp || l.removed);
    case "selfPower": return power(src) >= cond.n;
    case "playedProgram": return !!P.playedProgram;
    case "selfSpent": return !!src.spent;
    case "selfNamed": return src.card.name === cond.name;
    case "selfEquipped": return (ctx.unit || src).gear && (ctx.unit || src).gear.length > 0;
    case "selfStoleThisTurn": return !!src.stoleThisTurn;
    case "ctxGigParity": return ctx.gig ? (ctx.gig.value % 2 === 0) === (cond.p === "even") : false;
    case "ctxGigMin": return ctx.gig ? ctx.gig.value === 1 : false;
    case "ctxGigSides": return ctx.gig ? ctx.gig.sides === cond.n : false;
    case "ctxCardType": return ctx.card ? ctx.card.card.type === cond.t : false;
    case "ctxCostEqualsGig": return ctx.card ? v.includes(ctx.card.card.cost ?? -1) : false;
    case "ctxUnitCls": { const u = ctx.unit || ctx.last; return u ? (u.card.cls || []).some(k => cond.cls.includes(k.toUpperCase())) : false; }
    case "spentCount": return [...P.field, ...P.legends.filter(l => !l.removed)].filter(x => x.spent).length >= cond.n;
    case "equippedCount": return [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)].filter(x => (x.gear || []).length).length >= cond.n;
    case "credLess": return streetCred(P) < cond.n;
    case "d4Min": return P.gigs.some(g => g.sides === 4 && g.value === 1);
    case "fixerEmpty": return P.fixer.length === 0;
    case "minGigsCount": return P.gigs.filter(isMin).length >= cond.n;
    case "did": return !!ctx.did;
    case "discardedEqualsGig": return ctx.discarded != null && v.includes(ctx.discarded);
    case "peekedTag": return !!ctx.peeked && ((ctx.peeked.card.cls || []).some(k => k.toUpperCase() === cond.cls) || (ctx.peeked.card.kw || []).includes(cond.kw));
    default: return false;
  }
}
export function count(G, P, src, per){
  const R = rival(G, P), v = vals(P);
  const k = typeof per === "string" ? per : per.k;
  switch(k){
    case "faceUpLegends": return P.legends.filter(l => l.faceUp && !l.removed).length;
    case "valuePairs": { const m = new Map(); for(const x of v) m.set(x, (m.get(x) || 0) + 1); let n = 0; for(const c of m.values()) n += Math.floor(c / 2); return n; }
    case "evenGigs": return v.filter(x => x % 2 === 0).length;
    case "oddGigs": return v.filter(x => x % 2 === 1).length;
    case "gigsAtLeast": return v.filter(x => x >= per.n).length;
    case "minGigs": return P.gigs.filter(isMin).length;
    case "unitsInTrash": return P.trash.filter(c => c.card.type === "Unit").length;
    case "rivalUnits": return R.field.length;
    case "selfGears": return (src.gear || []).length;
    default: return 0;
  }
}
/* costo effettivo di una carta in mano (sconti "per each…" e costi condizionati) */
export function costOf(G, P, c){
  let cost = c.card.cost ?? 0;
  if(c.fx.costIf && testCond(G, P, c, c.fx.costIf.cond)) cost = c.fx.costIf.cost;
  if(c.fx.costReduce){ cost = Math.max(c.fx.costReduce.min, cost - c.fx.costReduce.n * count(G, P, c, c.fx.costReduce.per)); }
  if(c.card.type === "Program" && P.programDiscountMin != null){ cost = Math.max(1, cost - P.programDiscountMin * P.gigs.filter(isMin).length); }
  if(c.card.type === "Gear"){   // Viktor Vektor: il primo Gear CYBERWARE del turno costa -3 (minimo 1)
    for(const h of [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)]){
      const d = h.fx.firstGearDiscount; if(!d) continue;
      if((c.card.cls || []).some(k => k.toUpperCase() === d.cls) && !(P.playedGearCls || {})[d.cls]) cost = Math.max(d.min, cost - d.n);
    }
  }
  return cost;
}

/* ------------------------------------------------------------ eventi */
/* fa scattare gli effetti "When …" di tutte le carte di P (campo, Leggende scoperte, Gear equipaggiati) */
function fireEvent(G, P, name, ctx, done){
  const hosts = [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)];
  const tasks = [];
  /* holder: l'Unità/Leggenda a cui l'evento si riferisce; store: la carta che porta il testo (per "la prima volta… ogni turno") */
  const consider = (holder, src, entries, store = holder) => {
    for(const e of entries || []){
      if(e.once){ store._once = store._once || {}; const k = name + ":" + e.text; if(store._once[k] === G.turn) continue; }
      // filtri specifici dell'evento
      if(name === "steal" && ctx.unit !== holder) continue;
      if(name === "block" && ctx.unit !== holder) continue;
      if((name === "winFight" || name === "loseFight" || name === "firstWin") && ctx.unit !== holder) continue;
      if((name === "firstSteal" || name === "firstSpent") && ctx.unit !== holder) continue;
      if(name === "hostSpent" && ctx.unit !== holder) continue;
      if(name === "friendlySteal"){ if(e.die && ctx.gig.sides !== e.die) continue; if(e.cls && !(ctx.unit.card.cls || []).some(k => e.cls.includes(k.toUpperCase()))) continue; if(e.lessThanPower && (ctx.unit === holder || ctx.gig.value >= power(ctx.unit))) continue; }
      if(name === "friendlyAttack" && e.cls && !(ctx.unit.card.cls || []).some(k => k.toUpperCase() === e.cls)) continue;
      if(name === "friendlyDefeated" && e.cls && !(ctx.unit.card.cls || []).some(k => k.toUpperCase() === e.cls)) continue;
      if(name === "defeatedFriendly" && e.equippedOnly && !ctx.equipped) continue;
      if(name === "spent" && e.equippedOnly && !(ctx.unit.gear || []).length) continue;
      if(name === "playProgram" && e.cls && !(ctx.card.card.cls || []).some(k => k.toUpperCase() === e.cls)) continue;
      if(name === "endTurn" && G.active !== P.id) continue;
      tasks.push(cb => { if(e.once){ store._once[name + ":" + e.text] = G.turn; } say(G, `⚡ ${store.card.dn}: ${e.text}`, "trigger"); runEffects(G, P, src, e.ops, name, cb, { ...ctx, holder, srcCard: store }); });
    }
  };
  for(const h of hosts){
    consider(h, h, h.fx.on[name]);
    for(const g of h.gear || []){
      if(name === "hostSpent" && ctx.unit === h) consider(h, h, g.fx.on.hostSpent, g);
      else if(name !== "hostSpent") consider(h, h, g.fx.on[name], g);
    }
  }
  const run = i => { if(i >= tasks.length){ done && done(); return; } tasks[i](() => run(i + 1)); };
  run(0);
}
/* più carte spese insieme (pagamento con Leggende, effetti che spendono Unità): una dopo l'altra */
function spentChain(G, P, list, done){ const run = i => { if(i >= list.length || G.winner != null){ done && done(); return; } onSpent(G, P, list[i], () => run(i + 1)); }; run(0); }
/* quando una carta viene spesa (attacco, abilità, pagamento, Blocker, effetti): eventi dei Gear e "la prima volta che…" */
function onSpent(G, P, x, done){
  fireEvent(G, P, "hostSpent", { unit: x }, () => fireEvent(G, P, "firstSpent", { unit: x }, () => fireEvent(G, P, "spent", { unit: x }, done)));
}

/* ------------------------------------------------------------ effetti */
const unitOpts = (G, list) => list.map(u => ({ label: `${u.card.dn} (${power(u)})`, unit: u }));
function runEffects(G, P, src, ops, trigger, done, ctx = {}){
  const R = rival(G, P);
  const queue = ops.slice();
  let cur = null;
  const askE = (pi, kind, options, cb, extra = {}) => ask(G, pi, kind, options, cb, { src: ctx.srcName || src.card.dn, srcPid: src.pid, text: cur && cur.text, ...extra });
  const sc = ctx.srcCard || src, S_ = sc.uid;   // la carta che porta il testo (un Gear, una Leggenda, un Programma) e la sua posizione
  let srcSent = false;   // l'innesco si annuncia solo quando un'operazione parte davvero (non se le condizioni la saltano tutte)
  const sendSrc = () => { if(srcSent || !sc.card) return; srcSent = true; const x = [...new Set(ops.map(o => o.text).filter(Boolean))].join(" "); fxEv(G, "src", { p: P.id, s: S_, h: src.uid, pid: sc.pid, dn: sc.card.dn, ty: sc.card.type, tr: trigger, x }); };
  let last = null;   // ultima Unità bersagliata ("give it +2 power", "it can attack…")
  let prev = null;   // operazione precedente ("you may defeat 2 instead")
  const next = () => {
    if(G.winner != null){ done && done(); return; }
    const o = queue.shift(); if(!o){ done && done(); return; }
    prev = cur; cur = o;
    const cctx = () => ({ ...ctx, last: last || ctx.last });
    if(o.skipIf && testCond(G, P, src, o.skipIf, cctx())){ next(); return; }
    if(o.cond){ const ok = testCond(G, P, src, o.cond, cctx()); if(ok === !!o.negate){ next(); return; } }
    sendSrc();
    const times = o.per ? count(G, P, src, o.per) : 1;
    const nTimes = o.n != null && o.per ? o.n * times : o.n;
    switch(o.op){
      case "draw": if(nTimes > 0) draw(G, P, nTimes); next(); break;
      case "mill": { const n = Math.min(o.n, P.deck.length); const ms = P.deck.splice(0, n); P.trash.push(...ms); P.lastMilled = ms; if(ms.length) fxEv(G, "mill", { p: P.id, s: S_, c: ms.map(fxCard) }); say(G, `${P.name} manda ${n} carte nel trash (${ms.map(c => c.card.dn).join(", ") || "nessuna"}).`); next(); break; }
      case "mayMillTop": { if(!P.deck.length){ next(); break; } const c = P.deck[0]; askE(P.id, "yesno", [{ label: `Trash ${c.card.dn}`, v: true }, { label: "Lasciala", v: false }], o2 => { if(o2 && o2.v){ P.deck.shift(); P.trash.push(c); fxEv(G, "mill", { p: P.id, s: S_, c: [fxCard(c)] }); say(G, `${P.name} manda ${c.card.dn} nel trash.`); } next(); }); break; }
      case "sellTop": { if(!P.deck.length){ next(); break; } const c = P.deck.shift(); P.eddies.push({ ...c, spent: false }); say(G, `${P.name} vende la prima carta del mazzo (ora ${P.eddies.length} €$).`, "eddie"); next(); break; }
      case "readyEddies": { let k = 0; for(const e of P.eddies) if(e.spent && k < o.n){ e.spent = false; k++; } say(G, `${P.name} prepara ${k} Eddie.`); next(); break; }
      case "readySelf": { const u = ctx.holder || src; if(u.spent){ u.spent = false; fxEv(G, "ready", { s: S_, t: [u.uid] }); say(G, `${u.card.dn} è di nuovo pronta.`); } next(); break; }
      case "readyHost": { const u = ctx.holder || src; if(u.spent){ u.spent = false; fxEv(G, "ready", { s: S_, t: [u.uid] }); say(G, `${u.card.dn} è di nuovo pronta.`); } next(); break; }
      case "readyUnits": { let k = 0; const one = () => { const pool = P.field.filter(u => u.spent); if(k++ >= o.n || !pool.length){ next(); return; }
          askE(P.id, "target", [...unitOpts(G, pool), { label: "Basta così", unit: null }], o2 => { if(o2 && o2.unit){ o2.unit.spent = false; fxEv(G, "ready", { s: S_, t: [o2.unit.uid] }); say(G, `${o2.unit.card.dn} è di nuovo pronta.`); one(); } else next(); }); }; one(); break; }
      case "readyLegends": { let k = 0; const one = () => { const pool = P.legends.filter(l => l.faceUp && l.spent && !l.removed && !l.onField && (!o.cls || (l.card.cls || []).some(x => x.toUpperCase() === o.cls))); if(k++ >= o.n || !pool.length){ next(); return; }
          askE(P.id, "target", [...pool.map(l => ({ label: l.card.dn, unit: l })), { label: "Basta così", unit: null }], o2 => { if(o2 && o2.unit){ o2.unit.spent = false; fxEv(G, "ready", { s: S_, t: [o2.unit.uid] }); say(G, `${o2.unit.card.dn} è di nuovo pronta.`); one(); } else next(); }); }; one(); break; }
      case "readyUnitPower": { const v = ctx.gig ? ctx.gig.value : -1; askE(P.id, "target", unitOpts(G, P.field.filter(u => u !== src && u.spent && power(u) === v)), o2 => { if(o2){ o2.unit.spent = false; fxEv(G, "ready", { s: S_, t: [o2.unit.uid] }); say(G, `${o2.unit.card.dn} è di nuovo pronta.`); } next(); }); break; }
      case "fromTrash": {
        const pool = (o.milled ? (P.lastMilled || []) : P.trash).filter(c => c !== src && (!o.type || o.type === "Card" || c.card.type === o.type) && (!o.cls || (c.card.cls || []).some(k => k.toUpperCase() === o.cls)));
        askE(P.id, "pickcard", [...pool.map(c => ({ label: c.card.dn, c })), { label: "Nessuna", c: null }], o2 => { if(o2 && o2.c){ P.trash.splice(P.trash.indexOf(o2.c), 1); P.hand.push(o2.c); fxEv(G, "recover", { p: P.id, s: S_, c: [fxCard(o2.c)] }); say(G, `${P.name} recupera ${o2.c.card.dn} dal trash.`); } next(); }, { verb: "Recupera", info: ["Carte nel tuo trash che puoi riprendere in mano."] }); break; }
      case "searchTop": {
        const top = P.deck.splice(0, Math.min(o.n, P.deck.length)); const taken = [];
        const k = o.perMin ? o.k + P.gigs.filter(isMin).length : o.k;
        say(G, `${P.name} guarda le prime ${top.length} carte del mazzo.`);
        const noun = o.type === "Card" ? (k === 1 ? "carta" : "carte") : o.type;
        const want = (k >= 99 ? `tutte le ${noun} che vuoi` : k === 1 ? `1 ${noun}` : `fino a ${k} ${noun}`) + (o.maxCost != null ? ` con costo ${o.maxCost} o meno` : "") + (o.costEqGig ? " con costo uguale al valore di un tuo Gig" : "");
        const ok = c => (o.type === "Card" || c.card.type === o.type) && (o.maxCost == null || (c.card.cost ?? 0) <= o.maxCost) && (!o.costEqGig || vals(P).includes(c.card.cost ?? -1));
        // il giocatore vede tutte le carte guardate: quelle che l'effetto non permette di prendere restano visibili ma non selezionabili
        const pickOne = () => {
          const left = top.filter(c => !taken.includes(c)), pool = left.filter(ok);
          if(!left.length || (taken.length && (!pool.length || taken.length >= k))){ finish(); return; }
          const can = pool.length && taken.length < k;
          askE(P.id, "pickcard", [...left.map(c => ({ label: ok(c) && can ? c.card.dn : `${c.card.dn} · non prendibile`, c, disabled: !(ok(c) && can) })), { label: taken.length ? "Basta così" : can ? "Nessuna" : "Ok, vanno in fondo al mazzo", c: null }],
            o2 => { if(o2 && o2.c && !o2.disabled){ taken.push(o2.c); P.hand.push(o2.c); say(G, `${P.name} aggiunge ${o2.c.card.dn} alla mano.`); pickOne(); } else finish(); },
            { verb: "Prendi", info: [`Prime ${top.length} carte del tuo mazzo.`, `Puoi prendere: ${want}.`, taken.length ? `Già prese: ${taken.length}.` : "", `Le altre vanno in fondo al mazzo${o.random ? " in ordine casuale" : ""}.`].filter(Boolean) });
        };
        const finish = () => { const rest = top.filter(c => !taken.includes(c)); if(o.random) shuffle(rest, G.rng); P.deck.push(...rest); if(rest.length) say(G, `${rest.length} carte in fondo al mazzo.`); next(); };
        pickOne(); break; }
      case "revealTop": { if(!P.deck.length){ next(); break; } ctx.card = P.deck[0]; say(G, `${P.name} rivela ${ctx.card.card.dn}.`); next(); break; }
      case "takeRevealed": { const c = ctx.card; if(c && P.deck[0] === c && !(o.ifNotPlayed && ctx.played)){ P.deck.shift(); P.hand.push(c); say(G, `${c.card.dn} va in mano.`); } next(); break; }
      case "playRevealed": { const c = ctx.card; if(!c || P.deck[0] !== c){ next(); break; }
        const can = c.card.type !== "Gear" || [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)].length;
        askE(P.id, "yesno", [{ label: `Gioca ${c.card.dn} gratis`, v: true, disabled: !can }, { label: o.elseTake ? "No, in mano" : "No", v: false }], o2 => {
          if(o2 && o2.v && can){ P.deck.shift(); ctx.played = true; playFreeCard(G, P, c, "gratis", next); }
          else { if(o.elseTake){ P.deck.shift(); P.hand.push(c); say(G, `${c.card.dn} va in mano.`); } next(); } }); break; }
      case "mayDefeatGearDraw": {
        const pool = []; for(const h of [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)]) for(const g of h.gear || []) pool.push({ label: `${g.card.dn} su ${h.card.dn}`, g, h });
        askE(P.id, "pickcard", [...pool, { label: `Nessuno (pesca ${o.no})`, g: null }], o2 => { if(o2 && o2.g){ o2.h.gear.splice(o2.h.gear.indexOf(o2.g), 1); P.trash.push(o2.g); fxEv(G, "gear", { s: S_, t: o2.g.uid, h: o2.h.uid, n: o2.g.card.power ?? 0 }); say(G, `${P.name} sconfigge ${o2.g.card.dn}.`); draw(G, P, o.yes); } else draw(G, P, o.no); next(); }); break; }
      case "mayDo": {
        const go = () => runEffects(G, P, src, o.then, trigger, next, ctx);
        if(o.kind === "pay"){ if(!canPay(P, o.n)){ next(); break; } askE(P.id, "yesno", [{ label: `Paga ${o.n} €$`, v: true }, { label: "No", v: false }], o2 => { if(o2 && o2.v) payAsk(G, P, o.n, go, next); else next(); }); break; }
        if(o.kind === "discard"){ if(P.hand.length < o.n){ next(); break; }
          let k = 0; const one = () => { if(k >= o.n){ ctx.did = true; go(); return; } askE(P.id, "discard", [...P.hand.map(c => ({ label: c.card.dn, c })), ...(k ? [] : [{ label: "Non scartare", c: null }])], o2 => { if(o2 && o2.c){ P.hand.splice(P.hand.indexOf(o2.c), 1); P.trash.push(o2.c); fxEv(G, "discard", { p: P.id, s: S_, c: [fxCard(o2.c)] }); say(G, `${P.name} scarta ${o2.c.card.dn}.`); k++; one(); } else next(); }); }; one(); break; }
        if(o.kind === "discardPrograms"){ const progs = P.hand.filter(c => c.card.type === "Program"); if(progs.length < o.n){ next(); break; }
          let k = 0; const one = () => { if(k >= o.n){ go(); return; } askE(P.id, "discard", [...P.hand.filter(c => c.card.type === "Program").map(c => ({ label: c.card.dn, c })), ...(k ? [] : [{ label: "Non scartare", c: null }])], o2 => { if(o2 && o2.c){ P.hand.splice(P.hand.indexOf(o2.c), 1); P.trash.push(o2.c); fxEv(G, "discard", { p: P.id, s: S_, c: [fxCard(o2.c)] }); say(G, `${P.name} scarta ${o2.c.card.dn}.`); k++; one(); } else next(); }); }; one(); break; }
        if(o.kind === "defeatFriendlyGear" || o.kind === "defeatAnyGear"){
          const pool = []; const hostsP = [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)]; const hosts = o.kind === "defeatAnyGear" ? [...hostsP, ...R.field, ...R.legends.filter(l => l.faceUp && !l.removed && !l.onField)] : hostsP;
          for(const h of hosts) for(const g of h.gear || []) pool.push({ label: `${g.card.dn} su ${h.card.dn}`, g, h, owner: hostsP.includes(h) ? P : R });
          askE(P.id, "pickcard", [...pool, { label: "Nessuno", g: null }], o2 => { if(o2 && o2.g){ o2.h.gear.splice(o2.h.gear.indexOf(o2.g), 1); o2.owner.trash.push(o2.g); fxEv(G, "gear", { s: S_, t: o2.g.uid, h: o2.h.uid, n: o2.g.card.power ?? 0 }); say(G, `${o2.g.card.dn} sconfitto.`); ctx.card = o2.g; go(); } else next(); }); break; }
        next(); break; }
      case "freeCall": {
        const fd = o.peeked ? (ctx.peeked && !ctx.peeked.faceUp && !ctx.peeked.removed ? [ctx.peeked] : []) : P.legends.filter(l => !l.faceUp && !l.removed);
        if(P.called || !fd.length){ next(); break; }
        askE(P.id, "yesno", [{ label: o.peeked ? `Chiama ${ctx.peeked.card.dn} gratis` : "Chiama una Leggenda gratis", v: true }, { label: "No", v: false }], o2 => {
          if(o2 && o2.v){ const l = fd[Math.floor(G.rng() * fd.length)]; l.faceUp = true; P.called = true; say(G, `${P.name} chiama ${l.card.dn} gratis!`, "call"); runEffects(G, P, l, l.fx.call, "Call", next); } else next(); }); break; }
      case "playFree": {
        const from = o.from || "hand";
        const src2 = from === "hand" ? P.hand : from === "trash" ? P.trash : [...P.hand, ...P.trash];
        let k = 0; const K = o.k || 1;
        const one = () => {
          const pool = src2.filter(c => c !== src && c.card.type === o.type && (c.card.cost ?? 0) <= o.maxCost && (!o.cls || (c.card.cls || []).some(x => x.toUpperCase() === o.cls)));
          if(k >= K || !pool.length){ next(); return; }
          askE(P.id, "pickcard", [...pool.map(c => ({ label: `${c.card.dn} (${c.card.cost ?? 0})${P.trash.includes(c) ? " · trash" : ""}`, c })), { label: k ? "Basta così" : "Nessuna", c: null }], o2 => {
            if(!o2 || !o2.c){ next(); return; }
            const c = o2.c; k++;
            const take = () => { const arr = P.hand.includes(c) ? P.hand : P.trash; arr.splice(arr.indexOf(c), 1); };
            const after = () => { if(o.bottomAfter){ const i = P.trash.indexOf(c); if(i >= 0){ P.trash.splice(i, 1); P.deck.push(c); say(G, `${c.card.dn} in fondo al mazzo.`); } } one(); };
            if(o.pay){ payAsk(G, P, costOf(G, P, c), () => { take(); playFreeCard(G, P, c, "dal trash", after, o); }, one); return; }
            take(); playFreeCard(G, P, c, "gratis", after, o);
          });
        };
        one(); break; }
      case "swapGig": {
        if(!P.gigs.length || !R.gigs.length){ next(); break; }
        askE(P.id, "gigpick", [...P.gigs.map(g => ({ label: `tuo d${g.sides} = ${g.value}`, gig: g })), { label: "Non scambiare", gig: null }], a => { if(!a || !a.gig){ next(); return; }
          askE(P.id, "steal", R.gigs.map(g => ({ label: `rivale d${g.sides} = ${g.value}`, gig: g })), b => { if(b){ P.gigs.splice(P.gigs.indexOf(a.gig), 1, b.gig); R.gigs.splice(R.gigs.indexOf(b.gig), 1, a.gig); say(G, `${P.name} scambia il d${a.gig.sides} (${a.gig.value}) con il d${b.gig.sides} (${b.gig.value}) del rivale.`, "gig"); fireEvent(G, R, "rivalAdjust", {}, next); } else next(); }); }); break; }
      case "setGigLike": {
        const all = [...P.gigs.map(g => ({ label: `tuo d${g.sides} = ${g.value}`, gig: g })), ...R.gigs.map(g => ({ label: `rivale d${g.sides} = ${g.value}`, gig: g }))];
        if(all.length < 2){ next(); break; }
        askE(P.id, "gigpick", [...all, { label: "Nessuno", gig: null }], a => { if(!a || !a.gig){ next(); return; }
          askE(P.id, "gigpick", all.filter(x => x.gig !== a.gig).map(x => ({ label: "come " + x.label, gig: x.gig })), b => { if(b){ const v = Math.min(a.gig.sides, b.gig.value); say(G, `Il d${a.gig.sides} passa da ${a.gig.value} a ${v}.`, "gig"); a.gig.value = v; const owner = P.gigs.includes(a.gig) ? P : R; if(owner === R) fireEvent(G, R, "rivalAdjust", {}, next); else next(); } else next(); }); }); break; }
      case "stealGig": {
        if(!R.gigs.length){ next(); break; }
        const pool = o.unshared ? R.gigs.filter(g => !vals(P).includes(g.value)) : R.gigs;
        askE(P.id, "steal", pool.map(g => ({ label: `d${g.sides} = ${g.value}`, gig: g })), o2 => { if(o2){ R.gigs.splice(R.gigs.indexOf(o2.gig), 1); P.gigs.push(o2.gig); say(G, `${P.name} ruba un d${o2.gig.sides} (${o2.gig.value}).`, "steal"); const u = ctx.holder || src; if(checkMajority(G)){ next(); return; }
          // è l'Unità a rubare: scattano di nuovo i suoi "quando ruba un Gig"
          fireEvent(G, P, "steal", { unit: u, gig: o2.gig }, () => fireEvent(G, P, "friendlySteal", { unit: u, gig: o2.gig }, next)); } else next(); }); break; }
      case "spendSelf": if(P.field.includes(src) && !src.spent){ src.spent = true; onSpent(G, P, src, next); } else next(); break;
      case "adrenaline": askE(P.id, "target", unitOpts(G, P.field.filter(u => u !== src && u.lag && (u.card.cost ?? 0) <= o.maxCost)), o2 => { if(o2){ o2.unit.lag = false; say(G, `${o2.unit.card.dn} ha Adrenaline: può attaccare subito.`); } next(); }); break;
      case "grantKw": askE(P.id, "target", unitOpts(G, P.field.filter(u => (u.card.cost ?? 0) <= o.maxCost)), o2 => { if(o2){ o2.unit.kwBlockerThisTurn = true; last = o2.unit; say(G, `${o2.unit.card.dn} ha Blocker fino a fine turno.`); } next(); }); break;
      case "grantNoLag": askE(P.id, "target", unitOpts(G, P.field.filter(u => u.lag)), o2 => { if(o2){ o2.unit.lag = false; o2.unit.onlyUnitsThisTurn = true; last = o2.unit; say(G, `${o2.unit.card.dn} può attaccare Unità spese subito.`); } next(); }); break;
      case "grantLast": { const u = last || ctx.last; if(u){ u[o.flag] = true; say(G, `${u.card.dn}: al prossimo attacco può attaccare Unità pronte.`); } next(); break; }
      case "noLag": if(P.field.includes(src)){ src.lag = false; src.onlyUnitsThisTurn = !!o.onlyUnits; say(G, `${src.card.dn} può attaccare subito${o.onlyUnits ? " (solo Unità)" : ""}.`); } next(); break;
      case "noLagLast": if(last){ last.lag = false; last.onlyUnitsThisTurn = true; } next(); break;
      case "chooseForUnit": askE(P.id, "target", unitOpts(G, P.field), o2 => { if(o2) last = o2.unit; next(); }); break;
      case "choose": {
        // "Give a friendly Unit these effects… If you have less ☆, they choose for you": la scelta è di chi deve farla
        const chooser = ((o.rivalChooses && testCond(G, P, src, o.rivalChooses)) || ctx.rivalChooses) ? R.id : P.id;
        if(o.bothIf && testCond(G, P, src, o.bothIf, cctx())){   // "If …, choose both instead"
          say(G, `${P.name} ottiene entrambi gli effetti.`);
          const run = k => { if(k >= o.alts.length){ next(); return; } runEffects(G, P, src, o.alts[k].ops, trigger, () => run(k + 1), { ...ctx, last }); }; run(0); break; }
        askE(chooser, "choice", o.alts.map(a => ({ label: a.text, alt: a })), o2 => { if(o2){ say(G, `${G.players[chooser].name} sceglie: «${o2.alt.text}»`); runEffects(G, P, src, o2.alt.ops, trigger, next, { ...ctx, last }); } else next(); }); break; }
      case "rivalChooses": ctx.rivalChooses = true; say(G, `${R.name} sceglierà l'effetto al posto di ${P.name}.`); next(); break;
      case "discard": { let k = 0; const one = () => { if(k++ >= (o.n || 1) || !P.hand.length){ next(); return; } askE(P.id, "discard", P.hand.map(c => ({ label: c.card.dn, c })), o2 => { if(o2){ P.hand.splice(P.hand.indexOf(o2.c), 1); P.trash.push(o2.c); ctx.card = o2.c; ctx.did = true; fxEv(G, "discard", { p: P.id, s: S_, c: [fxCard(o2.c)] }); say(G, `${P.name} scarta ${o2.c.card.dn}.`); } one(); }); }; one(); break; }
      case "rivalDiscard": {
        let k = 0; const one = () => { if(k++ >= o.n || !R.hand.length){ next(); return; } askE(R.id, "discard", R.hand.map(c => ({ label: c.card.dn, c })), o2 => { if(o2){ R.hand.splice(R.hand.indexOf(o2.c), 1); R.trash.push(o2.c); ctx.card = o2.c; fxEv(G, "discard", { p: R.id, s: S_, c: [fxCard(o2.c)] }); say(G, `${R.name} scarta ${o2.c.card.dn}.`); } one(); }); }; one(); break; }
      case "eachRedraw": { for(const Q of G.players){ const n = Q.hand.length; if(n) fxEv(G, "discard", { p: Q.id, s: S_, c: Q.hand.map(fxCard) }); Q.trash.push(...Q.hand); Q.hand = []; say(G, `${Q.name} scarta ${n} carte.`); ctx.discarded = (ctx.discarded || 0) + n; }
        let i = 0; const one = () => { if(i >= 2){ next(); return; } const Q = G.players[(P.id + i) % 2]; i++; askE(Q.id, "yesno", [{ label: `Pesca ${o.n}`, v: true }, { label: "Non pescare", v: false }], o2 => { if(o2 && o2.v) draw(G, Q, o.n); one(); }); }; one(); break; }
      case "eachDefeats": { let i = 0; const one = () => { if(i >= 2){ next(); return; } const Q = G.players[(P.id + i) % 2]; i++; if(!Q.field.length){ one(); return; } askE(Q.id, "target", unitOpts(G, Q.field), o2 => { if(o2){ fxEv(G, "defeat", { s: S_, t: [o2.unit.uid] }); say(G, `${Q.name} sconfigge ${o2.unit.card.dn}.`, "fight"); defeat(G, Q, o2.unit, one); } else one(); }); }; one(); break; }
      case "buff": {
        const n = o.n * (o.per ? 0 : 1);
        const pool = o.equipped ? P.field.filter(u => (u.gear || []).length) : P.field;
        askE(P.id, "target", unitOpts(G, pool), o2 => { if(o2){ const add = o.per ? o.n * count(G, P, o2.unit, o.per) : o.n; o2.unit.mod = (o2.unit.mod || 0) + add; last = o2.unit; fxEv(G, "pow", { s: S_, t: [o2.unit.uid], n: add }); say(G, `${o2.unit.card.dn} +${add} potenza fino a fine turno.`); } next(); }); break; }
      case "buffSelf": { const u = ctx.holder || src; if(P.field.includes(u) || u.isLegend || P.legends.includes(u)){ const add = o.eq === "maxGig" ? Math.max(0, ...vals(P)) : o.eq === "revealedCost" ? (ctx.card ? ctx.card.card.cost ?? 0 : 0) : o.per ? o.n * count(G, P, u, o.per) : o.n; u.mod = (u.mod || 0) + add; if(add) fxEv(G, "pow", { s: S_, t: [u.uid], n: add }); say(G, `${u.card.dn} +${add} potenza fino a fine turno.`); } next(); break; }
      case "buffLast": { const u = last || ctx.last || ctx.unit; if(u){ u.mod = (u.mod || 0) + o.n; fxEv(G, "pow", { s: S_, t: [u.uid], n: o.n }); say(G, `${u.card.dn} +${o.n} potenza fino a fine turno.`); } next(); break; }
      case "gig": {
        const pick = o.ctx && ctx.gig ? [{ label: `d${ctx.gig.sides} = ${ctx.gig.value}`, gig: ctx.gig }] : P.gigs.map(g => ({ label: `d${g.sides} = ${g.value}`, gig: g }));
        if(!pick.length){ next(); break; }
        askE(P.id, "gigpick", [...pick, { label: "Nessun Gig", gig: null }], o2 => {
          if(!o2 || !o2.gig){ next(); return; }
          const g = o2.gig, range = [];
          const lo = o.mode === "up" ? 1 : -o.n, hi = o.mode === "down" ? -1 : o.n;
          for(let d = lo; d <= hi; d++){ const v = g.value + d; if(d && v >= 1 && v <= g.sides) range.push({ label: `${g.value} → ${v}`, v }); }
          if(!range.length){ next(); return; }
          askE(P.id, "gigvalue", [...range, { label: "Lascia così", v: null }], o3 => { if(o3 && o3.v != null){ say(G, `${P.name} porta il d${g.sides} da ${g.value} a ${o3.v}.`, "gig"); g.value = o3.v; ctx.gig = g; } next(); });
        }); break; }
      case "defeat": {
        const maxP = o.maxFrom === "d20" ? Math.max(-1, ...P.gigs.filter(g => g.sides === 20).map(g => g.value)) : o.max;
        const maxC = o.maxFrom === "discarded" ? (ctx.card ? ctx.card.card.cost ?? 0 : -1) : o.max;
        const friendlyMax = Math.max(-1, ...P.field.map(u => power(u)));
        const pool = (o.any ? [...P.field, ...R.field] : R.field).filter(u => (!o.spentOnly || u.spent) && (o.by === "power" ? power(u) <= maxP : o.by === "cost" ? (u.card.cost ?? 0) <= maxC : true) && (!o.lessThanFriendly || power(u) < friendlyMax));
        askE(P.id, "target", [...unitOpts(G, pool), ...(o.may ? [{ label: "Nessuna", unit: null }] : [])], o2 => { if(o2 && o2.unit){ const owner = P.field.includes(o2.unit) ? P : R; fxEv(G, "defeat", { s: S_, t: [o2.unit.uid] }); say(G, `${o2.unit.card.dn} sconfitta da ${src.card.dn}.`, "fight"); defeat(G, owner, o2.unit, next); } else next(); }); break; }
      case "repeatPrev": { if(prev && prev.op === "defeat"){ for(let k = 0; k < o.n; k++) queue.unshift({ ...prev, may: true, cond: null }); } next(); break; }
      case "defeatOpponent": { const opp = ctx.opponent; const owner = opp && (P.field.includes(opp) ? P : R.field.includes(opp) ? R : null); if(owner){ fxEv(G, "defeat", { s: S_, t: [opp.uid] }); say(G, `${opp.card.dn} sconfitta.`, "fight"); defeat(G, owner, opp, next); } else next(); break; }
      case "defeatGear": {
        const pool = []; for(const u of R.field) for(const g of u.gear || []) if((g.card.power ?? 0) <= o.max) pool.push({ label: `${g.card.dn} su ${u.card.dn}`, g, u });
        askE(P.id, "target", pool, o2 => { if(o2){ o2.u.gear.splice(o2.u.gear.indexOf(o2.g), 1); R.trash.push(o2.g); fxEv(G, "gear", { s: S_, t: o2.g.uid, h: o2.u.uid, n: o2.g.card.power ?? 0 }); say(G, `${o2.g.card.dn} sconfitto.`); } next(); }); break; }
      case "defeatAllOther": { const all = [...P.field.filter(x => x !== src), ...R.field]; if(all.length) fxEv(G, "defeat", { s: S_, t: all.map(u => u.uid), m: 1 }); say(G, "Tutte le altre Unità sono sconfitte."); const run = k => { if(k >= all.length){ next(); return; } const u = all[k], owner = P.field.includes(u) ? P : R; defeat(G, owner, u, () => run(k + 1)); }; run(0); break; }
      case "spendAll": { const now = R.field.filter(u => !u.spent); for(const u of now) u.spent = true; if(now.length) fxEv(G, "spend", { s: S_, t: now.map(u => u.uid) }); say(G, `Tutte le Unità di ${R.name} sono spese.`); spentChain(G, R, now, next); break; }
      case "spend": { let k = 0; const K = o.per ? times : 1; const one = () => { if(k++ >= K){ next(); return; } askE(P.id, "target", unitOpts(G, R.field.filter(u => !u.spent && (o.max == null || (u.card.cost ?? 0) <= o.max))), o2 => { if(o2){ o2.unit.spent = true; last = o2.unit; if(o.lock) o2.unit.cantReady = true; fxEv(G, "spend", { s: S_, t: [o2.unit.uid], lock: o.lock ? 1 : 0 }); say(G, `${o2.unit.card.dn} viene spesa${o.lock ? " e non si prepara al prossimo turno" : ""}.`); onSpent(G, R, o2.unit, one); } else next(); }); }; one(); break; }
      case "spendLock": askE(P.id, "target", unitOpts(G, R.field), o2 => { if(o2){ o2.unit.cantReady = true; fxEv(G, "mark", { s: S_, t: [o2.unit.uid], k: "lock" }); say(G, `${o2.unit.card.dn} non si preparerà al prossimo turno.`); } next(); }); break;
      case "lockLast": if(last){ last.cantReady = true; fxEv(G, "mark", { s: S_, t: [last.uid], k: "lock" }); } next(); break;
      case "cantAttackUntil": askE(P.id, "target", unitOpts(G, o.any ? [...R.field, ...P.field] : R.field), o2 => { if(o2){ o2.unit.lockAttackBy = P.id; fxEv(G, "mark", { s: S_, t: [o2.unit.uid], k: "noatk" }); say(G, `${o2.unit.card.dn} non può attaccare fino al prossimo turno di ${P.name}.`); } next(); }); break;
      case "mustAttack": askE(P.id, "target", unitOpts(G, R.field), o2 => { if(o2){ o2.unit.mustAttack = true; fxEv(G, "mark", { s: S_, t: [o2.unit.uid], k: "must" }); say(G, `${o2.unit.card.dn} dovrà attaccare nel prossimo turno di ${R.name}, se può.`); } next(); }); break;
      case "debuff": { const pool = R.field.slice().sort((a, b) => (b === G.attacker) - (a === G.attacker)); const n = o.eq === "selfPower" ? power(ctx.holder || src) : o.n;
        askE(P.id, "target", unitOpts(G, pool), o2 => { if(o2){ o2.unit.mod = (o2.unit.mod || 0) - n; last = o2.unit; fxEv(G, "pow", { s: S_, t: [o2.unit.uid], n: -n }); say(G, `${o2.unit.card.dn} -${n} potenza fino a fine turno (ora ${power(o2.unit)}).`); } next(); }); break; }
      case "debuffAll": for(const u of R.field){ u.mod = (u.mod || 0) - o.n; } if(R.field.length) fxEv(G, "pow", { s: S_, t: R.field.map(u => u.uid), n: -o.n }); say(G, `Tutte le Unità di ${R.name} hanno -${o.n} potenza fino a fine turno.`); next(); break;
      case "bottomDeckAll": { const list = R.field.filter(u => power(u) <= o.maxPower); if(list.length) fxEv(G, "bottom", { s: S_, t: list.map(u => u.uid) }); for(const u of list) bottomDeckUnit(G, R, u); if(!list.length) say(G, `Nessuna Unità rivale con potenza ${o.maxPower}.`); next(); break; }
      case "stealLess": { const pool = R.field.slice().sort((a, b) => (b === G.attacker) - (a === G.attacker));
        askE(P.id, "target", unitOpts(G, pool), o2 => { if(o2){ o2.unit.stealLess = (o2.unit.stealLess || 0) + o.n; ctx.unit = o2.unit; say(G, `${o2.unit.card.dn} ruba ${o.n} Gig in meno in questo turno.`); } next(); }); break; }
      case "goSoloDiscount": P.goSoloDiscount = { n: o.n, min: o.min }; say(G, `Il prossimo Go Solo di ${P.name} costa -${o.n} €$ (minimo ${o.min}) in questo turno.`); next(); break;
      case "nextProgramDiscount": P.programDiscountMin = o.n; say(G, `Il prossimo Programma di ${P.name} costa -${o.n} €$ per ogni Gig al minimo (minimo ${o.min}).`); next(); break;
      case "flag": P[o.flag] = o.n || true; say(G, `${P.name}: «${o.text}»`); next(); break;
      case "doomLast": { const u = last || ctx.last; if(u){ u.doomIfActs = true; fxEv(G, "mark", { s: S_, t: [u.uid], k: "doom" }); say(G, `${u.card.dn}: se ruba o combatte, sarà sconfitta a fine turno.`); } next(); break; }
      case "stealLimit": P.stealLimit = { ...(P.stealLimit || {}), [o.who]: o.mode }; say(G, `${P.name}: «${o.text}»`); next(); break;
      case "readyEquipped": { let k = 0; const rd = []; for(const x of [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)]) if((x.gear || []).length && x.spent){ x.spent = false; k++; rd.push(x.uid); } if(rd.length) fxEv(G, "ready", { s: S_, t: rd }); say(G, `${P.name} prepara ${k} Unità/Leggende equipaggiate.`); next(); break; }
      case "rerollOnce": { const g = ctx.gig; if(!g){ next(); break; }
        askE(P.id, "yesno", [{ label: `Ritira il d${g.sides} (ora ${g.value})`, v: true }, { label: `Tieni ${g.value}`, v: false }], o2 => { if(o2 && o2.v){ const v = rollDie(g.sides, G.rng); say(G, `${P.name} ritira il d${g.sides}: ${v} (era ${g.value}).`, "gig"); g.value = v; } next(); }, { reroll: g }); break; }
      case "revealRivalChoice": { const top = P.deck.splice(0, Math.min(o.n, P.deck.length)); if(!top.length){ next(); break; }
        say(G, `${P.name} rivela ${top.map(c => c.card.dn).join(", ")}.`);
        askE(R.id, "choice", [{ label: `${P.name} le aggiunge alla mano`, v: "hand" }, { label: `Vanno nel trash e ${P.name} pesca ${o.draw}`, v: "trash" }], o2 => {
          if(o2 && o2.v === "trash"){ P.trash.push(...top); fxEv(G, "mill", { p: P.id, s: S_, c: top.map(fxCard) }); say(G, `${R.name} le manda nel trash.`); draw(G, P, o.draw); } else { P.hand.push(...top); say(G, `${R.name} le lascia andare in mano a ${P.name}.`); } next(); }, { reveal: top }); break; }
      case "searchTrash": { const top = P.deck.splice(0, Math.min(o.n, P.deck.length)); if(!top.length){ next(); break; }
        say(G, `${P.name} guarda le prime ${top.length} carte del mazzo.`); let k = 0;
        const one = () => { const pool = top.filter(c => !P.trash.includes(c)); if(k >= o.k || !pool.length){ P.deck.unshift(...pool); next(); return; }
          askE(P.id, "pickcard", pool.map(c => ({ label: `Trash ${c.card.dn}`, c })), o2 => { if(o2){ P.trash.push(o2.c); fxEv(G, "mill", { p: P.id, s: S_, c: [fxCard(o2.c)] }); say(G, `${P.name} manda ${o2.c.card.dn} nel trash.`); k++; } one(); },
            { verb: "Manda nel trash", info: [`Prime ${top.length} carte del tuo mazzo.`, `Scegline ${o.k - k} da mandare nel trash.`, "Le altre restano in cima al mazzo, nello stesso ordine."] }); }; one(); break; }
      case "chooseTypeReveal": { if(!P.deck.length){ next(); break; }
        askE(P.id, "choice", ["Unit", "Gear", "Program"].map(t => ({ label: t, v: t })), o2 => { const t = o2 ? o2.v : "Unit"; const c = P.deck.shift(); say(G, `${P.name} sceglie «${t}» e rivela ${c.card.dn} (${c.card.type}).`);
          if(c.card.type === t){ P.hand.push(c); let k = 0; for(const e of P.eddies) if(e.spent && k < o.eddies){ e.spent = false; k++; } say(G, `${c.card.dn} va in mano e ${P.name} prepara ${k} Eddie.`); } else { P.trash.push(c); fxEv(G, "mill", { p: P.id, s: S_, c: [fxCard(c)] }); say(G, `${c.card.dn} va nel trash.`); } next(); }, { typeChoice: true }); break; }
      case "bottomDeck": {
        const Q = o.who === "rival" ? R : P;
        let pool = Q.field.filter(u => (!o.unequipped || !(u.gear || []).length) && (!o.spentOnly || u.spent) && (!o.readyOnly || !u.spent) && (o.maxPower == null || power(u) <= o.maxPower));
        if(o.lowest && pool.length){ const m = Math.min(...pool.map(power)); pool = pool.filter(u => power(u) === m); }
        askE(P.id, "target", unitOpts(G, pool), o2 => { if(o2){ fxEv(G, "bottom", { s: S_, t: [o2.unit.uid] }); bottomDeckUnit(G, Q, o2.unit); if(o.then) runEffects(G, P, src, o.then, trigger, next, ctx); else next(); } else next(); }); break; }
      case "bottomDeckSelf": { const u = ctx.holder || src; if(P.field.includes(u)){ fxEv(G, "bottom", { s: S_, t: [u.uid] }); bottomDeckUnit(G, P, u); } next(); break; }
      case "bounceSelf": { const u = ctx.holder || src; const i = P.field.indexOf(u); if(i >= 0){ P.field.splice(i, 1); for(const g of u.gear || []) P.trash.push(g); const c = { uid: u.uid, cid: u.cid, pid: u.pid, card: u.card, fx: u.fx }; P.hand.push(c); say(G, `${u.card.dn} torna in mano.`); } next(); break; }
      case "moveGear": { const l = ctx.holder || src; const gears = l.gear || []; const targets = P.field.filter(u => !(u.gear || []).length);
        if(!gears.length || !targets.length){ next(); break; }
        askE(P.id, "pickcard", [...gears.map(g => ({ label: g.card.dn, g })), { label: "Nessuno", g: null }], a => { if(!a || !a.g){ next(); return; }
          askE(P.id, "target", unitOpts(G, targets), b => { if(b){ l.gear.splice(l.gear.indexOf(a.g), 1); b.unit.gear = b.unit.gear || []; b.unit.gear.push(a.g); say(G, `${a.g.card.dn} passa a ${b.unit.card.dn}.`); if(o.readyIt && b.unit.spent){ b.unit.spent = false; say(G, `${b.unit.card.dn} è di nuovo pronta.`); } } next(); }); }); break; }
      case "peekLegend": { const fd = P.legends.filter(l => !l.faceUp && !l.removed); if(!fd.length){ next(); break; }
        if(o.pick){ askE(P.id, "pickcard", [...fd.map(l => ({ label: `Guarda la Leggenda coperta ${P.legends.indexOf(l) + 1}`, l })), { label: "Nessuna", l: null }], o2 => { if(o2 && o2.l){ ctx.peeked = o2.l; G.events.push({ kind: "peek", p: P.id, legends: [o2.l.card.dn] }); say(G, `${P.name} guarda una Leggenda coperta (solo lui ne vede il nome).`); } next(); }); break; }
        G.events.push({ kind: "peek", p: P.id, legends: (o.all ? fd : [fd[0]]).map(l => l.card.dn) }); say(G, `${P.name} guarda ${o.all ? "le Leggende coperte" : "una Leggenda coperta"} (solo lui ne vede il nome).`); next(); break; }
      case "manualText": case "manual": say(G, `${src.card.dn} — effetto manuale: «${o.text}»`, "manual"); G.events.push({ kind: "manual", p: P.id, card: src.card.dn, text: o.text }); next(); break;
      default: next();
    }
  };
  next();
}
function bottomDeckUnit(G, Q, u){
  const i = Q.field.indexOf(u); if(i < 0) return;
  Q.field.splice(i, 1);
  if(u.isLegend){ u.legendRef.removed = true; u.legendRef.onField = false; say(G, `${u.card.dn} esce dal gioco.`); return; }
  for(const g of u.gear || []) Q.trash.push(g);
  Q.deck.push({ uid: u.uid, cid: u.cid, pid: u.pid, card: u.card, fx: u.fx });
  say(G, `${u.card.dn} va in fondo al mazzo di ${Q.name}.`);
}
/* gioca una carta senza pagarla (effetti "play … for free") */
function playFreeCard(G, P, c, how, done, o = {}){
  if(c.card.type === "Gear"){
    const hosts = [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)].filter(h => !o.cls || h !== o.excludeHost);
    if(!hosts.length){ P.hand.push(c); done(); return; }
    ask(G, P.id, "target", hosts.map(h => ({ label: h.card.dn, unit: h })), o3 => { if(o3){ o3.unit.gear = o3.unit.gear || []; o3.unit.gear.push(c); say(G, `${P.name} equipaggia ${c.card.dn} a ${o3.unit.card.dn} ${how}.`, "play"); runEffects(G, P, o3.unit, c.fx.play, "Play", done, { srcCard: c }); } else { P.hand.push(c); done(); } });
    return;
  }
  putInPlay(G, P, c, how, done, o);
}

/* ------------------------------------------------------------ strumenti manuali (per gli effetti non interpretati) */
export const manual = {
  draw: (G, pi, n = 1) => { draw(G, G.players[pi], n); },
  toggleSpent: (G, pi, uid) => { const P = G.players[pi]; const x = P.field.find(u => u.uid === uid) || P.legends.find(l => l.uid === uid) || P.eddies.find(e => e.uid === uid); if(x){ x.spent = !x.spent; if(x.lag !== undefined) x.lag = false; } },
  mod: (G, pi, uid, d) => { const u = G.players[pi].field.find(u => u.uid === uid); if(u) u.mod = (u.mod || 0) + d; },
  defeat: (G, pi, uid) => { const P = G.players[pi]; const u = P.field.find(u => u.uid === uid); if(u) defeat(G, P, u); },
  gig: (G, pi, uid, d) => { const g = G.players[pi].gigs.find(g => g.uid === uid); if(g) g.value = Math.max(1, Math.min(g.sides, g.value + d)); },
  moveGig: (G, pi, uid) => { const P = G.players[pi], R = rival(G, P); const i = P.gigs.findIndex(g => g.uid === uid); if(i >= 0) R.gigs.push(P.gigs.splice(i, 1)[0]); },
  discard: (G, pi, uid) => { const P = G.players[pi]; const i = P.hand.findIndex(c => c.uid === uid); if(i >= 0) P.trash.push(P.hand.splice(i, 1)[0]); },
  flip: (G, pi, idx) => { const l = G.players[pi].legends[idx]; if(l) l.faceUp = !l.faceUp; },
  concede: (G, pi) => { win(G, 1 - pi, `${G.players[pi].name} si arrende`); }
};

/* ------------------------------------------------------------ vista per il bot/UI */
export function legalActions(G, pi){
  const P = G.players[pi], R = rival(G, P), acts = [];
  if(G.winner != null || G.pending || G.active !== pi || G.phase !== "main") return acts;
  if(!P.sold) for(const c of P.hand) if(c.card.eddiable) acts.push({ t: "sell", uid: c.uid, card: c });
  for(const c of P.hand){
    const cost = costOf(G, P, c); if(!canPay(P, cost)) continue;
    if(c.card.type === "Gear"){ for(const t of [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)]) acts.push({ t: "play", uid: c.uid, card: c, target: t.uid, targetObj: t }); }
    else acts.push({ t: "play", uid: c.uid, card: c });
  }
  if(!P.called && canPay(P, callCost(G, P)) && P.legends.some(l => !l.faceUp && !l.removed)) acts.push({ t: "call" });
  P.legends.forEach((l, i) => { if(!l.removed && !l.onField && l.faceUp && (l.card.kw || []).includes("Go Solo") && l.card.cost != null && canPay(P, goSoloCost(G, P, l))) acts.push({ t: "gosolo", idx: i, legend: l }); });
  P.legends.forEach((l, i) => { if(!l.removed && !l.onField && l.faceUp && l.card.cost != null && canPay(P, l.card.cost)) acts.push({ t: "legendplay", idx: i, legend: l }); });
  for(const x of [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)]) if(hasSpend(x) && !x.spent && !x.lag && ready(P) - (P.legends.includes(x) ? 1 : 0) >= spendCost(G, P, x)) acts.push({ t: "spend", uid: x.uid, obj: x, src: spendSrc(x) });
  for(const u of P.field){
    if(!canAttack(G, P, u)) continue;
    // bersagli: Unità spese (o pronte, con gli effetti che lo consentono) e area Gig, nel rispetto dei limiti «solo Unità» / «solo Gig» di questo turno
    if(!u.onlyGigsThisTurn) for(const t of R.field){ const readyOk = (hasKw(t, "Blocker") && u.fx.attackReadyBlockersIf && testCond(G, P, u, u.fx.attackReadyBlockersIf)) || u.attackReady; if(t.spent || readyOk) acts.push({ t: "attack", uid: u.uid, unit: u, target: { kind: "unit", uid: t.uid }, targetObj: t }); }
    if(R.gigs.length && !u.fx.onlyUnits && !u.onlyUnitsThisTurn && (power(u) >= 1 || u.fx.attack.length)) acts.push({ t: "attack", uid: u.uid, unit: u, target: { kind: "gigs" } });
  }
  acts.push({ t: "end" });
  return acts;
}
export function doAction(G, pi, a){
  switch(a.t){
    case "sell": return sell(G, pi, a.uid);
    case "play": return play(G, pi, a.uid, a.target);
    case "call": return callLegend(G, pi, a.idx);
    case "gosolo": return goSolo(G, pi, a.idx);
    case "legendplay": return legendPlay(G, pi, a.idx);
    case "spend": return spendAbility(G, pi, a.uid);
    case "attack": return attack(G, pi, a.uid, a.target);
    case "end": return endTurn(G);
  }
  return false;
}
/* stato sintetico, utile per i test */
export function summary(G){
  return G.players.map(P => ({ name: P.name, hand: P.hand.length, deck: P.deck.length, eddies: P.eddies.length, field: P.field.map(u => `${u.card.dn}:${power(u)}${u.spent ? "s" : ""}${u.lag ? "L" : ""}`), gigs: P.gigs.map(g => `d${g.sides}=${g.value}`), cred: streetCred(P), legends: P.legends.map(l => (l.faceUp ? "↑" : "↓") + (l.spent ? "s" : "") + (l.removed ? "x" : "")) }));
}

/* ------------------------------------------------------------ mosse serializzabili (partite online)
   Una partita online è seme + mazzi + elenco di mosse: ogni telefono le applica
   nello stesso ordine e ottiene lo stesso stato.                                */
export function moveOf(a){ const m = { t: a.t }; for(const k of ["uid", "target", "idx"]) if(a[k] !== undefined) m[k] = a[k]; return m; }
/* mossa arrivata dalla rete: vale solo se la fa chi ne ha il diritto. `seat` è il posto di chi l'ha inviata
   secondo il database (non secondo la mossa stessa): azioni solo nel proprio turno, scelte solo sulle
   proprie decisioni in sospeso, mulligan solo il proprio. Le mosse rifiutate non toccano la partita,
   allo stesso modo su entrambi i telefoni. */
export function applyMoveAs(G, seat, m){
  if(!m || typeof m !== "object" || (seat !== 0 && seat !== 1)) return false;
  if(m.k === "a"){ if(m.p !== seat || G.active !== seat || !m.a || typeof m.a !== "object") return false; return applyMove(G, m); }
  if(m.k === "r"){
    if(!G.pending || G.pending.player !== seat) return false;
    const i = m.i; if(i != null && i !== -1 && !(Number.isInteger(i) && i >= 0 && i < G.pending.options.length)) return false;
    return applyMove(G, m);
  }
  if(m.k === "m"){ if(m.p !== seat) return false; return applyMove(G, m); }
  return false;
}
export function applyMove(G, m){
  if(!m) return false;
  if(m.k === "a") return doAction(G, m.p, m.a);
  if(m.k === "r") return resolve(G, m.i);
  if(m.k === "m"){ if(G.players[m.p].mulliganed) return false; return mulligan(G, m.p, !!m.d); }
  return false;
}
