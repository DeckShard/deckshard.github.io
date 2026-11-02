/* Collaudo dal vivo dei tavoli online sul progetto Supabase: due giocatori di prova
   (accesso anonimo, va abilitato nel pannello). Codice di 4 caratteri, mulligan in
   contemporanea, partita giocata dai due telefoni con stato identico, ripresa dopo
   un ricaricamento, chat del tavolo, sfida diretta, patta, abbandono, disconnessione
   oltre il minuto. BASE=… node online.test.mjs                                    */
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://127.0.0.1:8760";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let fails = 0, passes = 0;
const ok = (c, m) => { if(c) passes++; else { fails++; console.log("  ✘", m); } };
const tag = Math.random().toString(36).slice(2, 6);
const errors = [];
async function device(name, auth){
  const ctx = await b.newContext({ viewport: { width: 1100, height: 700 } });
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errors.push(name + ": " + e.message));
  pg.on("dialog", d => d.accept());
  await pg.goto(BASE + "/index.html#profile"); await pg.waitForFunction(() => document.querySelector("#metaLine") && !/…/.test(document.querySelector("#metaLine").textContent));
  if(auth){ await pg.evaluate(a => localStorage.setItem("ncd:auth", a), auth); await pg.reload(); }
  else await pg.evaluate(async () => { const c = await import("./cloud.js"); await c.signInAnon(); });
  await pg.waitForFunction(async () => { const c = await import("./cloud.js"); return c.state.user && c.state.status === "ok"; }, null, { timeout: 20000 });
  return { ctx, pg, name };
}
const until = async (pg, fn, arg, ms = 20000) => { try{ await pg.waitForFunction(fn, arg, { timeout: ms }); return true; }catch(e){ return false; } };
const setNick = (pg, n) => pg.evaluate(async n => { const c = await import("./cloud.js"); await c.setNick(n); }, n);
const toLobby = async pg => { await pg.click('nav.tabs button[data-tab="sim"]'); await pg.waitForTimeout(200); await pg.click('#simMode button[data-v="online"]'); await pg.waitForTimeout(400); };
const snap = pg => pg.evaluate(async () => { const e = await import("./engine.js"); const G = window.__ncdSim.G(); if(!G) return null; return JSON.stringify({ s: e.summary(G), w: G.winner, t: G.turn, a: G.active, ph: G.phase, p: G.pending && [G.pending.player, G.pending.kind], log: G.log.slice(-30).map(x => x.text) }); });
const applied = pg => pg.evaluate(async () => { const o = await import("./online.js"); return { applied: o.T.applied, inflight: o.T.inflight }; });
/* un passo di gioco casuale per chi deve decidere su questo telefono */
const step = (pg, seed) => pg.evaluate(async seed => {
  const e = await import("./engine.js"), S = window.__ncdSim, G = S.G(), me = S.seat();
  if(!G || G.winner != null) return "end";
  if(document.querySelector("[data-mull]")){ document.querySelector('[data-mull="keep"]').click(); return "mull"; }
  const rnd = (n => () => (n = (n * 16807) % 2147483647) / 2147483647)(seed);
  if(G.pending){ if(G.pending.player !== me) return "wait"; const okI = G.pending.options.map((o, i) => o.disabled ? -1 : i).filter(i => i >= 0); const cancel = G.pending.options.findIndex(o => o.kind === "cancel"); let pick = okI[Math.floor(rnd() * okI.length)]; if(pick === cancel && okI.length > 1) pick = okI.find(i => i !== cancel); S.res(okI.length ? pick : -1); return "res"; }
  if(G.active !== me || G.phase !== "main") return "wait";
  const acts = e.legalActions(G, me), non = acts.filter(a => a.t !== "end");
  const a = non.length && rnd() < .75 ? non[Math.floor(rnd() * non.length)] : acts.find(a => a.t === "end");
  S.act(e.moveOf(a)); return "act:" + a.t;
}, seed);
const settled = async (P, Q) => { for(let i = 0; i < 40; i++){ const [x, y] = [await applied(P.pg), await applied(Q.pg)]; if(x.applied === y.applied && !x.inflight && !y.inflight) return x.applied; await P.pg.waitForTimeout(250); } return -1; };

