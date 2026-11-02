/* Motore di regole del Cyberpunk TCG — puro, senza DOM, collaudabile in Node.

   Regole di base applicate per intero: fasi del turno, Eddies e vendita,
   Chiamata delle Leggende, Leggende spese come 1 €$, Go Solo, Lag e
   Adrenaline, attacchi a Unità spese o all'area Gig, Blocker, furto dei Gig
   in base alla potenza, Street Cred, vittoria a 7 Gig, overtime, deck-out.

   Effetti delle carte: quelli più comuni sono interpretati dal testo
   (pesca, +potenza, trash, Gig ±N, sconfiggi/spendi Unità rivali, scarti);
   il resto viene segnalato come «manuale» e lasciato ai giocatori (il bot
   li ignora).                                                             */

export const DICE = [4, 6, 8, 10, 12, 20];
export const MAX_TURNS_BEFORE_OT = 7;

/* ------------------------------------------------------------ utilità */
export function mulberry32(seed){
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (arr, rng) => { for(let i = arr.length - 1; i > 0; i--){ const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const rollDie = (sides, rng) => 1 + Math.floor(rng() * sides);

/* ------------------------------------------------------------ effetti dal testo */
const RX = [
  [/\bdraw (\d+)\b/i, m => ({ op: "draw", n: +m[1] })],
  [/\btrash (\d+)\b/i, m => ({ op: "mill", n: +m[1] })],
  [/^give a friendly unit \+(\d+) power this turn\.?$/i, m => ({ op: "buff", n: +m[1], who: "friendly" })],
  [/^give this unit \+(\d+) power this turn\.?$/i, m => ({ op: "buffSelf", n: +m[1] })],
  [/^this unit has \+(\d+) power this turn\.?$/i, m => ({ op: "buffSelf", n: +m[1] })],
  [/increase a gig by up to (\d+)/i, m => ({ op: "gig", n: +m[1], mode: "up" })],
  [/adjust a gig by (?:up to )?(\d+)/i, m => ({ op: "gig", n: +m[1], mode: "adj" })],
  [/defeat all other units/i, () => ({ op: "defeatAllOther" })],
  [/defeat a rival unit with power (\d+) or less/i, m => ({ op: "defeat", max: +m[1], by: "power" })],
  [/defeat a rival unit with cost (\d+) or less/i, m => ({ op: "defeat", max: +m[1], by: "cost" })],
  [/defeat a rival gear with power (\d+) or less/i, m => ({ op: "defeatGear", max: +m[1] })],
  [/defeat a spent unit/i, () => ({ op: "defeat", spentOnly: true, any: true })],
  [/spend all rival units/i, () => ({ op: "spendAll" })],
  [/spend a rival unit with cost (\d+) or less/i, m => ({ op: "spend", max: +m[1] })],
  [/spend a rival unit/i, () => ({ op: "spend" })],
  [/a rival discards (\d+)/i, m => ({ op: "rivalDiscard", n: +m[1] })],
  [/discard (\d+)\b/i, m => ({ op: "discard", n: +m[1] })],
];
/* schemi che coprono più frasi (vengono provati prima, sull'inizio della riga) */
const LINE_RX = [
  [/^search the top (\d+) cards? of your deck\.\s*reveal (up to (\d+)|an?|any number of) (unit|gear|program|card)s?( with cost (\d+) or less)? and add (?:them|it) to your hand\.\s*bottom-deck the rest( in a random order)?\.?/i,
    m => ({ op: "searchTop", n: +m[1], k: m[3] ? +m[3] : /any number/i.test(m[2]) ? 99 : 1, type: cap(m[4]), maxCost: m[6] ? +m[6] : null, random: !!m[7] })],
  [/^trash (\d+)\.\s*(?:then, )?add (?:an?|1) (?:([A-Z]{3,}) )?(unit|gear|program|card) from (among them|your trash) to your hand\.?/i,
    m => [{ op: "mill", n: +m[1] }, { op: "fromTrash", cls: m[2] ? m[2].toUpperCase() : null, type: cap(m[3]), milled: /among/i.test(m[4]) }]],
  [/^you may defeat a friendly gear\.\s*if you do, draw (\d+)\.\s*otherwise, draw (\d+)\.?/i, m => ({ op: "mayDefeatGearDraw", yes: +m[1], no: +m[2] })],
  [/^you may call a legend for free\.?/i, () => ({ op: "freeCall" })],
  [/^play a (unit|gear|program) with cost (\d+) or less from your hand for free\.?/i, m => ({ op: "playFree", type: cap(m[1]), maxCost: +m[2] })],
  [/^swap a friendly gig with a rival gig\.?/i, () => ({ op: "swapGig" })],
  [/^set a player's gig to the same value as another player's gig\.?/i, () => ({ op: "setGigLike" })],
  [/^ready up to (\d+) friendly units\.?/i, m => ({ op: "readyUnits", n: +m[1] })],
  [/^ready a friendly face-up legend\.?/i, () => ({ op: "readyLegend" })],
  [/^spend this unit and a rival unit\.?/i, () => [{ op: "spendSelf" }, { op: "spend" }]],
  [/^give another friendly unit with cost (\d+) or less \{?adrenaline\}? this turn\.?/i, m => ({ op: "adrenaline", maxCost: +m[1] })],
  [/^spend a rival unit\.\s*it can't ready until your next turn\.?/i, () => ({ op: "spend", lock: true })],
];
const cap = w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w;
const MANUAL_START = /^(if|when|while|the first time|the next time|until|during|at the (start|end)|each player|rivals?|you may|play (a|this|your|up to)|search|reveal|look|set|swap|move|bottom-deck|equip|sell|ready|add|a friendly|other friendly|friendly|rival units|this unit (can|wins|has|steals)|units|play)/i;

function parseBody(body){
  const ops = [];
  let rest = body.trim();
  // 1) schemi a più frasi, dall'inizio
  let again = true;
  while(again && rest){
    again = false;
    for(const [rx, mk] of LINE_RX){
      const m = rest.match(rx);
      if(m){ const r = mk(m); for(const o of [].concat(r)) ops.push({ ...o, text: m[0] }); rest = rest.slice(m[0].length).trim(); again = true; break; }
    }
  }
  // 2) frasi singole
  for(const sentence of rest.split(/(?<=\.)\s+/)){
    const t = sentence.trim(); if(!t) continue;
    if(MANUAL_START.test(t)){ ops.push({ op: "manual", text: t }); continue; }
    let hit = null;
    for(const [rx, mk] of RX){ const m = t.match(rx); if(m){ hit = mk(m); hit.text = t; break; } }
    ops.push(hit || { op: "manual", text: t });
  }
  return ops;
}
/* divide il testo in righe e frasi, ignorando i promemoria tra parentesi;
   "Choose one effect. A // B" diventa una scelta tra due liste di effetti */
export function parseEffects(text){
  const out = { play: [], call: [], attack: [], defeated: [], spend: [], passive: [], manual: [], quick: false, cantAttack: false, onlyUnits: false };
  if(!text) return out;
  const clean = text.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  if(/this unit can't attack\b(?! unless)/i.test(clean)) out.cantAttack = true;
  if(/can only attack rival units/i.test(clean)) out.onlyUnits = true;
  if(/\{Quick\}/.test(text)) out.quick = true;
  const lines = text.replace(/\([^)]*\)/g, " ").split(/\n/).map(l => l.trim()).filter(Boolean);
  let key = "passive", chooseFor = null;
  for(const l of lines){
    // {Quick} e il costo in €$ possono precedere l'innesco: "{Quick} 1 €$, {Spend} …"
    const head = l.replace(/^(\{Quick\}\s*|\d+\s*€\$,?\s*)+/i, "");
    const trig = head.match(/^\{(Play|Call|Attack|Defeated|Spend)\}/i);
    const triggers = (head.match(/^(\{(Play|Call|Attack|Defeated|Spend)\}:?\s*)+/i) || [""])[0].match(/Play|Call|Attack|Defeated|Spend/gi) || [];
    if(trig) key = trig[1].toLowerCase();
    else if(!chooseFor) key = "passive";
    const body = l.replace(/^(\{[^}]+\}:?\s*|[\d]+\s*€\$,?\s*)+/g, "").trim();
    let ops;
    if(/^choose one effect\.?$/i.test(body)){ chooseFor = key; continue; }
    if(body.includes("//")){
      const alts = body.split(/\s*\/\/\s*/).map(a => ({ text: a.trim(), ops: parseBody(a) }));
      ops = [{ op: "choose", alts, text: body }];
      if(chooseFor){ key = chooseFor; chooseFor = null; }
    } else ops = parseBody(body);
    const keys = triggers.length > 1 ? triggers.map(t => t.toLowerCase()) : [key];
    for(const k of keys){ if(k === "passive") out.passive.push(...ops.filter(o => o.op !== "manual")); else out[k].push(...ops); }
    out.manual.push(...ops.filter(o => o.op === "manual").map(o => o.text));
  }
  return out;
}

/* ------------------------------------------------------------ creazione partita */
let UID = 1;
function inst(card, pid){ return { uid: UID++, cid: card.id, pid: pid || (card.def && card.def.id) || null, card, fx: parseEffects(card.text) }; }

/* deck: { name, legends:[{cid,pid}], cards:[{cid,pid,n}] }; cards: Map id → carta */
export function createGame(decks, cardsById, opts = {}){
  const rng = opts.rng || mulberry32(opts.seed ?? (Date.now() & 0xffffffff));
  const G = { turn: 0, active: 0, first: 0, phase: "setup", log: [], winner: null, reason: "", overtime: false, rng, pending: null, players: [], auto: [!!opts.bot0, !!opts.bot1], autoPay: opts.autoPay || [false, false], events: [] };
  decks.forEach((d, i) => {
    const P = { id: i, name: d.name || `Giocatore ${i + 1}`, deck: [], hand: [], trash: [], eddies: [], legends: [], field: [], fixer: DICE.slice(), gigs: [], sold: false, called: false, turns: 0, removed: [] };
    for(const e of d.cards){ const c = cardsById.get(e.cid); if(!c) continue; for(let k = 0; k < e.n; k++) P.deck.push(inst(c, e.pid)); }
    for(const l of d.legends.filter(Boolean)){ const c = cardsById.get(l.cid); if(c) P.legends.push({ ...inst(c, l.pid), faceUp: false, spent: false, gear: [] }); }
    shuffle(P.deck, rng); shuffle(P.legends, rng);
    G.players.push(P);
  });
  // tiro del d20 per chi inizia: il vincitore sceglie, qui inizia sempre lui
  let a, b; do { a = rollDie(20, rng); b = rollDie(20, rng); } while(a === b);
  G.first = a > b ? 0 : 1; G.active = G.first;
  say(G, `Tiro iniziale: ${G.players[0].name} ${a} – ${G.players[1].name} ${b}. Inizia ${G.players[G.first].name}.`);
  for(const P of G.players){ draw(G, P, 6, true); }
  // chi inizia spende le 2 Leggende più a sinistra e non le prepara al primo turno
  const F = G.players[G.first]; F.legends[0].spent = true; F.legends[1].spent = true; F.skipReadyLegends = true;
  G.phase = "mulligan";
  return G;
}
export function mulligan(G, pi, doIt){
  const P = G.players[pi];
  if(doIt){ P.deck.push(...P.hand); P.hand = []; shuffle(P.deck, G.rng); draw(G, P, 6, true); say(G, `${P.name} fa mulligan.`); }
  P.mulliganed = true;
  if(G.players.every(p => p.mulliganed)) startTurn(G);
}

/* ------------------------------------------------------------ fasi */
function say(G, text, kind = "info"){ G.log.push({ t: G.turn, p: G.active, text, kind }); if(G.log.length > 400) G.log.shift(); }
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
  if(G.overtime && P.gigs.length > rival(G, P).gigs.length){ win(G, P.id, `Overtime: ${P.name} ha più Gig (${P.gigs.length} contro ${rival(G, P).gigs.length})`); return; }
  // 1) prepara
  for(const e of P.eddies) e.spent = false;
  if(P.skipReadyLegends){ P.skipReadyLegends = false; } else for(const l of P.legends) l.spent = false;
  for(const u of P.field){ if(u.cantReady){ u.cantReady = false; } else u.spent = false; u.lag = false; u.mod = 0; }
  for(const u of rival(G, P).field) u.mod = 0;
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
  });
}
function win(G, pi, reason){ G.winner = pi; G.reason = reason; G.phase = "over"; say(G, reason, "end"); }

