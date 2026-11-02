/* Partite online: le stesse mosse sullo stesso seme danno sempre lo stesso stato */
import { readFileSync } from "node:fs";
import { createGame, legalActions, mulberry32, applyMove, moveOf, summary } from "./engine.js";
const data = JSON.parse(readFileSync("public/cards.json", "utf8"));
const byId = new Map(); for(const c of data.cards){ c.def = c.prints[0]; c.ramN = c.ram ?? 0; byId.set(c.id, c); }
const legends = data.cards.filter(c => c.type === "Legend" && c.legal === "legal"), others = data.cards.filter(c => c.type !== "Legend");
const snap = G => JSON.stringify({ s: summary(G), w: G.winner, r: G.reason, t: G.turn, a: G.active, p: G.pending && [G.pending.player, G.pending.kind, G.pending.options.length], log: G.log.map(e => e.text) });
let fails = 0, games = 0, moves = 0, ended = 0;
for(let seed = 1; seed <= 120; seed++){
  const rng = mulberry32(seed * 104729);
  const pick = (arr, n) => { const a = arr.slice(); const out = []; while(out.length < n && a.length) out.push(a.splice(Math.floor(rng() * a.length), 1)[0]); return out; };
  const mkDeck = name => ({ name, legends: pick(legends, 3).map(c => ({ cid: c.id, pid: c.def.id })), cards: pick(others, 20).map(c => ({ cid: c.id, pid: c.def.id, n: 2 })) });
  const decks = [mkDeck("Host"), mkDeck("Guest")], opts = { seed: seed * 31, autoPay: [rng() < .5, rng() < .5] };
  const json = JSON.parse(JSON.stringify(decks));       // come arrivano dal database
  const G = createGame(decks, byId, opts), log = [];
  const play = m => { log.push(JSON.parse(JSON.stringify(m))); applyMove(G, m); };
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
  for(const m of JSON.parse(JSON.stringify(log))) applyMove(R, m);
  if(snap(R) !== snap(G)){ fails++; console.log("seed", seed, "stato diverso dopo", log.length, "mosse"); }
  // rigiocare a metà e poi continuare dà lo stesso risultato (riconnessione)
  const half = Math.floor(log.length / 2), H = createGame(json, byId, opts);
  for(const m of log.slice(0, half)) applyMove(H, m);
  const mid = snap(H); const H2 = createGame(json, byId, opts); for(const m of log.slice(0, half)) applyMove(H2, m);
  if(snap(H2) !== mid){ fails++; console.log("seed", seed, "rigioco parziale diverso"); }
  for(const m of log.slice(half)) applyMove(H, m);
  if(snap(H) !== snap(G)){ fails++; console.log("seed", seed, "ripresa a metà diversa"); }
  games++; moves += log.length; if(G.winner != null) ended++;
}
console.log(`${games} partite rigiocate (${ended} concluse), ${moves} mosse, ${fails} differenze`);
process.exit(fails ? 1 : 0);