const H = await device("H"), Gs = await device("G");
const nickH = "Host_" + tag, nickG = "Guest_" + tag;
await setNick(H.pg, nickH); await setNick(Gs.pg, nickG);

/* 1. tavolo con codice */
await toLobby(H.pg);
ok(await H.pg.locator("#onlCreate").count() === 1 && await H.pg.locator("#onlJoin").count() === 1, "lobby online con Crea / Entra");
await H.pg.selectOption("#simDeck0", "starter:theheistretailstarterdeck");
await H.pg.click("#onlCreate");
ok(await until(H.pg, () => /^[A-Z2-9]{4}$/.test(document.querySelector(".tcode b")?.textContent || "")), "codice di 4 caratteri mostrato");
const code = (await H.pg.locator(".tcode b").textContent()).trim();
await toLobby(Gs.pg);
await Gs.pg.selectOption("#simDeck0", "starter:embracingpowerretailstarterdeck");
await Gs.pg.fill("#onlCode", "zzzz"); await Gs.pg.click("#onlJoin");
ok(await until(Gs.pg, () => /nessun tavolo/.test(document.querySelector("#toast")?.textContent || ""), null, 8000), "codice sbagliato: avviso");
await Gs.pg.fill("#onlCode", code.toLowerCase()); await Gs.pg.click("#onlJoin");
ok(await until(Gs.pg, () => !document.querySelector("#board").hidden && document.querySelector("[data-mull]")), "ospite: plancia aperta con il mulligan");
ok(await until(H.pg, () => !document.querySelector("#board").hidden && document.querySelector("[data-mull]")), "host: la partita parte da sola quando entra l'ospite");
const names = await H.pg.locator(".bz.rival .lbl").textContent();
ok(names.includes(nickG), "host vede il nick dell'ospite sulla plancia (" + names + ")");
// mulligan nello stesso istante: uno dei due va in conflitto e si ricostruisce
await Promise.all([H.pg.click('[data-mull="redo"]'), Gs.pg.click('[data-mull="keep"]')]);
ok(await until(H.pg, () => window.__ncdSim.G().players.every(p => p.mulliganed) && window.__ncdSim.G().turn >= 1) && await until(Gs.pg, () => window.__ncdSim.G().players.every(p => p.mulliganed) && window.__ncdSim.G().turn >= 1), "mulligan contemporanei: partita avviata su entrambi");
let n = await settled(H, Gs);
ok(n === 2 && await snap(H.pg) === await snap(Gs.pg), `stato identico dopo i mulligan (${n} mosse)`);

