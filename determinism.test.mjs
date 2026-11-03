/* Partite online: le stesse mosse sullo stesso seme danno sempre lo stesso stato */
import { readFileSync } from "node:fs";
import { createGame, legalActions, mulberry32, applyMove, applyMoveAs, moveOf, summary } from "./engine.js";
const data = JSON.parse(readFileSync("public/cards.json", "utf8"));
const byId = new Map(); for(const c of data.cards){ c.def = c.prints[0]; c.ramN = c.ram ?? 0; byId.set(c.id, c); }
const legends = data.cards.filter(c => c.type === "Legend" && c.legal === "legal"), others = data.cards.filter(c => c.type !== "Legend");
const snap = G => JSON.stringify({ s: summary(G), w: G.winner, r: G.reason, t: G.turn, a: G.active, p: G.pending && [G.pending.player, G.pending.kind, G.pending.options.length], log: G.log.map(e => e.text) });
let fails = 0, games = 0, moves = 0, ended = 0, forged = 0, forgedOk = 0;
for(let seed = 1; seed <= 120; seed++){
  const rng = mulberry32(seed * 104729);
  const pick = (arr, n) => { const a = arr.slice(); const out = []; while(out.length < n && a.length) out.push(a.splice(Math.floor(rng() * a.length), 1)[0]); return out; };
  const mkDeck = name => ({ name, legends: pick(legends, 3).map(c => ({ cid: c.id, pid: c.def.id })), cards: pick(others, 20).map(c => ({ cid: c.id, pid: c.def.id, n: 2 })) });
  const decks = [mkDeck("Host"), mkDeck("Guest")], opts = { seed: seed * 31, autoPay: [rng() < .5, rng() < .5] };
  const json = JSON.parse(JSON.stringify(decks));       // come arrivano dal database
  const G = createGame(decks, byId, opts), log = [];
  // chi fa la mossa (come lo registra il database): il giocatore di turno, o chi deve decidere
  const play = m => {
    const seat = m.k === "r" ? G.pending.player : m.p;
    // un avversario che prova a muovere al posto dell'altro: deve essere ignorato senza toccare nulla
    if(rng() < .15){ const before = snap(G), bad = JSON.parse(JSON.stringify(m)); forged++;
      if(applyMoveAs(G, 1 - seat, bad) || snap(G) !== before){ forgedOk++; } }
    log.push({ seat, m: JSON.parse(JSON.stringify(m)) }); if(!applyMoveAs(G, seat, m) && m.k !== "a") { /* le azioni non valide restano senza effetto */ }
  };
  // i due mulligan in ordine casuale (online arrivano in ordine qualsiasi)
  const order = rng() < .5 ? [0, 1] : [1, 0];
  for(const p of order) play({ k: "m", p, d: rng() < .3 ? 1 : 0 });
  let guard = 0;
  try{
    while(G.winner == null && guard++ < 900){
      if(G.pending){ const ok = G.pending.options.map((o, i) => o.disabled ? -1 : i).filter(i => i >= 0); play({ k: "r", i: ok.length ? ok[Math.floor(rng() * ok.length)] : -1 }); continue; }
      const acts = legalActions(G, G.active); if(!acts.length) break;
      const non = acts.filter(a => a.t !== "end"), a = non.length && rng() < .8 ? non[Math.floor(rng() * non.length)] : acts.find(a => a.t === "end");
      play({ k: "a", p: G.active, a: moveOf(a) });
    }
  }catch(e){ fails++; console.log("seed", seed, "errore", e.stack.split("\n").slice(0, 3).join(" | ")); continue; }
  // un'altra partita in mezzo (sul telefono possono essercene state altre), poi si rigioca dal registro
  createGame([mkDeck("X"), mkDeck("Y")], byId, { seed: 99 });
  const R = createGame(json, byId, opts);
  for(const x of JSON.parse(JSON.stringify(log))) applyMoveAs(R, x.seat, x.m);
  // e anche senza controlli (applyMove) si arriva allo stesso stato: le mosse oneste non vengono mai rifiutate
  const U = createGame(json, byId, opts); for(const x of log) applyMove(U, x.m);
  if(snap(U) !== snap(G)){ fails++; console.log("seed", seed, "mosse oneste rifiutate dai controlli"); }
  if(snap(R) !== snap(G)){ fails++; console.log("seed", seed, "stato diverso dopo", log.length, "mosse"); }
  // rigiocare a metà e poi continuare dà lo stesso risultato (riconnessione)
  const half = Math.floor(log.length / 2), H = createGame(json, byId, opts);
  for(const x of log.slice(0, half)) applyMoveAs(H, x.seat, x.m);
  const mid = snap(H); const H2 = createGame(json, byId, opts); for(const x of log.slice(0, half)) applyMoveAs(H2, x.seat, x.m);
  if(snap(H2) !== mid){ fails++; console.log("seed", seed, "rigioco parziale diverso"); }
  for(const x of log.slice(half)) applyMoveAs(H, x.seat, x.m);
  if(snap(H) !== snap(G)){ fails++; console.log("seed", seed, "ripresa a metà diversa"); }
  games++; moves += log.length; if(G.winner != null) ended++;
}
// mazzo ostile: stampa inventata con HTML dentro e copie enormi
const evil = { name: "x", legends: legends.slice(0, 5).map(c => ({ cid: c.id, pid: '"><img src=x onerror=alert(1)>' })), cards: [{ cid: others[0].id, pid: "javascript:x", n: 1e9 }, { cid: others[1].id, pid: others[1].def.id, n: "<b>" }] };
const E = createGame([evil, evil], byId, { seed: 5 });
const bad = [...E.players[0].deck, ...E.players[0].hand, ...E.players[0].legends].filter(x => !byId.get(x.cid).prints.some(p => p.id === x.pid));
if(bad.length || E.players[0].legends.length > 3 || E.players[0].deck.length + E.players[0].hand.length > 100){ fails++; console.log("mazzo ostile non ripulito", bad.length, E.players[0].legends.length, E.players[0].deck.length); }
if(forgedOk){ fails++; console.log(forgedOk, "mosse falsificate accettate"); }
console.log(`${games} partite rigiocate (${ended} concluse), ${moves} mosse, ${forged} mosse falsificate respinte, ${fails} differenze`);
process.exit(fails ? 1 : 0);
