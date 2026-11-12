/* Collaudo dell'interfaccia con Playwright. Serve un server sull'app:
   BASE=http://127.0.0.1:8751 node ui.test.mjs                     */
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://127.0.0.1:8751";
let fails = 0, passes = 0;
/* tiro iniziale: se l'ha vinto il giocatore, sceglie chi inizia (prima opzione) e poi arriva il mulligan */
const openingChoice = async () => { await page.waitForSelector("#simAsk"); for(let k = 0; k < 4 && !(await page.locator('[data-mull="keep"]').count()); k++){ if(await page.locator("#simAsk [data-react]").count()) await page.click("#simAsk [data-react]"); if(await page.locator("#simAsk [data-ask]").count()) await page.click("#simAsk [data-ask] >> nth=0"); await page.waitForTimeout(250); } };
const ok = (c, m) => { if(c) passes++; else { fails++; console.log("  ✘", m); } };
const errors = [];
import { existsSync } from "node:fs"; import { fileURLToPath } from "node:url";
const HERE = fileURLToPath(new URL(".", import.meta.url));   // cartella del progetto: le immagini per lo scanner stanno in data/img
const CHROME = process.env.CHROME || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);   // altrimenti il browser di Playwright
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if(m.type() === "error") errors.push(m.text()); });

await page.goto(BASE + "/index.html");
/* home: pagina d'accoglienza al centro della barra, Social dall'avatar */
await page.waitForSelector("#p-home.on .emblem");
ok((await page.locator("nav.tabs button").evaluateAll(bs => bs.map(b => b.dataset.tab))).join(",") === "collection,deck,home,sim,chat", "barra: Collection, Deckbuilder, Home, Simulator, Chat");
ok(await page.locator("#homeSocial").count() === 1 && /Benvenuto|Bentornato/.test(await page.locator(".hhello").textContent()), "home con avatar e saluto");
await page.click("#homeSocial"); await page.waitForTimeout(300);
ok(await page.locator("#p-profile.on").count() === 1 && await page.locator('nav.tabs button[data-tab="home"][aria-selected="true"]').count() === 1, "avatar → Social, con Home accesa nella barra");
await page.click('nav.tabs button[data-tab="collection"]');
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
const NC = await page.evaluate(async () => { const { DATA } = await import("./data.js"); return [DATA.cards.length, DATA.cards.reduce((a, c) => a + c.prints.length, 0)]; });
ok(await page.locator("#collRows .row").count() === NC[0] - 1, `mancanti: ${NC[0] - 1}`);
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

/* import massivo della collezione */
await page.click("#collImportBtn");
await page.fill("#collImportText", "3 Mantis Blades\n2 WNC-030\nHEI-004 x1\nNon esiste");
ok((await page.locator("#collImportPreview").textContent()).includes("6 copie") && (await page.locator("#collImportPreview").textContent()).includes("Non esiste"), "anteprima import: conteggio e righe non riconosciute");
await page.click("#collImportGo");
await page.waitForFunction(() => document.querySelector("#collImport").hidden);
ok((await page.locator("#tOwned").textContent()) === "9", "aggiorna: 3 già possedute + 6 = 9 copie");
await page.click("#collImportBtn");
await page.fill("#collImportText", "1 Detonate");
await page.click('#collImportMode [data-v="replace"]');
await page.click("#collImportGo");
ok(await page.locator("#appAsk .btn.bad").count() === 1, "conferma nello stile dell'app (non quella del telefono)");
await page.click('#appAsk [data-a="ok"]');
await page.waitForFunction(() => document.querySelector("#collImport").hidden);
ok((await page.locator("#tOwned").textContent()) === "1", "sostituisci: la collezione contiene solo la lista nuova");
// ripristina 3 copie di Mantis Blades per i controlli successivi
await page.click("#collImportBtn"); await page.fill("#collImportText", "3 WNC-025"); await page.click('#collImportMode [data-v="add"]'); await page.click("#collImportGo");
await page.waitForFunction(() => document.querySelector("#collImport").hidden);
ok((await page.locator("#tOwned").textContent()) === "4", "aggiunte 3 copie");