/* 2. partita giocata dai due telefoni */
let diff = 0, steps = 0, reloaded = false;
for(let i = 0; i < 400; i++){
  const r1 = await step(H.pg, 1000 + i), r2 = await step(Gs.pg, 5000 + i); steps++;
  if(r1 === "end" && r2 === "end") break;
  if(r1 === "wait" && r2 === "wait") await H.pg.waitForTimeout(200);
  if(i % 25 === 24){ const m = await settled(H, Gs); if(m > 0 && await snap(H.pg) !== await snap(Gs.pg)) diff++; }
  if(i === 60 && !reloaded){
    reloaded = true;
    await settled(H, Gs);
    await Gs.pg.reload(); await Gs.pg.waitForFunction(async () => { const c = await import("./cloud.js"); return c.state.user && c.state.status === "ok"; }, null, { timeout: 20000 });
    await toLobby(Gs.pg);
    ok(await until(Gs.pg, () => document.querySelector("[data-onlresume]")), "dopo il ricaricamento: partita in corso nella lobby");
    await Gs.pg.click("[data-onlresume]");
    ok(await until(Gs.pg, () => !document.querySelector("#board").hidden && window.__ncdSim.G()), "ripresa della partita");
    await settled(H, Gs);
    ok(await snap(H.pg) === await snap(Gs.pg), "stato identico dopo la ripresa (rigiocato dal registro)");
    // chat del tavolo
    await Gs.pg.evaluate(() => document.querySelector("#bChat").click()); await Gs.pg.fill("#tchatIn", "ciao " + tag, { force: true }); await Gs.pg.press("#tchatIn", "Enter");
    ok(await until(H.pg, t => document.querySelector("#bChat .nbadge"), tag, 10000), "chat: badge sul telefono dell'host");
    await H.pg.evaluate(() => document.querySelector("#bChat").click());
    ok(await until(H.pg, t => document.querySelector("#tchatList")?.textContent.includes("ciao " + t), tag, 5000), "chat: messaggio arrivato");
    for(const pg of [H.pg, Gs.pg]) await pg.evaluate(() => document.querySelector("#bChatClose")?.click());
  }
}
await settled(H, Gs);
const fin = [await snap(H.pg), await snap(Gs.pg)];
ok(!diff && fin[0] === fin[1], `partita: stato identico sui due telefoni (${steps} passi, ${diff} differenze)`);
const winner = JSON.parse(fin[0]).w;
ok(winner === 0 || winner === 1, "partita conclusa dal motore (vince il posto " + winner + ")");
ok(await until(H.pg, () => document.querySelector(".winbox")) && await until(Gs.pg, () => document.querySelector(".winbox")), "schermata di fine su entrambi");
const tableRes = async pg => pg.evaluate(async () => { const o = await import("./online.js"); await o.refreshTables(); return o.tables.filter(t => t.status === "finished").map(t => t.result + ":" + t.reason); });
await H.pg.waitForTimeout(1500);
const rr = await tableRes(Gs.pg);
ok(rr.length === 1 && rr[0].startsWith(winner === 0 ? "host:" : "guest:"), "risultato registrato nel database dal telefono di chi perde (" + rr + ")");
console.log("  ricostruzioni dal registro:", await H.pg.evaluate(() => window.__ncdRebuilds || 0), await Gs.pg.evaluate(() => window.__ncdRebuilds || 0));
const recs = await Promise.all([H.pg, Gs.pg].map(pg => pg.evaluate(() => JSON.parse(localStorage.getItem("ncd:record")).online)));
ok(recs[0].w + recs[1].w === 1 && recs[0].l + recs[1].l === 1, "record online aggiornato (" + JSON.stringify(recs) + ")");
await H.pg.click("#bExit"); await Gs.pg.click("#bExit");

/* 3. sfida diretta a un amico, poi patta */
await H.pg.evaluate(async n => { const c = await import("./cloud.js"); await c.friendRequest(n); }, nickG);
const hId = await H.pg.evaluate(async () => (await import("./cloud.js")).state.user.id);
await Gs.pg.evaluate(async id => { const c = await import("./cloud.js"); await c.friendRespond(id, true); }, hId);
await H.pg.evaluate(async () => { const c = await import("./cloud.js"); await c.refreshSocial(); });
await H.pg.click('nav.tabs button[data-tab="profile"]'); await H.pg.waitForTimeout(500);
ok(await until(H.pg, () => document.querySelector("[data-fduel]")), "pulsante Sfida nella lista amici");
await H.pg.click("[data-fduel]");
ok(await until(H.pg, () => document.querySelector("#onlFriend") && document.querySelector('#p-sim.on')), "Sfida porta alla lobby con l'amico scelto");
await H.pg.click("#onlChallenge");
ok(await until(H.pg, () => /Sfida inviata/.test(document.querySelector(".tcode")?.textContent || "")), "sfida inviata: in attesa");
ok(await until(Gs.pg, () => /ti sfida/.test(document.querySelector("#toast")?.textContent || "") || document.querySelector('nav.tabs button[data-tab="sim"] .nbadge'), null, 15000), "l'amico riceve la sfida in tempo reale");
await toLobby(Gs.pg);
ok(await until(Gs.pg, () => document.querySelector("[data-onlaccept]")), "sfida nella lobby dell'amico");
await Gs.pg.click("[data-onlaccept]");
ok(await until(H.pg, () => document.querySelector("[data-mull]")) && await until(Gs.pg, () => document.querySelector("[data-mull]")), "sfida accettata: partita avviata");
await H.pg.click('[data-mull="keep"]'); await Gs.pg.click('[data-mull="keep"]');
await until(H.pg, () => window.__ncdSim.G().players.every(p => p.mulliganed));
await H.pg.evaluate(() => document.querySelector("#bMenu").click()); await H.pg.evaluate(() => [...document.querySelectorAll(".pop button")].find(b => /Proponi la patta/.test(b.textContent)).click());
ok(await until(Gs.pg, () => document.querySelector(".drawask")), "proposta di patta arrivata");
await Gs.pg.evaluate(() => document.querySelector('[data-draw="1"]').click());
ok(await until(H.pg, () => /PATTA/.test(document.querySelector(".winbox h2")?.textContent || "")) && await until(Gs.pg, () => /PATTA/.test(document.querySelector(".winbox h2")?.textContent || "")), "patta concordata su entrambi");
await H.pg.click("#bExit"); await Gs.pg.click("#bExit");

