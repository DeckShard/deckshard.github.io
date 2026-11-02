/* Simulatore: plancia orizzontale, partita contro il bot o in due sullo
   stesso dispositivo. Il motore è in engine.js, il bot in bot.js.      */

import { DATA, imgUrl, thumbUrl } from "./data.js";
import { S, saveDeck } from "./store.js";
import { $, $$, esc, toast, openLens, openCard } from "./ui.js";
import { createGame, mulligan, resolve, legalActions, doAction, power, ready, readyEddies, streetCred, canAttack, canPay, manual, rival, hasKw } from "./engine.js";
import { botDecide, botStep } from "./bot.js";
import { starterDeck, isLegal, deckSize, openDeck } from "./deck.js";
import { prereleaseSetupHTML, wirePrerelease } from "./prerelease.js";
import { tutorialHTML, startTutorial, tutorialStep, tutorialBarHTML, tutorialActive, stopTutorial } from "./tutorial.js";

/* Strumenti manuali (spendi/prepara, ±potenza, sconfiggi, ±1 sui Gig, pesca…):
   permettono di applicare a mano gli effetti che il motore non interpreta,
   ma escono dalle regole. Spenti per ora; da riattivare per una modalità
   "tavolo libero" se servirà. */
const MANUAL = false;
let G = null, mode = "bot", human = [true, false], sel = null, targeting = null, pop = null, showLog = false, botTimer = null, handoff = false, wired = false;
let lastSeen = { turn: 0, seen: 0 }, noteMsg = "", noteT = null, reactCover = null;
let drag = null;   // trascinamento in corso dalla mano
const clearDrop = () => $$("#board .drop").forEach(x => x.classList.remove("drop"));
const killGhosts = () => { $$(".bc.ghost").forEach(g => g.remove()); $$("#board .dragging").forEach(x => x.classList.remove("dragging")); $$("#board .candrop").forEach(x => x.classList.remove("candrop")); clearDrop(); };
/* all'inizio del trascinamento: evidenzia dove la carta può essere lasciata */
function markDropZones(c){
  const M = G.players[me()];
  if(c.isLegendDrag){ const f = $(`#board [data-field="${M.id}"]`); if(f) f.classList.add("candrop"); return; }
  if(c.card.type === "Gear"){
    $$(`#board [data-field="${M.id}"] .bc`).forEach(x => x.classList.add("candrop"));
    for(const l of M.legends) if(l.faceUp && !l.onField && !l.removed){ const el = $(`#board .bz.mine [data-legend][data-uid="${l.uid}"]`); if(el) el.classList.add("candrop"); }
  } else { const f = $(`#board [data-field="${M.id}"]`); if(f) f.classList.add("candrop"); }
  if(c.card.eddiable && !M.sold){ const e = $(`#board .bz.mine [data-eddies]`); if(e) e.classList.add("candrop"); }
}
/* avviso dentro la plancia (il toast globale non segue la rotazione) */
function note(msg){ noteMsg = msg; clearTimeout(noteT); noteT = setTimeout(() => { noteMsg = ""; const n = $("#noteMsg"); if(n) n.remove(); }, 2600); render(); }
const names = () => [S.profile.nick || "Tu", mode === "bot" ? "Bot" : "Giocatore 2"];

/* ------------------------------------------------------------ setup (pagina) */
export function renderSim(){
  const root = $("#simSetup");
  if(!wired){ wire(); wired = true; }
  const decks = S.decks.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const opts = sel0 => `<option value="starter:theheistretailstarterdeck">Starter «The Heist» (bozza)</option><option value="starter:embracingpowerretailstarterdeck">Starter «Embracing Power» (bozza)</option>` +
    decks.map(d => `<option value="${d.id}"${d.id === sel0 ? " selected" : ""}>${esc(d.name)} (${deckSize(d)} carte${isLegal(d) ? "" : ", non valido"})</option>`).join("");
  root.innerHTML = `
    <div class="card">
      <h2>Simulator</h2>
      <div class="sub">Partita completa con le regole di base applicate dal motore: fasi, Eddies, Leggende, attacchi, Blocker, furto dei Gig, Street Cred, overtime. Gli effetti più comuni delle carte sono automatici; gli altri vengono segnalati e li applichi con gli strumenti manuali.</div>
      <div class="field"><label>Modalità</label><span class="seg" id="simMode"><button data-v="bot" aria-pressed="${mode === "bot"}">Contro il bot</button><button data-v="hot" aria-pressed="${mode === "hot"}">In due, stesso dispositivo</button></span></div>
      <div class="simdecks" style="margin-top:10px">
        <div><label style="font-size:12px;font-weight:700;color:var(--mute)">Il tuo mazzo</label><select class="inp" id="simDeck0">${opts(S.settings.simDeck0)}</select></div>
        <div><label style="font-size:12px;font-weight:700;color:var(--mute)">${mode === "bot" ? "Mazzo del bot" : "Mazzo del giocatore 2"}</label><select class="inp" id="simDeck1">${opts(S.settings.simDeck1 || "starter:embracingpowerretailstarterdeck")}</select></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center">
        <button class="btn acc2" id="simStart">▶ Inizia la partita</button>
        ${G && G.winner == null ? `<button class="btn" id="simResume">Riprendi la partita in corso</button>` : ""}
        <span class="chip">${S.record.wins || 0} vittorie · ${S.record.losses || 0} sconfitte</span>
      </div>
      <div class="field" style="margin-top:8px"><label>Pagamento degli Eddies<small>Manuale: scegli ogni volta cosa spendere. Automatico: paga da solo e chiede solo se deve spendere una Leggenda con un'abilità Spend ancora utilizzabile.</small></label>
        <span class="seg" id="simPay"><button data-v="0" aria-pressed="${!S.profile.autoPay}">Manuale</button><button data-v="1" aria-pressed="${!!S.profile.autoPay}">Automatico</button></span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn sm" id="simTutorial">Tutorial: partita guidata</button></div>
      <p class="note" style="margin:12px 0 0"><b>Sul telefono</b> la plancia è orizzontale: ruota il dispositivo (o lascia che l'app la ruoti da sola). Tocca una carta per le azioni, <b>tieni premuto</b> per ingrandirla con lo zoom. I mazzi devono avere 3 Leggende e almeno qualche carta; per i tornei usa il deckbuilder per verificarne la legalità.</p>
    </div>
    ${prereleaseSetupHTML()}`;
}
function deckFrom(v){
  if(v.startsWith("starter:")){ const code = v.slice(8); return starterDeck(code, code.includes("heist") ? "Starter The Heist" : "Starter Embracing Power"); }
  return S.decks.find(d => d.id === v);
}

