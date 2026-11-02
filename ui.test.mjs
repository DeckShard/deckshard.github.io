/* Collaudo dell'interfaccia con Playwright. Serve un server sull'app:
   BASE=http://127.0.0.1:8751 node ui.test.mjs                     */
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://127.0.0.1:8751";
let fails = 0, passes = 0;
const ok = (c, m) => { if(c) passes++; else { fails++; console.log("  ✘", m); } };
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if(m.type() === "error") errors.push(m.text()); });

await page.goto(BASE + "/index.html");
await page.waitForFunction(() => document.querySelector("#collRows .gc"));
ok(await page.locator("#collRows .gc").count() > 100, "griglia collezione popolata");
ok((await page.locator("#metaLine").textContent()).includes("carte"), "riga meta");

/* ricerca e scheda */
await page.fill("#collQ", "mantis");
ok(await page.locator("#collRows .gc").count() === 1, "ricerca: Mantis Blades");
await page.click("#collRows .gc");
await page.waitForSelector("#sheet.on");
ok((await page.locator("#sheetBox h3").first().textContent()).includes("Mantis"), "scheda aperta");
await page.click('#sheetBox [data-q="1"]'); await page.click('#sheetBox [data-q="1"]');
ok((await page.locator("#sheetQty").textContent()) === "2", "quantità 2");
ok((await page.locator("#sheetTot").textContent()).startsWith("2"), "totale 2 in collezione");
const prints = await page.locator("#sheetBox .pt").count(); ok(prints >= 2, `stampe elencate (${prints})`);
await page.click("#sheetBox .pt:nth-child(2)");
ok(!(await page.locator("#sheetBox .pt").first().getAttribute("class")).includes("sel"), "cambio stampa");
await page.click("#closeSheet");
ok(!(await page.locator("#sheet").getAttribute("class") || "").includes("on"), "scheda chiusa");
ok((await page.locator("#tOwned").textContent()) === "2", "tessera copie aggiornata");
await page.screenshot({ path: "/tmp/ncd-shot-collection.png" });

/* vista elenco, solo possedute */
await page.fill("#collQ", "");
await page.click('#collView [data-v="list"]');
ok(await page.locator("#collRows .row").count() > 100, "vista elenco");
await page.click("#collOwned");
ok(await page.locator("#collRows .row").count() === 1, "solo possedute: 1");
await page.click("#collOwned");

/* persistenza */
await page.reload(); await page.waitForFunction(() => document.querySelector("#collRows .gc, #collRows .row"));
ok((await page.locator("#tOwned").textContent()) === "2", "collezione persistita dopo ricarica");

/* deckbuilder */
await page.click('nav.tabs button[data-tab="deck"]');
await page.click('[data-starter="theheistretailstarterdeck"]');
await page.waitForSelector("#deckEdit:not([hidden])");
ok((await page.locator("#deckEdit .lslot img").count()) === 3, "3 Leggende dallo starter");
const legalTxt = await page.locator("#deckEdit .legal").textContent();
ok(/✔.*carte/.test(legalTxt), "conteggio carte nel pannello legalità: " + legalTxt.slice(0, 80));
ok((await page.locator("#deckEdit .dlist .row").count()) === 17, "17 voci nella bozza");
// aggiungi una carta dal browser
await page.fill("#deckQ", "mantis blades");
await page.click("#deckRows .row");
ok((await page.locator("#deckEdit .dlist .row").count()) === 18, "carta aggiunta");
// quantità +
const row = page.locator('#deckEdit .dlist .row:has-text("Mantis")');
await row.locator('[data-dq="1"]').click();
ok((await row.locator(".qtyctl b").textContent()) === "2", "quantità 2");
// cambio artwork dalla miniatura del browser
await page.click("#deckRows .row .thumb");
await page.waitForSelector("#sheet.on");
ok(await page.locator("#pickBtn").count() === 1, "modale in modalità scelta stampa");
await page.click("#sheetBox .pt:last-child"); await page.click("#pickBtn");
ok(!(await page.locator("#sheet").getAttribute("class") || "").includes("on"), "stampa scelta e modale chiusa");
// export testo
await page.evaluate(() => { navigator.clipboard.writeText = t => { window.__txt = t; return Promise.resolve(); }; });
await page.click("#deckCopy");
const txt = await page.evaluate(() => window.__txt);
ok(txt && txt.includes("Legend:") && /\d+ Mantis Blades/.test(txt), "export testo");
await page.screenshot({ path: "/tmp/ncd-shot-deck.png", fullPage: true });
// torna all'elenco
await page.click("#deckBack");
ok((await page.locator("#deckList [data-deck]").count()) === 1, "mazzo in elenco");
// import testo
await page.evaluate(() => { window.prompt = () => "# Test import\nLegend: V: Streetkid\nLegend: Royce: Psycho on the Edge\nLegend: Rogue Amendiares: Preem Solo\n3 Mantis Blades\n2x Japantown Jonin\nNon esiste"; });
await page.click("#deckImport");
await page.waitForSelector("#deckEdit:not([hidden])");
ok((await page.locator("#deckName").inputValue()) === "Test import", "nome importato");
ok((await page.locator("#deckEdit .dlist .row").count()) === 2, "2 carte importate");
await page.click("#deckBack");