/* scanner da foto (OCR vero, motore da CDN) */
await page.click("#collScan");
await page.waitForSelector("#scan:not([hidden])");
const SCANS = [["7ffa8ba4-f187-4ba0-a719-fa8ebf45a03b", "Mantis Blades"], ["c7eba3a0-63cb-4311-988e-d487a7c0841a", "Delamain: Rideshare AI"], ["3fc63c58-5954-4744-a5af-047bfc5cb159", "V: Streetkid"], ["7514dd38-6e2d-43dd-9715-6b3a32615382", "Animals Wrecker"]];
let scanOk = 0;
for(const [pid, name] of SCANS){
  await page.evaluate(() => { document.querySelector("#scanMsg").textContent = ""; });
  await page.setInputFiles("#scanFile", `${HERE}data/img/${pid}.webp`);
  try{
    await page.waitForFunction(() => /in lista|Forse|Non ho|Errore/.test(document.querySelector("#scanMsg").textContent), null, { timeout: 120000 });
    const msg = await page.locator("#scanMsg").textContent();
    const first = msg.includes("in lista") ? msg.replace(/^✔ /, "").replace(/ in lista.*$/, "").replace(/ · .*$/, "") : await page.locator("#scanHits .hit b").first().textContent().catch(() => "");
    if(first === name) scanOk++; else console.log(`  (scanner: atteso ${name}, letto ${first} — ${await page.locator("#scanMsg").textContent()})`);
  }catch(e){ console.log("  (scanner non verificabile qui: " + (await page.locator("#scanMsg").textContent()) + ")"); break; }
}
ok(scanOk >= 3, `OCR: ${scanOk}/${SCANS.length} carte riconosciute dall'immagine`);
// variante: la stampa Iconic Legend di V: Streetkid deve finire in lista come tale, non come la base
await page.evaluate(() => { document.querySelector("#scanMsg").textContent = ""; });
await page.setInputFiles("#scanFile", `${HERE}data/img/837d354a-a1c8-4df0-b4ac-4db43730187a.webp`);
try{
  await page.waitForFunction(() => /in lista|Forse|Non ho|Errore/.test(document.querySelector("#scanMsg").textContent), null, { timeout: 120000 });
  const list = await page.evaluate(() => JSON.parse(localStorage.getItem("ncd:scanlist") || "[]"));
  const vRow = list.find(e => e.pid === "837d354a-a1c8-4df0-b4ac-4db43730187a");
  ok(!!vRow, "scanner: riconosce la variante Iconic dall'illustrazione (" + (await page.locator("#scanMsg").textContent()) + ")");
}catch(e){ console.log("  (variante non verificabile: " + e.message.slice(0, 60) + ")"); }
if(scanOk){
  ok((await page.locator("#scanList .srow").count()) >= scanOk, `lista di scansione con almeno ${scanOk} righe`);
  await page.click('#scanList .srow >> nth=0 >> [data-sq="1"]');
  ok(/\d+ carte/.test(await page.locator("#scanCommit").textContent()), "quantità modificabile in lista");
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
// la carta aggiunta passa nella sezione «Nel mazzo» (chiusa all'inizio): la si apre
ok(await page.locator("#deckRows .dsec.in").count() === 0 && (await page.locator("#deckRows .row .bstep b").textContent()) === "2", "elenco unico: la carta resta in «Aggiungi carte» con il contatore finché non sono 3");
ok(await page.locator("#deckSec[open] > summary .n").count() === 1 && /carte/.test(await page.locator("#deckSec > summary").textContent()), "Deck richiudibile con il riepilogo");
await page.click('#deckEdit .dlist .row:has-text("Mantis") .thumb');
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
await page.click("#deckImport");
await page.fill("#appAsk #appAskIn", "# Test import\nLegend: V: Streetkid\nLegend: Royce: Psycho on the Edge\nLegend: Rogue Amendiares: Preem Solo\n3 Mantis Blades\n2x Japantown Jonin\n2 WNC-025\n1 MS01 030\nSD01-004 x2\nNon esiste");
await page.click('#appAsk [data-a="ok"]');
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
await page.click("#deckList [data-ddel] >> nth=0");
await page.click('#appAsk [data-a="ok"]'); await page.waitForTimeout(200);
ok((await page.locator("#deckList [data-deck]").count()) === nDecks - 1, "mazzo eliminato dall'elenco");

/* profilo */
await page.click('nav.tabs button[data-tab="home"]'); await page.click("#homeSocial");
await page.fill("#pfNick", "Choom"); await page.dispatchEvent("#pfNick", "change");
await page.click('#pfLife [data-v="Nomad"]');
ok((await page.locator("#pfChars button").count()) > 60, "galleria avatar con illustrazioni alternative");
const favs = await page.locator("#pfChars button").evaluateAll(els => els.map(e => e.dataset.fav));
const favNames = favs.map(f => f.split(" · ")[0]);
ok(favNames.every((f, i) => !i || favNames[i - 1].localeCompare(f, "it") <= 0), "galleria in ordine alfabetico");
await page.click('#pfChars button[data-fav="V: Streetkid"]');
ok((await page.locator(".phead h2").textContent()) === "Choom", "nick salvato");
ok(await page.locator(".phead .avatar.art").count() === 1, "avatar dalla Leggenda");
await page.screenshot({ path: "/tmp/ncd-shot-profile.png", fullPage: true });
/* impostazioni (ingranaggio in alto): aspetto, lingua, prezzi, dati */
await page.click("#btnSettings");
ok(await page.locator("#p-settings.on").count() === 1 && (await page.locator("#p-settings h3").allTextContents()).join(",").includes("Prezzi"), "ingranaggio → Impostazioni con le sezioni");
await page.click('#pfAccent .sw[data-v="netrunner"]');
ok((await page.evaluate(() => document.documentElement.dataset.accent)) === "netrunner", "accento applicato");
ok(await page.locator("#pfTheme").count() === 0 && await page.locator("#pfAccentL .sw").count() >= 6, "niente più tema chiaro: aspetti scuri e chiari");
await page.click('#pfAccentL .sw[data-v="l-mox"]');
ok(await page.evaluate(() => document.documentElement.dataset.theme === "light" && document.documentElement.dataset.accent === "l-mox" && getComputedStyle(document.body).backgroundColor !== "rgb(255, 255, 255)"), "aspetto chiaro applicato (base colorata, non bianca)");
await page.click('#pfAccent .sw[data-v="holophone"]');
ok((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "aspetto scuro");
ok(/v\d+\.\d+/.test(await page.locator("#p-settings").textContent()) && (await page.locator("#metaLine").isVisible()), "versione nelle impostazioni e catalogo visibile nell'intestazione anche sul telefono");
/* collezione: voci per carta / illustrazione / edizione e illustrazione fissata */
{
  await page.click('#pfCollView button[data-v="art"]'); await page.waitForTimeout(200);
  await page.click('nav.tabs button[data-tab="collection"]'); await page.waitForTimeout(400);
  const nArt = await page.locator("#collRows .gc").count();
  ok(nArt > 151 && /illustrazioni/.test(await page.locator("#tOwnedN").textContent()), `collezione per illustrazione: ${nArt} voci`);
  await page.click("#btnSettings"); await page.waitForTimeout(200); await page.click('#pfCollView button[data-v="print"]'); await page.waitForTimeout(200);
  await page.click('nav.tabs button[data-tab="collection"]'); await page.waitForTimeout(600);
  ok(await page.locator("#collRows .gc").count() === NC[1] && new RegExp(NC[1] + " edizioni").test(await page.locator("#tOwnedN").textContent()), `collezione per edizione: ${NC[1]} voci`);
  await page.click("#btnSettings"); await page.waitForTimeout(200); await page.click('#pfCollView button[data-v="card"]'); await page.waitForTimeout(200);
  ok(await page.locator("#pfCollPick").count() === 1, "regola dell'illustrazione mostrata solo in modalità per carta");
  await page.click('nav.tabs button[data-tab="collection"]'); await page.waitForTimeout(400);
  await page.click("#collRows .gc >> nth=0"); await page.waitForTimeout(300); await page.click("#sheetBox .pt >> nth=1"); await page.waitForTimeout(150); await page.click("#favBtn"); await page.waitForTimeout(300);
  const favPid = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("ncd:settings")).favPrints || {})[0]);
  await page.click("#closeSheet"); await page.waitForTimeout(300);
  ok(!!favPid && (await page.locator("#collRows .gc >> nth=0").getAttribute("data-pid")) === favPid, "illustrazione fissata dalla scheda mostrata in collezione");
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("ncd:settings")); s.favPrints = {}; localStorage.setItem("ncd:settings", JSON.stringify(s)); });
  await page.click("#btnSettings"); await page.waitForTimeout(300);
}