/* ------------------------------------------------------------ partita */
function start(opts = {}){
  let d0 = opts.deck0 || deckFrom($("#simDeck0").value), d1 = opts.deck1 || deckFrom($("#simDeck1").value);
  if(d0 && d0.format === "sealed" && d0.botDeck && !opts.deck1){ d1 = d0.botDeck; mode = "bot"; }
  if(!d0 || !d1){ toast("Scegli due mazzi"); return; }
  for(const d of [d0, d1]) if(d.legends.filter(Boolean).length < 3 || deckSize(d) < 10){ toast(`«${d.name}»: servono 3 Leggende e un mazzo con carte`); return; }
  S.settings.simDeck0 = $("#simDeck0").value; S.settings.simDeck1 = $("#simDeck1").value; S.save("settings");
  human = mode === "bot" ? [true, false] : [true, true];
  const nm = names();
  G = createGame([{ ...d0, name: nm[0] }, { ...d1, name: nm[1] }], DATA.byId, { bot0: !human[0], bot1: !human[1], autoPay: [!!S.profile.autoPay, !!S.profile.autoPay] });
  G.decide = botDecide; G.mulliganAsked = [false, false];
  sel = null; targeting = null; pop = null; handoff = false; lastSeen = { turn: 0, seen: 0 };
  $("#board").innerHTML = ""; openBoard();
  // mulligan: ai bot no; agli umani lo chiede la plancia (vedi mulliganHTML: fa parte
  // dello stato, così un ridisegno — es. l'ingresso a schermo intero — non lo perde)
  for(const i of [0, 1]) if(!human[i]) mulligan(G, i, false);
  render(); tick();
}
const mulliganPending = () => G ? [0, 1].find(k => human[k] && !G.players[k].mulliganed) : null;
function mulliganHTML(){
  const i = mulliganPending(); if(i == null) return "";
  const P = G.players[i];
  return `<div id="simAsk"><div class="box"><h3>${esc(P.name)}: tieni questa mano?</h3>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin:8px 0">${P.hand.map(c => `<div class="bc" data-zoom="${c.pid}"><img src="${thumbUrl(c.pid)}" alt="${esc(c.card.dn)}"></div>`).join("")}</div>
    <div class="opts"><button class="btn yel" data-mull="keep">Tengo</button><button class="btn" data-mull="redo">Mulligan (ripesco 6)</button></div></div></div>`;
}
function openBoard(){
  const b = $("#board"); b.hidden = false; document.body.style.overflow = "hidden";
  try{ document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.("landscape").catch(() => {})).catch(() => {}); }catch(e){}
}
function closeBoard(){
  stopTutorial();
  $("#board").hidden = true; document.body.style.overflow = "";
  try{ screen.orientation?.unlock?.(); if(document.fullscreenElement) document.exitFullscreen?.(); }catch(e){}
  clearTimeout(botTimer); renderSim();
}

/* turno del bot a passi, per leggere cosa fa */
function tick(){
  clearTimeout(botTimer);
  if(!G) return;
  if(mulliganPending() != null){ render(); return; }
  if(G.winner != null){ finish(); render(); return; }
  if(G.pending){ if(human[G.pending.player]) { render(); return; } // decisione umana in attesa
    // decisione del bot (fuori dal suo turno, es. blocco): già risolta da ask()
  }
  if(!human[G.active] && G.phase === "main" && !G.pending){
    botTimer = setTimeout(() => { const more = botStep(G, G.active); render(); if(G.winner != null) finish(); if(more || G.active !== undefined) tick(); }, 650);
    return;
  }
  render();
  if(G.winner != null) finish();
}
function finish(){
  if(!G || G.winner == null || G.recorded) return; G.recorded = true;
  if(mode === "bot"){ if(G.winner === 0) S.record.wins = (S.record.wins || 0) + 1; else S.record.losses = (S.record.losses || 0) + 1; }
  S.record.games = [{ when: Date.now(), mode, winner: G.players[G.winner].name, reason: G.reason, turns: G.turn }, ...(S.record.games || [])].slice(0, 50);
  S.save("record"); render();
}

/* ------------------------------------------------------------ resa grafica */
const me = () => mode === "bot" ? 0 : G.active;   // in hot-seat la plancia è sempre dal punto di vista di chi gioca
function cardHTML(x, cls = "", extra = ""){
  const pw = power(x), base = x.card.power ?? 0, c = cls + (x.spent ? " spent" : "") + (x.lag ? " lag" : "") + (sel === x.uid ? " sel" : "");
  return `<div class="bc ${c}" data-uid="${x.uid}" title="${esc(x.card.dn)}">${x.pid ? `<img src="${thumbUrl(x.pid)}" alt="">` : `<div class="n">${esc(x.card.dn)}</div>`}
    ${x.card.type === "Unit" || x.isLegend ? `<span class="pw${pw !== base ? " mod" : ""}">${pw}</span>` : ""}${extra}
    ${(x.gear || []).length ? `<div class="g">${x.gear.map(g => `<img src="${thumbUrl(g.pid)}" alt="" title="${esc(g.card.dn)}">`).join("")}</div>` : ""}</div>`;
}
/* pagamento sulla plancia: quando il motore chiede «con cosa paghi?», si toccano
   direttamente gli Eddies o le Leggende invece di scegliere da una finestra */
