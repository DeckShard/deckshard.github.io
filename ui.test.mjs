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
await page.click('#collOwned [data-o="yes"]');
ok(await page.locator("#collRows .row").count() === 1, "solo possedute: 1");
await page.click('#collOwned [data-o="no"]');
ok(await page.locator("#collRows .row").count() === 150, "mancanti: 150");
await page.click('#collOwned [data-o=""]');
// pressione lunga sulla tessera: +1 senza aprire la scheda
await page.click('#collView [data-v="grid"]');
await page.fill("#collQ", "detonate");
await page.dispatchEvent("#collRows .gc", "pointerdown"); await page.waitForTimeout(600); await page.dispatchEvent("#collRows .gc", "pointerup");
ok((await page.locator("#collRows .gc .qty").textContent()) === "×1", "+1 con la pressione lunga");
ok(!(await page.locator("#sheet").getAttribute("class") || "").includes("on"), "la scheda non si apre");
await page.fill("#collQ", "");

/* persistenza */
await page.reload(); await page.waitForFunction(() => document.querySelector("#collRows .gc, #collRows .row"));
ok((await page.locator("#tOwned").textContent()) === "3", "collezione persistita dopo ricarica");

/* scanner da foto (OCR vero, motore da CDN) */
await page.click("#collScan");
await page.waitForSelector("#scan:not([hidden])");
const SCANS = [["7ffa8ba4-f187-4ba0-a719-fa8ebf45a03b", "Mantis Blades"], ["c7eba3a0-63cb-4311-988e-d487a7c0841a", "Delamain: Rideshare AI"], ["3fc63c58-5954-4744-a5af-047bfc5cb159", "V: Streetkid"], ["7514dd38-6e2d-43dd-9715-6b3a32615382", "Animals Wrecker"]];
let scanOk = 0;
for(const [pid, name] of SCANS){
  await page.evaluate(() => { document.querySelector("#scanMsg").textContent = ""; });
  await page.setInputFiles("#scanFile", `/home/claude/nightcity-deck/data/img/${pid}.webp`);
  try{
    await page.waitForFunction(() => /in lista|Forse|Non ho|Errore/.test(document.querySelector("#scanMsg").textContent), null, { timeout: 120000 });
    const msg = await page.locator("#scanMsg").textContent();
    const first = msg.includes("in lista") ? msg.replace(/^✔ /, "").replace(/ in lista.*$/, "") : await page.locator("#scanHits .hit b").first().textContent().catch(() => "");
    if(first === name) scanOk++; else console.log(`  (scanner: atteso ${name}, letto ${first} — ${await page.locator("#scanMsg").textContent()})`);
  }catch(e){ console.log("  (scanner non verificabile qui: " + (await page.locator("#scanMsg").textContent()) + ")"); break; }
}
ok(scanOk >= 3, `OCR: ${scanOk}/${SCANS.length} carte riconosciute dall'immagine`);
if(scanOk){
  ok((await page.locator("#scanList .srow").count()) === scanOk, `lista di scansione con ${scanOk} righe`);
  await page.click('#scanList .srow >> nth=0 >> [data-sq="1"]');
  ok((await page.locator("#scanCommit").textContent()).includes(`${scanOk + 1} carte`), "quantità modificabile in lista");
  await page.click("#scanCommit");
  ok((await page.locator("#scanList .srow").count()) === 0, "lista svuotata dopo la conferma");
}
await page.click("#scanClose");
ok(await page.locator("#scan").isHidden(), "scanner chiuso");

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
await page.evaluate(() => { window.prompt = () => "# Test import\nLegend: V: Streetkid\nLegend: Royce: Psycho on the Edge\nLegend: Rogue Amendiares: Preem Solo\n3 Mantis Blades\n2x Japantown Jonin\n2 WNC-025\n1 MS01 030\nSD01-004 x2\nNon esiste"; });
await page.click("#deckImport");
await page.waitForSelector("#deckEdit:not([hidden])");
ok((await page.locator("#deckName").inputValue()) === "Test import", "nome importato");
const importedRows = await page.locator("#deckEdit .dlist .row").count();
ok(importedRows === 4, `carte importate per nome e per codice (${importedRows} voci)`);
ok((await page.locator('#deckEdit .dlist .row:has-text("Mantis Blades") .qtyctl b').textContent()) === "5", "WNC-025 riconosciuta come Mantis Blades (3+2 copie)");
ok(await page.locator("#deckErrors").count() === 1 && (await page.locator("#deckErrors").textContent()).includes("Non esiste"), "righe non riconosciute mostrate");
await page.click("#deckErrorsOk"); ok(await page.locator("#deckErrors").count() === 0, "avviso chiuso");
await page.click("#deckBack");
// elimina dall'elenco con conferma
const nDecks = await page.locator("#deckList [data-deck]").count();
page.once("dialog", d => d.accept());
await page.click("#deckList [data-ddel] >> nth=0");
ok((await page.locator("#deckList [data-deck]").count()) === nDecks - 1, "mazzo eliminato dall'elenco");