/* profilo */
await page.click('nav.tabs button[data-tab="profile"]');
await page.fill("#pfNick", "Choom"); await page.dispatchEvent("#pfNick", "change");
await page.click('#pfLife [data-v="Nomad"]');
await page.click('#pfChars button[data-fav="V: Streetkid"]');
ok((await page.locator(".phead h2").textContent()) === "Choom", "nick salvato");
ok(await page.locator(".phead img.avatar").count() === 1, "avatar dalla Leggenda");
await page.click('#pfAccent .sw[data-v="netrunner"]');
ok((await page.evaluate(() => document.documentElement.dataset.accent)) === "netrunner", "accento applicato");
await page.click('#pfTheme [data-v="dark"]');
ok((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "tema scuro");
await page.screenshot({ path: "/tmp/ncd-shot-profile.png", fullPage: true });
await page.click('#pfTheme [data-v="light"]');

/* simulatore contro il bot */
await page.click('nav.tabs button[data-tab="sim"]');
await page.selectOption("#simDeck0", "starter:theheistretailstarterdeck");
await page.selectOption("#simDeck1", "starter:embracingpowerretailstarterdeck");
await page.click("#simStart");
await page.waitForSelector("#board:not([hidden])");
await page.waitForSelector("#simAsk");
ok((await page.locator("#simAsk h3").textContent()).includes("tieni"), "mulligan chiesto");
await page.click('#simAsk button:has-text("Tengo")');
await page.waitForTimeout(300);
// o scelgo il dado (se inizio io) o aspetto il bot
for(let i = 0; i < 40; i++){
  const ask = await page.locator("#simAsk").count();
  if(ask){ const h = await page.locator("#simAsk h3").textContent(); if(/dado/.test(h)) { await page.click("#simAsk [data-ask]"); } else { await page.click("#simAsk [data-ask]"); } }
  const mine = await page.locator("#bEnd").count();
  if(mine) break;
  await page.waitForTimeout(400);
}
ok(await page.locator("#bEnd").count() === 1, "arrivato il mio turno");
await page.screenshot({ path: "/tmp/ncd-shot-board.png" });
ok(await page.locator('[data-handrow] .bc').count() >= 6, "mano visibile");
// menù su una carta in mano
await page.click('[data-handrow] .bc >> nth=0');
ok(await page.locator(".pop").count() === 1, "menù carta");
const popTxt = await page.locator(".pop").textContent();
ok(/Gioca|Equipaggia/.test(popTxt) && /Vendi|vendibile/.test(popTxt), "voci gioca/vendi");
// vendi la prima carta vendibile
const sellBtn = page.locator('.pop button:has-text("Vendi")');
if(await sellBtn.count() && await sellBtn.isEnabled()){ await sellBtn.click(); ok((await page.locator('[data-eddies] b').textContent()).startsWith("1/"), "venduta: 1 eddie"); }
else { await page.click("#board .bstrip"); }
// fine turno → il bot gioca → torna a me
await page.click("#bEnd");
for(let i = 0; i < 60; i++){
  if(await page.locator("#simAsk").count()){ await page.click("#simAsk [data-ask]"); }
  if(await page.locator("#bEnd").count()) break;
  await page.waitForTimeout(400);
}
ok(await page.locator("#bEnd").count() === 1, "turno del bot completato");
const t = await page.locator(".bstrip .st").textContent(); ok(/T3|T4|T2/.test(t), "turno avanzato: " + t);
// registro
await page.click("#bLog"); ok(await page.locator("#simLog .e").count() > 3, "registro con voci");
await page.click("#bLogClose");
// zoom con pressione lunga su una carta in mano
await page.dispatchEvent('[data-handrow] .bc >> nth=0', "pointerdown"); await page.waitForTimeout(600);
ok((await page.locator("#lens").getAttribute("class") || "").includes("on"), "lente aperta con pressione lunga");
await page.keyboard.press("Escape"); await page.dispatchEvent('[data-handrow] .bc >> nth=0', "pointerup"); await page.click("#board .bstrip .st");
// resa e uscita
await page.click("#bMenu"); await page.click('.pop button:has-text("arrendo")');
await page.waitForSelector(".winbox");
ok((await page.locator(".winbox h2").textContent()).includes("SCONFITTA"), "resa registrata");
await page.click("#bExit");
ok(await page.locator("#board").isHidden(), "plancia chiusa");
ok((await page.locator("#simSetup .chip").first().textContent()).includes("1 sconfitte"), "record aggiornato");

/* hot-seat: passaggio del dispositivo */
await page.click('#simMode [data-v="hot"]');
await page.click("#simStart");
await page.waitForSelector("#simAsk");
await page.click('#simAsk button:has-text("Tengo")'); await page.waitForSelector('#simAsk button:has-text("Tengo")'); await page.click('#simAsk button:has-text("Tengo")');
await page.waitForTimeout(200);
if(await page.locator("#simAsk [data-ask]").count()) await page.click("#simAsk [data-ask]");
ok(await page.locator("#bEnd").count() === 1, "hot-seat: turno del primo");
await page.click("#bEnd");
ok(await page.locator(".handoff").count() === 1, "schermata passa il dispositivo");
await page.click("#bHand");
if(await page.locator("#simAsk [data-ask]").count()) await page.click("#simAsk [data-ask]");
ok(await page.locator("#bEnd").count() === 1, "hot-seat: turno del secondo");
await page.click("#bMenu"); await page.click('.pop button:has-text("Esci")');

/* desktop: tab in alto, griglia larga */
const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await desk.goto(BASE + "/index.html#deck"); await desk.waitForFunction(() => document.querySelector("#deckList"));
ok(await desk.locator('nav.tabs button[data-tab="deck"][aria-selected="true"]').count() === 1, "hash #deck apre il deckbuilder");
await desk.screenshot({ path: "/tmp/ncd-shot-desktop.png" });

ok(errors.length === 0, "nessun errore JS: " + errors.slice(0, 3).join(" | "));
await browser.close();
console.log(`\n${passes} controlli OK, ${fails} falliti`);
process.exit(fails ? 1 : 0);