const payMode = () => G && G.pending && G.pending.kind === "pay" && !G.pending.ctx.confirm && human[G.pending.player] ? G.pending : null;
const payOpt = pred => { const p = payMode(); if(!p) return -1; return p.options.findIndex(pred); };
function legendHTML(l, mine){
  const pm = payMode(), payable = pm && pm.player === (mine ? me() : 1 - me()) && pm.options.some(o => o.l === l);
  const cls = payable ? " target" : "";
  if(l.removed) return `<div class="bc back" data-uid="${l.uid}" style="opacity:.35">✕</div>`;
  if(l.onField) return `<div class="bc back up" data-uid="${l.uid}" style="opacity:.5"><div class="n">in campo</div></div>`;
  if(!l.faceUp) return `<div class="bc back${l.spent ? " spent" : ""}${cls}" data-uid="${l.uid}" data-legend="1">?</div>`;
  return cardHTML(l, cls, "").replace('class="bc ', 'class="bc leg ').replace(`data-uid="${l.uid}"`, `data-uid="${l.uid}" data-legend="1"`);
}
const dieHTML = (g, cls = "") => `<span class="die d${g.sides} ${cls}" data-gig="${g.uid || ""}"><small>d${g.sides}</small>${g.value ?? ""}</span>`;

function render(){
  if(!G) return;
  const M = G.players[me()], R = rival(G, M), board = $("#board"), pm = payMode();
  const myTurn = G.active === M.id && G.phase === "main" && !G.pending && G.winner == null;
  const acts = myTurn && human[M.id] ? legalActions(G, M.id) : [];
  const canSell = acts.some(a => a.t === "sell"), canCall = acts.some(a => a.t === "call");
  const handHTML = M.hand.map(c => {
    const cost = c.card.cost ?? 0, afford = canPay(M, cost);
    return `<div class="bc big${sel === c.uid ? " sel" : ""}" data-uid="${c.uid}" data-hand="1" title="${esc(c.card.dn)}"><img src="${thumbUrl(c.pid)}" alt=""><span class="co${afford ? "" : " no"}">${cost}</span>${c.card.eddiable ? `<span class="ed" title="Vendibile per 1 €$">€$</span>` : ""}</div>`;
  }).join("");
  const pendingTxt = pm ? "" : G.pending ? (human[G.pending.player] ? `${G.players[G.pending.player].name} deve scegliere…` : "il bot decide…") : "";
  const payTxt = pm ? `<b style="color:var(--acc2)">Paga ${pm.ctx.cost} €$ (${pm.ctx.paid}/${pm.ctx.cost}): tocca un Eddie o una Leggenda</b>` : "";
  const status = G.winner != null ? `Fine: ${esc(G.reason)}` : myTurn ? "Il tuo turno" : human[G.active] ? `Turno di ${esc(G.players[G.active].name)}` : "Turno del bot…";
  const last = G.log.slice(-1)[0];
  // misura delle carte dall'altezza disponibile: 2 righe rivale + campo + pile + mano (1,15×) + barra e margini
  const H = board.clientHeight; board.style.setProperty("--bh", H + "px");
  if(drag){ drag = null; killGhosts(); }   // un ridisegno durante un trascinamento lo annulla, senza lasciare copie in giro
  board.style.setProperty("--cw", Math.max(32, Math.min(64, (H - 110) / (1.4 * 4.15 + 0.6))).toFixed(1) + "px");
  board.innerHTML = `
    <div class="bz rival">
      <div class="brow">
        <div class="stack" title="Mazzo"><b>${R.deck.length}</b><small>mazzo</small></div>
        <div class="stack" title="Mano"><b>${R.hand.length}</b><small>mano</small></div>
        <div class="stack ed${readyEddies(R) ? "" : " lo"}${pm && pm.player === R.id && payOpt(o => o.kind === "eddie") >= 0 ? " target" : ""}" data-eddies="${R.id}" title="Eddies"><b>${readyEddies(R)}/${R.eddies.length}</b><small>€$</small></div>
        <div class="stack" data-trash="${R.id}" title="Trash"><b>${R.trash.length}</b><small>trash</small></div>
        <div style="display:flex;gap:3px">${R.legends.map(l => legendHTML(l, false)).join("")}</div>
        <div style="flex:1"></div>
        <div class="dice" data-owner="${R.id}">${R.gigs.map(g => dieHTML(g)).join("")}${R.fixer.map(s => dieHTML({ sides: s }, "fx")).join("")}<span class="cred">☆ ${streetCred(R)} · ${R.gigs.length} Gig</span></div>
      </div>
      <div class="brow field" data-field="${R.id}"><span class="lbl">${esc(R.name)}</span>${R.field.map(u => cardHTML(u, (targeting && targeting.kind === "attack" && u.spent) ? "target" : "")).join("") || `<span style="color:var(--mute)">nessuna Unità</span>`}</div>
    </div>

    <div class="bstrip">
      <span class="st">T${G.turn} · ${status}</span>
      <span class="lg" id="lastLog" title="${esc(last ? last.text : "")}">${payTxt ? payTxt + " · " : ""}${noteMsg ? `<b id="noteMsg" style="color:var(--acc2)">${esc(noteMsg)} · </b>` : ""}${pendingTxt ? `<b>${esc(pendingTxt)}</b> · ` : ""}${esc(last ? last.text : "")}</span>
      ${myTurn && human[M.id] ? `<button class="btn sm yel" id="bEnd">Fine turno</button>` : ""}
      ${pm ? `${payOpt(o => o.kind === "alleddies") >= 0 ? `<button class="btn sm acc2" id="bPayAll">Tutto con Eddies</button>` : ""}<button class="btn sm" id="bPayCancel">Annulla</button>` : targeting ? `<button class="btn sm" id="bCancel">Annulla</button>` : ""}
      <button class="btn sm icon" id="bLog" title="Registro">≡</button>
      <button class="btn sm icon" id="bMenu" title="Menù">⋯</button>
    </div>

    <div class="bz mine">
      <div class="brow field" data-field="${M.id}"><span class="lbl">${esc(M.name)}</span>${M.field.map(u => cardHTML(u, targeting && targeting.kind === "gear" ? "target" : "")).join("") || `<span style="color:var(--mute)">nessuna Unità in campo</span>`}</div>
      <div class="brow">
        <div class="stack" title="Mazzo"><b>${M.deck.length}</b><small>mazzo</small></div>
        <div class="stack ed${readyEddies(M) ? "" : " lo"}${pm && pm.player === M.id && payOpt(o => o.kind === "eddie") >= 0 ? " target" : ""}" data-eddies="${M.id}" title="Eddies: pronti/totali"><b>${readyEddies(M)}/${M.eddies.length}</b><small>€$</small></div>
        <div class="stack" data-trash="${M.id}" title="Trash"><b>${M.trash.length}</b><small>trash</small></div>
        <div style="display:flex;gap:3px">${M.legends.map(l => legendHTML(l, true)).join("")}</div>
        <div style="flex:1"></div>
        <div class="dice" data-owner="${M.id}">${M.gigs.map(g => dieHTML(g)).join("")}${M.fixer.map(s => dieHTML({ sides: s }, "fx")).join("")}<span class="cred">☆ ${streetCred(M)} · ${M.gigs.length} Gig</span></div>
      </div>
      <div class="brow hand" data-handrow="${M.id}"><span class="lbl">mano · ${ready(M)} €$</span>${handHTML || `<span style="color:var(--mute)">mano vuota</span>`}</div>
    </div>
    ${tutorialActive() ? tutorialBarHTML(G, me()) : ""}
    ${showLog ? `<div id="simLog"><div style="display:flex;justify-content:space-between;align-items:center"><b>Registro</b><button class="btn sm icon" id="bLogClose">✕</button></div>${G.log.slice(-80).map(e => `<div class="e ${e.kind}">${esc(e.text)}</div>`).join("")}</div>` : ""}
    ${mulliganPending() != null ? mulliganHTML() : pm ? "" : G.pending && human[G.pending.player] ? askHTML() : ""}
    ${G.winner != null ? `<div class="winbox"><div class="box"><h2>${G.winner === me() ? "VITTORIA" : mode === "hot" ? "VINCE " + esc(G.players[G.winner].name).toUpperCase() : "SCONFITTA"}</h2><p>${esc(G.reason)}</p><p style="color:var(--mute)">${G.turn} turni</p><div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn yel" id="bAgain">Rivincita</button><button class="btn" id="bExit">Esci</button></div></div></div>` : ""}
    ${handoff ? `<div class="handoff"><h2>Passa il dispositivo a ${esc(G.players[G.active].name)}</h2><p>Il tuo rivale non guarda, promesso.</p><button class="btn yel" id="bHand">Sono pronto</button></div>` : ""}`;
  if(showLog){ const l = $("#simLog"); l.scrollTop = l.scrollHeight; }
  if(tutorialActive() && tutorialStep(G, me())) { /* passo completato: la barra si aggiorna al prossimo ridisegno */ setTimeout(() => { if(G) render(); }, 0); }
}

/* richieste del motore (dado, blocco, furto, bersaglio…) */
function askHTML(){
  const p = G.pending, P = G.players[p.player];
  const titles = { die: "Quale dado tiri dal fixer?", block: `${esc(P.name)}: come reagisci?`, steal: "Quale Gig rubi?", target: "Scegli il bersaglio", discard: "Scegli la carta da scartare", gigpick: "Quale Gig?", gigvalue: "Nuovo valore", pickcard: "Scegli la carta", choice: "Scegli un effetto", yesno: "Vuoi farlo?", pay: p.ctx && p.ctx.confirm ? `Per pagare ${p.ctx.cost} €$ devi spendere una Leggenda con abilità` : `Come paghi? ${p.ctx ? `${p.ctx.paid}/${p.ctx.cost} €$ pagati` : ""}` };
  const ctx = p.kind === "block" && p.ctx.attacker ? `<p style="color:var(--ink2);margin:0 0 8px">${esc(p.ctx.attacker.card.dn)} (${power(p.ctx.attacker)}) attacca ${p.ctx.target ? esc(p.ctx.target.card.dn) + " (" + power(p.ctx.target) + ")" : "la tua area Gig"}. Puoi bloccare, chiamare una Leggenda o usare una carta Quick, anche più volte.</p>` : "";
  // in due sullo stesso dispositivo: la decisione del difensore si apre solo dopo un tocco, così l'attaccante non vede le sue carte
  if(mode === "hot" && p.player !== G.active && reactCover !== p) return `<div id="simAsk"><div class="box"><h3>Reazione di ${esc(P.name)}</h3><p>${esc(G.players[G.active].name)}, passa il dispositivo: le opzioni del rivale compaiono solo dopo il suo tocco.</p><div class="opts"><button class="btn yel" data-react="1">Sono ${esc(P.name)}, mostra le opzioni</button></div></div></div>`;
  const srcLine = p.ctx && p.ctx.src && p.kind !== "die" && p.kind !== "block" && p.kind !== "steal" ? `<div class="sub" style="margin:-4px 0 8px"><b>${esc(p.ctx.src)}</b>${p.ctx.text ? ` — ${esc(p.ctx.text)}` : ""}</div>` : "";
  return `<div id="simAsk"><div class="box"><h3>${titles[p.kind] || "Scegli"}</h3>${srcLine}${ctx}<div class="opts">${p.options.map((o, i) => {
    const pid = o.unit?.pid || o.c?.pid || o.g?.pid; return `<button class="btn${pid ? " card-opt" : ""}" data-ask="${i}">${pid ? `<img src="${thumbUrl(pid)}" alt="">` : ""}${esc(o.label)}</button>`; }).join("")}</div></div></div>`;
}
/* finestra generica (mulligan, conferme) */
function showAsk(title, cards, text, buttons){
  const el = document.createElement("div"); el.id = "simAsk";
  el.innerHTML = `<div class="box"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}${cards ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin:8px 0">${cards.map(c => `<div class="bc" data-zoom="${c.pid}"><img src="${thumbUrl(c.pid)}" alt="${esc(c.label)}"></div>`).join("")}</div>` : ""}<div class="opts">${buttons.map((b, i) => `<button class="btn ${b.cls || ""}" data-b="${i}">${esc(b.label)}</button>`).join("")}</div></div>`;
  el.addEventListener("click", e => { const z = e.target.closest("[data-zoom]"); if(z){ openLens(imgUrl(z.dataset.zoom)); return; } const b = e.target.closest("[data-b]"); if(b){ el.remove(); buttons[+b.dataset.b].fn(); } });
  $("#board").appendChild(el);
}