export function endTurn(G){
  if(G.winner != null || G.pending) return false;
  const P = G.players[G.active];
  G.phase = "end";
  for(const u of P.field) u.mod = 0;
  // overtime: dopo il 7º turno dell'ultimo giocatore
  if(!G.overtime && G.players.every(p => p.turns >= MAX_TURNS_BEFORE_OT) && G.active !== G.first){ G.overtime = true; say(G, "Overtime! Vince chi inizia un turno con più Gig del rivale.", "turn"); }
  G.active = 1 - G.active;
  startTurn(G);
  return true;
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
  for(const l of legs.filter(l => l.faceUp && !l.fx.spend.length)){ if(left){ l.spent = true; left--; } }
  for(const l of legs.filter(l => l.faceUp && l.fx.spend.length)){ if(left){ l.spent = true; left--; } }
  return left === 0;
}
export const canPay = (P, cost) => ready(P) >= cost;
const legendLabel = (P, l) => l.faceUp ? `Leggenda ${l.card.dn}${l.fx.spend.length ? " (ha un'abilità Spend)" : ""}` : `Leggenda coperta ${P.legends.indexOf(l) + 1}`;
/* pagamento con scelta del giocatore. Bot e giocatori con il pagamento automatico
   pagano da soli; a loro viene chiesto solo quando toccherebbe spendere una
   Leggenda scoperta con un'abilità {Spend} ancora utilizzabile.
   cb() quando il pagamento è completo; onCancel() se il giocatore rinuncia. */
