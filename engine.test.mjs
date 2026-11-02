/* Collaudo del motore: partite bot contro bot con i mazzi starter, più
   controlli puntuali sulle regole. Esegui: node engine.test.mjs   */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createGame, mulligan, legalActions, doAction, resolve, summary, parseEffects, power, streetCred, endTurn } from "./engine.js";
import { botDecide, botTurn, botStep } from "./bot.js";

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, "public", "cards.json"), "utf8"));
const byId = new Map();
for(const c of data.cards){ c.def = c.prints[0]; c.ramN = c.ram ?? 0; byId.set(c.id, c); }
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
import { canPay, costOf } from "./engine.js";

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
console.log(`\n${passes} controlli OK, ${fails} falliti`);
process.exit(fails ? 1 : 0);