/* ------------------------------------------------------------ menù contestuali */
function openPop(anchor, items, title){
  closePop();
  const el = document.createElement("div"); el.className = "pop"; pop = el;
  el.innerHTML = (title ? `<div class="ttl">${esc(title)}</div>` : "") + items.map((it, i) => `<button data-i="${i}" class="${it.cls || ""}" ${it.disabled ? "disabled" : ""}>${esc(it.label)}</button>`).join("");
  el.addEventListener("click", e => { const b = e.target.closest("[data-i]"); if(!b) return; closePop(); items[+b.dataset.i].fn(); });
  $("#board").appendChild(el);
  const r = anchor.getBoundingClientRect(), br = $("#board").getBoundingClientRect();
  // coordinate nello spazio della plancia (che può essere ruotata)
  const rotated = matchMedia("(orientation: portrait) and (max-width: 760px)").matches;
  let x, y;
  if(rotated){ x = r.top - br.top; y = br.right - r.right; } else { x = r.left - br.left; y = r.top - br.top; }
  const W = $("#board").clientWidth, H = $("#board").clientHeight;
  el.style.left = Math.max(4, Math.min(W - el.offsetWidth - 4, x)) + "px";
  el.style.top = Math.max(4, Math.min(H - el.offsetHeight - 4, y + (rotated ? 0 : r.height + 4))) + "px";
}
function closePop(){ if(pop){ pop.remove(); pop = null; } }