function payAsk(G, P, cost, cb, onCancel){
  if(cost <= 0){ cb(); return; }
  if(!canPay(P, cost)){ onCancel && onCancel(); return; }
  const legs = () => P.legends.filter(l => !l.spent && !l.removed && !l.onField);
  const autoPay = G.auto[P.id] || (G.autoPay && G.autoPay[P.id]);
  if(autoPay){
    const needLeg = Math.max(0, cost - readyEddies(P));
    const abilityLegs = legs().filter(l => l.faceUp && l.fx.spend.length);
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
      if(stillNeed <= 0){ for(const e of P.eddies) if(!e.spent) e.spent = true; for(const l of legs().filter(l => !(l.faceUp && l.fx.spend.length))) l.spent = true; for(const l of picked) l.spent = true; cb(); return; }
      const opts = abilityLegs.filter(l => !picked.includes(l)).map(l => ({ label: `Spendi ${legendLabel(P, l)}`, l }));
      ask(G, P.id, "pay", [...opts, { label: "Annulla", l: null }], o => { if(o && o.l){ picked.push(o.l); pickLeg(); } else onCancel && onCancel(); }, { cost, paid: cost - stillNeed, need: stillNeed, confirm: true });
    };
    pickLeg(); return;
  }
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

export function callLegend(G, pi, idx, done){
  const P = G.players[pi]; if(G.pending || P.called) return err(G, "Hai già chiamato una Leggenda in questo turno");
  const faceDown = P.legends.filter(l => !l.faceUp && !l.removed);
  if(!faceDown.length) return err(G, "Nessuna Leggenda coperta");
  if(!canPay(P, 1)) return err(G, "Serve 1 €$");
  // non puoi guardarle prima: la scelta è di fatto casuale
  const l = idx != null && P.legends[idx] && !P.legends[idx].faceUp ? P.legends[idx] : faceDown[Math.floor(G.rng() * faceDown.length)];
  payAsk(G, P, 1, () => {
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
  if(!(l.card.kw || []).includes("Go Solo") || l.card.cost == null) return err(G, `${l.card.dn} non ha Go Solo`);
  const extra = rival(G, P).field.some(u => (u.gear || []).some(g => /pay \+2 €\$ to use \{Go Solo\}/i.test(g.card.text))) ? 2 : 0;
  if(!canPay(P, l.card.cost + extra)) return err(G, `Servono ${l.card.cost + extra} €$`);
  l.onField = true;   // non può pagare se stessa
  payAsk(G, P, l.card.cost + extra, () => {
    l.faceUp = true; l.spent = false;
    const u = { ...l, spent: false, lag: false, mod: 0, isLegend: true, legendRef: l }; delete u.onField;
    P.field.push(u);
    say(G, `${P.name} manda ${l.card.dn} in Go Solo (${power(u)} potenza).`, "play");
    runEffects(G, P, u, u.fx.play, "Play");
  }, () => { l.onField = false; });
  return true;
}

export function play(G, pi, uid, targetUid){
  const P = G.players[pi]; if(G.active !== pi || G.phase !== "main" || G.pending) return err(G, "Non è il momento");
  const i = P.hand.findIndex(c => c.uid === uid); if(i < 0) return err(G, "Carta non in mano");
  const c = P.hand[i], card = c.card;
  let cost = card.cost ?? 0;
  if(card.type === "Gear"){
    const t = [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)].find(x => x.uid === targetUid);
    if(!t) return err(G, "Scegli un'Unità o una Leggenda scoperta a cui equipaggiare");
    if(!canPay(P, cost)) return err(G, `Servono ${cost} €$`);
    payAsk(G, P, cost, () => {
      P.hand.splice(P.hand.indexOf(c), 1);
      t.gear = t.gear || []; t.gear.push(c);
      say(G, `${P.name} equipaggia ${card.dn} a ${t.card.dn}.`, "play");
      runEffects(G, P, t, c.fx.play, "Play");
    });
    return true;
  }
  if(!canPay(P, cost)) return err(G, `Servono ${cost} €$ (ne hai ${ready(P)})`);
  payAsk(G, P, cost, () => { P.hand.splice(P.hand.indexOf(c), 1); putInPlay(G, P, c); });
  return true;
}
function putInPlay(G, P, c, how = "", done){
  const card = c.card;
  if(card.type === "Unit"){
    const u = { ...c, spent: false, lag: !hasKw(c, "Adrenaline"), mod: 0, gear: [] };
    P.field.push(u);
    say(G, `${P.name} gioca ${card.dn} (${power(u)})${how ? " " + how : ""}.`, "play");
    runEffects(G, P, u, u.fx.play, "Play", done);
  } else { // Program
    say(G, `${P.name} usa ${card.dn}${how ? " " + how : ""}.`, "play"); P.playedProgram = true;
    const ops = [...c.fx.play, ...c.fx.passive, ...c.fx.manual.map(text => ({ op: "manual", text }))].filter((o, k, arr) => arr.findIndex(x => x.text === o.text) === k);
    runEffects(G, P, c, ops, "Program", () => { if(!P.trash.includes(c)) P.trash.push(c); done && done(); });
  }
}

/* abilità {Spend} di Unità sul campo o Leggende scoperte */
export function spendAbility(G, pi, uid, done, reaction = false){
  const P = G.players[pi]; if(G.pending || (!reaction && (G.active !== pi || G.phase !== "main"))) return false;
  const x = P.field.find(u => u.uid === uid) || P.legends.find(l => l.uid === uid && l.faceUp && !l.removed && !l.onField);
  if(!x) return err(G, "Carta non trovata");
  if(x.spent || x.lag) return err(G, "Già spesa o con Lag");
  if(!x.fx.spend.length) return err(G, "Nessuna abilità {Spend}");
  const costM = +((x.card.text.match(/(\d+)\s*€\$,\s*\{Spend\}/) || [])[1] || 0);
  if(costM && !canPay(P, costM)) return err(G, `Servono ${costM} €$`);
  x.spent = true;   // la carta stessa non può pagare il proprio costo
  payAsk(G, P, costM, () => {
    say(G, `${P.name} spende ${x.card.dn} per l'abilità.`, "play");
    runEffects(G, P, x, x.fx.spend, "Spend", done);
  }, () => { x.spent = false; done && done(); });
  return true;
}
/* Programma con {Quick} giocato come reazione nel turno del rivale */
export function playQuick(G, pi, uid, done){
  const P = G.players[pi]; const i = P.hand.findIndex(c => c.uid === uid); if(i < 0) return false;
  const c = P.hand[i]; if(!c.fx.quick || c.card.type !== "Program" || !canPay(P, c.card.cost ?? 0)) return false;
  payAsk(G, P, c.card.cost ?? 0, () => { P.hand.splice(P.hand.indexOf(c), 1); putInPlay(G, P, c, "come reazione", done); }, done);
  return true;
}

/* ------------------------------------------------------------ attacco */
export function canAttack(G, P, u){
  if(u.spent || u.lag) return false;
  if(u.fx.cantAttack) return false;
  if(/can't attack unless you played a program this turn/i.test(u.card.text) && !P.playedProgram) return false;
  return true;
}
export function attack(G, pi, uid, target){
  const P = G.players[pi], R = rival(G, P);
  if(G.active !== pi || G.phase !== "main" || G.pending) return err(G, "Non è il momento");
  const u = P.field.find(x => x.uid === uid); if(!u) return err(G, "Unità non trovata");
  if(!canAttack(G, P, u)) return err(G, `${u.card.dn} non può attaccare`);
  let tu = null;
  if(target.kind === "unit"){
    tu = R.field.find(x => x.uid === target.uid); if(!tu) return err(G, "Bersaglio non trovato");
    if(!tu.spent && !(hasKw(tu, "Blocker") && /can attack ready units with \{Blocker\}/i.test(u.card.text) && streetCred(P) > streetCred(R))) return err(G, "Puoi attaccare solo Unità spese");
  } else {
    if(u.fx.onlyUnits) return err(G, `${u.card.dn} può attaccare solo Unità`);
    if(!R.gigs.length) return err(G, "Il rivale non ha Gig");
    if(power(u) < 1) return err(G, "Con potenza 0 non si rubano Gig");
  }
  u.spent = true;
  say(G, `${P.name}: ${u.card.dn} (${power(u)}) attacca ${tu ? tu.card.dn + " (" + power(tu) + ")" : "l'area Gig"}.`, "attack");
  runEffects(G, P, u, u.fx.attack, "Attack");
  // finestra di reazione del difensore: Chiamata, Quick, Blocker
  const proceed = blocker => {
    if(G.winner != null) return;
    if(blocker){
      blocker.spent = true;
      say(G, `${R.name}: ${blocker.card.dn} blocca (${power(blocker)}).`, "attack");
      fight(G, P, u, R, blocker, true);
      return;
    }
    if(!P.field.includes(u)){ say(G, `${u.card.dn} non è più in campo: l'attacco si annulla.`); return; }
    if(tu && !R.field.includes(tu)){ say(G, `${tu.card.dn} non è più in campo: l'attacco si annulla.`); return; }
    if(tu) fight(G, P, u, R, tu, false); else steal(G, P, u, R);
  };
  reactionWindow(G, R, u, tu, proceed);
  return true;
}
function reactionWindow(G, R, au, tu, proceed){
  const opts = [{ label: "Non reagire", kind: "none", uid: null }];
  for(const b of R.field) if(!b.spent && !b.lag && hasKw(b, "Blocker") && b !== tu) opts.push({ label: `Blocca con ${b.card.dn} (${power(b)})`, kind: "block", uid: b.uid, unit: b });
  if(!R.called && canPay(R, 1)) R.legends.forEach((l, i) => { if(!l.faceUp && !l.removed) opts.push({ label: `Chiama la Leggenda ${i + 1} (1 €$)`, kind: "call", idx: i }); });
  for(const c of R.hand) if(c.fx.quick && c.card.type === "Program" && canPay(R, c.card.cost ?? 0)) opts.push({ label: `Quick: ${c.card.dn} (${c.card.cost ?? 0} €$)`, kind: "quick", uid: c.uid, c });
  for(const x of [...R.field, ...R.legends.filter(l => l.faceUp && !l.removed && !l.onField)]) if(x.fx.quick && x.fx.spend.length && !x.spent && !x.lag) opts.push({ label: `Quick: abilità di ${x.card.dn}`, kind: "qspend", uid: x.uid });
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
  const pa = power(au), pd = power(du);
  if(pa > pd){ say(G, `${au.card.dn} vince ${pa}–${pd}: ${du.card.dn} sconfitta.`, "fight"); defeat(G, D, du); }
  else if(pd > pa){ say(G, `${du.card.dn} vince ${pd}–${pa}: ${au.card.dn} sconfitta.`, "fight"); defeat(G, A, au); }
  else { say(G, `Pareggio ${pa}–${pd}: entrambe sconfitte.`, "fight"); defeat(G, D, du); defeat(G, A, au); }
  if(blocked) say(G, "Attacco deviato: nessun Gig rubato.", "fight");
}
function steal(G, A, au, D){
  const n = Math.min(D.gigs.length, 1 + Math.floor(power(au) / 10));
  const pickOne = k => {
    if(k >= n || !D.gigs.length){ checkMajority(G); return; }
    ask(G, A.id, "steal", D.gigs.map(g => ({ label: `d${g.sides} = ${g.value}`, gig: g })), o => {
      const g = o.gig; D.gigs.splice(D.gigs.indexOf(g), 1); A.gigs.push(g);
      say(G, `${A.name} ruba un d${g.sides} (${g.value}) — ${A.gigs.length} Gig.`, "steal");
      pickOne(k + 1);
    });
  };
  pickOne(0);
}
function checkMajority(G){ /* la vittoria si controlla all'inizio del turno */ }

export function defeat(G, P, u){
  const i = P.field.indexOf(u); if(i < 0) return;
  P.field.splice(i, 1);
  if(u.isLegend){ u.legendRef.removed = true; u.legendRef.onField = false; say(G, `${u.card.dn} esce dal gioco (Go Solo).`); }
  else { P.trash.push(u); for(const g of u.gear || []) P.trash.push(g); }
  runEffects(G, P, u, u.fx.defeated, "Defeated");
  for(const g of u.gear || []) runEffects(G, P, u, g.fx.defeated, "Defeated");
}

/* ------------------------------------------------------------ effetti */
function runEffects(G, P, src, ops, trigger, done){
  const R = rival(G, P);
  const queue = ops.slice();
  const next = () => {
    if(G.winner != null){ done && done(); return; }
    const o = queue.shift(); if(!o){ done && done(); return; }
    switch(o.op){
      case "draw": draw(G, P, o.n); next(); break;
      case "mill": { const n = Math.min(o.n, P.deck.length); const ms = P.deck.splice(0, n); P.trash.push(...ms); P.lastMilled = ms; say(G, `${P.name} manda ${n} carte nel trash (${ms.map(c => c.card.dn).join(", ") || "nessuna"}).`); next(); break; }
      case "fromTrash": {
        const pool = (o.milled ? (P.lastMilled || []) : P.trash).filter(c => (!o.type || o.type === "Card" || c.card.type === o.type) && (!o.cls || (c.card.cls || []).some(k => k.toUpperCase() === o.cls)));
        ask(G, P.id, "pickcard", [...pool.map(c => ({ label: c.card.dn, c })), { label: "Nessuna", c: null }], o2 => { if(o2 && o2.c){ P.trash.splice(P.trash.indexOf(o2.c), 1); P.hand.push(o2.c); say(G, `${P.name} recupera ${o2.c.card.dn} dal trash.`); } next(); }); break; }
      case "searchTop": {
        const top = P.deck.splice(0, Math.min(o.n, P.deck.length)); const taken = [];
        say(G, `${P.name} guarda le prime ${top.length} carte del mazzo.`);
        const pickOne = () => {
          const pool = top.filter(c => !taken.includes(c) && (o.type === "Card" || c.card.type === o.type) && (o.maxCost == null || (c.card.cost ?? 0) <= o.maxCost));
          if(!pool.length || taken.length >= o.k){ finish(); return; }
          ask(G, P.id, "pickcard", [...pool.map(c => ({ label: c.card.dn, c })), { label: taken.length ? "Basta così" : "Nessuna", c: null }], o2 => { if(o2 && o2.c){ taken.push(o2.c); P.hand.push(o2.c); say(G, `${P.name} aggiunge ${o2.c.card.dn} alla mano.`); pickOne(); } else finish(); });
        };
        const finish = () => { const rest = top.filter(c => !taken.includes(c)); if(o.random) shuffle(rest, G.rng); P.deck.push(...rest); if(rest.length) say(G, `${rest.length} carte in fondo al mazzo.`); next(); };
        pickOne(); break; }
      case "mayDefeatGearDraw": {
        const pool = []; for(const h of [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)]) for(const g of h.gear || []) pool.push({ label: `${g.card.dn} su ${h.card.dn}`, g, h });
        ask(G, P.id, "pickcard", [...pool, { label: `Nessuno (pesca ${o.no})`, g: null }], o2 => { if(o2 && o2.g){ o2.h.gear.splice(o2.h.gear.indexOf(o2.g), 1); P.trash.push(o2.g); say(G, `${P.name} sconfigge ${o2.g.card.dn}.`); draw(G, P, o.yes); } else draw(G, P, o.no); next(); }); break; }
      case "freeCall": {
        const fd = P.legends.filter(l => !l.faceUp && !l.removed);
        if(P.called || !fd.length){ say(G, P.called ? "Leggenda già chiamata in questo turno." : "Nessuna Leggenda coperta."); next(); break; }
        ask(G, P.id, "yesno", [{ label: "Chiama una Leggenda gratis", v: true }, { label: "No", v: false }], o2 => {
          if(o2 && o2.v){ const l = fd[Math.floor(G.rng() * fd.length)]; l.faceUp = true; P.called = true; say(G, `${P.name} chiama ${l.card.dn} gratis!`, "call"); runEffects(G, P, l, l.fx.call, "Call", next); } else next(); }); break; }
      case "playFree": {
        const pool = P.hand.filter(c => c.card.type === o.type && (c.card.cost ?? 0) <= o.maxCost);
        ask(G, P.id, "pickcard", [...pool.map(c => ({ label: `${c.card.dn} (${c.card.cost ?? 0})`, c })), { label: "Nessuna", c: null }], o2 => {
          if(!o2 || !o2.c){ next(); return; }
          const c = o2.c;
          if(c.card.type === "Gear"){
            const hosts = [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)];
            ask(G, P.id, "target", hosts.map(h => ({ label: h.card.dn, unit: h })), o3 => { if(o3){ P.hand.splice(P.hand.indexOf(c), 1); o3.unit.gear = o3.unit.gear || []; o3.unit.gear.push(c); say(G, `${P.name} equipaggia ${c.card.dn} a ${o3.unit.card.dn} gratis.`, "play"); runEffects(G, P, o3.unit, c.fx.play, "Play", next); } else next(); });
          } else { P.hand.splice(P.hand.indexOf(c), 1); putInPlay(G, P, c, "gratis", next); }
        }); break; }
      case "swapGig": {
        if(!P.gigs.length || !R.gigs.length){ next(); break; }
        ask(G, P.id, "gigpick", P.gigs.map(g => ({ label: `tuo d${g.sides} = ${g.value}`, gig: g })), a => { if(!a){ next(); return; }
          ask(G, P.id, "steal", R.gigs.map(g => ({ label: `rivale d${g.sides} = ${g.value}`, gig: g })), b => { if(b){ P.gigs.splice(P.gigs.indexOf(a.gig), 1, b.gig); R.gigs.splice(R.gigs.indexOf(b.gig), 1, a.gig); say(G, `${P.name} scambia il d${a.gig.sides} (${a.gig.value}) con il d${b.gig.sides} (${b.gig.value}) del rivale.`, "gig"); } next(); }); }); break; }
      case "setGigLike": {
        const all = [...P.gigs.map(g => ({ label: `tuo d${g.sides} = ${g.value}`, gig: g })), ...R.gigs.map(g => ({ label: `rivale d${g.sides} = ${g.value}`, gig: g }))];
        if(all.length < 2){ next(); break; }
        ask(G, P.id, "gigpick", all, a => { if(!a){ next(); return; }
          ask(G, P.id, "gigpick", all.filter(x => x.gig !== a.gig).map(x => ({ label: "come " + x.label, gig: x.gig })), b => { if(b){ const v = Math.min(a.gig.sides, b.gig.value); say(G, `Il d${a.gig.sides} passa da ${a.gig.value} a ${v}.`, "gig"); a.gig.value = v; } next(); }); }); break; }
      case "readyUnits": {
        let k = 0; const one = () => { const pool = P.field.filter(u => u.spent); if(k++ >= o.n || !pool.length){ next(); return; }
          ask(G, P.id, "target", [...pool.map(u => ({ label: `${u.card.dn} (${power(u)})`, unit: u })), { label: "Basta così", unit: null }], o2 => { if(o2 && o2.unit){ o2.unit.spent = false; say(G, `${o2.unit.card.dn} è di nuovo pronta.`); one(); } else next(); }); };
        one(); break; }
      case "readyLegend": ask(G, P.id, "target", P.legends.filter(l => l.faceUp && l.spent && !l.removed && !l.onField).map(l => ({ label: l.card.dn, unit: l })), o2 => { if(o2){ o2.unit.spent = false; say(G, `${o2.unit.card.dn} è di nuovo pronta.`); } next(); }); break;
      case "spendSelf": if(P.field.includes(src)) src.spent = true; next(); break;
      case "adrenaline": ask(G, P.id, "target", P.field.filter(u => u !== src && u.lag && (u.card.cost ?? 0) <= o.maxCost).map(u => ({ label: `${u.card.dn} (${power(u)})`, unit: u })), o2 => { if(o2){ o2.unit.lag = false; say(G, `${o2.unit.card.dn} ha Adrenaline: può attaccare subito.`); } next(); }); break;
      case "choose": ask(G, P.id, "choice", o.alts.map(a => ({ label: a.text, alt: a })), o2 => { if(o2){ say(G, `${P.name} sceglie: «${o2.alt.text}»`); runEffects(G, P, src, o2.alt.ops, trigger, next); } else next(); }); break;
      case "discard": ask(G, P.id, "discard", P.hand.map(c => ({ label: c.card.dn, c })), o2 => { if(o2){ P.hand.splice(P.hand.indexOf(o2.c), 1); P.trash.push(o2.c); say(G, `${P.name} scarta ${o2.c.card.dn}.`); } next(); }); break;
      case "rivalDiscard": {
        let k = 0; const one = () => { if(k++ >= o.n || !R.hand.length){ next(); return; } ask(G, R.id, "discard", R.hand.map(c => ({ label: c.card.dn, c })), o2 => { if(o2){ R.hand.splice(R.hand.indexOf(o2.c), 1); R.trash.push(o2.c); say(G, `${R.name} scarta ${o2.c.card.dn}.`); } one(); }); }; one(); break; }
      case "buff": ask(G, P.id, "target", P.field.map(u => ({ label: `${u.card.dn} (${power(u)})`, unit: u })), o2 => { if(o2){ o2.unit.mod = (o2.unit.mod || 0) + o.n; say(G, `${o2.unit.card.dn} +${o.n} potenza fino a fine turno.`); } next(); }); break;
      case "buffSelf": if(P.field.includes(src)){ src.mod = (src.mod || 0) + o.n; say(G, `${src.card.dn} +${o.n} potenza fino a fine turno.`); } next(); break;
      case "gig": {
        const opts = P.gigs.map(g => ({ label: `d${g.sides} = ${g.value}`, gig: g }));
        ask(G, P.id, "gigpick", opts, o2 => {
          if(!o2){ next(); return; }
          const g = o2.gig, range = [];
          for(let d = -(o.mode === "adj" ? o.n : 0); d <= o.n; d++){ const v = g.value + d; if(d && v >= 1 && v <= g.sides) range.push({ label: `${g.value} → ${v}`, v }); }
          ask(G, P.id, "gigvalue", range, o3 => { if(o3){ say(G, `${P.name} porta il d${g.sides} da ${g.value} a ${o3.v}.`, "gig"); g.value = o3.v; } next(); });
        }); break; }
      case "defeat": {
        const pool = (o.any ? [...P.field, ...R.field] : R.field).filter(u => (!o.spentOnly || u.spent) && (o.by === "power" ? power(u) <= o.max : o.by === "cost" ? (u.card.cost ?? 0) <= o.max : true));
        ask(G, P.id, "target", pool.map(u => ({ label: `${u.card.dn} (${power(u)})`, unit: u })), o2 => { if(o2){ const owner = P.field.includes(o2.unit) ? P : R; say(G, `${o2.unit.card.dn} sconfitta da ${src.card.dn}.`, "fight"); defeat(G, owner, o2.unit); } next(); }); break; }
      case "defeatGear": {
        const pool = []; for(const u of R.field) for(const g of u.gear || []) if((g.card.power ?? 0) <= o.max) pool.push({ label: `${g.card.dn} su ${u.card.dn}`, g, u });
        ask(G, P.id, "target", pool, o2 => { if(o2){ o2.u.gear.splice(o2.u.gear.indexOf(o2.g), 1); R.trash.push(o2.g); say(G, `${o2.g.card.dn} sconfitto.`); } next(); }); break; }
      case "defeatAllOther": { for(const u of [...P.field.filter(x => x !== src), ...R.field]){ const owner = P.field.includes(u) ? P : R; defeat(G, owner, u); } say(G, "Tutte le altre Unità sono sconfitte."); next(); break; }
      case "spendAll": for(const u of R.field) u.spent = true; say(G, `Tutte le Unità di ${R.name} sono spese.`); next(); break;
      case "spend": ask(G, P.id, "target", R.field.filter(u => !u.spent && (o.max == null || (u.card.cost ?? 0) <= o.max)).map(u => ({ label: `${u.card.dn} (${power(u)})`, unit: u })), o2 => { if(o2){ o2.unit.spent = true; if(o.lock) o2.unit.cantReady = true; say(G, `${o2.unit.card.dn} viene spesa${o.lock ? " e non si prepara al prossimo turno" : ""}.`); } next(); }); break;
      case "manual": say(G, `${src.card.dn} — effetto manuale: «${o.text}»`, "manual"); G.events.push({ kind: "manual", p: P.id, card: src.card.dn, text: o.text }); next(); break;
      default: next();
    }
  };
  next();
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
    const cost = c.card.cost ?? 0; if(!canPay(P, cost)) continue;
    if(c.card.type === "Gear"){ for(const t of [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)]) acts.push({ t: "play", uid: c.uid, card: c, target: t.uid, targetObj: t }); }
    else acts.push({ t: "play", uid: c.uid, card: c });
  }
  if(!P.called && canPay(P, 1) && P.legends.some(l => !l.faceUp && !l.removed)) acts.push({ t: "call" });
  P.legends.forEach((l, i) => { if(!l.removed && !l.onField && (l.card.kw || []).includes("Go Solo") && l.card.cost != null && canPay(P, l.card.cost)) acts.push({ t: "gosolo", idx: i, legend: l }); });
  for(const x of [...P.field, ...P.legends.filter(l => l.faceUp && !l.removed && !l.onField)]) if(x.fx.spend.length && !x.spent && !x.lag) acts.push({ t: "spend", uid: x.uid, obj: x });
  for(const u of P.field){
    if(!canAttack(G, P, u)) continue;
    for(const t of R.field) if(t.spent) acts.push({ t: "attack", uid: u.uid, unit: u, target: { kind: "unit", uid: t.uid }, targetObj: t });
    if(R.gigs.length && power(u) >= 1 && !u.fx.onlyUnits) acts.push({ t: "attack", uid: u.uid, unit: u, target: { kind: "gigs" } });
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