/* lingua: English → tutta l'interfaccia tradotta (DOM + registro), poi si torna all'italiano */
await page.click('#pfLang button[data-v="en"]'); await page.waitForFunction(() => document.documentElement.lang === "en" && document.querySelector("#p-settings h3")); await page.waitForTimeout(600);
ok((await page.locator("#p-settings h3").allTextContents()).join(",").includes("Appearance") && (await page.locator("#btnSettings").getAttribute("title")) === "Settings", "English: sezioni e attributi tradotti");
await page.click('nav.tabs button[data-tab="sim"]'); await page.waitForTimeout(300);
ok((await page.locator("#simStart").textContent()).includes("Start the game"), "English: simulatore tradotto");
await page.selectOption("#simDeck0", "starter:theheistretailstarterdeck"); await page.selectOption("#simDeck1", "starter:embracingpowerretailstarterdeck"); await page.click("#simStart");
await page.waitForSelector("#simAsk");
// se il tiro iniziale l'ha vinto il giocatore, prima sceglie chi inizia (tradotto anche quello)
if(await page.locator("#simAsk [data-ask]").count()){ ok((await page.locator("#simAsk h3").textContent()).includes("opening roll"), "English: scelta di chi inizia tradotta"); await page.click("#simAsk [data-ask] >> nth=0"); await page.waitForSelector('[data-mull="keep"]'); }
ok((await page.locator("#simAsk h3").textContent()).includes("keep this hand"), "English: mulligan tradotto");
await page.click('[data-mull="keep"]'); for(let i = 0; i < 40; i++){ if(await page.locator("#simAsk [data-ask]").count()) await page.click("#simAsk [data-ask] >> nth=0"); if(await page.locator("#bEnd").count()) break; await page.waitForTimeout(300); }
ok(/Your turn/.test(await page.locator(".bstrip").textContent()) && /rolls? a d\d+ from the fixer|draws? 1\.|goes first\./.test(await page.locator(".bstrip").textContent()), "English: barra e registro tradotti (" + (await page.locator(".bstrip .lg").textContent()).slice(0, 60) + ")");
await page.click("#bMenu"); await page.click('.pop button:has-text("Leave the board")');
await page.click("#btnSettings"); await page.waitForTimeout(300); await page.click('#pfLang button[data-v="it"]'); await page.waitForFunction(() => document.documentElement.lang === "it" && document.querySelector("#p-settings h3")); await page.waitForTimeout(500);
ok((await page.locator("#p-settings h3").allTextContents()).join(",").includes("Aspetto"), "ritorno all'italiano");