function after(okv){ if(okv === false && G.lastError){ note(G.lastError); G.lastError = null; } sel = null; targeting = null; render(); tick(); }

function handCard(el, P){
  const c = P.hand.find(x => x.uid === +el.dataset.uid); if(!c) return;
  const myTurn = G.active === P.id && G.phase === "main" && !G.pending && G.winner == null && human[P.id];
  const cost = c.card.cost ?? 0, items = [];
  if(myTurn){
    if(c.card.type === "Gear") items.push({ label: `Equipaggia (${cost} €$) → scegli l'Unità`, cls: "acc", disabled: !canPay(P, cost), fn: () => { targeting = { kind: "gear", uid: c.uid }; sel = c.uid; render(); note("Tocca l'Unità o la Leggenda scoperta da equipaggiare"); } });
    else items.push({ label: `Gioca (${cost} €$)`, cls: "acc", disabled: !canPay(P, cost), fn: () => after(doAction(G, P.id, { t: "play", uid: c.uid })) });
    if(c.card.eddiable) items.push({ label: P.sold ? "Vendi (già venduto in questo turno)" : "Vendi → 1 €$", disabled: P.sold, fn: () => after(doAction(G, P.id, { t: "sell", uid: c.uid })) });
    if(MANUAL) items.push({ label: "Scarta (manuale)", cls: "danger", fn: () => { manual.discard(G, P.id, c.uid); after(); } });
  }
  items.push({ label: "Ingrandisci", fn: () => openLens(imgUrl(c.pid)) }, { label: "Scheda carta", fn: () => openCard(c.cid, c.pid) });
  openPop(el, items, c.card.dn);
}
function fieldCard(el, owner){
  const P = G.players[owner], u = P.field.find(x => x.uid === +el.dataset.uid); if(!u) return;
  const M = G.players[me()], mine = owner === M.id;
  const myTurn = G.active === M.id && G.phase === "main" && !G.pending && G.winner == null && human[M.id];
  // in modalità bersaglio
  if(targeting && myTurn){
    if(targeting.kind === "gear" && mine){ after(doAction(G, M.id, { t: "play", uid: targeting.uid, target: u.uid })); return; }
    if(targeting.kind === "attack" && !mine){ after(doAction(G, M.id, { t: "attack", uid: targeting.uid, target: { kind: "unit", uid: u.uid } })); return; }
  }
  const items = [];
  if(mine && myTurn){
    const can = canAttack(G, M, u);
    items.push({ label: power(u) < 1 ? "Attacca l'area Gig (potenza 0: non ruba, ma attiva gli effetti)" : `Attacca l'area Gig (${1 + Math.floor(power(u) / 10)} Gig)`, cls: "acc", disabled: !can || !rival(G, M).gigs.length || u.fx.onlyUnits, fn: () => after(doAction(G, M.id, { t: "attack", uid: u.uid, target: { kind: "gigs" } })) });
    items.push({ label: "Attacca un'Unità spesa →", disabled: !can || !rival(G, M).field.some(x => x.spent), fn: () => { targeting = { kind: "attack", uid: u.uid }; sel = u.uid; render(); note("Tocca l'Unità rivale spesa da attaccare"); } });
    if(u.fx.spend.length) items.push({ label: "Abilità {Spend}", disabled: u.spent || u.lag, fn: () => after(doAction(G, M.id, { t: "spend", uid: u.uid })) });
  }
  if(MANUAL && human[M.id] && G.winner == null){
    items.push({ label: "— strumenti manuali —", disabled: true, fn: () => {} },
      { label: u.spent ? "Prepara" : "Spendi", fn: () => { manual.toggleSpent(G, owner, u.uid); after(); } },
      { label: "+1 potenza (questo turno)", fn: () => { manual.mod(G, owner, u.uid, 1); after(); } },
      { label: "−1 potenza (questo turno)", fn: () => { manual.mod(G, owner, u.uid, -1); after(); } },
      { label: "Sconfiggi", cls: "danger", fn: () => { manual.defeat(G, owner, u.uid); after(); } });
  }
  items.push({ label: "Ingrandisci", fn: () => openLens(imgUrl(u.pid)) }, { label: "Scheda carta", fn: () => openCard(u.cid, u.pid) });
  for(const g of u.gear || []) items.push({ label: `Ingrandisci ${g.card.dn} (Gear)`, fn: () => openLens(imgUrl(g.pid)) });
  openPop(el, items, `${u.card.dn} · potenza ${power(u)}`);
}
function legendCard(el, owner){
  const P = G.players[owner], l = P.legends.find(x => x.uid === +el.dataset.uid); if(!l) return;
  const M = G.players[me()], mine = owner === M.id;
  const myTurn = G.active === M.id && G.phase === "main" && !G.pending && G.winner == null && human[M.id];
  if(targeting && targeting.kind === "gear" && mine && l.faceUp && !l.onField && !l.removed && myTurn){ after(doAction(G, M.id, { t: "play", uid: targeting.uid, target: l.uid })); return; }
  const items = [], idx = P.legends.indexOf(l);
  if(mine && myTurn && !l.removed && !l.onField){
    if(!l.faceUp) items.push({ label: "Chiama questa Leggenda (1 €$)", cls: "acc", disabled: P.called || !canPay(P, 1), fn: () => after(doAction(G, M.id, { t: "call", idx })) });
    if(l.faceUp && (l.card.kw || []).includes("Go Solo") && l.card.cost != null) items.push({ label: `Go Solo (${l.card.cost} €$): entra come Unità pronta${l.spent ? "" : ", può pagare 1 €$ da sé"}`, disabled: !canPay(P, l.card.cost), fn: () => after(doAction(G, M.id, { t: "gosolo", idx })) });
    if(l.faceUp && l.fx.spend.length) items.push({ label: "Abilità {Spend}", disabled: l.spent, fn: () => after(doAction(G, M.id, { t: "spend", uid: l.uid })) });
    if(MANUAL) items.push({ label: l.spent ? "Prepara (manuale)" : "Spendi come 1 €$ (manuale)", fn: () => { manual.toggleSpent(G, owner, l.uid); after(); } });
    if(MANUAL && !l.faceUp) items.push({ label: "Scopri senza chiamare (manuale)", fn: () => { manual.flip(G, owner, idx); after(); } });
  }
  if(l.faceUp){ items.push({ label: "Ingrandisci", fn: () => openLens(imgUrl(l.pid)) }, { label: "Scheda carta", fn: () => openCard(l.cid, l.pid) }); for(const g of l.gear || []) items.push({ label: `Ingrandisci ${g.card.dn} (Gear)`, fn: () => openLens(imgUrl(g.pid)) }); }
  if(!items.length) items.push({ label: "Leggenda coperta: nessuno sa quale sia", disabled: true, fn: () => {} });
  openPop(el, items, l.faceUp ? l.card.dn : "Leggenda coperta");
}
function gigChip(el, owner){
  const P = G.players[owner], g = P.gigs.find(x => x.uid === +el.dataset.gig); if(!g) return;
  const M = G.players[me()];
  if(!MANUAL || !human[M.id] || G.winner != null) return;
  openPop(el, [
    { label: "+1 (manuale)", disabled: g.value >= g.sides, fn: () => { manual.gig(G, owner, g.uid, 1); after(); } },
    { label: "−1 (manuale)", disabled: g.value <= 1, fn: () => { manual.gig(G, owner, g.uid, -1); after(); } },
    { label: "Passa al rivale (manuale)", cls: "danger", fn: () => { manual.moveGig(G, owner, g.uid); after(); } }
  ], `d${g.sides} = ${g.value}`);
}
function menu(el){
  const M = G.players[me()];
  openPop(el, [
    ...(MANUAL ? [{ label: "Pesca 1 (manuale)", disabled: !human[M.id] || G.winner != null, fn: () => { manual.draw(G, M.id, 1); after(); } }] : []),
    { label: "Registro completo", fn: () => { showLog = true; render(); } },
    { label: "Mi arrendo", cls: "danger", disabled: G.winner != null, fn: () => { manual.concede(G, M.id); after(); } },
    { label: "Esci dalla plancia", fn: () => closeBoard() }
  ], "Menù");
}

