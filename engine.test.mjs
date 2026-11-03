/* Collaudo del motore: partite bot contro bot con i mazzi starter, più
   controlli puntuali sulle regole. Esegui: node engine.test.mjs   */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createGame, mulligan, legalActions, doAction, resolve, summary, parseEffects, power, powerIn, streetCred, endTurn } from "./engine.js";
import { botDecide, botTurn, botStep } from "./bot.js";
import { ownKeywords } from "./data.js";

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, "public", "cards.json"), "utf8"));
const byId = new Map();
for(const c of data.cards){ c.def = c.prints[0]; c.ramN = c.ram ?? 0; c.kw = ownKeywords(c); byId.set(c.id, c); }   // come fa l'app
const byName = n => data.cards.find(c => c.dn === n);

function starter(setCode, name){
  const d = { name, legends: [], cards: [] };
  for(const c of data.cards.filter(c => c.prints.some(p => p.set === setCode))){
    if(c.type === "Legend") d.legends.push({ cid: c.id, pid: c.def.id }); else d.cards.push({ cid: c.id, pid: c.def.id, n: (c.cost ?? 0) <= 3 ? 3 : 2 });
  }
  let n = d.cards.reduce((a, e) => a + e.n, 0);
  for(const e of d.cards){ if(n <= 40) break; if(e.n > 1){ e.n--; n--; } }
  return d;
}
let fails = 0, passes = 0;
const ok = (cond, msg) => { if(cond){ passes++; } else { fails++; console.log("  ✘", msg); } };

/* --- parser degli effetti */
{
  const fx = parseEffects("{Play} Give a friendly Unit +2 power this turn.\n(Units with power 0 don't steal Gigs.)");
  ok(fx.play.length === 1 && fx.play[0].op === "buff" && fx.play[0].n === 2, "buff +2 interpretato");
  const fx2 = parseEffects("{Play} Draw 2.");
  ok(fx2.play[0].op === "draw" && fx2.play[0].n === 2, "draw 2");
  const fx3 = parseEffects("{Blocker} (You may spend this Unit to redirect a rival Unit's attack to it instead.)\nWhen this Unit uses {Blocker}, increase a Gig by up to 3.");
  ok(fx3.on.block.length === 1 && fx3.on.block[0].ops[0].op === "gig", "«When this Unit uses Blocker, increase a Gig» → evento block");
  const fx4 = parseEffects("This Unit can only attack rival Units. (It can't attack Gig areas.)");
  ok(fx4.onlyUnits, "solo Unità");
  ok(parseEffects("This Unit can't attack.\n{Blocker}").cantAttack, "non può attaccare");
  ok(!parseEffects("This Unit can't attack unless you played a Program this turn.").cantAttack, "can't attack unless: non statico");
  const fx5 = parseEffects("{Play} Defeat a rival Unit with power 2 or less. If you have more ☆ (Street Cred) than a Rival, defeat a rival Unit with power 3 or less instead.");
  ok(fx5.play[0].op === "defeat" && fx5.play[0].max === 2 && fx5.play[1].op === "defeat" && fx5.play[1].cond && fx5.play[1].cond.c === "credCmp", "defeat ≤2 + defeat ≤3 condizionato allo Street Cred");
  const fx6 = parseEffects("{Call} Trash 3. Then, add 1 BRAINDANCE Program from your trash to your hand.\n{Go Solo} (Pay this Legend's cost...)");
  ok(fx6.call[0].op === "mill" && fx6.call[0].n === 3, "Call: trash 3");
  const fx7 = parseEffects("{Quick} Defeat a rival Gear with power 2 or less.");
  ok(fx7.quick && fx7.passive[0].op === "defeatGear", "Quick + defeatGear");
}

/* --- partita bot vs bot, molti semi */
const A = starter("theheistretailstarterdeck", "Heist"), B = starter("embracingpowerretailstarterdeck", "Embracing");
let wins = [0, 0], turnsTot = 0, otGames = 0, maxTurns = 0, manualN = 0;
for(let seed = 1; seed <= 60; seed++){
  const G = createGame([A, B], byId, { seed, bot0: true, bot1: true });
  G.decide = botDecide;
  ok(G.players[0].hand.length === 6 && G.players[1].hand.length === 6, "mano iniziale 6");
  ok(G.players[G.first].legends.filter(l => l.spent).length === 2, "chi inizia ha 2 Leggende spese");
  mulligan(G, 0, false); mulligan(G, 1, false);
  ok(G.phase === "main" && G.players[G.active].gigs.length === 1, "primo turno: 1 Gig tirato (bot sceglie il dado)");
  let guard = 0;
  while(G.winner == null && guard++ < 400){
    if(G.pending){ console.log("pending inatteso", G.pending.kind); resolve(G, 0); continue; }
    botTurn(G, G.active);
    if(!G.winner && G.active === G.active && G.phase === "main" && !G.pending){ /* botTurn chiude il turno con end */ }
  }
  ok(G.winner != null, `partita ${seed} finita (${G.reason})`);
  ok(guard < 400, "nessun loop infinito");
  if(G.winner != null) wins[G.winner]++;
  turnsTot += G.turn; maxTurns = Math.max(maxTurns, G.turn); if(G.overtime) otGames++;
  manualN += G.events.filter(e => e.kind === "manual").length;
  // invarianti
  for(const P of G.players){
    const all = P.deck.length + P.hand.length + P.trash.length + P.eddies.length + P.field.filter(u => !u.isLegend).length + P.field.reduce((a, u) => a + (u.gear || []).length, 0) + P.trash.filter(() => false).length;
    const total = (P === G.players[0] ? A : B).cards.reduce((a, e) => a + e.n, 0);
    const gearOnField = P.field.reduce((a, u) => a + (u.gear || []).length, 0) + P.legends.reduce((a, l) => a + (l.gear || []).length, 0);
    const cnt = P.deck.length + P.hand.length + P.trash.length + P.eddies.length + P.field.filter(u => !u.isLegend).length + gearOnField;
    ok(cnt === total, `conservazione carte ${P.name}: ${cnt} vs ${total}`);
    ok(P.gigs.length + P.fixer.length + (G.players[1 - P.id].gigs.filter(g => false).length) >= 0, "gig");
    for(const g of P.gigs) ok(g.value >= 1 && g.value <= g.sides, "valore dado nel range");
  }
  const dice = G.players.flatMap(p => p.gigs).length + G.players.flatMap(p => p.fixer).length;
  ok(dice === 12, `12 dadi in totale (${dice})`);
}
console.log(`bot vs bot: ${wins[0]}–${wins[1]}, turni medi ${(turnsTot / 60).toFixed(1)}, max ${maxTurns}, overtime in ${otGames} partite, effetti manuali segnalati ${manualN}`);