/* simulatore contro il bot */
await page.click('nav.tabs button[data-tab="sim"]');
await page.selectOption("#simDeck0", "starter:theheistretailstarterdeck");
await page.selectOption("#simDeck1", "starter:embracingpowerretailstarterdeck");
await page.click("#simStart");
await page.waitForSelector("#board:not([hidden])");
await openingChoice();
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
  const payMode = /Paga \d+ €\$/.test(await page.locator(".bstrip .lg").textContent());
  ok(payMode || await page.locator('[data-field] .bc, #simAsk').count() >= 1 || await page.locator('[data-handrow] .bc').count() < handN /* un Programma senza scelte va dritto nel Trash */, payMode ? "pagamento sulla plancia: la barra chiede di toccare Eddies o Leggende" : "costo pari alle risorse: pagato da solo");
  if(payMode) ok(await page.locator(".bz.mine .target").count() >= 1, "fonti di pagamento evidenziate");
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
    if(await hand.count() <= k){ dragged = await hand.count() < n; break; }   // una carta è già stata giocata (pagata da sola)
    const card = hand.nth(k); const box = await card.boundingBox(); const field = await page.locator('.bz.mine [data-field]').boundingBox();
    const afford = (await card.locator(".co").getAttribute("class")).indexOf("no") < 0;
    if(!afford || !box || !field) continue;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + 20, box.y - 40, { steps: 4 }); await page.mouse.move(field.x + field.width / 2, field.y + field.height / 2, { steps: 6 });
    await page.mouse.up(); await page.waitForTimeout(150);
    dragged = /Paga \d+ €\$/.test(await page.locator(".bstrip .lg").textContent()) || (await page.locator(".bstrip .lg").textContent()).includes("Trascina") || await hand.count() < n;
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
// tiro, scelta di chi inizia e i due mulligan, con le schermate di passaggio in mezzo (una per giocatore)
let hands = 0;
for(let k = 0; k < 14; k++){
  await page.waitForTimeout(250);
  if(await page.locator("#bHand").count()){ hands++; await page.click("#bHand"); continue; }
  if(await page.locator('[data-mull="keep"]').count()){ await page.click('[data-mull="keep"]'); continue; }
  if(await page.locator("#simAsk [data-react]").count()){ await page.click("#simAsk [data-react]"); continue; }
  if(await page.locator("#simAsk [data-ask]").count()){ await page.click("#simAsk [data-ask]"); continue; }
  if(await page.locator("#bEnd").count() && !(await page.locator("#simAsk").count())) break;
}
ok(hands >= 1, "hot-seat: schermata di passaggio tra i mulligan");
ok(await page.locator("#bEnd").count() === 1, "hot-seat: turno del primo");
await page.click("#bEnd");
ok(await page.locator(".handoff").count() === 1, "schermata passa il dispositivo");
await page.click("#bHand");
if(await page.locator("#simAsk [data-ask]").count()) await page.click("#simAsk [data-ask]");
ok(await page.locator("#bEnd").count() === 1, "hot-seat: turno del secondo");
await page.click("#bMenu"); await page.click('.pop button:has-text("Esci")');