/* ------------------------------------------------------------ eventi */
function wire(){
  const root = $("#simSetup");
  root.addEventListener("click", e => {
    const m = e.target.closest("#simMode button"); if(m){ mode = m.dataset.v; renderSim(); return; }
    const pb = e.target.closest("#simPay button"); if(pb){ S.profile.autoPay = pb.dataset.v === "1"; S.save("profile"); renderSim(); return; }
    if(e.target.closest("#simStart")){ start(); return; }
    if(e.target.closest("#simResume")){ openBoard(); render(); tick(); }
  });
  document.addEventListener("ncd:playdeck", e => { S.settings.simDeck0 = e.detail; S.save("settings"); renderSim(); const d = S.decks.find(x => x.id === e.detail); if(d && d.format === "sealed") start(); });
  root.addEventListener("click", e => { const z = e.target.closest(".pkg [data-zoom]"); if(z) openLens(imgUrl(z.dataset.zoom)); });
  wirePrerelease(root, id => { location.hash = "#deck"; openDeck(id); toast("Scegli 3 Leggende e almeno 30 carte, poi «Gioca»", 4000); });
  root.addEventListener("click", e => { if(e.target.closest("#simTutorial")){ mode = "bot"; human = [true, false]; startTutorial(); start({ deck0: starterDeck("theheistretailstarterdeck", "Tutorial"), deck1: starterDeck("embracingpowerretailstarterdeck", "Bot") }); } });

  const board = $("#board");
  // pressione lunga: zoom
  let lp = null, lpFired = false;
  board.addEventListener("pointerdown", e => {
    const el = e.target.closest(".bc"); if(!el) return; lpFired = false;
    const pid = pidOf(el); if(!pid) return;
    lp = setTimeout(() => { lpFired = true; if(drag && drag.active) return; peek(pid); }, 420);
  });
  // anteprima: la carta grande ma non a tutto schermo, resta visibile la plancia; sparisce al rilascio
  function peek(pid){
    let el = $("#peek"); if(!el){ el = document.createElement("div"); el.id = "peek"; board.appendChild(el); }
    el.innerHTML = `<img src="${imgUrl(pid)}" alt=""><div class="hint">Rilascia per chiudere · «Ingrandisci» nel menù per lo zoom</div>`; el.hidden = false;
  }
  const unpeek = () => { const el = $("#peek"); if(el) el.hidden = true; };
  board.addEventListener("pointerup", unpeek); board.addEventListener("pointercancel", unpeek);
  board.addEventListener("contextmenu", e => e.preventDefault());
  const lpCancel = () => clearTimeout(lp);
  // trascinamento dalla mano: sulla plancia per giocare, su un'Unità/Leggenda per equipaggiare un Gear
  const rotated = () => matchMedia("(orientation: portrait) and (max-width: 760px)").matches;

  const dropTarget = (x, y) => {
    const M = G.players[me()], el = document.elementFromPoint(x, y); if(!el) return null;
    const ed = el.closest(".bz.mine [data-eddies]"); if(ed) return { kind: "sell", el: ed };
    const bc = el.closest(".bc");
    if(bc && bc.closest(`[data-field="${M.id}"]`)) return { kind: "unit", el: bc, uid: +bc.dataset.uid };
    if(bc && bc.dataset.legend && bc.closest(".bz.mine")){ const l = M.legends.find(l => l.uid === +bc.dataset.uid); if(l && l.faceUp && !l.onField && !l.removed) return { kind: "legend", el: bc, uid: l.uid }; if(l && !l.faceUp) return { kind: "facedown", el: null }; }
    const zone = el.closest(".bz.mine"); if(zone && !el.closest("[data-handrow]")) return { kind: "field", el: zone.querySelector(`[data-field="${M.id}"]`) };
    return null;
  };
  board.addEventListener("pointerdown", e => {
    if(drag) return;                                   // un secondo dito non avvia un altro trascinamento
    if(!e.isPrimary || !G || G.winner != null) return;
    const M = G.players[me()]; if(G.active !== M.id || G.phase !== "main" || G.pending || !human[M.id]) return;
    const el = e.target.closest("[data-handrow] .bc");
    const lg = !el && e.target.closest(".bz.mine [data-legend]");
    if(lg){   // una Leggenda scoperta con Go Solo si trascina in plancia
      const l = M.legends.find(x => x.uid === +lg.dataset.uid);
      if(!l || !l.faceUp || l.onField || l.removed || !(l.card.kw || []).includes("Go Solo")) return;
      killGhosts(); drag = { uid: l.uid, legendIdx: M.legends.indexOf(l), el: lg, x: e.clientX, y: e.clientY, active: false, ghost: null, id: e.pointerId }; return;
    }
    if(!el) return;
    killGhosts();
    drag = { uid: +el.dataset.uid, el, x: e.clientX, y: e.clientY, active: false, ghost: null, id: e.pointerId };
  });
  board.addEventListener("pointermove", e => {
    if(!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if(!drag.active){ if(Math.hypot(dx, dy) < 12) return; drag.active = true; lpCancel(); unpeek(); try{ drag.el.setPointerCapture(e.pointerId); }catch(err){}
      drag.ghost = drag.el.cloneNode(true); drag.ghost.className = "bc ghost" + (rotated() ? " rot" : ""); drag.ghost.style.width = Math.round(drag.el.getBoundingClientRect().width * 0.8) + "px"; document.body.appendChild(drag.ghost); drag.el.classList.add("dragging");
      const M = G.players[me()];
      if(drag.legendIdx != null) markDropZones({ isLegendDrag: true }); else { const c = M.hand.find(x => x.uid === drag.uid); if(c) markDropZones(c); } }
    drag.ghost.style.left = e.clientX + "px"; drag.ghost.style.top = e.clientY + "px";
    clearDrop(); const t = dropTarget(e.clientX, e.clientY); if(t && t.el) t.el.classList.add("drop");
  });
  const endDrag = e => {
    if(!drag || (e && e.pointerId !== drag.id && e.type !== "blur")) return;
    const d = drag; drag = null;
    killGhosts();
    if(!d.active) return;
    // (nessun "click" segue un trascinamento che finisce su un altro elemento: non serve ignorarlo)
    const M = G.players[me()];
    const t = e.type === "pointercancel" ? null : dropTarget(e.clientX, e.clientY);
    if(!t) return;
    if(d.legendIdx != null){ if(t.kind === "field" || t.kind === "unit") after(doAction(G, M.id, { t: "gosolo", idx: d.legendIdx })); return; }
    const c = M.hand.find(x => x.uid === d.uid); if(!c) return;
    if(t.kind === "sell"){ if(c.card.eddiable) after(doAction(G, M.id, { t: "sell", uid: c.uid })); else note("Questa carta non ha il simbolo di vendita"); return; }
    if(c.card.type === "Gear"){ if(t.kind === "unit" || t.kind === "legend") after(doAction(G, M.id, { t: "play", uid: c.uid, target: t.uid })); else note(t.kind === "facedown" ? "Un Gear si equipaggia solo a una Leggenda scoperta" : "Trascina il Gear su un'Unità o una Leggenda scoperta"); return; }
    if(t.kind === "field" || t.kind === "unit") after(doAction(G, M.id, { t: "play", uid: c.uid }));
  };
  board.addEventListener("pointerup", endDrag); board.addEventListener("pointercancel", endDrag);
  // rilascio fuori dalla plancia o finestra che perde il fuoco: niente copie fantasma in giro
  window.addEventListener("pointerup", e => { if(drag && e.pointerId === drag.id) endDrag(e); else if(!drag) killGhosts(); });
  window.addEventListener("blur", () => { drag = null; killGhosts(); });
  board.addEventListener("pointerup", lpCancel); board.addEventListener("pointercancel", lpCancel);
  let lpStart = null;
  board.addEventListener("pointerdown", e => { lpStart = { x: e.clientX, y: e.clientY }; }, true);
  board.addEventListener("pointermove", e => { if(lpStart && Math.hypot(e.clientX - lpStart.x, e.clientY - lpStart.y) > 10){ lpCancel(); unpeek(); } });
  board.addEventListener("click", e => {
    if(lpFired){ lpFired = false; return; }
    if(e.target.closest(".pop")) return;
    const t = e.target;
    // registro aperto: un tocco fuori dal pannello lo chiude
    if(showLog && !t.closest("#simLog")){ showLog = false; render(); return; }
    if(t.closest("#bEnd")){ after(doAction(G, me(), { t: "end" })); if(mode === "hot" && G.winner == null){ handoff = true; render(); } return; }
    if(t.closest("#bCancel")){ targeting = null; sel = null; render(); return; }
    if(t.closest("#bLog")){ showLog = !showLog; render(); return; }
    if(t.closest("#bLogClose")){ showLog = false; render(); return; }
    if(t.closest("#bMenu")){ menu(t.closest("#bMenu")); return; }
    if(t.closest("#bAgain")){ $("#board").hidden = true; renderSim(); start(); return; }
    if(t.closest("#bExit")){ closeBoard(); return; }
    if(t.closest("#bHand")){ handoff = false; render(); tick(); return; }
    if(t.closest("[data-react]")){ reactCover = G.pending; render(); return; }
    if(t.closest("#tutSkip")){ stopTutorial(); render(); return; }
    if(t.closest("#tutNext")){ tutorialStep(G, me(), true); render(); return; }
    if(payMode()){
      const pm = payMode();
      if(t.closest("#bPayCancel")){ resolve(G, payOpt(o => o.kind === "cancel")); render(); tick(); return; }
      if(t.closest("#bPayAll")){ resolve(G, payOpt(o => o.kind === "alleddies")); render(); tick(); return; }
      const ed = t.closest("[data-eddies]"); if(ed && +ed.dataset.eddies === pm.player){ const i = payOpt(o => o.kind === "eddie"); if(i >= 0){ resolve(G, i); render(); tick(); } else note("Nessun Eddie pronto"); return; }
      const lg = t.closest("[data-legend]"); if(lg){ const i = payOpt(o => o.l && o.l.uid === +lg.dataset.uid); if(i >= 0){ resolve(G, i); render(); tick(); } else note("Questa Leggenda non può pagare"); return; }
      if(!t.closest(".bstrip, .pop, #simLog")) note("Tocca un Eddie o una Leggenda, oppure Annulla");
      return;
    }
    const mull = t.closest("[data-mull]"); if(mull){ mulligan(G, mulliganPending(), mull.dataset.mull === "redo"); render(); tick(); return; }
    const zoom = t.closest("[data-zoom]"); if(zoom){ openLens(imgUrl(zoom.dataset.zoom)); return; }
    const ask = t.closest("[data-ask]"); if(ask){ resolve(G, +ask.dataset.ask); render(); tick(); return; }
    const hand = t.closest("[data-hand=\"1\"]"); if(hand){ handCard(hand, G.players[me()]); return; }
    const leg = t.closest("[data-legend]"); if(leg){ const owner = leg.closest(".bz").classList.contains("mine") ? me() : 1 - me(); legendCard(leg, owner); return; }
    const bc = t.closest(".bc"); if(bc){ const f = bc.closest("[data-field]"); if(f){ fieldCard(bc, +f.dataset.field); return; } }
    const gig = t.closest("[data-gig]"); if(gig && gig.dataset.gig){ gigChip(gig, +gig.closest("[data-owner]").dataset.owner); return; }
    const trash = t.closest("[data-trash]"); if(trash){ const P = G.players[+trash.dataset.trash]; showAsk(`Trash di ${P.name} (${P.trash.length})`, P.trash.slice(-24).map(c => ({ label: c.card.dn, pid: c.pid })), null, [{ label: "Chiudi", fn: () => {} }]); return; }
    closePop();
  });
  window.addEventListener("resize", () => { if(G && !$("#board").hidden) render(); });
}
function pidOf(el){
  if(!G) return null; const uid = +el.dataset.uid;
  for(const P of G.players){ const x = [...P.hand, ...P.field, ...P.legends].find(c => c.uid === uid); if(x){ if(P.legends.includes(x) && !x.faceUp) return null; if(P.hand.includes(x) && P.id !== me()) return null; return x.pid; } }
  return null;
}