/* profilo */
await page.click('nav.tabs button[data-tab="profile"]');
await page.fill("#pfNick", "Choom"); await page.dispatchEvent("#pfNick", "change");
await page.click('#pfLife [data-v="Nomad"]');
ok((await page.locator("#pfChars button").count()) > 60, "galleria avatar con illustrazioni alternative");
const favs = await page.locator("#pfChars button").evaluateAll(els => els.map(e => e.dataset.fav));
const favNames = favs.map(f => f.split(" · ")[0]);
ok(favNames.every((f, i) => !i || favNames[i - 1].localeCompare(f, "it") <= 0), "galleria in ordine alfabetico");
await page.click('#pfChars button[data-fav="V: Streetkid"]');
ok((await page.locator(".phead h2").textContent()) === "Choom", "nick salvato");
ok(await page.locator(".phead .avatar.art").count() === 1, "avatar dalla Leggenda");
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
// un ridisegno (es. ingresso a schermo intero) non deve far sparire il mulligan
await page.setViewportSize({ width: 412, height: 900 }); await page.waitForTimeout(200);
ok(await page.locator('[data-mull="keep"]').count() === 1, "mulligan sopravvive al ridisegno");
await page.click('[data-mull="keep"]');
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
ok(/Gioca|Equipaggia/.test(popTxt), "voce gioca/equipaggia");
// vendi la prima carta vendibile
let sold = false;
for(let k = 0; k < (await page.locator('[data-handrow] .bc').count()) && !sold; k++){
  if(k) await page.click(`[data-handrow] .bc >> nth=${k}`);
  const sellBtn = page.locator('.pop button:has-text("Vendi")');
  if(await sellBtn.count() && await sellBtn.isEnabled()){ await sellBtn.click(); sold = true; ok((await page.locator('.bz.mine [data-eddies] b').textContent()).startsWith("1/"), "venduta: 1 eddie"); }
  else await page.click("#board .bstrip .st");
}
// gioca una carta che posso permettermi: il pagamento manuale chiede con cosa pagare
let played = false;
const handN = await page.locator('[data-handrow] .bc').count();
for(let k = 0; k < handN && !played; k++){
  await page.click(`[data-handrow] .bc >> nth=${k}`);
  const b = page.locator('.pop button.acc');
  if(await b.count() && await b.isEnabled() && /Gioca/.test(await b.textContent())){ await b.click(); played = true; }
  else await page.click("#board .bstrip .st");
}
if(played){
  ok(/Paga \d+ €\$/.test(await page.locator(".bstrip .lg").textContent()), "pagamento sulla plancia: la barra chiede di toccare Eddies o Leggende");
  ok(await page.locator(".bz.mine .target").count() >= 1, "fonti di pagamento evidenziate");
  for(let k = 0; k < 6 && /Paga \d+ €\$/.test(await page.locator(".bstrip .lg").textContent()); k++){
    const ed = page.locator(".bz.mine [data-eddies].target"), lg = page.locator(".bz.mine [data-legend].target");
    if(await ed.count()) await ed.click(); else if(await lg.count()) await lg.first().click(); else break;
    await page.waitForTimeout(100);
  }
  ok(!/Paga \d+ €\$/.test(await page.locator(".bstrip .lg").textContent()), "pagamento completato toccando le fonti");
}
// trascinamento: una carta giocabile dalla mano sulla plancia
{
  const M0 = await page.evaluate(() => null);
  const hand = page.locator('[data-handrow] .bc'); const n = await hand.count(); let dragged = false;
  for(let k = 0; k < n && !dragged; k++){
    const card = hand.nth(k); const box = await card.boundingBox(); const field = await page.locator('.bz.mine [data-field]').boundingBox();
    const afford = (await card.locator(".co").getAttribute("class")).indexOf("no") < 0;
    if(!afford || !box || !field) continue;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + 20, box.y - 40, { steps: 4 }); await page.mouse.move(field.x + field.width / 2, field.y + field.height / 2, { steps: 6 });
    await page.mouse.up(); await page.waitForTimeout(150);
    dragged = /Paga \d+ €\$/.test(await page.locator(".bstrip .lg").textContent()) || (await page.locator(".bstrip .lg").textContent()).includes("Trascina");
  }
  if(dragged){ ok(true, "trascinamento dalla mano avvia il gioco della carta"); if(await page.locator("#bPayCancel").count()) await page.click("#bPayCancel"); }
}
// fine turno → il bot gioca → torna a me (prima si chiudono eventuali richieste della carta giocata)
if(await page.locator("#bPayCancel").count()) await page.click("#bPayCancel");
for(let i = 0; i < 10 && await page.locator("#simAsk [data-ask]").count(); i++){ await page.click("#simAsk [data-ask] >> nth=-1"); await page.waitForTimeout(100); }
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
ok(await page.locator("#peek:not([hidden]) img").count() === 1, "anteprima della carta con la pressione lunga");
const peekH = await page.evaluate(() => { const i = document.querySelector("#peek img"), b = document.querySelector("#board"); return [i.getBoundingClientRect().height, b.clientHeight]; });
ok(peekH[0] <= peekH[1] * 0.9, `anteprima dimensionata sulla plancia (${Math.round(peekH[0])}px su ${peekH[1]}px)`);
await page.dispatchEvent('[data-handrow] .bc >> nth=0', "pointerup");
ok(await page.locator("#peek:not([hidden])").count() === 0, "anteprima chiusa al rilascio");
await page.click("#board .bstrip .st");
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
await page.click('[data-mull="keep"]'); await page.waitForSelector('[data-mull="keep"]'); await page.click('[data-mull="keep"]');
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