/* regole */
await page.click('nav.tabs button[data-tab="sim"]'); await page.click('.panel.on #simKind [data-v="rules"]'); await page.waitForTimeout(300);
ok(await page.locator('nav.tabs button[data-tab="sim"][aria-selected="true"]').count() === 1, "Regole dentro il Simulator");
ok(await page.locator("#p-rules .rulesec").count() >= 10, "pagina delle regole con le sezioni");
await page.click('#rulesMode button[data-v="1"]'); await page.waitForSelector("details.rfull", { timeout: 8000 });
ok(await page.locator(".rule").count() > 600 && (await page.locator("#p-rules").textContent()).includes("Comprehensive Rules"), "regole complete ufficiali caricate da rules.json");
await page.fill("#rulesQ", "blocker"); await page.waitForTimeout(500);
ok(await page.locator(".rule.hit").count() >= 5, "ricerca nelle regole complete");
await page.fill("#rulesQ", ""); await page.waitForTimeout(400);
await page.click('#rulesMode button[data-v="0"]');

/* prerelease: apri il kit, costruisci, gioca contro il bot */
await page.click('nav.tabs button[data-tab="sim"]');
ok(await page.locator("#prOpen").count() === 0, "nella scheda Costruito niente Prerelease");
await page.click('.panel.on #simKind [data-v="sealed"]');
ok((await page.locator("#simMode button").allTextContents()).join(",") === "Sfida IA,Online", "Prerelease: solo Sfida IA e Online");
await page.click("#prOpen");
ok(await page.locator("#prKit .pack").count() === 8, "kit aperto: 6 buste + Leggende + promo");
ok(await page.locator("#prKit .bc").count() === 6 * 12 + 3 + 1, "76 carte nel kit");
await page.click("#prBuild");
await page.waitForSelector("#deckEdit:not([hidden])");
ok((await page.locator("#deckEdit .legal").textContent()).includes("sealed"), "editor in modalità sealed");
// scegli 3 Leggende dal kit e aggiungi carte fino a 30
await page.click('#deckBrowse [data-b="legends"]'); await page.waitForTimeout(300);
for(let i = 0; i < 3; i++){ await page.click(`#deckRows .row:not(.indeck) >> nth=0`); await page.waitForTimeout(250); }
ok((await page.locator("#deckEdit .lslot img").count()) === 3, "3 Leggende scelte dal kit");
await page.click('#deckBrowse [data-b="cards"]'); await page.waitForTimeout(300);
// al massimo 3 colori: si filtra l'elenco sui 3 colori più presenti nel kit
{ const top3 = await page.evaluate(async () => { const { DATA } = await import("./data.js"); const cnt = {}; for(const r of document.querySelectorAll("#deckRows .row")){ const c = DATA.byId.get(r.dataset.cid); cnt[c.color] = (cnt[c.color] || 0) + 1; } return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).slice(0, 3); });
  await page.click("#deckFilt"); for(const c of top3){ await page.click(`#deckFilters [data-fk="colors"][data-fv="${c}"]`); await page.waitForTimeout(100); } }