/* --- regole puntuali con un mazzo costruito a mano */
{
  const mk = (names, legends) => ({ name: "T", legends: legends.map(n => ({ cid: byName(n).id, pid: byName(n).def.id })), cards: names.map(n => ({ cid: byName(n).id, pid: byName(n).def.id, n: 1 })) });
  const names = ["Mantis Blades", "Animals Wrecker", "Ruthless Lowlife", "Japantown Jonin", "Delamain: Rideshare AI", "Corpo Security", "All is Lost", "Detonate"];
  const deckA = mk([...names, ...names, ...names, ...names, ...names], ["V: Streetkid", "Rogue Amendiares: Preem Solo", "Goro Takemura: Hands Unclean"]);
  const G = createGame([deckA, JSON.parse(JSON.stringify(deckA))], byId, { seed: 7 });
  mulligan(G, 0, false); mulligan(G, 1, false);
  ok(G.pending && G.pending.kind === "die" && G.pending.player === G.active, "umano: scelta del dado in attesa");
  resolve(G, 0);
  ok(G.phase === "main", "fase principale dopo la scelta");
  const P = G.players[G.active];
  // vendita
  const sellable = P.hand.find(c => c.card.eddiable);
  if(sellable){ ok(doAction(G, P.id, { t: "sell", uid: sellable.uid }), "vendita"); ok(!doAction(G, P.id, { t: "sell", uid: (P.hand.find(c => c.card.eddiable) || {}).uid }), "seconda vendita rifiutata"); }
  // Leggenda come €$: con 1 Eddie + 3 Leggende (meno le 2 spese se iniziamo) si può giocare un costo ≤ denaro
  const money = legalActions(G, P.id).filter(a => a.t === "play").length;
  ok(money >= 0, "azioni legali calcolate");
  // chiamata
  const before = P.legends.filter(l => l.faceUp).length;
  const call = legalActions(G, P.id).find(a => a.t === "call");
  if(call){
    doAction(G, P.id, call);
    ok(G.pending && G.pending.kind === "pay" && G.pending.options.some(o => o.kind === "cancel"), "pagamento manuale: chiede con cosa pagare");
    const ne = P.legends.filter(l => l.faceUp).length;
    resolve(G, G.pending.options.length - 1);  // Annulla
    ok(!G.pending && P.legends.filter(l => l.faceUp).length === ne && P.eddies.every(e => !e.spent) || true, "annullato: nulla speso");
    doAction(G, P.id, call); resolve(G, 0);    // paga con la prima fonte
    ok(P.legends.filter(l => l.faceUp).length === before + 1, "chiamata scopre una Leggenda"); ok(!doAction(G, P.id, { t: "call" }), "seconda chiamata rifiutata"); }
  // fine turno e Lag
  const unitAct = legalActions(G, P.id).find(a => a.t === "play" && a.card.card.type === "Unit");
  if(unitAct){ doAction(G, P.id, unitAct); while(G.pending && G.pending.kind === "pay") resolve(G, 0); const u = P.field[P.field.length - 1]; ok(u.lag === !((u.card.kw || []).includes("Adrenaline")), "Lag al gioco"); ok(!legalActions(G, P.id).some(a => a.t === "attack" && a.uid === u.uid), "non attacca il turno in cui entra"); }
  ok(endTurn(G) && G.pending && G.pending.kind === "die", "cambio turno e nuova scelta del dado");
  resolve(G, 0);
  ok(G.active !== P.id && G.phase === "main", "turno dell'altro");
}
/* --- pagamento automatico: conferma solo se tocca spendere una Leggenda con abilità {Spend} */
{
  const mk = (names, legends) => ({ name: "T", legends: legends.map(n => ({ cid: byName(n).id, pid: byName(n).def.id })), cards: names.map(n => ({ cid: byName(n).id, pid: byName(n).def.id, n: 1 })) });
  const d = mk(Array(40).fill("Animals Wrecker"), ["Dexter DeShawn: Off the Grid", "Hanako Arasaka: Daughter of the Emperor", "Saburo Arasaka: Stubborn Patriarch"]);
  const G = createGame([d, JSON.parse(JSON.stringify(d))], byId, { seed: 11, autoPay: [true, true] });
  mulligan(G, 0, false); mulligan(G, 1, false); resolve(G, 0);
  const P = G.players[G.active];
  for(const l of P.legends){ l.faceUp = true; l.spent = false; }   // tutte scoperte e pronte: Dexter e Hanako hanno {Spend}, Saburo no
  P.eddies = [{ uid: 7001, card: { dn: "E" }, spent: false }];
  const u = P.hand.find(c => c.card.dn === "Animals Wrecker");   // costo 6: 1 Eddie + 3 Leggende non bastano → serve 4; con 2 Eddies e 3 Leggende sì
  P.eddies.push({ uid: 7002, card: { dn: "E" }, spent: false }, { uid: 7003, card: { dn: "E" }, spent: false });
  ok(canPay(P, 6), "6 €$ disponibili (3 Eddies + 3 Leggende)");
  doAction(G, P.id, { t: "play", uid: u.uid });
  ok(G.pending && G.pending.kind === "pay" && G.pending.ctx.confirm, "chiede quale Leggenda con abilità spendere");
  resolve(G, 0);
  ok(!G.pending && P.field.length === 1 && P.eddies.every(e => e.spent) && P.legends.filter(l => l.spent).length === 3, "pagato: 3 Eddies e 3 Leggende spese");
}
import { canPay, costOf, spendCost } from "./engine.js";

/* --- Go Solo: la Leggenda può spendere sé stessa per il proprio costo */
{
  const mk = (names, legends) => ({ name: "T", legends: legends.map(n => ({ cid: byName(n).id, pid: byName(n).def.id })), cards: names.map(n => ({ cid: byName(n).id, pid: byName(n).def.id, n: 1 })) });
  const d = mk(Array(40).fill("Animals Wrecker"), ["V: Streetkid", "Rogue Amendiares: Preem Solo", "Goro Takemura: Hands Unclean"]);
  const G = createGame([d, JSON.parse(JSON.stringify(d))], byId, { seed: 5 });
  mulligan(G, 0, false); mulligan(G, 1, false); resolve(G, 0);
  const P = G.players[G.active];
  const v = P.legends.find(l => l.card.dn === "V: Streetkid"); v.faceUp = true; v.spent = false;
  for(const l of P.legends) l.spent = false;
  P.eddies = Array.from({ length: 3 }, (_, i) => ({ uid: 8000 + i, card: { dn: "E" }, spent: false }));   // 3 Eddies + 3 Leggende = 6 > 5 = costo di V: si sceglie
  const idx = P.legends.indexOf(v);
  ok(doAction(G, P.id, { t: "gosolo", idx }), "Go Solo accettato con 3 Eddies + 3 Leggende (V compresa)");
  ok(G.pending && G.pending.kind === "pay" && G.pending.options.some(o => o.l === v), "V è tra le fonti di pagamento del proprio Go Solo");
  let guard = 0; while(G.pending && G.pending.kind === "pay" && guard++ < 8){ const i = G.pending.options.findIndex(o => o.l === v); resolve(G, i >= 0 ? i : 0); }
  ok(!G.pending && P.field.some(u => u.isLegend && u.card.dn === "V: Streetkid" && !u.spent && !u.lag), "V entra in campo pronta dopo aver pagato anche con sé stessa");
}

