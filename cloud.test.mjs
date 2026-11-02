/* Collaudo dal vivo dell'account e della parte social sul progetto Supabase:
   due giocatori di prova (accesso anonimo, va abilitato nel pannello),
   sincronizzazione su un secondo «dispositivo», amicizia, chat in tempo
   reale, feedback, cancellazione degli account. BASE=… node cloud.test.mjs */
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://127.0.0.1:8760";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let fails = 0, passes = 0;
const ok = (c, m) => { if(c) passes++; else { fails++; console.log("  ✘", m); } };
const tag = Math.random().toString(36).slice(2, 7);
const errors = [];
async function device(name){
  const ctx = await b.newContext({ viewport: { width: 420, height: 860 } });
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errors.push(name + ": " + e.message));
  pg.on("dialog", d => d.accept());
  await pg.goto(BASE + "/index.html#profile"); await pg.waitForFunction(() => document.querySelector("#metaLine") && !/…/.test(document.querySelector("#metaLine").textContent));
  return { ctx, pg };
}
const until = async (pg, fn, arg, ms = 15000) => { try{ await pg.waitForFunction(fn, arg, { timeout: ms }); return true; }catch(e){ return false; } };
const anon = pg => pg.evaluate(async () => { const c = await import("./cloud.js"); await c.signInAnon(); });
const cloudState = pg => pg.evaluate(async () => { const c = await import("./cloud.js"); return { user: c.state.user && c.state.user.id, nick: c.state.profile && c.state.profile.nick, status: c.state.status, error: c.state.error, friends: c.friends.map(f => [f.nick, f.status, f.incoming, f.unread]) }; });

// dispositivo A con dati locali
const A = await device("A");
await A.pg.evaluate(t => { localStorage.setItem("ncd:coll", JSON.stringify({ "3fc63c58-5954-4744-a5af-047bfc5cb159": 2 })); localStorage.setItem("ncd:decks", JSON.stringify([{ id: "dk" + t, name: "Mazzo " + t, legends: [null, null, null], cards: [], updated: Date.now() }])); localStorage.setItem("ncd:profile", JSON.stringify({ nick: "Alpha " + t, faction: "Nomad" })); }, tag);
await A.pg.reload(); await A.pg.waitForTimeout(800);
ok(await A.pg.locator("#acct #acSend").count() === 1, "scheda Account con accesso via email");
await anon(A.pg);
ok(await until(A.pg, () => document.querySelector("#acct #acOut")), "A: accesso eseguito, scheda Account collegata");
await A.pg.waitForTimeout(2500);
let sA = await cloudState(A.pg);
ok(sA.user && sA.status === "ok", "A: sincronizzato (" + JSON.stringify(sA).slice(0, 120) + ")");
ok(sA.nick === "Alpha_" + tag, "A: nick pubblico proposto da quello locale (" + sA.nick + ")");
const remoteA = await A.pg.evaluate(async () => { const c = await import("./cloud.js"); const cl = await c.client(); const { data } = await cl.from("user_data").select("coll, decks, stamps").single(); return data; });
ok(remoteA && remoteA.coll["3fc63c58-5954-4744-a5af-047bfc5cb159"] === 2 && remoteA.decks.length === 1, "A: collezione e mazzi caricati nel cloud");
// nick dalla scheda
const nickA = "TestA_" + tag;
await A.pg.fill("#acNick", nickA); await A.pg.click("#acNickSave"); await A.pg.waitForTimeout(800);
ok((await cloudState(A.pg)).nick === nickA, "A: nick cambiato dalla scheda Account");
await A.pg.fill("#acNick", "no spazi"); await A.pg.click("#acNickSave"); await A.pg.waitForTimeout(400);
ok((await cloudState(A.pg)).nick === nickA, "A: nick non valido rifiutato");