let addedRows = 0;
for(let k = 0; k < 90 && addedRows < 60; k++){
  const rows = page.locator("#deckRows .row"); const n = await rows.count(); if(!n) break;
  const i = k % n; await rows.nth(i).click(); await page.waitForTimeout(120); addedRows++;
  const size = (await page.locator("#deckEdit .chip:has-text('carte')").first().textContent());
  if(/^3[0-9] carte/.test(size)) break;
}
const legalTxt2 = await page.locator("#deckEdit .legal").textContent();
console.log("  sealed:", legalTxt2.replace(/\s+/g, " ").slice(0, 160));
ok(/\d+ colori su un massimo di 3|Troppi colori/.test(legalTxt2), "controllo dei colori nel sealed");
await page.click("#deckPlay");
await page.waitForSelector("#board:not([hidden])");
await openingChoice();
ok(await page.locator(".bz.rival .lbl").count() === 1 && (await page.locator(".bz.rival .lbl").textContent()).includes("IA"), "partita sealed contro il bot avviata");
await page.click('[data-mull="keep"]'); await page.waitForTimeout(300);
for(let i = 0; i < 5 && await page.locator("#simAsk [data-ask]").count(); i++){ await page.click("#simAsk [data-ask]"); await page.waitForTimeout(200); }
await page.click("#bMenu"); await page.click('.pop button:has-text("Esci")');