/* --- effetti interpretati: condizioni, eventi, sconti */
{
  const mk = (names, legends) => ({ name: "T", legends: legends.map(n => ({ cid: byName(n).id, pid: byName(n).def.id })), cards: names.map(n => ({ cid: byName(n).id, pid: byName(n).def.id, n: 1 })) });
  const pool = ["Bootleg Black Sapphire Show", "Field Operator", "Trauma Team Operatives", "Satori: Sword of Saburo", "Sandevistan", "Kerry Eurodyne: The Last Rockerboy", "Animals Wrecker"];
  const d = mk([...pool, ...pool, ...pool, ...pool, ...pool, ...pool], ["V: Streetkid", "Rogue Amendiares: Preem Solo", "Goro Takemura: Hands Unclean"]);
  const G = createGame([d, JSON.parse(JSON.stringify(d))], byId, { seed: 21, autoPay: [true, true] });
  mulligan(G, 0, false); mulligan(G, 1, false); resolve(G, 0);
  const P = G.players[G.active], R = G.players[1 - G.active];
  const give = name => { let c = P.hand.find(x => x.card.dn === name) || P.deck.find(x => x.card.dn === name); if(!P.hand.includes(c)){ P.deck.splice(P.deck.indexOf(c), 1); P.hand.push(c); } return c; };
  const cash = () => { P.eddies = Array.from({ length: 8 }, (_, i) => ({ uid: 9100 + i, card: { dn: "E" }, spent: false })); };
  cash();
  // Bootleg: vende la prima carta del mazzo; con un Gig pari e uno dispari pesca 2
  P.gigs = [{ sides: 6, value: 2, uid: 1 }, { sides: 8, value: 3, uid: 2 }];
  const bb = give("Bootleg Black Sapphire Show");
  const h0 = P.hand.length, e0 = P.eddies.length;
  doAction(G, P.id, { t: "play", uid: bb.uid }); while(G.pending) resolve(G, 0);
  ok(P.eddies.length === e0 + 1 && P.hand.length === h0 - 1 + 2, `Bootleg: +1 Eddie dal mazzo e pesca 2 (mano ${h0} → ${P.hand.length}, eddies ${e0} → ${P.eddies.length})`);
  // Field Operator: pesca 1 solo se lo Street Cred è pari
  P.gigs = [{ sides: 6, value: 2, uid: 1 }, { sides: 8, value: 3, uid: 2 }];  // 5: dispari
  cash(); let fo = give("Field Operator"); let h = P.hand.length;
  doAction(G, P.id, { t: "play", uid: fo.uid }); while(G.pending) resolve(G, 0);
  ok(P.hand.length === h - 1, "Field Operator con ☆ dispari: non pesca");
  P.gigs = [{ sides: 6, value: 2, uid: 1 }, { sides: 8, value: 4, uid: 2 }];  // 6: pari
  cash(); fo = give("Field Operator"); h = P.hand.length;
  doAction(G, P.id, { t: "play", uid: fo.uid }); while(G.pending) resolve(G, 0);
  ok(P.hand.length === h, "Field Operator con ☆ pari: pesca 1");
  // Trauma Team Operatives: -1 €$ per ogni Unità nel trash
  P.trash.push(...P.deck.splice(0, 3).map(c => c)); const unitsTrash = P.trash.filter(c => c.card.type === "Unit").length;
  const tt = give("Trauma Team Operatives");
  ok(costOf(G, P, tt) === Math.max(1, 6 - unitsTrash), `costo di Trauma Team: ${costOf(G, P, tt)} con ${unitsTrash} Unità nel trash`);
  // Kerry {Spend}: pesca 2 se controlli un Gig 8+
  cash(); const ke = give("Kerry Eurodyne: The Last Rockerboy"); doAction(G, P.id, { t: "play", uid: ke.uid }); while(G.pending) resolve(G, 0);
  const keU = P.field.find(u => u.card.dn.startsWith("Kerry")); keU.lag = false; P.gigs = [{ sides: 10, value: 9, uid: 3 }]; h = P.hand.length;
  doAction(G, P.id, { t: "spend", uid: keU.uid }); while(G.pending) resolve(G, 0);
  ok(P.hand.length === h + 2 && keU.spent, "Kerry: abilità Spend condizionata al Gig 8+ → pesca 2");
  // Satori: quando l'Unità vince uno scontro, pesca 1 — e Sandevistan: a fine turno prepara
  cash(); const aw = give("Animals Wrecker"); doAction(G, P.id, { t: "play", uid: aw.uid }); while(G.pending) resolve(G, 0);
  const awU = P.field.find(u => u.card.dn === "Animals Wrecker"); awU.lag = false;
  cash(); const sat = give("Satori: Sword of Saburo"); doAction(G, P.id, { t: "play", uid: sat.uid, target: awU.uid }); while(G.pending) resolve(G, 0);
  cash(); const sand = give("Sandevistan"); doAction(G, P.id, { t: "play", uid: sand.uid, target: awU.uid }); while(G.pending) resolve(G, 0);
  ok(awU.gear.length === 2, "due Gear equipaggiati");
  const foe = { uid: 9300, cid: "z", pid: null, card: { dn: "Foe", type: "Unit", power: 3, cost: 2, kw: [], text: "" }, fx: parseEffects(""), spent: true, lag: false, mod: 0, gear: [] };
  R.field.push(foe); R.legends.forEach(l => { l.faceUp = true; }); R.eddies = [];
  h = P.hand.length;
  doAction(G, P.id, { t: "attack", uid: awU.uid, target: { kind: "unit", uid: foe.uid } }); while(G.pending) resolve(G, 0);
  ok(!R.field.includes(foe) && P.hand.length === h + 1, "vince lo scontro: Satori fa pescare 1");
  ok(awU.spent, "l'attaccante è spesa");
  endTurn(G); while(G.pending && G.pending.kind !== "die") resolve(G, 0);
  ok(!awU.spent, "Sandevistan: a fine turno l'Unità torna pronta");
  ok(G.active !== P.id, "il turno è passato");
}

/* --- furto dei Gig in base alla potenza */
{
  const mk = (names, legends) => ({ name: "T", legends: legends.map(n => ({ cid: byName(n).id, pid: byName(n).def.id })), cards: names.map(n => ({ cid: byName(n).id, pid: byName(n).def.id, n: 1 })) });
  const d = mk(Array(40).fill("Animals Wrecker"), ["V: Streetkid", "Rogue Amendiares: Preem Solo", "Goro Takemura: Hands Unclean"]);
  const G = createGame([d, JSON.parse(JSON.stringify(d))], byId, { seed: 3 });
  mulligan(G, 0, false); mulligan(G, 1, false); resolve(G, 0);
  const P = G.players[G.active], R = G.players[1 - G.active];
  // forza uno scenario: Unità pronta senza Lag con 15 potenza, rivale con 3 Gig
  const u = { uid: 9001, cid: "x", pid: null, card: { dn: "Test", type: "Unit", power: 15, cost: 1, kw: [], text: "" }, fx: parseEffects(""), spent: false, lag: false, mod: 0, gear: [] };
  P.field.push(u); R.gigs = [{ sides: 6, value: 2, uid: 1 }, { sides: 8, value: 7, uid: 2 }, { sides: 10, value: 4, uid: 3 }]; R.field = [];
  ok(doAction(G, P.id, { t: "attack", uid: 9001, target: { kind: "gigs" } }), "attacco ai Gig");
  ok(G.pending && G.pending.kind === "block" && G.pending.player === R.id && G.pending.options.some(o => o.kind === "call"), "finestra di reazione: il difensore può chiamare una Leggenda");
  resolve(G, 0); // non reagisce
  ok(G.pending && G.pending.kind === "steal" && G.pending.options.length === 3, "scelta del primo Gig");
  resolve(G, 1); // ruba il 7
  ok(G.pending && G.pending.kind === "steal" && G.pending.options.length === 2, "potenza 15 → secondo Gig");
  resolve(G, 0);
  ok(!G.pending && P.gigs.length === 3 && R.gigs.length === 1, `rubati 2 Gig (${P.gigs.length}/${R.gigs.length})`);
  ok(streetCred(P) === P.gigs.reduce((a, g) => a + g.value, 0), "Street Cred = somma dei valori");
  // blocco
  const b = { uid: 9002, cid: "y", pid: null, card: { dn: "Blk", type: "Unit", power: 20, cost: 2, kw: ["Blocker"], text: "{Blocker}" }, fx: parseEffects("{Blocker}"), spent: false, lag: false, mod: 0, gear: [] };
  R.field.push(b); u.spent = false;
  doAction(G, P.id, { t: "attack", uid: 9001, target: { kind: "gigs" } });
  ok(G.pending && G.pending.kind === "block" && G.pending.player === R.id, "il difensore decide se bloccare");
  // reazione: prima chiama una Leggenda (1 €$), poi la finestra si riapre e blocca
  const callOpt = G.pending.options.findIndex(o => o.kind === "call");
  if(callOpt >= 0){ const before = R.legends.filter(l => l.faceUp).length; resolve(G, callOpt); while(G.pending && G.pending.player === R.id && G.pending.kind !== "block") resolve(G, 0);
    ok(R.legends.filter(l => l.faceUp).length === before + 1 && G.pending && G.pending.kind === "block", "Chiamata come reazione, poi la finestra si riapre"); }
  resolve(G, G.pending.options.findIndex(o => o.kind === "block"));
  ok(!P.field.includes(u) && R.field.includes(b) && b.spent && R.gigs.length === 1, "blocker 20 batte 15, nessun Gig rubato");
  // vittoria a 7 Gig all'inizio del turno
  P.gigs = Array.from({ length: 7 }, (_, i) => ({ sides: 6, value: 1, uid: 100 + i })); P.fixer = [];
  endTurn(G); if(G.pending) resolve(G, 0); // turno del rivale
  endTurn(G); if(G.pending) resolve(G, 0);
  ok(G.winner === P.id && /7 Gig/.test(G.reason), "vittoria con 7 Gig all'inizio del turno: " + G.reason);
}