// secondo dispositivo di A: stessa sessione, nessun dato locale → prende il cloud
const A2 = await device("A2");
const auth = await A.pg.evaluate(() => localStorage.getItem("ncd:auth"));
await A2.pg.evaluate(a => { localStorage.setItem("ncd:auth", a); }, auth);
await A2.pg.reload();
ok(await until(A2.pg, () => document.querySelector("#acct #acOut")), "A2: sessione ripresa sul secondo dispositivo");
ok(await until(A2.pg, () => (JSON.parse(localStorage.getItem("ncd:decks") || "[]")).length === 1), "A2: mazzi scaricati dal cloud");
ok(await A2.pg.evaluate(() => JSON.parse(localStorage.getItem("ncd:coll") || "{}")["3fc63c58-5954-4744-a5af-047bfc5cb159"] === 2), "A2: collezione scaricata dal cloud");
// modifica su A2 → arriva su A in tempo reale
await A2.pg.evaluate(async () => { const s = await import("./store.js"); s.setQty("3fc63c58-5954-4744-a5af-047bfc5cb159", 3); });
ok(await until(A.pg, () => JSON.parse(localStorage.getItem("ncd:coll") || "{}")["3fc63c58-5954-4744-a5af-047bfc5cb159"] === 3, null, 20000), "A: modifica fatta su A2 arrivata in tempo reale");
await A2.ctx.close();

// giocatore B
const B = await device("B");
await anon(B.pg);
ok(await until(B.pg, () => document.querySelector("#acct #acOut")), "B: accesso eseguito");
await B.pg.waitForTimeout(1500);
const nickB = "TestB_" + tag;
await B.pg.fill("#acNick", nickB); await B.pg.click("#acNickSave"); await B.pg.waitForTimeout(600);
await B.pg.fill("#frQ", "TestA_" + tag.slice(0, 3)); await B.pg.click("#frSearch"); await B.pg.waitForTimeout(800);
ok(await B.pg.locator(`[data-fadd="${nickA}"]`).count() === 1, "B: trova A cercando il nick");
await B.pg.click(`[data-fadd="${nickA}"]`); await B.pg.waitForTimeout(800);
ok(await until(A.pg, () => document.querySelector("[data-facc]"), null, 20000), "A: richiesta di B arrivata in tempo reale");
ok(await until(A.pg, () => /^1$|^2$/.test((document.querySelector('nav.tabs button[data-tab="profile"] .nbadge') || {}).textContent || "")), "A: badge sulla scheda Social");
await A.pg.click("[data-facc]");
ok(await until(B.pg, () => document.querySelector("[data-fchat]"), null, 20000), "B: amicizia accettata, compare tra gli amici");
// chat
await A.pg.click("[data-fchat]"); await A.pg.waitForSelector("#chat:not([hidden]) #chText");
await A.pg.fill("#chText", "ciao " + tag); await A.pg.press("#chText", "Enter");
ok(await until(A.pg, t => [...document.querySelectorAll(".msg.me")].some(m => m.textContent.includes("ciao " + t)), tag), "A: messaggio inviato");
ok(await until(B.pg, () => document.querySelector(".badge") && document.querySelector(".badge").textContent === "1", null, 20000), "B: messaggio non letto segnalato");
await B.pg.click("[data-fchat]"); await B.pg.waitForSelector("#chat:not([hidden]) #chText");
ok(await until(B.pg, t => [...document.querySelectorAll(".msg:not(.me)")].some(m => m.textContent.includes("ciao " + t)), tag), "B: legge il messaggio");
await B.pg.fill("#chText", "ehi A"); await B.pg.press("#chText", "Enter");
ok(await until(A.pg, () => [...document.querySelectorAll(".msg:not(.me)")].some(m => m.textContent.includes("ehi A")), null, 20000), "A: risposta arrivata in tempo reale con la chat aperta");
ok(await until(A.pg, () => /in linea/.test(document.querySelector(".chh").textContent), null, 10000), "A: B risulta in linea");
await A.pg.click("#chClose"); await B.pg.click("#chClose");
// feedback
await A.pg.click("#btnSettings"); await A.pg.waitForTimeout(300);
await A.pg.fill("#fbBody", "collaudo automatico " + tag + " (si può cancellare)"); await A.pg.click("#fbSend");
ok(await until(A.pg, () => /Feedback inviato/.test(document.body.textContent), null, 8000), "feedback inviato dalle Impostazioni");
// pulizia: entrambi eliminano l'account
for(const [n, d] of [["A", A], ["B", B]]){
  await d.pg.click('nav.tabs button[data-tab="profile"]'); await d.pg.waitForTimeout(300);
  await d.pg.click("#acDelete");
  ok(await until(d.pg, () => document.querySelector("#acct #acSend")), n + ": account eliminato, si torna al modulo di accesso");
}
ok(!errors.length, "nessun errore JS: " + errors.slice(0, 3).join(" | "));
await b.close();
console.log(`\n${passes} controlli OK, ${fails} falliti`);
process.exit(fails ? 1 : 0);