/* tutorial: partita guidata */
ok(await page.locator('#simDeck0 option[value^="starter:"]').count() === 0, "Prerelease: solo mazzi da kit nella scelta");
await page.click('.panel.on #simKind [data-v="built"]'); await page.click('#simMode [data-v="tutorial"]');
ok((await page.locator("#simMode button").allTextContents()).join(",") === "Sfida IA,Offline,Online,Tutorial", "Costruito: Sfida IA, Offline, Online, Tutorial");
// prima apertura: «È la tua prima notte?» → Sì: solo la prima lezione aperta
ok(await page.locator(".tutask").count() === 1, "tutorial: domanda «prima notte a Night City?»");
await page.click('[data-tutfirst="1"]'); await page.waitForTimeout(200);
ok(await page.locator(".tutitem").count() === 5 && await page.locator(".tutitem.locked").count() === 4, "tutorial: 5 lezioni, aperta solo la prima");
await page.click('[data-lesson="basi"]');
await page.waitForSelector("#board:not([hidden])"); await page.waitForSelector(".tutbar");
ok(/Le basi.*1\/12/.test(await page.locator(".tutbar .n").textContent()) && await page.locator("[data-mull]").count() === 0 && await page.locator("#bEnd").count() === 0, "lezione 1: plancia già pronta, niente mulligan né fine turno");
await page.click("#tutNext"); await page.waitForTimeout(150);
ok(await page.locator("#board .tuthl").count() >= 1, "lezione 1: il pezzo di cui si parla è evidenziato");
for(let i = 0; i < 10; i++){ await page.click("#tutNext"); await page.waitForTimeout(80); }
await page.click("#tutDone"); await page.waitForTimeout(300);
ok(await page.locator("#board").isHidden() && await page.locator(".tutitem.locked").count() === 3 && await page.locator('[data-lesson="turno"]:not([disabled])').count() === 1, "lezione 1 finita: si apre la seconda");
await page.click('[data-lesson="turno"]');
await page.waitForSelector("#board:not([hidden])"); await page.waitForSelector(".tutbar");
ok(await page.locator("#simAsk.mull .mc").count() === 6, "lezione 2: mulligan con le carte grandi");
await page.click('[data-mull="keep"]'); await page.waitForTimeout(300);
const stepN = async () => ((await page.locator(".tutbar .n").textContent().catch(() => "")).match(/(\d+)\/\d+$/) || [])[1];
{ const tn = await stepN(); ok(tn === "2" || tn === "3", "tutorial: avanza dopo il mulligan (" + tn + ")"); }
ok(await page.locator("#tutSkip").count() === 0, "tutorial senza pulsante di chiusura");
// il bot inizia (partita seedata); al mio turno: dado, poi i passi guidati con le azioni giuste sempre disponibili
for(let i = 0; i < 80; i++){ if(await page.locator("#simAsk [data-ask]").count()){ await page.click("#simAsk [data-ask] >> nth=0"); } if(await stepN() === "3") break; await page.waitForTimeout(300); }
ok(await stepN() === "3", "tutorial: passo della vendita raggiunto al mio turno");
ok(await page.locator("#bEnd").count() === 0, "fine turno nascosto finché il passo non è completato");
// vendita: la carta vendibile c'è sempre
let soldT = false;
for(let k = 0; k < (await page.locator('[data-handrow] .bc').count()) && !soldT; k++){
  await page.click(`[data-handrow] .bc >> nth=${k}`); const sb = page.locator('.pop button:has-text("Vendi")');
  if(await sb.count() && await sb.isEnabled()){ await sb.click(); soldT = true; } else await page.click("#board .bstrip .st");
}
await page.waitForTimeout(300);
ok(soldT && await stepN() === "4", "venduta: passo 4 (gioca un'Unità)");
// l'Unità con potenza da ≤3 €$ (Dexter) c'è sempre; le altre Unità sono disattivate in questo passo
let playedT = false;
for(let k = 0; k < (await page.locator('[data-handrow] .bc').count()) && !playedT; k++){
  await page.click(`[data-handrow] .bc >> nth=${k}`); const pb = page.locator('.pop button:has-text("Gioca")');
  if(await pb.count() && await pb.isEnabled()){ await pb.click(); playedT = true; } else await page.click("#board .bstrip .st");
}
for(let k = 0; k < 6 && /Paga \d+ €\$/.test(await page.locator(".bstrip .lg").textContent()); k++){ const ed = page.locator(".bz.mine [data-eddies].target"), lg = page.locator(".bz.mine [data-legend].target"); if(await ed.count()) await ed.click(); else if(await lg.count()) await lg.first().click(); await page.waitForTimeout(120); }
for(let i = 0; i < 6 && await page.locator("#simAsk [data-ask]").count(); i++){ await page.click("#simAsk [data-ask] >> nth=-1"); await page.waitForTimeout(150); }
await page.waitForTimeout(300);
ok(playedT && await stepN() === "5", "giocata: passo 5 (chiama una Leggenda)");
// passi 5→10: chiama, fine turno, secondo turno (dado, vendi, Bombus), attacca con Dexter, fine turno, reazione all'attacco del bot
const step = stepN;
const payLoop = async () => { for(let k = 0; k < 8 && /Paga \d+ €\$/.test(await page.locator(".bstrip .lg").textContent()); k++){ const ed = page.locator(".bz.mine [data-eddies].target"), lg = page.locator(".bz.mine [data-legend].target"); if(await ed.count()) await ed.click(); else if(await lg.count()) await lg.first().click(); await page.waitForTimeout(120); } };
// richieste in sospeso: nei riquadri «scegli una carta» (es. Viktor Vektor) prima si tocca una carta, poi si conferma
const asks = async (sel = "#simAsk [data-ask] >> nth=0") => { for(let i = 0; i < 8 && await page.locator("#simAsk [data-ask]").count(); i++){ if(await page.locator("#simAsk [data-pick]").count() && !(await page.locator("#simAsk .pk.on").count())) await page.click("#simAsk [data-pick] >> nth=0"); const b = page.locator(sel); if(await b.isEnabled()) await page.click(sel); await page.waitForTimeout(150); } };
await page.click('.bz.mine [data-legend] >> nth=0'); await page.click('.pop button:has-text("Chiama")'); await payLoop(); await page.waitForTimeout(300);
await asks(); await page.waitForTimeout(300);
ok(await step() === "6", "chiamata: passo 6 (fine turno)");
await page.click("#bEnd");
// il bot gioca; al mio turno arriva la scelta del dado (le opzioni iniziano con «d»), poi si vende e si gioca Bombus
let dieSeen = false;
for(let i = 0; i < 80 && !dieSeen; i++){ const a = page.locator("#simAsk [data-ask]"); if(await a.count()){ const t = await a.first().textContent(); if(/^d\d+/.test(t)) dieSeen = true; await a.first().click(); } await page.waitForTimeout(300); }
await page.waitForTimeout(400);
ok(dieSeen && await step() === "7", "secondo turno: passo 7 (gioca Bombus)");
{ let s2 = false; for(let k = 0; k < (await page.locator('[data-handrow] .bc').count()) && !s2; k++){ await page.click(`[data-handrow] .bc >> nth=${k}`); const sb = page.locator('.pop button:has-text("Vendi")'); if(await sb.count() && await sb.isEnabled()){ await sb.click(); s2 = true; } else await page.click("#board .bstrip .st"); }
  let pb2 = false; for(let k = 0; k < (await page.locator('[data-handrow] .bc').count()) && !pb2; k++){ await page.click(`[data-handrow] .bc >> nth=${k}`); const pb = page.locator('.pop button:has-text("Gioca")'); if(await pb.count() && await pb.isEnabled()){ await pb.click(); pb2 = true; } else await page.click("#board .bstrip .st"); }
  await payLoop(); await asks(); await page.waitForTimeout(300); }