/* 4. abbandono */
await toLobby(H.pg); await H.pg.click("#onlCreate");
await until(H.pg, () => /^[A-Z2-9]{4}$/.test(document.querySelector(".tcode b")?.textContent || ""));
const code2 = (await H.pg.locator(".tcode b").textContent()).trim();
await toLobby(Gs.pg); await Gs.pg.fill("#onlCode", code2); await Gs.pg.click("#onlJoin");
await until(Gs.pg, () => document.querySelector("[data-mull]")); await until(H.pg, () => document.querySelector("[data-mull]"));
await Gs.pg.evaluate(() => document.querySelector("#bMenu").click()); await Gs.pg.evaluate(() => [...document.querySelectorAll(".pop button")].find(b => /Abbandona la partita/.test(b.textContent)).click());
await Gs.pg.evaluate(() => [...document.querySelectorAll("#simAsk button")].find(b => /^Abbandono$/.test(b.textContent.trim())).click());
ok(await until(H.pg, () => /VITTORIA/.test(document.querySelector(".winbox h2")?.textContent || "")) && await until(Gs.pg, () => /SCONFITTA/.test(document.querySelector(".winbox h2")?.textContent || "")), "abbandono: vittoria all'host");
await H.pg.click("#bExit"); await Gs.pg.click("#bExit");

/* 5. disconnessione oltre il minuto */
await toLobby(H.pg); await H.pg.click("#onlCreate");
await until(H.pg, () => /^[A-Z2-9]{4}$/.test(document.querySelector(".tcode b")?.textContent || ""));
const code3 = (await H.pg.locator(".tcode b").textContent()).trim();
const gAuth = await Gs.pg.evaluate(() => localStorage.getItem("ncd:auth"));
await toLobby(Gs.pg); await Gs.pg.fill("#onlCode", code3); await Gs.pg.click("#onlJoin");
ok(await until(H.pg, () => document.querySelector("[data-mull]") && !document.querySelector("#board").hidden), "terzo tavolo avviato");
await Gs.ctx.close();   // l'ospite sparisce
ok(await until(H.pg, () => /non risponde/.test(document.querySelector("#onlBadge")?.textContent || ""), null, 45000), "avviso: l'avversario non risponde, con conto alla rovescia");
ok(await until(H.pg, () => !document.querySelector("#board").hidden && /VITTORIA/.test(document.querySelector(".winbox h2")?.textContent || ""), null, 60000), "dopo un minuto vince chi è rimasto");
ok(/disconness/.test(await H.pg.locator(".winbox p").first().textContent()), "motivo: disconnessione");

/* pulizia: i due account di prova */
const G2 = await device("G2", gAuth);
for(const P of [H, G2]) await P.pg.evaluate(async () => { const c = await import("./cloud.js"); await c.deleteAccount(); });
ok(!errors.length, "nessun errore JavaScript (" + errors.slice(0, 3).join(" | ") + ")");
await b.close();
console.log(`\n${passes} controlli OK, ${fails} falliti`);
process.exit(fails ? 1 : 0);