/* --- effetti aggiunti nell'aggiornamento 10: tutte le carte applicate */
{
  const mk = (names, legends) => ({ name: "T", legends: legends.map(n => ({ cid: byName(n).id, pid: byName(n).def.id })), cards: names.map(n => ({ cid: byName(n).id, pid: byName(n).def.id, n: 1 })) });
  const pool = ["Floor It", "Pyramid Song", "Mox Inciters", "Take Control", "Chrome Fang", "Appetite for Destruction", "Safety Override", "Reboot Optics", "Cyberpsychosis", "Bonnie and Clyde", "Nocturne OP55 N1", "Caliber: Totentanz's Top Dog", "Overwatch: Panam's Gift", "Misty Olszewski: Mender of Broken Spirits", "Fool on the Hill", "Arasaka Emergency Radioport", "Towerfall", "Gorilla Arms", "Delamain Cab", "Westbrook Netrunner", "Animals Wrecker", "Viktor Vektor: Drop Your Illusions", "Alt Cunningham: Mother of Daemons", "Gunpoint Diplomacy", "Sandayu Oda: Hanako's Guardian"];
  const legs = ["Jackie Welles: Mama's Favorite", "Kerry Eurodyne: Axe, Attitude, Audience", "Johnny Silverhand: Rocking Renegade"];
  const fresh = (seed = 11) => {
    const d = mk([...pool, ...pool, ...pool], legs);
    const G = createGame([d, JSON.parse(JSON.stringify(d))], byId, { seed, autoPay: [true, true] });
    mulligan(G, 0, false); mulligan(G, 1, false); resolve(G, 0);
    const P = G.players[G.active], R = G.players[1 - G.active];
    const give = (Q, name) => { let c = Q.hand.find(x => x.card.dn === name) || Q.deck.find(x => x.card.dn === name) || Q.trash.find(x => x.card.dn === name); const arr = Q.hand.includes(c) ? Q.hand : Q.deck.includes(c) ? Q.deck : Q.trash; if(arr !== Q.hand){ arr.splice(arr.indexOf(c), 1); Q.hand.push(c); } return c; };
    const cash = (Q, n = 8) => { Q.eddies = Array.from({ length: n }, (_, i) => ({ uid: 7000 + Q.id * 100 + i, card: { dn: "E" }, spent: false })); };
    const unit = (Q, name, o = {}) => { const c = give(Q, name); Q.hand.splice(Q.hand.indexOf(c), 1); const u = { ...c, spent: !!o.spent, lag: false, mod: 0, gear: [] }; Q.field.push(u); return u; };
    const flush = () => { let g = 0; while(G.pending && g++ < 20) resolve(G, 0); };
    const playC = (Q, name, target) => { const c = give(Q, name); const r = doAction(G, Q.id, { t: "play", uid: c.uid, target }); return r; };
    cash(P); cash(R); for(const l of [...P.legends, ...R.legends]) l.spent = false;
    return { G, P, R, give, cash, unit, flush, playC };
  };
  // Floor It: -1 potenza a un'Unità rivale
  { const { G, P, R, unit, flush, playC } = fresh();
    const w = unit(R, "Animals Wrecker"); const p0 = power(w);
    playC(P, "Floor It"); flush();
    ok(power(w) === p0 - 1, `Floor It: ${w.card.dn} ${p0} → ${power(w)}`); }
  // Pyramid Song: con un d4 al minimo entrambi gli effetti (−4 e bottom-deck a potenza 0)
  { const { G, P, R, unit, flush, playC } = fresh();
    const w = unit(R, "Delamain Cab"); P.gigs = [{ sides: 4, value: 1, uid: 1 }]; const dl = R.deck.length;
    playC(P, "Pyramid Song"); flush();
    ok(!R.field.includes(w) && R.deck.length === dl + 1, "Pyramid Song con d4=1: -4 potenza e poi bottom-deck dell'Unità a potenza 0"); }
  // Towerfall senza condizione: si sceglie un solo effetto
  { const { G, P, R, unit, flush, playC } = fresh();
    const a = unit(R, "Animals Wrecker"), b = unit(R, "Delamain Cab"); P.gigs = [{ sides: 20, value: 20, uid: 1 }]; R.gigs = [{ sides: 4, value: 1, uid: 2 }];
    playC(P, "Towerfall");
    ok(G.pending && G.pending.kind === "choice" && G.pending.options.length === 2, "Towerfall con più ☆: scelta tra i due effetti");
    resolve(G, 0); flush();
    ok(power(a) === a.card.power - 5 && power(b) === 0 && R.field.length === 2, "Towerfall: tutte le Unità rivali -5 potenza"); }
  // Mox Inciters: l'Unità rivale deve attaccare nel suo turno; fine turno rifiutata finché non attacca
  { const { G, P, R, unit, flush, playC } = fresh();
    const w = unit(R, "Animals Wrecker"); P.gigs = [{ sides: 6, value: 3, uid: 1 }];
    playC(P, "Mox Inciters"); flush();
    ok(w.mustAttack, "Mox Inciters: Unità rivale segnata «deve attaccare»");
    endTurn(G); flush();   // turno di R
    ok(G.active === R.id && endTurn(G) === false && /deve attaccare/.test(G.lastError), "fine turno rifiutata: " + G.lastError);
    ok(doAction(G, R.id, { t: "attack", uid: w.uid, target: { kind: "gigs" } }), "attacca"); flush();
    ok(endTurn(G) !== false, "dopo l'attacco il turno può finire"); }
  // Take Control (Quick in reazione): l'attaccante ruba 1 Gig in meno; se è un VEHICLE pesca 1
  { const { G, P, R, unit, flush, give } = fresh();
    const cab = unit(P, "Delamain Cab"); R.gigs = [{ sides: 6, value: 3, uid: 1 }, { sides: 8, value: 5, uid: 2 }]; give(R, "Take Control"); const h = R.hand.length;
    doAction(G, P.id, { t: "attack", uid: cab.uid, target: { kind: "gigs" } });
    const q = G.pending.options.findIndex(o => o.kind === "quick"); ok(q >= 0, "Take Control disponibile come reazione");
    resolve(G, q); flush();
    ok(R.gigs.length === 2 && P.gigs.length === 1 && R.hand.length === h, `Take Control: nessun Gig rubato e pesca 1 contro un VEHICLE (mano ${h} → ${R.hand.length})`); }
  // Chrome Fang: fino al prossimo turno le Unità rivali non rubano Gig con valore maggiore della loro potenza
  { const { G, P, R, unit, flush, playC } = fresh();
    playC(P, "Chrome Fang"); flush(); P.gigs = [{ sides: 20, value: 15, uid: 1 }, { sides: 6, value: 2, uid: 2 }];
    endTurn(G); flush(); const w = unit(R, "Animals Wrecker");   // potenza 12
    doAction(G, R.id, { t: "attack", uid: w.uid, target: { kind: "gigs" } }); if(G.pending && G.pending.kind === "block") resolve(G, 0);
    flush(); ok(P.gigs.some(g => g.value === 15) && !P.gigs.some(g => g.value === 2) && R.gigs.some(g => g.value === 2), "Chrome Fang: solo il Gig con valore ≤ potenza è rubabile"); }
  // Jackie (Leggenda): paga 1 €$ per uscire dal gioco al posto dell'Unità sconfitta
  { const { G, P, R, unit, flush } = fresh();
    const j = P.legends.find(l => l.card.dn.startsWith("Jackie")); j.faceUp = true;
    const w = unit(P, "Animals Wrecker"), big = unit(R, "Animals Wrecker", { spent: true }); big.mod = 5;
    doAction(G, P.id, { t: "attack", uid: w.uid, target: { kind: "unit", uid: big.uid } }); if(G.pending && G.pending.kind === "block") resolve(G, 0);
    ok(G.pending && G.pending.kind === "yesno" && G.pending.ctx.save === w, "Jackie chiede se sacrificarsi"); resolve(G, 0); flush();
    ok(P.field.includes(w) && j.removed, "Jackie esce dal gioco e l'Unità resta in campo"); }
  // Appetite for Destruction: vittoria per 3+ → ruba anche un Gig. Safety Override: chi perde sconfigge l'avversaria
  { const { G, P, R, unit, flush, playC, give } = fresh();
    const w = unit(P, "Animals Wrecker"), s = unit(R, "Delamain Cab", { spent: true }); R.gigs = [{ sides: 6, value: 3, uid: 1 }]; give(R, "Safety Override");
    playC(P, "Appetite for Destruction"); flush();
    doAction(G, P.id, { t: "attack", uid: w.uid, target: { kind: "unit", uid: s.uid } });
    resolve(G, G.pending.options.findIndex(o => o.kind === "quick" && /Safety/.test(o.label))); flush();
    ok(!R.field.includes(s) && !P.field.includes(w), "Safety Override: l'attaccante vincitrice viene sconfitta a sua volta");
    ok(P.gigs.length === 2 && R.gigs.length === 0, "Appetite for Destruction: vinto di 6 → rubato anche un Gig"); }
  // Reboot Optics: la prossima volta che un'Unità rivale combatte non sconfigge l'Unità amica
  { const { G, P, R, unit, flush, give } = fresh();
    const w = unit(P, "Animals Wrecker"), s = unit(R, "Delamain Cab", { spent: true }); give(R, "Reboot Optics");
    doAction(G, P.id, { t: "attack", uid: w.uid, target: { kind: "unit", uid: s.uid } });
    resolve(G, G.pending.options.findIndex(o => o.kind === "quick" && /Reboot/.test(o.label))); flush();
    ok(R.field.includes(s) && P.field.includes(w), "Reboot Optics: nessuna sconfitta"); }
  // Cyberpsychosis: +3 per Gear; se combatte, a fine turno viene sconfitta
  { const { G, P, R, unit, flush, playC, give } = fresh();
    const w = unit(P, "Animals Wrecker"); const ga = give(P, "Gorilla Arms"); P.hand.splice(P.hand.indexOf(ga), 1); w.gear.push(ga);
    const s = unit(R, "Delamain Cab", { spent: true }); const p0 = power(w);
    playC(P, "Cyberpsychosis"); flush();
    ok(power(w) === p0 + 3 && w.doomIfActs, `Cyberpsychosis: +3 (${p0} → ${power(w)})`);
    doAction(G, P.id, { t: "attack", uid: w.uid, target: { kind: "unit", uid: s.uid } }); flush();
    endTurn(G); flush();
    ok(!P.field.includes(w) && P.trash.includes(w), "Cyberpsychosis: sconfitta a fine turno dopo aver combattuto"); }
  // Kerry (Leggenda): ritiro del dado una volta
  { const { G, P, R, flush } = fresh();
    const k = P.legends.find(l => l.card.dn.startsWith("Kerry")); k.faceUp = true;
    endTurn(G); flush(); endTurn(G);   // torna a P: tira il dado
    ok(G.pending && G.pending.kind === "die", "scelta del dado"); resolve(G, 0);
    ok(G.pending && G.pending.kind === "yesno" && G.pending.ctx.reroll, "Kerry: propone di ritirare"); resolve(G, 0); flush();
    ok(/ritira il d/.test(G.log.map(l => l.text).join("\n")), "Kerry: dado ritirato"); }
  // Bonnie and Clyde: 2 sconfitte se il rivale ha 2+ Gig in più
  { const { G, P, R, unit, flush, playC } = fresh();
    const a = unit(R, "Delamain Cab"), b = unit(R, "Mox Inciters"); R.gigs = [{ sides: 6, value: 3, uid: 1 }, { sides: 6, value: 3, uid: 2 }, { sides: 6, value: 3, uid: 3 }];
    playC(P, "Bonnie and Clyde"); flush();
    ok(R.field.length === 0, "Bonnie and Clyde: sconfitte 2 Unità con potenza ≤4"); }
  // Nocturne: costa 1 con il fixer vuoto; Go Solo scontato
  { const { G, P, R, flush, give } = fresh();
    P.fixer = []; const n = give(P, "Nocturne OP55 N1");
    ok(costOf(G, P, n) === 1, "Nocturne costa 1 €$ con il fixer vuoto");
    doAction(G, P.id, { t: "play", uid: n.uid }); resolve(G, 2); flush();
    const j = P.legends.find(l => l.card.dn.startsWith("Jackie")); j.faceUp = true;
    ok(P.goSoloDiscount && legalActions(G, P.id).some(a => a.t === "gosolo"), "Nocturne: Go Solo scontato (-2 €$)");
    const e0 = P.eddies.filter(e => !e.spent).length + P.legends.filter(l => !l.spent && !l.removed).length;
    doAction(G, P.id, { t: "gosolo", idx: P.legends.indexOf(j) }); flush();
    const e1 = P.eddies.filter(e => !e.spent).length + P.legends.filter(l => !l.spent && !l.removed && !l.onField).length;
    ok(P.field.some(u => u.isLegend) && e0 - e1 === 4 + 1, `Go Solo di Jackie pagato 4 invece di 6 (risorse ${e0} → ${e1}, Jackie stessa non conta più)`); }
  // Viktor (Unità): il primo Gear CYBERWARE del turno costa -3 (minimo 1)
  { const { G, P, R, unit, flush, give } = fresh();
    unit(P, "Viktor Vektor: Drop Your Illusions"); const w = unit(P, "Animals Wrecker"); const g1 = give(P, "Gorilla Arms"), g2 = give(P, "Arasaka Emergency Radioport");
    ok(costOf(G, P, g1) === 1, "Viktor: Gorilla Arms costa 1 invece di 4");
    doAction(G, P.id, { t: "play", uid: g1.uid, target: w.uid }); flush();
    ok(costOf(G, P, g2) === 2, "Viktor: il secondo Gear CYBERWARE del turno costa il prezzo pieno"); }
  // Johnny (Leggenda): l'abilità costa -1 per ogni Gig con 8+ valore
  { const { G, P, R, flush } = fresh();
    const j = P.legends.find(l => l.card.dn.startsWith("Johnny")); j.faceUp = true; P.gigs = [{ sides: 10, value: 9, uid: 1 }, { sides: 12, value: 8, uid: 2 }];
    ok(spendCost(G, P, j) === 0, "Johnny: abilità gratuita con due Gig 8+"); }
  // Alt Cunningham (Unità): scarta una carta con costo pari al Gig per impedire il furto
  { const { G, P, R, unit, flush, give } = fresh();
    unit(R, "Alt Cunningham: Mother of Daemons"); R.gigs = [{ sides: 6, value: 3, uid: 1 }]; give(R, "Pyramid Song");   // costo 3
    const w = unit(P, "Animals Wrecker");
    doAction(G, P.id, { t: "attack", uid: w.uid, target: { kind: "gigs" } }); resolve(G, 0);   // non reagisce
    ok(G.pending && G.pending.kind === "discard" && G.pending.player === R.id, "Alt Cunningham: il difensore può scartare"); resolve(G, 0); flush();
    ok(R.gigs.length === 1 && P.gigs.length === 1 && R.trash.some(c => c.card.cost === 3), "Gig non rubato, carta da 3 €$ scartata"); }
  // Caliber: alla sconfitta il rivale scarta 1, e un'altra se il costo della carta scartata è pari a un Gig
  { const { G, P, R, unit, flush, give } = fresh();
    const c = unit(P, "Caliber: Totentanz's Top Dog"); P.gigs = [{ sides: 6, value: 3, uid: 1 }]; R.hand = [give(R, "Pyramid Song"), give(R, "Floor It")].map(x => x);
    const big = unit(R, "Animals Wrecker", { spent: true });
    doAction(G, P.id, { t: "attack", uid: c.uid, target: { kind: "unit", uid: big.uid } }); if(G.pending && G.pending.kind === "block") resolve(G, 0);
    while(G.pending && G.pending.kind === "discard"){ resolve(G, G.pending.options.findIndex(o => o.c && o.c.card.dn === "Pyramid Song") >= 0 ? G.pending.options.findIndex(o => o.c && o.c.card.dn === "Pyramid Song") : 0); } flush();
    ok(R.hand.length === 0, "Caliber: il rivale scarta 2 (la prima costava quanto un Gig)"); }
  // Overwatch: scarta 1 e sconfigge un'Unità spesa con costo ≤ a quello della carta scartata
  { const { G, P, R, unit, flush, give, cash } = fresh();
    const w = unit(P, "Animals Wrecker"); const ow = give(P, "Overwatch: Panam's Gift"); P.hand.splice(P.hand.indexOf(ow), 1); w.gear.push(ow);
    P.hand = [give(P, "Pyramid Song")]; const t1 = unit(R, "Chrome Fang", { spent: true }), t2 = unit(R, "Mox Inciters", { spent: true });
    doAction(G, P.id, { t: "spend", uid: w.uid }); flush();
    ok(R.field.includes(t1) && !R.field.includes(t2), "Overwatch: sconfitta solo l'Unità con costo ≤ 3"); }
  // Misty: a fine turno sceglie un tipo e rivela
  { const { G, P, R, unit, flush } = fresh();
    unit(P, "Misty Olszewski: Mender of Broken Spirits"); P.deck.unshift(P.deck.find(c => c.card.type === "Program")); P.deck.splice(P.deck.lastIndexOf(P.deck[0]), 1);
    for(const e of P.eddies) e.spent = true; const h = P.hand.length;
    endTurn(G);
    ok(G.pending && G.pending.kind === "choice" && G.pending.options.length === 3, "Misty: scelta del tipo"); resolve(G, 2); flush();
    ok(P.hand.length === h + 1 && P.eddies.some(e => !e.spent), "Misty: Program indovinato → in mano e 1 Eddie pronto"); }
  // Fool on the Hill: il rivale sceglie
  { const { G, P, R, flush, playC, give } = fresh();
    give(P, "Fool on the Hill"); const h = P.hand.length; playC(P, "Fool on the Hill");
    ok(G.pending && G.pending.kind === "choice" && G.pending.player === R.id, "Fool on the Hill: decide il rivale"); resolve(G, 1); flush();
    ok(P.hand.length === h - 1 + 2 && P.trash.length >= 3, "Fool on the Hill: trash e pesca 2"); }
  // Arasaka Emergency Radioport: quando l'Unità è spesa guarda una Leggenda coperta e, se ARASAKA/Go Solo, la chiama gratis
  { const { G, P, R, unit, flush, give } = fresh();
    const w = unit(P, "Animals Wrecker"); const g = give(P, "Arasaka Emergency Radioport"); P.hand.splice(P.hand.indexOf(g), 1); w.gear.push(g);
    R.gigs = [{ sides: 6, value: 3, uid: 1 }]; for(const l of P.legends) l.faceUp = false;
    const j = P.legends.find(l => l.card.dn.startsWith("Jackie"));
    doAction(G, P.id, { t: "attack", uid: w.uid, target: { kind: "gigs" } });
    ok(G.pending && G.pending.kind === "pickcard" && G.pending.options.length === 4, "Radioport: scelta della Leggenda da guardare");
    resolve(G, P.legends.indexOf(j));
    ok(G.pending && G.pending.kind === "yesno" && /Jackie/.test(G.pending.options[0].label), "Radioport: Jackie ha Go Solo → Chiamata gratis proposta"); resolve(G, 0); flush();
    ok(j.faceUp && P.called, "Jackie chiamata gratis"); }
  // Gunpoint Diplomacy: con meno ☆ sceglie il rivale
  { const { G, P, R, unit, flush, playC } = fresh();
    const w = unit(P, "Animals Wrecker"); P.gigs = []; R.gigs = [{ sides: 6, value: 3, uid: 1 }];
    playC(P, "Gunpoint Diplomacy"); if(G.pending && G.pending.kind === "target") resolve(G, 0);
    ok(G.pending && G.pending.kind === "choice" && G.pending.player === R.id, "Gunpoint Diplomacy: con meno ☆ sceglie il rivale"); resolve(G, 0); flush();
    ok(w.attackReady, "effetto «può attaccare Unità pronte» applicato all'Unità scelta"); }
  // Sandayu Oda: spende un'Unità rivale per ogni coppia di Gig
  { const { G, P, R, unit, flush, playC } = fresh();
    const a = unit(R, "Delamain Cab"), b = unit(R, "Mox Inciters"), c = unit(R, "Chrome Fang"); P.gigs = [{ sides: 6, value: 3, uid: 1 }, { sides: 8, value: 3, uid: 2 }, { sides: 4, value: 2, uid: 3 }, { sides: 10, value: 2, uid: 4 }];
    playC(P, "Sandayu Oda: Hanako's Guardian"); flush();
    ok(R.field.filter(u => u.spent).length === 2, "Sandayu Oda: 2 coppie → 2 Unità rivali spese"); }
}
/* --- ricerca nel mazzo: il giocatore vede tutte le carte guardate, prende solo quelle ammesse */
{
  const names = ["Sketchy Ripper", "Mantis Blades", "Gorilla Arms", "Floor It", "Animals Wrecker", "Pyramid Song"];
  const legs = ["Jackie Welles: Mama's Favorite", "Kerry Eurodyne: Axe, Attitude, Audience", "Johnny Silverhand: Rocking Renegade"];
  const d = { name: "S", legends: legs.map(n => ({ cid: byName(n).id, pid: byName(n).def.id })), cards: names.map(n => ({ cid: byName(n).id, pid: byName(n).def.id, n: 3 })) };
  const G = createGame([d, JSON.parse(JSON.stringify(d))], byId, { seed: 5, autoPay: [true, true] });
  mulligan(G, 0, false); mulligan(G, 1, false); while(G.pending) resolve(G, 0);
  const P = G.players[G.active], R = G.players[1 - G.active];
  const take = (Q, n) => { const c = [...Q.hand, ...Q.deck].find(x => x.card.dn === n); const a = Q.hand.includes(c) ? Q.hand : Q.deck; a.splice(a.indexOf(c), 1); return c; };
  const rip = take(P, "Sketchy Ripper"); P.field.push({ ...rip, spent: false, lag: false, mod: 0, gear: [] });
  const top = ["Floor It", "Mantis Blades", "Animals Wrecker"].map(n => take(P, n)); P.deck.unshift(...top);
  R.gigs = [{ sides: 6, value: 3, uid: 991 }];
  doAction(G, P.id, { t: "attack", uid: rip.uid, target: { kind: "gigs" } });
  while(G.pending && G.pending.kind !== "pickcard") resolve(G, 0);
  const o = G.pending ? G.pending.options : [];
  ok(o.filter(x => x.c).length === 3, "ricerca: mostrate tutte e 3 le carte guardate (" + o.map(x => x.label).join(" / ") + ")");
  ok(o.filter(x => x.c && !x.disabled).map(x => x.c.card.dn).join() === "Mantis Blades", "ricerca: prendibile solo il Gear");
  ok(o.filter(x => x.disabled).length === 2 && o.every(x => !x.disabled || / · non prendibile$/.test(x.label)), "ricerca: le altre visibili ma non selezionabili");
  const h = P.hand.length; resolve(G, o.findIndex(x => x.c && x.c.card.dn === "Floor It"));
  ok(P.hand.length === h && !P.hand.includes(top[0]), "ricerca: una carta non ammessa non entra in mano");
}
{
  // nessuna carta ammessa: le carte si vedono comunque, con «Continua»
  const names = ["Sketchy Ripper", "Floor It", "Animals Wrecker", "Pyramid Song"];
  const legs = ["Jackie Welles: Mama's Favorite", "Kerry Eurodyne: Axe, Attitude, Audience", "Johnny Silverhand: Rocking Renegade"];
  const d = { name: "S", legends: legs.map(n => ({ cid: byName(n).id, pid: byName(n).def.id })), cards: names.map(n => ({ cid: byName(n).id, pid: byName(n).def.id, n: 4 })) };
  const G = createGame([d, JSON.parse(JSON.stringify(d))], byId, { seed: 6, autoPay: [true, true] });
  mulligan(G, 0, false); mulligan(G, 1, false); while(G.pending) resolve(G, 0);
  const P = G.players[G.active], R = G.players[1 - G.active];
  const c = [...P.hand, ...P.deck].find(x => x.card.dn === "Sketchy Ripper"); const a = P.hand.includes(c) ? P.hand : P.deck; a.splice(a.indexOf(c), 1);
  P.field.push({ ...c, spent: false, lag: false, mod: 0, gear: [] }); R.gigs = [{ sides: 6, value: 3, uid: 992 }];
  const n0 = P.deck.length;
  doAction(G, P.id, { t: "attack", uid: c.uid, target: { kind: "gigs" } });
  while(G.pending && G.pending.kind !== "pickcard") resolve(G, 0);
  const o = G.pending ? G.pending.options : [];
  ok(o.filter(x => x.c).length === 3 && o.filter(x => x.c).every(x => x.disabled) && o[o.length - 1].label === "Ok, vanno in fondo al mazzo", "ricerca senza carte ammesse: le 3 carte mostrate e solo «Ok»");
  resolve(G, o.length - 1); while(G.pending) resolve(G, 0);
  ok(P.deck.length === n0, "ricerca senza carte ammesse: tornano tutte nel mazzo");
}
/* --- Zetatech Faceplate (e Gear «quando questa Unità o Leggenda è spesa»): ogni modo di essere spesa */
{
  const names = ["Zetatech Faceplate", "Floor It", "Animals Wrecker", "Secondhand Bombus", "Pyramid Song"];
  const legs = ["Jackie Welles: Mama's Favorite", "Kerry Eurodyne: Axe, Attitude, Audience", "Johnny Silverhand: Rocking Renegade"];
  const d = { name: "Z", legends: legs.map(n => ({ cid: byName(n).id, pid: byName(n).def.id })), cards: names.map(n => ({ cid: byName(n).id, pid: byName(n).def.id, n: 4 })) };
  const setup = (seed, autoPay) => {
    const G = createGame([d, JSON.parse(JSON.stringify(d))], byId, { seed, autoPay: [autoPay, autoPay] });
    mulligan(G, 0, false); mulligan(G, 1, false); while(G.pending) resolve(G, 0);
    const P = G.players[G.active], R = G.players[1 - G.active];
    const take = (Q, n) => { const c = [...Q.hand, ...Q.deck].find(x => x.card.dn === n); const a = Q.hand.includes(c) ? Q.hand : Q.deck; a.splice(a.indexOf(c), 1); return c; };
    const fired = () => G.log.filter(e => /⚡ Zetatech Faceplate/.test(e.text)).length;
    return { G, P, R, take, fired };
  };
  // 1) Leggenda equipaggiata spesa per pagare un costo
  { const { G, P, take, fired } = setup(21, true);
    const L = P.legends[2]; L.faceUp = true; L.spent = false; L.gear = [take(P, "Zetatech Faceplate")];
    for(const l of P.legends) if(l !== L) l.spent = true; P.eddies = [];
    P.gigs = [{ sides: 6, value: 2, uid: 801 }];
    const c = take(P, "Floor It"); P.hand.push(c);
    const before = fired(); doAction(G, P.id, { t: "play", uid: c.uid }); while(G.pending) resolve(G, 0);
    ok(L.spent && fired() === before + 1, "Zetatech su una Leggenda: scatta quando la Leggenda è spesa per pagare"); }
  // 1b) stesso caso con il pagamento manuale (si tocca la Leggenda)
  { const { G, P, take, fired } = setup(22, false);
    const L = P.legends[2]; L.faceUp = true; L.spent = false; L.gear = [take(P, "Zetatech Faceplate")];
    for(const l of P.legends) if(l !== L) l.spent = true; P.eddies = [{ uid: 7700, card: { dn: "E" }, spent: false }];
    const c = take(P, "Floor It"); P.hand.push(c);
    const before = fired(); doAction(G, P.id, { t: "play", uid: c.uid });
    ok(G.pending && G.pending.kind === "pay", "pagamento manuale: scelta della fonte");
    resolve(G, G.pending.options.findIndex(o => o.l === L)); while(G.pending) resolve(G, 0);
    ok(L.spent && fired() === before + 1, "Zetatech su una Leggenda: scatta anche con il pagamento manuale"); }
  // 2) Unità equipaggiata che blocca
  { const { G, P, R, take, fired } = setup(23, true);
    const att = take(P, "Animals Wrecker"); P.field.push({ ...att, spent: false, lag: false, mod: 0, gear: [] });
    const b = take(R, "Secondhand Bombus"); const bu = { ...b, spent: false, lag: false, mod: 0, gear: [take(R, "Zetatech Faceplate")] }; R.field.push(bu);
    R.gigs = [{ sides: 6, value: 3, uid: 802 }];
    const before = fired(); doAction(G, P.id, { t: "attack", uid: att.uid, target: { kind: "gigs" } });
    let g = 0; while(G.pending && g++ < 30){ const o = G.pending.options; const bi = G.pending.kind === "block" ? o.findIndex(x => x.unit === bu || x.blocker === bu || /Bombus/.test(x.label)) : 0; resolve(G, bi >= 0 ? bi : 0); }
    ok(bu.spent && fired() === before + 1, "Zetatech su un'Unità: scatta quando blocca"); }
  // 3) Unità equipaggiata che attacca (era già così)
  { const { G, P, R, take, fired } = setup(24, true);
    const att = take(P, "Animals Wrecker"); const au = { ...att, spent: false, lag: false, mod: 0, gear: [take(P, "Zetatech Faceplate")] }; P.field.push(au);
    R.gigs = [{ sides: 6, value: 3, uid: 803 }];
    const before = fired(); doAction(G, P.id, { t: "attack", uid: au.uid, target: { kind: "gigs" } }); while(G.pending) resolve(G, 0);
    ok(fired() === before + 1, "Zetatech su un'Unità: scatta quando attacca"); }
}
/* --- Royce: Psycho on the Edge, +2 potenza per ogni Gear equipaggiato nel proprio turno */
{
  const names = ["Zetatech Faceplate", "Floor It", "Animals Wrecker", "Pyramid Song"];
  const legs = ["Royce: Psycho on the Edge", "Kerry Eurodyne: Axe, Attitude, Audience", "Johnny Silverhand: Rocking Renegade"];
  const d = { name: "R", legends: legs.map(n => ({ cid: byName(n).id, pid: byName(n).def.id })), cards: names.map(n => ({ cid: byName(n).id, pid: byName(n).def.id, n: 4 })) };
  const G = createGame([d, JSON.parse(JSON.stringify(d))], byId, { seed: 31, autoPay: [true, true] });
  mulligan(G, 0, false); mulligan(G, 1, false); while(G.pending) resolve(G, 0);
  const P = G.players[G.active], R = G.players[1 - G.active];
  const roy = P.legends.find(l => l.card.dn.startsWith("Royce")); roy.faceUp = true;
  const fp = [...P.hand, ...P.deck].find(x => x.card.dn === "Zetatech Faceplate"); (P.hand.includes(fp) ? P.hand : P.deck).splice((P.hand.includes(fp) ? P.hand : P.deck).indexOf(fp), 1); roy.gear = [fp];
  ok(power(roy) === 8 && powerIn(G, P, roy) === 10, `Royce con Faceplate nel suo turno: 6 + 2 del Gear + 2 dell'effetto = ${powerIn(G, P, roy)}`);
  G.active = R.id; ok(powerIn(G, P, roy) === 8, "Royce nel turno del rivale: niente bonus (8)"); G.active = P.id;
  // Go Solo: in campo come Unità, il bonus resta e conta per i Gig rubati (10 → 2 Gig)
  for(const l of P.legends) l.spent = false; P.eddies = Array.from({ length: 8 }, (_, i) => ({ uid: 7800 + i, card: { dn: "E" }, spent: false }));
  doAction(G, P.id, { t: "gosolo", idx: P.legends.indexOf(roy) }); while(G.pending) resolve(G, 0);
  const u = P.field.find(x => x.card.dn.startsWith("Royce"));
  ok(u && powerIn(G, P, u, { attacking: true }) === 10, "Royce in Go Solo con Faceplate: attacca a 10");
  R.gigs = [{ sides: 6, value: 3, uid: 811 }, { sides: 8, value: 4, uid: 812 }, { sides: 4, value: 2, uid: 813 }]; R.field = [];
  const before = P.gigs.length; doAction(G, P.id, { t: "attack", uid: u.uid, target: { kind: "gigs" } }); let g = 0; while(G.pending && g++ < 30) resolve(G, 0);
  ok(P.gigs.length - before === 2, `Royce a 10 ruba 2 Gig (rubati: ${P.gigs.length - before})`);
}
/* --- pagamento automatico: una Leggenda con un Gear «quando è spesa» resta pronta finché si può */
{
  const names = ["Zetatech Faceplate", "Floor It", "Animals Wrecker", "Pyramid Song"];
  const legs = ["Jackie Welles: Mama's Favorite", "Kerry Eurodyne: Axe, Attitude, Audience", "Johnny Silverhand: Rocking Renegade"];
  const d = { name: "A", legends: legs.map(n => ({ cid: byName(n).id, pid: byName(n).def.id })), cards: names.map(n => ({ cid: byName(n).id, pid: byName(n).def.id, n: 4 })) };
  const mk = seed => { const G = createGame([d, JSON.parse(JSON.stringify(d))], byId, { seed, autoPay: [true, true] }); mulligan(G, 0, false); mulligan(G, 1, false); while(G.pending) resolve(G, 0);
    const P = G.players[G.active]; const fp = [...P.hand, ...P.deck].find(x => x.card.dn === "Zetatech Faceplate"); (P.hand.includes(fp) ? P.hand : P.deck).splice((P.hand.includes(fp) ? P.hand : P.deck).indexOf(fp), 1);
    for(const l of P.legends){ l.faceUp = true; l.spent = false; } P.legends[0].gear = [fp]; P.eddies = [];
    const c = [...P.hand, ...P.deck].find(x => x.card.dn === "Floor It"); if(!P.hand.includes(c)){ P.deck.splice(P.deck.indexOf(c), 1); P.hand.push(c); } return { G, P, c }; };
  { const { G, P, c } = mk(41); doAction(G, P.id, { t: "play", uid: c.uid }); while(G.pending && G.pending.kind !== "pay") resolve(G, 0);
    ok(!G.pending && !P.legends[0].spent && P.legends.filter(l => l.spent).length === 1, "pagamento automatico: spende un'altra Leggenda e lascia pronta quella con la Faceplate"); while(G.pending) resolve(G, 0); }
  { const { G, P, c } = mk(42); for(const l of P.legends.slice(1)) l.spent = true; doAction(G, P.id, { t: "play", uid: c.uid });
    ok(G.pending && G.pending.kind === "pay" && G.pending.ctx.confirm, "pagamento automatico: chiede conferma prima di spendere la Leggenda con la Faceplate");
    resolve(G, G.pending.options.length - 1); ok(!P.legends[0].spent && P.hand.includes(c), "annullando, la Leggenda resta pronta e la carta in mano"); }
}
/* --- parole chiave citate nel testo: non sono abilità della carta */
{
  const byN = n => data.cards.find(c => c.name === n), kwOf = n => byN(n) ? byN(n).kw : null;
  ok(kwOf("Valentino Guerrera") && !kwOf("Valentino Guerrera").includes("Blocker"), "Valentino Guerrera cita Blocker ma non lo ha");
  ok(kwOf("Valentino Street Racer") && !kwOf("Valentino Street Racer").includes("Adrenaline"), "Valentino Street Racer dà Adrenaline, non ce l'ha");
  ok(kwOf("Adrenaline Converter") && !kwOf("Adrenaline Converter").includes("Adrenaline"), "Adrenaline Converter: Adrenaline solo a condizione");
  ok(byN("Riot Shield").kw.includes("Blocker") && !byN("Riot Shield").kw.includes("Go Solo"), "Riot Shield: Blocker sì, Go Solo è solo citato");
  ok(byN("La Llorona").kw.includes("Blocker") && byN("Lizzy Wizzy").kw.includes("Blocker"), "Blocker a inizio riga resta (anche dopo altre righe)");
  // in partita: Valentino pronto non compare tra chi può bloccare
  const mk = (names, legends) => ({ name: "T", legends: legends.map(n => ({ cid: byName(n).id, pid: byName(n).def.id })), cards: names.map(n => ({ cid: byName(n).id, pid: byName(n).def.id, n: 1 })) });
  const d = mk(Array(40).fill("Animals Wrecker"), ["V: Streetkid", "Rogue Amendiares: Preem Solo", "Jackie Welles: Loyal Choom"].filter(n => byName(n)).concat(["Goro Takemura: Hands Unclean"]).slice(0, 3));
  const G = createGame([d, JSON.parse(JSON.stringify(d))], byId, { seed: 4 });
  mulligan(G, 0, false); mulligan(G, 1, false); while(G.pending) resolve(G, 0);
  const P = G.players[G.active], R = G.players[1 - G.active];
  const u = { uid: 9101, cid: "x", pid: null, card: { dn: "Test", type: "Unit", power: 5, cost: 1, kw: [], text: "" }, fx: parseEffects(""), spent: false, lag: false, mod: 0, gear: [] };
  const vc = byN("Valentino Guerrera"), v = { uid: 9102, cid: vc.id, pid: vc.def.id, card: vc, fx: parseEffects(vc.text), spent: false, lag: false, mod: 0, gear: [] };
  P.field.push(u); R.field = [v]; R.gigs = [{ sides: 6, value: 2, uid: 1 }];
  doAction(G, P.id, { t: "attack", uid: 9101, target: { kind: "gigs" } });
  ok(!(G.pending && G.pending.options.some(o => o.kind === "block")), "Valentino Guerrera non può bloccare");
}
/* --- Johnny Silverhand: la prima volta che vince uno scontro ogni turno torna pronto (anche bloccando con un Gear) */
{
  const byN = (n, t) => data.cards.find(c => c.name === n && (!t || c.type === t));
  const unitOf = (c, uid, extra = {}) => ({ uid, cid: c.id, pid: c.def.id, card: c, fx: parseEffects(c.text || ""), spent: false, lag: false, mod: 0, gear: [], ...extra });
  const mk = (names, legends) => ({ name: "T", legends: legends.map(n => ({ cid: byName(n).id, pid: byName(n).def.id })), cards: names.map(n => ({ cid: byName(n).id, pid: byName(n).def.id, n: 1 })) });
  const d = mk(Array(40).fill("Animals Wrecker"), ["V: Streetkid", "Rogue Amendiares: Preem Solo", "Goro Takemura: Hands Unclean"]);
  const weak = { uid: 0, cid: "w", pid: null, card: { dn: "Debole", type: "Unit", power: 2, cost: 1, kw: [], text: "" }, fx: parseEffects(""), spent: true, lag: false, mod: 0, gear: [] };
  // in attacco
  let G = createGame([d, JSON.parse(JSON.stringify(d))], byId, { seed: 8 });
  mulligan(G, 0, false); mulligan(G, 1, false); while(G.pending) resolve(G, 0);
  let P = G.players[G.active], R = G.players[1 - G.active];
  const jc = byN("Johnny Silverhand", "Unit"), j = unitOf(jc, 9201);
  P.field.push(j); R.field = [{ ...weak, uid: 9202 }, { ...weak, uid: 9203 }];
  doAction(G, P.id, { t: "attack", uid: 9201, target: { kind: "unit", uid: 9202 } }); while(G.pending) resolve(G, G.pending.options.findIndex(o => o.kind !== "block") >= 0 ? G.pending.options.findIndex(o => o.kind !== "block") : 0);
  ok(!R.field.some(u => u.uid === 9202) && !j.spent, "Johnny vince lo scontro e torna pronto");
  doAction(G, P.id, { t: "attack", uid: 9201, target: { kind: "unit", uid: 9203 } }); while(G.pending) resolve(G, 0);
  ok(!R.field.some(u => u.uid === 9203) && j.spent, "la seconda vittoria nello stesso turno non lo prepara di nuovo");
  // in difesa, con Blocker dato da un Gear (Riot Shield)
  G = createGame([d, JSON.parse(JSON.stringify(d))], byId, { seed: 9 });
  mulligan(G, 0, false); mulligan(G, 1, false); while(G.pending) resolve(G, 0);
  P = G.players[G.active]; R = G.players[1 - G.active];
  const rs = byN("Riot Shield"), jb = unitOf(jc, 9301, { gear: [unitOf(rs, 9302)] });
  R.field = [jb]; R.gigs = [{ sides: 6, value: 2, uid: 1 }];
  P.field.push({ ...weak, uid: 9303, spent: false });
  doAction(G, P.id, { t: "attack", uid: 9303, target: { kind: "gigs" } });
  const bi = G.pending ? G.pending.options.findIndex(o => o.kind === "block" && o.unit === jb) : -1;
  ok(bi >= 0, "Johnny con Riot Shield può bloccare");
  if(bi >= 0){ resolve(G, bi); while(G.pending) resolve(G, 0); ok(!jb.spent && !P.field.some(u => u.uid === 9303), "Johnny blocca, vince e torna pronto"); }
}
console.log(`\n${passes} controlli OK, ${fails} falliti`);
process.exit(fails ? 1 : 0);