ok(await step() === "8", "Bombus giocata: passo 8 (attacca)");
await page.click('.bz.mine [data-field] .bc[title^="Dexter"]'); await page.click('.pop button:has-text("area Gig")'); await asks("#simAsk [data-ask] >> nth=-1"); await page.waitForTimeout(300);
ok(await step() === "9", "attacco fatto: passo 9 (fine turno)");
await page.click("#bEnd");
let reacted = false;
for(let i = 0; i < 80; i++){
  if(await page.locator('#simAsk [data-ask]:has-text("Blocca con")').count()){ ok(true, "il bot attacca: finestra di reazione con Blocca/Chiama/Quick"); await page.click('#simAsk [data-ask]:has-text("Blocca con")'); reacted = true; await page.waitForTimeout(300); break; }
  if(await page.locator("#simAsk [data-ask]").count()) await page.click("#simAsk [data-ask] >> nth=-1");
  if(await page.locator("#bEnd").count()) break;
  await page.waitForTimeout(400);
}
ok(reacted && ["10", "11"].includes(await step()), "bloccato con Bombus: passo 11 (" + await step() + ")");
await page.click("#bMenu"); ok(await page.locator('.pop button:has-text("Abbandona il tutorial")').count() === 1 && await page.locator('.pop button:has-text("Mi arrendo")').count() === 0, "nel tutorial il menù ha «Abbandona il tutorial» al posto della resa");
const lossesBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("ncd:record") || "{}").losses || 0);
await page.click('.pop button:has-text("Abbandona il tutorial")'); await page.waitForTimeout(300);
ok(await page.locator("#board[hidden]").count() === 1 && (await page.evaluate(() => JSON.parse(localStorage.getItem("ncd:record") || "{}").losses || 0)) === lossesBefore, "abbandono: plancia chiusa, nessuna sconfitta registrata");

/* desktop: tab in alto, griglia larga */
const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await desk.goto(BASE + "/index.html#deck"); await desk.waitForFunction(() => document.querySelector("#deckList"));
ok(await desk.locator('nav.tabs button[data-tab="deck"][aria-selected="true"]').count() === 1, "hash #deck apre il deckbuilder");
await desk.screenshot({ path: "/tmp/ncd-shot-desktop.png" });

/* import JSON nel formato di Deckrunners (collezione e mazzo) */
{
  const r = await desk.evaluate(async () => {
    const { jsonToLines, parseCardLines, isLegal } = await import("./deck.js");
    const obj = { app: "Deckrunners", format: 1, entries: [{ printingId: "MS01-025", setCode: "MS01", collectorNumber: "025", name: "MANTIS BLADES", rarity: "COMMON", copies: 3, serials: [] }, { printingId: "MS01-010", setCode: "MS01", collectorNumber: "010", name: "JAPANTOWN JONIN", copies: 1 }] };
    const l = jsonToLines(obj); const p = parseCardLines(l.lines);
    return { n: p.entries.length, tot: p.entries.reduce((a, e) => a + e.n, 0), bad: p.bad.length, names: p.entries.map(e => e.cid).length };
  });
  ok(r.n === 2 && r.tot === 4 && r.bad === 0, `JSON Deckrunners: ${r.n} carte, ${r.tot} copie, ${r.bad} non riconosciute`);
  // nel simulatore compaiono solo i mazzi in regola
  const sim = await desk.evaluate(async () => {
    const { S, saveDeck } = await import("./store.js"); const { DATA } = await import("./data.js");
    const c = DATA.cards.find(x => x.type === "Unit");
    saveDeck({ id: "draft-test", name: "Bozza di prova", legends: [null, null, null], cards: [{ cid: c.id, pid: c.def.id, n: 1 }], notes: "" });
    location.hash = "#sim"; await new Promise(r => setTimeout(r, 400));
    const opts = [...document.querySelectorAll("#simDeck0 option")].map(o => o.textContent);
    const note = document.querySelector("#simSetup details .sub").textContent;
    return { hasDraft: opts.some(t => /Bozza di prova/.test(t)), note };
  });
  ok(!sim.hasDraft && /1 mazzo resta/.test(sim.note), "simulatore: le bozze non sono tra i mazzi giocabili (" + sim.note.slice(-80) + ")");
}

ok(errors.length === 0, "nessun errore JS: " + errors.slice(0, 3).join(" | "));
await browser.close();
console.log(`\n${passes} controlli OK, ${fails} falliti`);
process.exit(fails ? 1 : 0);
