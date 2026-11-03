import { readFileSync } from "node:fs";
import { createGame, mulligan, resolve, mulberry32 } from "./engine.js";
import { ownKeywords } from "./data.js";
import { botDecide, botTurn } from "./bot.js";
const data = JSON.parse(readFileSync("public/cards.json", "utf8"));
const byId = new Map(); for(const c of data.cards){ c.def = c.prints[0]; c.ramN = c.ram ?? 0; c.kw = ownKeywords(c); byId.set(c.id, c); }
const legends = data.cards.filter(c => c.type === "Legend" && c.legal === "legal"), others = data.cards.filter(c => c.type !== "Legend");
let errors = 0, games = 0, manual = 0, turns = 0;
for(let seed = 1; seed <= 300; seed++){
  const rng = mulberry32(seed * 7919);
  const pick = (arr, n) => { const a = arr.slice(); const out = []; while(out.length < n && a.length){ out.push(a.splice(Math.floor(rng() * a.length), 1)[0]); } return out; };
  const mkDeck = () => ({ name: "F", legends: pick(legends, 3).map(c => ({ cid: c.id, pid: c.def.id })), cards: pick(others, 20).map(c => ({ cid: c.id, pid: c.def.id, n: 2 })) });
  const G = createGame([mkDeck(), mkDeck()], byId, { seed, bot0: true, bot1: true }); G.decide = botDecide;
  try{
    mulligan(G, 0, false); mulligan(G, 1, false);
    let guard = 0;
    while(G.winner == null && guard++ < 300){ if(G.pending){ resolve(G, 0); continue; } botTurn(G, G.active); }
    games++; turns += G.turn; manual += G.events.filter(e => e.kind === "manual").length;
    if(G.winner == null) console.log("partita", seed, "non finita", G.phase, G.pending && G.pending.kind);
  }catch(e){ errors++; console.log("seed", seed, e.stack.split("\n").slice(0, 3).join(" | ")); if(errors > 8) break; }
}
console.log(`${games} partite casuali, ${errors} errori, turni medi ${(turns / games).toFixed(1)}, effetti manuali ${manual}`);
