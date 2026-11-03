/* Simulatore: plancia orizzontale, partita contro il bot o in due sullo
   stesso dispositivo. Il motore è in engine.js, il bot in bot.js.      */

import { DATA, imgUrl, thumbUrl } from "./data.js";
import { S, saveDeck } from "./store.js";
import { $, $$, esc, toast, openLens, openCard } from "./ui.js";
import { createGame, mulligan, resolve, legalActions, doAction, applyMoveAs, moveOf, power, powerIn, ready, readyEddies, streetCred, canAttack, canPay, manual, rival, hasKw, hasSpend } from "./engine.js";
import { botDecide, botStep } from "./bot.js";
import { starterDeck, isLegal, validate, deckSize, openDeck } from "./deck.js";
import { prereleaseSetupHTML, wirePrerelease, verifySealed } from "./prerelease.js";
import * as ON from "./online.js";
import { state as cloudState, friends as cloudFriends } from "./cloud.js";
import { startTutorial, tutorialStep, tutorialBarHTML, tutorialActive, stopTutorial, tutorialAllows, ensureHand, TUTORIAL_SEED, tutorialTour, tutorialHighlight } from "./tutorial.js";

/* Strumenti manuali (spendi/prepara, ±potenza, sconfiggi, ±1 sui Gig, pesca…):
   permettono di applicare a mano gli effetti che il motore non interpreta,
   ma escono dalle regole. Spenti per ora; da riattivare per una modalità
   "tavolo libero" se servirà. */
const MANUAL = false;
let G = null, mode = "bot", gmode = "bot", gOnline = false, gSeat = 0, challenge = null, human = [true, false], sel = null, targeting = null, pop = null, showLog = false, botTimer = null, handoff = false, wired = false;
let lastSeen = { turn: 0, seen: 0 }, noteMsg = "", noteT = null, reactCover = null;
let drag = null;   // trascinamento in corso dalla mano
let peekPid = null;   // carta ingrandita con la pressione lunga
const peekInner = pid => `<img src="${imgUrl(pid)}" alt=""><div class="hint">Rilascia per chiudere · «Ingrandisci» nel menù per lo zoom</div>`;
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
const names = () => [S.profile.nick || "Tu", gmode === "bot" ? "IA" : "Giocatore 2"];

/* tutte le mosse passano da qui: in una partita online vengono anche inviate all'avversario */
const online = () => gOnline && ON.T.row;
function act(pi, a){ const m = moveOf(a); const r = doAction(G, pi, m); if(online()){ ON.send({ k: "a", p: pi, a: m }); clockMark(); } return r; }
function res(i){ const r = resolve(G, i); if(online()){ ON.send({ k: "r", i: i == null ? -1 : i }); clockMark(); } return r; }
function doMull(pi, d){ if(G.players[pi].mulliganed) return; mulligan(G, pi, d); if(online()){ ON.send({ k: "m", p: pi, d: d ? 1 : 0 }); clockMark(); } }

/* ------------------------------------------------------------ orologi dei tavoli con limite di tempo
   Dopo ogni mossa si annota chi deve muovere (una decisione in sospeso o il giocatore di turno) e il
   turno; con gli orari delle mosse dati dal server, i due telefoni calcolano gli stessi tempi.
   Chi finisce il tempo lo dichiara dal proprio telefono (come la sconfitta decisa dal motore).     */
let clk = [];
const onMoveNow = () => !G || G.winner != null ? null : G.pending ? G.pending.player : G.phase === "main" ? G.active : null;
function clockMark(){ if(G) clk.push({ on: onMoveNow(), act: G.active, turn: G.turn }); }
function clocks(){
  const o = ON.tableOpts(); if(!G || !gOnline || (!o.turn && !o.match)) return null;
  const st = ON.T.stamps, now = Date.now(), used = [0, 0]; let turnUsed = 0, decision = 0;
  const last = clk.length ? clk[clk.length - 1] : null;
  for(let i = 0; i < clk.length; i++){
    const from = st[i], to = i + 1 < clk.length ? st[i + 1] : now; if(!from || !to || to < from) continue;
    const c = clk[i], d = (to - from) / 1000; if(c.on == null) continue;
    used[c.on] += d;
    if(last && c.turn === last.turn && c.on === c.act) turnUsed += d;
    if(i === clk.length - 1) decision = d;
  }
  let expired = null;
  if(o.match){ for(const s of [0, 1]) if(used[s] > o.match * 60) expired = s; }
  if(o.turn && last && last.on != null){
    if(last.on === last.act && turnUsed > o.turn) expired = last.on;
    if(last.on !== last.act && decision > Math.min(60, o.turn)) expired = last.on;   // reazione (es. blocco): non si può far scadere il turno dell'altro
  }
  return { used, turnUsed, decision, on: last ? last.on : null, act: last ? last.act : null, expired, o };
}
const mmss = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
function clockHTML(){
  const c = clocks(); if(!c) return "";
  const mine = me(), parts = [];
  if(c.o.match) parts.push(`<span class="clk${c.on === mine ? " on" : ""}">Tu ${mmss(c.o.match * 60 - c.used[mine])}</span><span class="clk${c.on === 1 - mine ? " on" : ""}">Avv. ${mmss(c.o.match * 60 - c.used[1 - mine])}</span>`);
  if(c.o.turn && c.on != null){ const left = c.on === c.act ? c.o.turn - c.turnUsed : Math.min(60, c.o.turn) - c.decision; parts.push(`<span class="clk turn${left < 15 ? " low" : ""}">${c.on === mine ? "Tuo" : "Suo"} turno ${mmss(left)}</span>`); }
  return `<span class="clocks" title="Tempo rimasto">${parts.join("")}</span>`;
}
let conceding = false;
function clockCheck(){
  const c = clocks(); if(!c || c.expired == null || conceding || ON.T.ended) return;
  if(c.expired === me()){ conceding = true; note("Tempo scaduto"); ON.concedeTime().finally(() => { conceding = false; }); }
}

/* ------------------------------------------------------------ setup (pagina) */
/* Il setup ha due schede: «Costruito» (mazzi del deckbuilder e starter) e «Prerelease» (solo mazzi
   aperti da un kit). Le modalità: Sfida IA, Offline (due giocatori, un dispositivo), Online, Tutorial;
   nel Prerelease solo Sfida IA e Online, sempre contro mazzi Prerelease. */
let kind = null;   // "built" | "sealed"
let oppWarn = false;   // online: testo del problema se il mazzo dell'avversario non è regolare (o non viene da un kit Prerelease)
/* il mazzo dell'avversario arriva dal suo telefono: lo si ricontrolla qui con le stesse regole del deckbuilder
   (le carte non legali nei tornei restano ammesse in amichevole) */
function oppDeckIssue(opp){
  if(!opp) return false;
  if(opp.format === "sealed") return verifySealed({ ...opp, format: "sealed" }) ? false : "Le carte del mazzo avversario non corrispondono al kit Prerelease dichiarato";
  try{
    const d = { ...opp, legends: Array.isArray(opp.legends) ? opp.legends : [], cards: (Array.isArray(opp.cards) ? opp.cards : []).map(e => ({ ...e, n: Math.floor(Number(e && e.n)) || 0 })) };
    const ko = validate(d).filter(v => !v.ok && !v.t.startsWith("Non legali nei tornei")).map(v => v.t);
    return ko.length ? "Mazzo avversario fuori regola: " + ko.join(" · ") : false;
  }catch(e){ return "Mazzo avversario illeggibile"; }
}
const MODES = { built: [["bot", "Sfida IA"], ["hot", "Offline"], ["online", "Online"], ["tutorial", "Tutorial"]], sealed: [["bot", "Sfida IA"], ["online", "Online"]] };
export function simKind(){ return kind || S.settings.simKind || "built"; }
export function renderSim(){
  const root = $("#simSetup");
  if(!wired){ wire(); wired = true; }
  kind = simKind();
  if(!MODES[kind].some(([v]) => v === mode)) mode = "bot";
  // si gioca solo con mazzi completi: le bozze (non valide nel deckbuilder) restano fuori;
  // nel Costruito niente mazzi Prerelease, nel Prerelease solo quelli aperti davvero da un kit
  const legal = S.decks.filter(isLegal).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const built = legal.filter(d => d.format !== "sealed"), sealed = legal.filter(d => d.format === "sealed" && verifySealed(d));
  const drafts = S.decks.filter(d => (kind === "sealed") === (d.format === "sealed")).length - (kind === "sealed" ? sealed : built).length;
  const opt = (d, sel) => `<option value="${d.id}"${d.id === sel ? " selected" : ""}>${esc(d.name)} (${deckSize(d)} carte)</option>`;
  const starters = sel => [["theheistretailstarterdeck", "The Heist"], ["embracingpowerretailstarterdeck", "Embracing Power"]].map(([c, n]) => `<option value="starter:${c}"${sel === "starter:" + c ? " selected" : ""}>Starter «${n}»</option>`).join("");
  const builtOpts = sel => starters(sel) + built.map(d => opt(d, sel)).join("");
  const sel = kind === "sealed" ? (sealed.some(d => d.id === S.settings.simSealed) ? S.settings.simSealed : sealed[0]?.id) : S.settings.simDeck0;
  const lbl = t => `<label style="font-size:12px;font-weight:700;color:var(--mute)">${t}</label>`;
  const deck0 = kind === "sealed"
    ? (sealed.length ? `<div>${lbl("Il tuo mazzo Prerelease")}<select class="inp" id="simDeck0">${sealed.map(d => opt(d, sel)).join("")}</select></div>` : `<div class="note" style="margin:0">Non hai ancora un mazzo Prerelease completo: apri un kit qui sotto e costruiscilo nel deckbuilder.</div>`)
    : `<div>${lbl(mode === "hot" ? "Mazzo del giocatore 1" : "Il tuo mazzo")}<select class="inp" id="simDeck0">${builtOpts(sel)}</select></div>`;
  const deck1 = kind === "sealed" || mode === "online" || mode === "tutorial" ? ""
    : `<div>${lbl(mode === "bot" ? "Mazzo dell'IA" : "Mazzo del giocatore 2")}<select class="inp" id="simDeck1">${builtOpts(S.settings.simDeck1 || "starter:embracingpowerretailstarterdeck")}</select></div>`;
  const resume = G && G.winner == null && !gOnline ? `<button class="btn" id="simResume">Riprendi la partita in corso</button>` : "";
  let body;
  if(mode === "tutorial") body = `<div class="tutlist">
      <div class="tutitem"><div><b>Partita guidata</b><span>Conosci la plancia, poi una partita contro l'IA passo per passo: vendere, giocare, chiamare, attaccare, reagire.</span></div><button class="btn acc2" id="simTutorial">Inizia</button></div>
    </div>${resume ? `<div style="margin-top:10px">${resume}</div>` : ""}`;
  else if(mode === "online") body = `<div class="simdecks" style="margin-top:10px">${deck0}</div>${kind === "sealed" && !sealed.length ? "" : onlineLobbyHTML()}`;
  else body = `<div class="simdecks" style="margin-top:10px">${deck0}${deck1}</div>
      ${kind === "sealed" && !sealed.length ? "" : `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center">
        <button class="btn acc2" id="simStart">▶ Inizia la partita</button>${resume}
        <span class="chip">${S.record.wins || 0} vittorie · ${S.record.losses || 0} sconfitte contro l'IA</span></div>`}
      ${kind === "sealed" && sealed.length ? `<p class="sub" style="margin:8px 0 0">L'IA gioca con il kit che ha aperto lei, abbinato al tuo mazzo.</p>` : ""}`;
  root.innerHTML = `
    <div class="card">
      <h2>Simulator</h2>
      <div class="sub">Sfida un'IA uscita dal Blackwall, oppure i tuoi choom.</div>
      <div class="simkind" id="simKind"><button data-v="built" aria-pressed="${kind === "built"}">Costruito</button><button data-v="sealed" aria-pressed="${kind === "sealed"}">Prerelease</button></div>
      <div class="simmode"><span class="seg" id="simMode">${MODES[kind].map(([v, t]) => `<button data-v="${v}" aria-pressed="${mode === v}">${t}</button>`).join("")}</span></div>
      ${body}
      <details class="fold" style="margin-top:12px"><summary>Info aggiuntive</summary><div class="sub" style="margin-top:6px">
        <p style="margin:0 0 6px">Le regole sono applicate dal motore: fasi, Eddies, Leggende, attacchi, Blocker, furto dei Gig, Street Cred e overtime; gli effetti di tutte le carte sono eseguiti e il registro (≡) mostra ogni innesco con la carta che lo produce.</p>
        <p style="margin:0 0 6px"><b>Sul telefono</b> la plancia è orizzontale: ruota il dispositivo (o lascia che l'app la ruoti da sola). Tocca una carta per le azioni, <b>tieni premuto</b> per ingrandirla.</p>
        <p style="margin:0 0 6px">${kind === "sealed" ? "Nel Prerelease si gioca solo con mazzi aperti da un kit: almeno 30 carte di massimo 3 colori, senza limiti di RAM. Online si affrontano solo altri mazzi Prerelease." : "Si gioca solo con i mazzi completi: 3 Leggende, 40–50 carte entro i limiti RAM."}${drafts > 0 ? ` ${drafts} ${drafts === 1 ? "mazzo resta" : "mazzi restano"} nel deckbuilder finché non ${drafts === 1 ? "è completo" : "sono completi"}.` : ""}</p>
        <p style="margin:0">Il pagamento degli Eddies (manuale o automatico) si sceglie nelle Impostazioni.</p></div></details>
    </div>
    ${kind === "sealed" ? prereleaseSetupHTML() : ""}`;
}
function deckFrom(v){
  if(v.startsWith("starter:")){ const code = v.slice(8); return starterDeck(code, code.includes("heist") ? "Starter The Heist" : "Starter Embracing Power"); }
  return S.decks.find(d => d.id === v);
}

/* ------------------------------------------------------------ partita */
function start(opts = {}){
  const v0 = $("#simDeck0")?.value, v1 = $("#simDeck1")?.value;
  let d0 = opts.deck0 || (v0 && deckFrom(v0)), d1 = opts.deck1 || (v1 && deckFrom(v1));
  if(gOnline && G && G.winner == null){ toast("Hai una partita online in corso: finiscila o abbandonala prima", 3500); return; }
  if(mode === "online" || mode === "tutorial") mode = "bot";
  if(d0 && d0.format === "sealed" && d0.botDeck && !opts.deck1){ d1 = d0.botDeck; mode = "bot"; }
  else if(d1 && d1.format === "sealed" && d1.botDeck && !opts.deck1){ /* mazzo sealed scelto come avversario: va bene, lo gioca il bot o il secondo giocatore */ }
  if(!d0 || !d1){ toast("Scegli due mazzi"); return; }
  for(const d of [d0, d1]) if(d.legends.filter(Boolean).length < 3 || deckSize(d) < 10){ toast(`«${d.name}»: servono 3 Leggende e un mazzo con carte`); return; }
  if(!opts.deck0){ if(simKind() === "sealed") S.settings.simSealed = v0; else { S.settings.simDeck0 = v0; if(v1) S.settings.simDeck1 = v1; } S.save("settings"); }
  if(gOnline) ON.detach();
  gmode = mode; gOnline = false;
  human = mode === "bot" ? [true, false] : [true, true];
  const nm = names();
  const tut = tutorialActive();
  G = createGame([{ ...d0, name: nm[0] }, { ...d1, name: nm[1] }], DATA.byId, { bot0: !human[0], bot1: !human[1], autoPay: [!!S.profile.autoPay, !!S.profile.autoPay], seed: tut ? TUTORIAL_SEED : undefined, first: tut ? 1 : undefined });
  if(tut) ensureHand(G, 0);
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
  const i = mulliganPending(); if(i == null || tutorialTour()) return "";
  const P = G.players[i];
  // carte grandi: è la prima scelta della partita e va fatta a colpo d'occhio (tocca una carta per lo zoom)
  return `<div id="simAsk" class="mull"><div class="box"><h3>${esc(P.name)}: tieni questa mano?</h3>
    <div class="mullrow">${P.hand.map(c => `<div class="mc" data-zoom="${c.pid}" title="${esc(c.card.dn)}"><img src="${thumbUrl(c.pid)}" data-full="${imgUrl(c.pid)}" alt="${esc(c.card.dn)}" draggable="false"></div>`).join("")}</div>
    <div class="sub" style="margin:0 0 8px">Tocca una carta per ingrandirla. Con il mulligan rimescoli la mano nel mazzo e peschi 6 carte nuove.</div>
    <div class="opts"><button class="btn yel" data-mull="keep">Tengo</button><button class="btn" data-mull="redo">Mulligan (ripesco 6)</button></div></div></div>`;
}
function openBoard(){
  const b = $("#board"); b.hidden = false; document.body.style.overflow = "hidden";
  try{ document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.("landscape").catch(() => {})).catch(() => {}); }catch(e){}
}
function closeBoard(){
  stopTutorial(); closeTableChat();
  if(gOnline && G && G.winner != null){ ON.detach(); }   // partita online finita: si lascia il tavolo
  $("#board").hidden = true; document.body.style.overflow = "";
  try{ screen.orientation?.unlock?.(); if(document.fullscreenElement) document.exitFullscreen?.(); }catch(e){}
  clearTimeout(botTimer); renderSim();
}

/* turno del bot a passi, per leggere cosa fa */
/* ------------------------------------------------------------ ritmo delle azioni dell'avversario
   Impostazioni → Simulatore: l'IA (e l'avversario online) fa una mossa alla volta, con una pausa
   regolabile; ogni mossa compare in un riquadro sulla plancia e le carte appena entrate lampeggiano. */
const OPP_SPEED = { instant: [650, 0], fast: [1100, 700], normal: [1800, 1300], slow: [2800, 2300] };
const oppSpeed = () => OPP_SPEED[S.settings.oppSpeed] ? S.settings.oppSpeed : "normal";
const oppDelay = online => OPP_SPEED[oppSpeed()][online ? 1 : 0];
let feed = [], feedT = null, flashUids = new Set(), oppQ = [], oppQT = null;
const fieldUids = () => new Set(G.players.flatMap(P => [...P.field, ...P.legends].map(u => u.uid)));
const snapBefore = () => ({ last: G.log[G.log.length - 1], uids: fieldUids() });
function showOpp(b){
  if(!G || oppSpeed() === "instant") return;
  const i = b.last ? G.log.lastIndexOf(b.last) : -1, lines = G.log.slice(i + 1).map(e => e.text).filter(Boolean);
  const now = fieldUids(); flashUids = new Set([...now].filter(u => !b.uids.has(u)));
  if(!lines.length && !flashUids.size) return;
  feed = lines.slice(-3); clearTimeout(feedT);
  feedT = setTimeout(() => { feed = []; flashUids = new Set(); $("#oppFeed")?.remove(); document.querySelectorAll("#board .justnow").forEach(x => x.classList.remove("justnow")); }, Math.max(1600, oppDelay(gOnline) + 500));
}
/* online: le mosse dell'avversario arrivano anche a raffica; si applicano una alla volta con la pausa scelta */
function drainOpp(){
  if(oppQT || !oppQ.length || !G) return;
  const [m, seat] = oppQ.shift(), b = snapBefore();
  applyMoveAs(G, seat, m); clockMark();
  if(targeting && !G.players[me()].hand.some(c => c.uid === targeting.uid) && !G.players[me()].field.some(u => u.uid === targeting.uid)) targeting = null;
  if(m.k !== "m") showOpp(b);
  render(); tick();
  const d = m.k === "m" ? 0 : oppDelay(true);
  if(oppQ.length){ oppQT = setTimeout(() => { oppQT = null; drainOpp(); }, d); }
}
const oppBusy = () => gOnline && (oppQ.length > 0);
function tick(){
  clearTimeout(botTimer);
  if(!G) return;
  if(mulliganPending() != null){ render(); return; }
  if(G.winner != null){ finish(); render(); return; }
  if(gmode === "online"){ render(); return; }   // l'avversario gioca dal suo telefono
  if(G.pending){ if(human[G.pending.player]) { render(); return; } // decisione umana in attesa
    // decisione del bot (fuori dal suo turno, es. blocco): già risolta da ask()
  }
  if(!human[G.active] && G.phase === "main" && !G.pending){
    botTimer = setTimeout(() => { const b = snapBefore(); const more = botStep(G, G.active); showOpp(b); render(); if(G.winner != null) finish(); if(more || G.active !== undefined) tick(); }, oppDelay(false));
    return;
  }
  render();
  if(G.winner != null) finish();
}
function finish(){
  if(!G || G.winner == null || G.recorded) return; G.recorded = true;
  if(gmode === "online"){ finishOnline(); return; }
  if(gmode === "bot"){ if(G.winner === 0) S.record.wins = (S.record.wins || 0) + 1; else S.record.losses = (S.record.losses || 0) + 1; }
  S.record.games = [{ when: Date.now(), mode, winner: G.players[G.winner].name, reason: G.reason, turns: G.turn }, ...(S.record.games || [])].slice(0, 50);
  S.save("record"); render();
}

/* ------------------------------------------------------------ partita online */
const fmtCode = c => esc(c || "");
const nickOf = (t, who) => esc(t[who + "_nick"] || "?");
export function setChallenge(f){ challenge = f; mode = "online"; }
const optsLine = o => { o = o || {}; return [o.turn ? `${o.turn < 120 ? o.turn + " s" : o.turn / 60 + " min"} per turno` : "", o.match ? `${o.match} min a testa` : "", o.bo === 3 ? "al meglio di 3" : ""].filter(Boolean).join(" · "); };
function onlineLobbyHTML(){
  if(!cloudState.user) return `<div class="online-box"><p class="note" style="margin:0">Per giocare online serve un account: accedi dalla scheda <b>Social</b> con Google o con l'email. Il nick pubblico è il nome che vede l'avversario.</p><div style="margin-top:10px"><button class="btn acc2" id="onlLogin">Vai al Social</button></div></div>`;
  const T = ON.T, me = cloudState.user.id;
  const waiting = T.row && T.row.status === "waiting" && T.seat === 0 && !T.ended ? T.row : null;
  const inv = ON.invitesForMe(), act = ON.activeTables(), done = ON.tables.filter(t => t.status === "finished").slice(0, 5);
  const friends = cloudFriends.filter(f => f.status === "accepted");
  const rec = S.record.online || { w: 0, l: 0, d: 0 };
  const resultTxt = t => { const mine = t.host === me ? "host" : "guest"; const res = t.result === "draw" ? "Patta" : t.result === mine ? "Vittoria" : "Sconfitta"; const why = { resign: "abbandono", timeout: "disconnessione", agreement: "accordo", time: "tempo scaduto" }[t.reason] || ""; return res + (why ? ` (${why})` : ""); };
  const opp = t => t.host === me ? (t.guest_nick || t.invited_nick) : t.host_nick;
  return `<div class="online-box">
    ${waiting ? `<div class="tcode"><small>Codice del tavolo</small><b>${fmtCode(waiting.code)}</b>
        ${optsLine(waiting.opts) ? `<span class="chip">${optsLine(waiting.opts)}</span>` : ""}
        <span>${waiting.invited ? `Sfida inviata a <b>${esc(ON.T.inviteNick || (ON.tables.find(x => x.id === waiting.id) || {}).invited_nick || "un amico")}</b>: appena accetta, la partita parte da sola.` : "Dai il codice all'avversario: appena entra, la partita parte da sola."}</span>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:8px"><button class="btn sm" id="onlShare">Condividi il codice</button><button class="btn sm" id="onlCancel">Annulla il tavolo</button></div></div>`
    : `<div class="onl-grid">
        <div><h4>Crea un tavolo</h4><p class="sub">Ricevi un codice di 4 caratteri da dare all'avversario.</p>
          ${(() => { const o = S.settings.tableOpts || {}, sel = (id, cur, opts) => `<select class="inp" id="${id}">${opts.map(([v, t]) => `<option value="${v}"${String(cur || 0) === String(v) ? " selected" : ""}>${t}</option>`).join("")}</select>`;
            return `<div class="topts"><label>Tempo per turno${sel("onlTurn", o.turn, [[0, "Nessun limite"], [60, "1 minuto"], [90, "1 min e mezzo"], [120, "2 minuti"], [180, "3 minuti"]])}</label>
              <label>Tempo a testa${sel("onlMatch", o.match, [[0, "Nessun limite"], [10, "10 minuti"], [20, "20 minuti"], [30, "30 minuti"]])}</label>
              <label>Partite${sel("onlBo", o.bo || 1, [[1, "Una partita"], [3, "Al meglio di 3"]])}</label></div>`; })()}
          <button class="btn acc2" id="onlCreate">Crea un tavolo</button></div>
        <div><h4>Entra con un codice</h4><div style="display:flex;gap:6px"><input class="inp code" id="onlCode" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD"><button class="btn yel" id="onlJoin">Entra</button></div></div>
        <div><h4>Sfida un amico</h4>${friends.length ? `<div style="display:flex;gap:6px"><select class="inp" id="onlFriend">${friends.map(f => `<option value="${f.id}"${challenge && challenge.id === f.id ? " selected" : ""}>${esc(f.nick)}${cloudState.online.has(f.id) ? " ●" : ""}</option>`).join("")}</select><button class="btn acc2" id="onlChallenge">Sfida</button></div>` : `<p class="sub">Aggiungi amici dalla scheda Social per sfidarli direttamente.</p>`}</div>
      </div>`}
    ${inv.length ? `<h4 class="frh">Sfide ricevute</h4><div class="frlist">${inv.map(t => `<div class="frow2"><div class="nm"><b>${nickOf(t, "host")}</b><span>ti sfida · tavolo ${fmtCode(t.code)}${t.fmt === "sealed" ? " · Prerelease" : " · Costruito"}</span></div><button class="btn sm yel" data-onlaccept="${esc(t.code)}" data-fmt="${t.fmt || "built"}">Accetta</button><button class="btn sm" data-onlrefuse="${t.id}">Rifiuta</button></div>`).join("")}</div>` : ""}
    ${act.length ? `<h4 class="frh">Partite in corso</h4><div class="frlist">${act.map(t => `<div class="frow2"><div class="nm"><b>${esc(opp(t) || "?")}</b><span>tavolo ${fmtCode(t.code)} · ${t.moves} mosse</span></div><button class="btn sm acc2" data-onlresume="${t.id}">${ON.T.row && ON.T.row.id === t.id && G && gOnline ? "Torna alla plancia" : "Riprendi"}</button></div>`).join("")}</div>` : ""}
    ${done.length ? `<h4 class="frh">Ultime partite</h4><div class="frlist">${done.map(t => `<div class="frow2"><div class="nm"><b>${esc(opp(t) || "?")}</b><span>${resultTxt(t)}</span></div></div>`).join("")}</div>` : ""}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center"><span class="chip">Online: ${rec.w || 0} vittorie · ${rec.l || 0} sconfitte · ${rec.d || 0} patte</span></div>
    <p class="note" style="margin:10px 0 0">Si gioca con le regole del motore, come contro l'IA. <b>Se chiudi l'app o resti senza rete per più di un minuto, la partita va all'avversario.</b> Dal menù ⋯ della plancia puoi proporre la patta, abbandonare o scrivere nella chat del tavolo.</p>
  </div>`;
}
function onlineBadgeHTML(){
  if(!ON.T.row || G.winner != null) return "";
  return clockHTML() + onlineStatusHTML();
}
function onlineStatusHTML(){
  if(oppWarn) return `<b class="onl warn" title="${esc(oppWarn)}">⚠ mazzo avversario ${oppWarn.startsWith("Le carte") ? "non verificato" : "non regolare"}</b>`;
  const idle = ON.otherIdle(), R = G.players[1 - me()];
  if(ON.T.error && /fetch|network|Failed/i.test(ON.T.error)) return `<b class="onl warn">⚠ connessione assente</b>`;
  if(idle >= 25) return `<b class="onl warn">⚠ ${esc(R.name)} non risponde: vinci tra ${Math.max(0, 60 - idle)}s</b>`;
  return `<span class="onl ok" title="${esc(R.name)} è collegato">● ${esc(R.name)}</span>`;
}
function drawOfferHTML(){
  if(!ON.T.row || G.winner != null || !ON.T.drawOffer) return "";
  if(ON.T.drawOffer === cloudState.user?.id) return "";
  return `<div id="simAsk" class="drawask"><div class="box"><h3>${esc(G.players[1 - me()].name)} propone la patta</h3><p>Se accetti, la partita finisce senza vincitori.</p><div class="opts"><button class="btn yel" data-draw="1">Accetto la patta</button><button class="btn" data-draw="0">Continuiamo</button></div></div></div>`;
}
/* chat del tavolo: pannello a parte, fuori dalla plancia. La plancia si ridisegna spesso
   (mosse, segnali, tastiera che cambia l'altezza dello schermo): se la chat ne facesse parte,
   il campo di testo verrebbe ricreato a ogni ridisegno e la tastiera si aprirebbe e chiuderebbe di continuo */
const chatOpen = () => !!document.querySelector("#tchat:not([hidden])");
function chatListHTML(){
  return ON.T.chat.map(m => `<div class="msg${m.mine ? " me" : ""}">${m.mine ? "" : `<small>${esc(m.who)}</small>`}${esc(m.text)}</div>`).join("") || `<div class="sub">Nessun messaggio. Sii gentile: la chat del tavolo non viene salvata.</div>`;
}
function openTableChat(){
  closePop();
  let el = $("#tchat");
  if(!el){
    el = document.createElement("div"); el.id = "tchat";
    el.innerHTML = `<div class="box"><div class="chh"><b>Chat del tavolo</b><button class="btn sm icon" id="bChatClose" aria-label="Chiudi">✕</button></div>
      <div id="tchatList"></div>
      <form id="tchatForm" class="chin"><input class="inp" id="tchatIn" maxlength="300" autocomplete="off" enterkeyhint="send" placeholder="Scrivi…"><button class="btn yel" type="submit">Invia</button></form></div>`;
    el.addEventListener("click", e => { if(e.target.closest("#bChatClose") || e.target === el) closeTableChat(); });
    el.addEventListener("submit", e => { e.preventDefault(); const i = $("#tchatIn"); ON.sendChat(i.value); i.value = ""; i.focus(); });
    document.body.appendChild(el);
  }
  el.hidden = false; ON.T.chatUnread = 0; refreshTableChat();
  const b = $("#bChat .nbadge"); if(b) b.remove();
}
function refreshTableChat(){
  const l = $("#tchatList"); if(!l || !chatOpen()) return;
  ON.T.chatUnread = 0;
  l.innerHTML = chatListHTML(); l.scrollTop = l.scrollHeight;
}
function closeTableChat(){ const el = $("#tchat"); if(el){ el.hidden = true; if(document.activeElement && el.contains(document.activeElement)) document.activeElement.blur(); } if(G && !$("#board").hidden) render(); }
/* la partita si ricostruisce sempre da seme + mazzi + mosse */
function buildOnline(moves){
  const { decks, opts } = ON.setupOf(ON.T.row);
  G = createGame(decks, DATA.byId, opts);
  G.mulliganAsked = [false, false]; clk = [];
  for(const x of moves){ try{ applyMoveAs(G, x.seat, x.move); clockMark(); }catch(e){ console.warn("mossa non applicabile", x, e); break; } }
  if(ON.T.ended) applyEnd(ON.T.ended);
}
function applyEnd(e){
  if(!G || !e || !e.result) return;
  const w = e.result === "draw" ? -1 : e.result === "host" ? 0 : 1;
  if(G.winner === w && !["resign", "timeout", "agreement", "time"].includes(e.reason)) return;   // il motore l'aveva già decisa
  const loser = w >= 0 ? G.players[1 - w].name : "";
  G.winner = w; G.pending = null;
  G.reason = e.reason === "agreement" ? "Patta concordata" : e.reason === "resign" ? `${loser} abbandona la partita` : e.reason === "timeout" ? `${loser} si è disconnesso per più di un minuto` : e.reason === "time" ? `${loser} ha finito il tempo` : (G.reason || e.reason || "");
}
function finishOnline(){
  // la partita si ricostruisce più volte dal registro: si conta una volta sola per tavolo
  const tid = ON.T.row && ON.T.row.id, seen = S.record.onlineIds = S.record.onlineIds || [];
  if(G.winner >= 0 && G.winner !== gSeat && !ON.T.ended) ON.reportResult(G.winner, G.reason);
  if(!tid || seen.includes(tid)){ render(); return; }
  S.record.onlineIds = [tid, ...seen].slice(0, 30);
  const r = S.record.online = S.record.online || { w: 0, l: 0, d: 0 };
  if(G.winner === -1) r.d = (r.d || 0) + 1; else if(G.winner === gSeat) r.w = (r.w || 0) + 1; else r.l = (r.l || 0) + 1;
  S.record.games = [{ when: Date.now(), mode: "online", winner: G.winner === -1 ? "—" : G.players[G.winner].name, reason: G.reason, turns: G.turn, vs: G.players[1 - gSeat].name }, ...(S.record.games || [])].slice(0, 50);
  S.save("record");
  render();
  seriesAfter();
}
/* al meglio di 3: punteggio sulla plancia e, se la serie non è decisa, la partita dopo parte da sola */
let series = null, seriesT = null;
async function seriesAfter(){
  if(!ON.T.row || !ON.T.row.series) { series = null; return; }
  const tid = ON.T.row.id;
  try{ series = await ON.seriesScore(); }catch(e){ series = null; }
  if(!series || !ON.T.row || ON.T.row.id !== tid) return;
  series.next = series.me < 2 && series.opp < 2 && (ON.T.row.game_no || 1) < 3;
  render();
  if(series.next){ clearTimeout(seriesT); seriesT = setTimeout(() => { if(ON.T.row && ON.T.row.id === tid) ON.nextGame().catch(err => note(err.message)); }, 6000); }
}
const seriesHTML = () => series ? `<p class="series">Serie al meglio di 3 · <b>${series.me}–${series.opp}</b>${series.next ? ` · la partita ${(ON.T.row.game_no || 1) + 1} parte tra pochi secondi` : series.me >= 2 ? " · serie vinta" : series.opp >= 2 ? " · serie persa" : ""}</p>` : "";
const hooksForTest = {};
ON.setOnlineHooks(Object.assign(hooksForTest, {
  start(row, seat, nicks, moves){
    clearTimeout(botTimer); stopTutorial(); clearTimeout(seriesT); series = null;
    if(row.series && (row.game_no || 1) > 1) ON.seriesScore().then(x => { series = x ? { ...x, next: false } : null; render(); }).catch(() => {});
    gmode = "online"; mode = "online"; gOnline = true; gSeat = seat; human = [seat === 0, seat === 1];
    // Prerelease: il mazzo dell'avversario deve venire davvero da un kit (si riapre e si confronta)
    const opp = seat === 0 ? row.guest_deck : row.host_deck; oppWarn = oppDeckIssue(opp);
    sel = null; targeting = null; pop = null; handoff = false; showLog = false; lastSeen = { turn: 0, seen: 0 };
    buildOnline(moves);
    if(location.hash !== "#sim") location.hash = "#sim";
    $("#board").innerHTML = ""; openBoard(); render(); tick();
  },
  move(m, seat){ if(!G || !gOnline) return; oppQ.push([m, seat]); drainOpp(); },
  rebuild(moves){ if(!gOnline || !ON.T.row) return; oppQ = []; clearTimeout(oppQT); oppQT = null; window.__ncdRebuilds = (window.__ncdRebuilds || 0) + 1; buildOnline(moves); sel = null; targeting = null; render(); tick(); },
  lost(m){ if(m.k === "m" && G && !G.players[m.p].mulliganed){ doMull(m.p, !!m.d); render(); tick(); } },
  end(e){ if(G && gOnline){ applyEnd(e); render(); finish(); } }
}));
setInterval(() => { if(gOnline && G && G.winner == null){ clockCheck(); if(!$("#board").hidden){ const b = $("#onlBadge"); if(b) b.innerHTML = onlineBadgeHTML(); } } }, 1000);
function onlineMenuItems(){
  const mine = ON.T.drawOffer && ON.T.drawOffer === cloudState.user?.id;
  return [
    { label: `Chat del tavolo${ON.T.chatUnread ? ` (${ON.T.chatUnread})` : ""}`, fn: () => openTableChat() },
    { label: mine ? "Patta proposta: in attesa di risposta" : "Proponi la patta", disabled: G.winner != null || mine, fn: async () => { try{ await ON.offerDraw(); note("Patta proposta"); }catch(e){ note(e.message); } } },
    { label: "Abbandona la partita", cls: "danger", disabled: G.winner != null, fn: () => showAsk("Abbandonare la partita?", null, "La vittoria va all'avversario.", [{ label: "Abbandono", cls: "danger", fn: async () => { try{ await ON.resign(); }catch(e){ note(e.message); } } }, { label: "Continuo", fn: () => {} }]) }
  ];
}
async function lobbyClick(e){
  const t = e.target, deck = () => { const d = deckFrom($("#simDeck0").value); if(!d || d.legends.filter(Boolean).length < 3){ toast("Scegli un mazzo completo"); return null; } S.settings.simDeck0 = $("#simDeck0").value; S.save("settings"); return d; };
  const busy = async (btn, f) => { if(btn.disabled) return; btn.disabled = true; try{ await f(); }catch(err){ toast(err.message, 4000); } finally{ btn.disabled = false; renderSim(); } };
  if(t.closest("#onlLogin")){ location.hash = "#profile"; return; }
  let b;
  if((b = t.closest("#onlCreate"))){ const d = deck(); if(!d) return;
    const o = { turn: +($("#onlTurn")?.value || 0), match: +($("#onlMatch")?.value || 0), bo: +($("#onlBo")?.value || 1) };
    S.settings.tableOpts = o; S.save("settings");
    busy(b, () => ON.createTable(d, S.profile.autoPay, null, { turn: o.turn || null, match: o.match || null, bo: o.bo === 3 ? 3 : null })); return; }
  if((b = t.closest("#onlJoin"))){ const code = ($("#onlCode").value || "").trim().toUpperCase(); if(!/^[A-Z2-9]{4}$/.test(code)){ toast("Il codice è di 4 caratteri"); return; } const d = deck(); if(d) busy(b, () => ON.joinTable(code, d, S.profile.autoPay)); return; }
  if((b = t.closest("#onlChallenge"))){ const id = $("#onlFriend").value, f = cloudFriends.find(x => x.id === id); const d = deck(); if(d) busy(b, async () => { await ON.createTable(d, S.profile.autoPay, id); ON.T.inviteNick = f && f.nick; challenge = null; }); return; }
  if((b = t.closest("#onlCancel"))){ busy(b, () => ON.cancelTable(ON.T.row.id)); return; }
  if(t.closest("#onlShare")){ const code = ON.T.row && ON.T.row.code; const text = `Giochiamo a Cyberpunk TCG su DeckShard: codice del tavolo ${code} — ${location.origin + location.pathname}#sim`; try{ if(navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(code); toast("Codice copiato"); } }catch(err){} return; }
  if((b = t.closest("[data-onlaccept]"))){ if((b.dataset.fmt || "built") !== simKind()){ toast(b.dataset.fmt === "sealed" ? "È una sfida Prerelease: passa alla scheda Prerelease e scegli un tuo mazzo Prerelease" : "È una sfida con mazzi costruiti: passa alla scheda Costruito", 4500); return; } const d = deck(); if(d){ const code = b.dataset.onlaccept; busy(b, () => ON.joinTable(code, d, S.profile.autoPay)); } return; }
  if((b = t.closest("[data-onlrefuse]"))){ const id = b.dataset.onlrefuse; busy(b, () => ON.cancelTable(id)); return; }
  if((b = t.closest("[data-onlresume]"))){ const id = b.dataset.onlresume; if(ON.T.row && ON.T.row.id === id && G && gOnline){ openBoard(); render(); return; } busy(b, () => ON.resumeTable(id)); return; }
}

/* ------------------------------------------------------------ resa grafica */
const me = () => gmode === "bot" ? 0 : gmode === "online" ? gSeat : G.active;   // in hot-seat la plancia è sempre dal punto di vista di chi gioca
/* se le righe non ci stanno (browser con le barre visibili, schermi bassi) le carte si rimpiccioliscono
   finché tutto entra: altrimenti la zona in basso taglia le proprie Unità dall'alto */
function fitBoard(board, H){
  for(let i = 0; i < 4; i++){
    let need = 0;
    for(const z of board.children){
      const pos = getComputedStyle(z).position; if(pos === "absolute" || pos === "fixed" || z.hidden) continue;
      if(z.classList.contains("bz")){ let off = 0, full = 0; for(const r of z.children){ if(!r.classList.contains("brow")) continue; off += r.offsetHeight; full += Math.max(r.offsetHeight, r.scrollHeight); } need += z.offsetHeight - off + full; }
      else need += z.offsetHeight;
    }
    if(need <= H + 1) return;
    const cw = parseFloat(board.style.getPropertyValue("--cw")), next = Math.max(20, cw - (need - H) / 5.6 - 0.3);
    if(next >= cw - 0.05) return;
    board.style.setProperty("--cw", next.toFixed(1) + "px");
  }
}
/* potenza mostrata: quella che conta adesso, con gli effetti continui (es. Royce: +2 per ogni Gear nel suo turno) */
function shownPower(x){ const P = G && G.players.find(Q => Q.field.includes(x) || Q.legends.includes(x)); return P ? powerIn(G, P, x) : power(x); }
/* Gear come in Arena: le carte equipaggiate stanno sotto l'Unità (o la Leggenda) e ne spunta un margine;
   il primo tocco sull'Unità le apre di fianco, ognuna si tocca o si ingrandisce con la pressione lunga */
let gearOpen = null;
function cardHTML(x, cls = "", extra = ""){
  const pw = shownPower(x), base = x.card.power ?? 0, gear = x.gear || [];
  const c = cls + (x.spent ? " spent" : "") + (x.lag ? " lag" : "") + (sel === x.uid ? " sel" : "") + (flashUids.has(x.uid) ? " justnow" : "") + (gear.length ? " host" : "");
  const card = `<div class="bc ${c}" data-uid="${x.uid}" title="${esc(x.card.dn)}${gear.length ? " · " + gear.map(g => esc(g.card.dn)).join(", ") : ""}">${x.pid ? `<img src="${thumbUrl(x.pid)}" alt="">` : `<div class="n">${esc(x.card.dn)}</div>`}
    ${x.card.type === "Unit" || x.isLegend ? `<span class="pw${pw !== base ? " mod" : ""}">${pw}</span>` : ""}${extra}${gear.length ? `<span class="gn" aria-hidden="true">⚙${gear.length}</span>` : ""}</div>`;
  if(!gear.length) return card;
  const open = gearOpen === x.uid;
  return `<div class="bcw${open ? " open" : ""}${x.spent ? " hspent" : ""}" data-w="${x.uid}" style="--gn:${gear.length}">${card}${gear.map((g, i) => `<div class="bc gearc${flashUids.has(g.uid) ? " justnow" : ""}" data-uid="${g.uid}" data-gear-of="${x.uid}" style="--gi:${i + 1}" title="${esc(g.card.dn)} (Gear)">${g.pid ? `<img src="${thumbUrl(g.pid)}" alt="">` : `<div class="n">${esc(g.card.dn)}</div>`}</div>`).join("")}</div>`;
}
function gearCard(el){
  const host = +el.dataset.gearOf;
  for(const P of G.players) for(const u of [...P.field, ...P.legends]){ const g = (u.gear || []).find(x => x.uid === +el.dataset.uid); if(g && u.uid === host){
    openPop(el, [{ label: "Ingrandisci", fn: () => openLens(imgUrl(g.pid)) }, { label: "Scheda carta", fn: () => openCard(g.cid, g.pid) }], `${g.card.dn} · Gear di ${u.card.dn}`); return; } }
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
  const pendingTxt = pm ? "" : G.pending ? (human[G.pending.player] ? `${G.players[G.pending.player].name} deve scegliere…` : gmode === "online" ? `${G.players[G.pending.player].name} sta decidendo…` : "l'IA decide…") : "";
  const payTxt = pm ? `<b style="color:var(--acc2)">Paga ${pm.ctx.cost} €$ (${pm.ctx.paid}/${pm.ctx.cost}): tocca un Eddie o una Leggenda</b>` : "";
  const waitMull = G.phase === "mulligan" && gmode === "online" && G.players[me()].mulliganed;
  const status = G.winner != null ? `Fine: ${esc(G.reason)}` : waitMull ? `Mulligan: in attesa di ${esc(R.name)}` : myTurn ? "Il tuo turno" : human[G.active] || gmode === "online" ? `Turno di ${esc(G.players[G.active].name)}` : "Turno dell'IA…";
  const last = G.log.slice(-1)[0];
  // misura delle carte dall'altezza disponibile: 2 righe rivale + campo + pile + mano (1,15×) + barra e margini
  // altezza utile: senza i margini di sicurezza (su iPhone in orizzontale la barra della home toglie ~20px)
  const cs = getComputedStyle(board), H = board.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  board.style.setProperty("--bh", H + "px");
  if(drag){ drag = null; killGhosts(); }   // un ridisegno durante un trascinamento lo annulla, senza lasciare copie in giro
  // carte grandi quanto lo schermo permette (anche su un monitor da PC), senza superare la larghezza utile;
  // --bz ingrandisce in proporzione scritte, dadi e pile (resta 1 sui telefoni)
  const W = board.clientWidth, cw = Math.max(24, Math.min(150, (H - 110) / (1.4 * 4.15 + 0.6), (W - 320) / 9));
  board.style.setProperty("--cw", cw.toFixed(1) + "px");
  board.style.setProperty("--bz", Math.max(1, Math.min(2.2, cw / 52)).toFixed(3));
  board.innerHTML = `${feed.length ? `<div id="oppFeed" role="status" aria-live="polite">${feed.map(t => `<div>${esc(t)}</div>`).join("")}</div>` : ""}
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
      ${myTurn && human[M.id] && tutorialAllows("end") ? `<button class="btn sm yel" id="bEnd">Fine turno</button>` : ""}
      ${pm ? `${payOpt(o => o.kind === "alleddies") >= 0 ? `<button class="btn sm acc2" id="bPayAll">Tutto con Eddies</button>` : ""}<button class="btn sm" id="bPayCancel">Annulla</button>` : targeting ? `<button class="btn sm" id="bCancel">Annulla</button>` : ""}
      ${gmode === "online" ? `<span id="onlBadge">${onlineBadgeHTML()}</span><button class="btn sm icon" id="bChat" title="Chat del tavolo">💬${ON.T.chatUnread && !chatOpen() ? `<span class="nbadge">${ON.T.chatUnread}</span>` : ""}</button>` : ""}
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
    ${G.winner != null ? `<div class="winbox"><div class="box"><h2>${G.winner === -1 ? "PATTA" : G.winner === me() ? "VITTORIA" : gmode === "hot" ? "VINCE " + esc(G.players[G.winner].name).toUpperCase() : "SCONFITTA"}</h2><p class="wflav">${G.winner === -1 ? "Stavolta la città non è di nessuno." : G.winner === me() || gmode === "hot" ? "Night City ricorderà il tuo nome." : "Flatline. Rialzati, choom."}</p><p>${esc(G.reason)}</p><p style="color:var(--mute)">${G.turn} turni</p>${gmode === "online" ? seriesHTML() : ""}<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">${gmode === "online" ? `<button class="btn" id="bChat2">💬 Chat</button>${series && series.next ? `<button class="btn acc2" id="bNextGame">Partita successiva</button>` : ""}<button class="btn yel" id="bExit">Torna alla lobby</button>` : `<button class="btn yel" id="bAgain">Rivincita</button><button class="btn" id="bExit">Esci</button>`}</div></div></div>` : ""}
    ${gmode === "online" ? drawOfferHTML() : ""}
    ${peekPid ? `<div id="peek">${peekInner(peekPid)}</div>` : ""}
    ${handoff ? `<div class="handoff"><h2>Passa il dispositivo a ${esc(G.players[G.active].name)}</h2><p>Il tuo rivale non guarda, promesso.</p><button class="btn yel" id="bHand">Sono pronto</button></div>` : ""}`;
  fitBoard(board, H);
  const hl = tutorialHighlight(); if(hl) $$("#board " + hl.split(",").join(", #board ")).forEach(x => x.classList.add("tuthl"));
  if(showLog){ const l = $("#simLog"); l.scrollTop = l.scrollHeight; }
  // scelta tra carte: subito la miniatura, poi l'immagine grande appena è scaricata (leggibile anche il testo)
  $$("#simAsk .pk img[data-full], #simAsk .mc img[data-full]").forEach(img => { const full = img.dataset.full, pre = new Image(); pre.onload = () => { if(img.isConnected) img.src = full; }; pre.src = full; });
  if(tutorialActive() && tutorialStep(G, me())) { /* passo completato: la barra si aggiorna al prossimo ridisegno */ setTimeout(() => { if(G) render(); }, 0); }
}

/* richieste del motore (dado, blocco, furto, bersaglio…) */
function askHTML(){
  const p = G.pending, P = G.players[p.player];
  const titles = { die: "Quale dado tiri dal fixer?", block: `${esc(P.name)}: come reagisci?`, steal: "Quale Gig rubi?", target: "Scegli il bersaglio", discard: "Scegli la carta da scartare", gigpick: "Quale Gig?", gigvalue: "Nuovo valore", pickcard: "Scegli la carta", choice: "Scegli un effetto", yesno: "Vuoi farlo?", pay: p.ctx && p.ctx.confirm ? `Per pagare ${p.ctx.cost} €$ serve una Leggenda che ha un effetto quando la spendi (abilità {Spend} o un Gear come Zetatech Faceplate): la spendo?` : `Come paghi? ${p.ctx ? `${p.ctx.paid}/${p.ctx.cost} €$ pagati` : ""}` };
  const ctx = p.kind === "block" && p.ctx.attacker ? `<p style="color:var(--ink2);margin:0 0 8px">${esc(p.ctx.attacker.card.dn)} (${powerIn(G, G.players[G.active], p.ctx.attacker, { attacking: true })}) attacca ${p.ctx.target ? esc(p.ctx.target.card.dn) + " (" + shownPower(p.ctx.target) + ")" : "la tua area Gig"}. Puoi bloccare, chiamare una Leggenda o usare una carta Quick, anche più volte.</p>` : "";
  // in due sullo stesso dispositivo: la decisione del difensore si apre solo dopo un tocco, così l'attaccante non vede le sue carte
  if(gmode === "hot" && p.player !== G.active && reactCover !== p) return `<div id="simAsk"><div class="box"><h3>Reazione di ${esc(P.name)}</h3><p>${esc(G.players[G.active].name)}, passa il dispositivo: le opzioni del rivale compaiono solo dopo il suo tocco.</p><div class="opts"><button class="btn yel" data-react="1">Sono ${esc(P.name)}, mostra le opzioni</button></div></div></div>`;
  if((p.kind === "pickcard" || p.kind === "discard") && p.options.some(o => o.c && o.c.pid)) return pickerHTML(p, P, titles[p.kind]);
  const srcLine = p.ctx && p.ctx.src && p.kind !== "die" && p.kind !== "block" && p.kind !== "steal" ? `<div class="sub" style="margin:-4px 0 8px"><b>${esc(p.ctx.src)}</b>${p.ctx.text ? ` — ${esc(p.ctx.text)}` : ""}</div>` : "";
  return `<div id="simAsk"><div class="box"><h3>${titles[p.kind] || "Scegli"}</h3>${srcLine}${ctx}<div class="opts">${p.options.map((o, i) => {
    const pid = o.unit?.pid || o.c?.pid || o.g?.pid; return `<button class="btn${pid ? " card-opt" : ""}" data-ask="${i}"${o.disabled ? " disabled" : ""}>${pid ? `<img src="${thumbUrl(pid)}" alt="">` : ""}${esc(o.label)}</button>`; }).join("")}</div></div></div>`;
}
/* scelta tra carte (ricerca nel mazzo, trash, recupero, scarto): le carte si vedono grandi, con il testo
   della carta che produce l'effetto e cosa si può fare. Tocca una carta per sceglierla (🔍 o pressione
   lunga per ingrandirla), poi conferma: niente scelte per sbaglio con un tocco solo.               */
let pickSel = null;   // { p: richiesta in corso, i: opzione scelta }
function pickerHTML(p, P, title){
  if(!pickSel || pickSel.p !== p) pickSel = { p, i: null };
  const ctx = p.ctx || {}, srcPrint = ctx.srcPid ? DATA.byPrint.get(ctx.srcPid) : null, srcCard = srcPrint && srcPrint.card;
  const verb = ctx.verb || (p.kind === "discard" ? "Scarta" : "Scegli");
  const info = ctx.info || (p.kind === "discard" ? ["Scegli una carta dalla tua mano."] : []);
  const cards = p.options.map((o, i) => ({ o, i })).filter(x => x.o.c && x.o.c.pid), others = p.options.map((o, i) => ({ o, i })).filter(x => !(x.o.c && x.o.c.pid));
  const chosen = pickSel.i != null ? p.options[pickSel.i] : null;
  return `<div id="simAsk" class="picker"><div class="box">
    <div class="pkhead">${srcPrint ? `<div class="bc pksrc" data-zoom="${srcPrint.id}" title="Ingrandisci"><img src="${thumbUrl(srcPrint.id)}" alt=""></div>` : ""}
      <div class="pkt"><h3>${title || "Scegli la carta"}</h3>${ctx.src ? `<div class="pkfx"><b>${esc(ctx.src)}</b>${srcCard && srcCard.text ? ` — ${esc(srcCard.text)}` : ctx.text ? ` — ${esc(ctx.text)}` : ""}</div>` : ""}
      ${info.length ? `<div class="pkinfo">${info.map(t => `<span>${esc(t)}</span>`).join(" ")}</div>` : ""}</div></div>
    <div class="pkrow">${cards.map(({ o, i }) => `<div class="pk${o.disabled ? " off" : ""}${pickSel.i === i ? " on" : ""}" ${o.disabled ? "" : `data-pick="${i}"`}>
        <img src="${thumbUrl(o.c.pid)}" data-full="${imgUrl(o.c.pid)}" alt="${esc(o.c.card.dn)}" draggable="false"><button class="zm" data-zoom="${o.c.pid}" aria-label="Ingrandisci">🔍</button>
        <span class="nm">${esc(o.c.card.dn)}</span>${o.disabled ? `<span class="why">non prendibile</span>` : ""}</div>`).join("")}</div>
    <div class="opts">${chosen ? `<button class="btn yel" data-ask="${pickSel.i}">${esc(verb)}: ${esc(chosen.c.card.dn)}</button>` : cards.some(x => !x.o.disabled) ? `<span class="pkhint">Tocca una carta per sceglierla</span>` : ""}${others.map(({ o, i }) => `<button class="btn" data-ask="${i}"${o.disabled ? " disabled" : ""}>${esc(o.label)}</button>`).join("")}</div>
  </div></div>`;
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
    const okPlay = tutorialAllows("play", c), okSell = tutorialAllows("sell", c);
    if(c.card.type === "Gear") items.push({ label: `Equipaggia (${cost} €$) → scegli l'Unità`, cls: "acc", disabled: !canPay(P, cost) || !okPlay, fn: () => { targeting = { kind: "gear", uid: c.uid }; sel = c.uid; render(); note("Tocca l'Unità o la Leggenda scoperta da equipaggiare"); } });
    else items.push({ label: `Gioca (${cost} €$)`, cls: "acc", disabled: !canPay(P, cost) || !okPlay, fn: () => after(act(P.id, { t: "play", uid: c.uid })) });
    if(c.card.eddiable) items.push({ label: P.sold ? "Vendi (già venduto in questo turno)" : "Vendi → 1 €$", disabled: P.sold || !okSell, fn: () => after(act(P.id, { t: "sell", uid: c.uid })) });
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
    if(targeting.kind === "gear" && mine){ after(act(M.id, { t: "play", uid: targeting.uid, target: u.uid })); return; }
    if(targeting.kind === "attack" && !mine){ after(act(M.id, { t: "attack", uid: targeting.uid, target: { kind: "unit", uid: u.uid } })); return; }
  }
  if((u.gear || []).length && gearOpen !== u.uid){ gearOpen = u.uid; render(); return; }   // primo tocco: Gear di fianco
  const items = [];
  if(mine && myTurn){
    const can = canAttack(G, M, u) && tutorialAllows("attack");
    const apw = powerIn(G, M, u, { attacking: true });
    items.push({ label: apw < 1 ? "Attacca l'area Gig (potenza 0: non ruba, ma attiva gli effetti)" : `Attacca l'area Gig (${1 + Math.floor(apw / 10)} Gig)`, cls: "acc", disabled: !can || !rival(G, M).gigs.length || u.fx.onlyUnits, fn: () => after(act(M.id, { t: "attack", uid: u.uid, target: { kind: "gigs" } })) });
    items.push({ label: "Attacca un'Unità spesa →", disabled: !can || !rival(G, M).field.some(x => x.spent), fn: () => { targeting = { kind: "attack", uid: u.uid }; sel = u.uid; render(); note("Tocca l'Unità rivale spesa da attaccare"); } });
    if(hasSpend(u)) items.push({ label: "Abilità {Spend}", disabled: u.spent || u.lag || !tutorialAllows("spend"), fn: () => after(act(M.id, { t: "spend", uid: u.uid })) });
  }
  if(MANUAL && human[M.id] && G.winner == null){
    items.push({ label: "— strumenti manuali —", disabled: true, fn: () => {} },
      { label: u.spent ? "Prepara" : "Spendi", fn: () => { manual.toggleSpent(G, owner, u.uid); after(); } },
      { label: "+1 potenza (questo turno)", fn: () => { manual.mod(G, owner, u.uid, 1); after(); } },
      { label: "−1 potenza (questo turno)", fn: () => { manual.mod(G, owner, u.uid, -1); after(); } },
      { label: "Sconfiggi", cls: "danger", fn: () => { manual.defeat(G, owner, u.uid); after(); } });
  }
  items.push({ label: "Ingrandisci", fn: () => openLens(imgUrl(u.pid)) }, { label: "Scheda carta", fn: () => openCard(u.cid, u.pid) });

  openPop(el, items, `${u.card.dn} · potenza ${shownPower(u)}`);
}
function legendCard(el, owner){
  const P = G.players[owner], l = P.legends.find(x => x.uid === +el.dataset.uid); if(!l) return;
  const M = G.players[me()], mine = owner === M.id;
  const myTurn = G.active === M.id && G.phase === "main" && !G.pending && G.winner == null && human[M.id];
  if(targeting && targeting.kind === "gear" && mine && l.faceUp && !l.onField && !l.removed && myTurn){ after(act(M.id, { t: "play", uid: targeting.uid, target: l.uid })); return; }
  if((l.gear || []).length && l.faceUp && gearOpen !== l.uid && !payMode()){ gearOpen = l.uid; render(); return; }
  const items = [], idx = P.legends.indexOf(l);
  if(mine && myTurn && !l.removed && !l.onField){
    if(!l.faceUp) items.push({ label: "Chiama questa Leggenda (1 €$)", cls: "acc", disabled: P.called || !canPay(P, 1) || !tutorialAllows("call"), fn: () => after(act(M.id, { t: "call", idx })) });
    if(l.faceUp && (l.card.kw || []).includes("Go Solo") && l.card.cost != null) items.push({ label: `Go Solo (${l.card.cost} €$): entra come Unità pronta${l.spent ? "" : ", può pagare 1 €$ da sé"}`, disabled: !canPay(P, l.card.cost) || !tutorialAllows("gosolo"), fn: () => after(act(M.id, { t: "gosolo", idx })) });
    if(l.faceUp && l.fx.spend.length) items.push({ label: "Abilità {Spend}", disabled: l.spent || !tutorialAllows("spend"), fn: () => after(act(M.id, { t: "spend", uid: l.uid })) });
    if(MANUAL) items.push({ label: l.spent ? "Prepara (manuale)" : "Spendi come 1 €$ (manuale)", fn: () => { manual.toggleSpent(G, owner, l.uid); after(); } });
    if(MANUAL && !l.faceUp) items.push({ label: "Scopri senza chiamare (manuale)", fn: () => { manual.flip(G, owner, idx); after(); } });
  }
  if(l.faceUp){ items.push({ label: "Ingrandisci", fn: () => openLens(imgUrl(l.pid)) }, { label: "Scheda carta", fn: () => openCard(l.cid, l.pid) }); }
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
    ...(gmode === "online" ? onlineMenuItems() : tutorialActive() ? [{ label: "Abbandona il tutorial", cls: "danger", fn: () => { G.recorded = true; G = null; closeBoard(); toast("Tutorial chiuso: nessuna sconfitta registrata"); } }]
                        : [{ label: "Mi arrendo", cls: "danger", disabled: G.winner != null, fn: () => { manual.concede(G, M.id); after(); } }]),
    { label: gmode === "online" && G.winner == null ? "Esci dalla plancia (la partita resta aperta)" : "Esci dalla plancia", fn: () => closeBoard() }
  ], "Menù");
}

/* ------------------------------------------------------------ eventi */
function wire(){
  const root = $("#simSetup");
  root.addEventListener("click", e => {
    const m = e.target.closest("#simMode button"); if(m && !m.disabled){ mode = m.dataset.v; renderSim(); return; }
    const kb = e.target.closest("#simKind button"); if(kb){ kind = kb.dataset.v; S.settings.simKind = kind; S.save("settings"); renderSim(); return; }
    if(e.target.closest("#simStart")){ start(); return; }
    if(mode === "online"){ lobbyClick(e); }
    if(e.target.closest("#simResume")){ openBoard(); render(); tick(); }
  });
  root.addEventListener("input", e => { if(e.target.id === "onlCode"){ const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4); e.target.value = v; } });
  root.addEventListener("keydown", e => { if(e.target.id === "onlCode" && e.key === "Enter") $("#onlJoin")?.click(); });
  for(const ev of ["ncd:tables", "ncd:table", "ncd:cloud", "ncd:social", "ncd:presence"]) document.addEventListener(ev, () => {
    const setupVisible = $("#p-sim")?.classList.contains("on") && $("#board").hidden;
    if(setupVisible && mode === "online" && !document.activeElement?.matches?.("#onlCode, #onlFriend, #simDeck0")) renderSim();
    if(ev === "ncd:table" && gOnline && G && !$("#board").hidden) render();
  });
  document.addEventListener("ncd:tablechat", () => { if(chatOpen()) refreshTableChat(); else if(gOnline && G && !$("#board").hidden) render(); });
  root.addEventListener("change", e => { if(e.target.id === "simDeck0"){ S.settings[simKind() === "sealed" ? "simSealed" : "simDeck0"] = e.target.value; S.save("settings"); renderSim(); } if(e.target.id === "simDeck1"){ S.settings.simDeck1 = e.target.value; S.save("settings"); } });
  document.addEventListener("ncd:playdeck", e => { const d = S.decks.find(x => x.id === e.detail); if(!d || !isLegal(d)){ toast("Il mazzo non è ancora in regola: completalo nel deckbuilder"); return; } kind = d.format === "sealed" ? "sealed" : "built"; S.settings.simKind = kind; S.settings[kind === "sealed" ? "simSealed" : "simDeck0"] = e.detail; S.save("settings");
    if(kind === "sealed" && !verifySealed(d)){ toast("Questo mazzo non corrisponde a un kit Prerelease aperto nell'app"); renderSim(); return; }
    if(mode === "tutorial") mode = "bot"; renderSim(); if(d.format === "sealed"){ mode = "bot"; start(); } });
  root.addEventListener("click", e => { const z = e.target.closest(".pkg [data-zoom]"); if(z) openLens(imgUrl(z.dataset.zoom)); });
  wirePrerelease(root, id => { location.hash = "#deck"; openDeck(id); toast("Scegli 3 Leggende e almeno 30 carte, poi «Gioca»", 4000); });
  root.addEventListener("click", e => { if(e.target.closest("#simTutorial")){ mode = "bot"; human = [true, false]; startTutorial(); start({ deck0: starterDeck("theheistretailstarterdeck", "Tutorial"), deck1: starterDeck("embracingpowerretailstarterdeck", "IA") }); mode = "tutorial"; } });

  const board = $("#board");
  // pressione lunga: zoom
  let lp = null, lpFired = false;
  board.addEventListener("pointerdown", e => {
    clearTimeout(lp);
    const el = e.target.closest(".bc"); if(!el) return; lpFired = false;
    const pid = pidOf(el); if(!pid) return;
    lp = setTimeout(() => { lpFired = true; if(drag && drag.active) return; peek(pid); }, 420);
  });
  // anteprima: la carta grande ma non a tutto schermo, resta visibile la plancia; sparisce al rilascio.
  // Lo stato è fuori dalla plancia (peekPid): un ridisegno a metà pressione (mossa dell'avversario,
  // segnale del tavolo online) la ricrea invece di cancellarla
  function peek(pid){
    peekPid = pid;
    let el = $("#peek"); if(!el){ el = document.createElement("div"); el.id = "peek"; board.appendChild(el); }
    el.innerHTML = peekInner(pid); el.hidden = false;
  }
  const unpeek = () => { peekPid = null; const el = $("#peek"); if(el) el.remove(); };
  board.addEventListener("pointerup", unpeek); board.addEventListener("pointercancel", unpeek);
  window.addEventListener("pointerup", unpeek); window.addEventListener("pointercancel", unpeek); window.addEventListener("blur", unpeek);
  board.addEventListener("contextmenu", e => e.preventDefault());
  const lpCancel = () => clearTimeout(lp);
  // trascinamento dalla mano: sulla plancia per giocare, su un'Unità/Leggenda per equipaggiare un Gear
  const rotated = () => matchMedia("(orientation: portrait) and (max-width: 760px)").matches;

  const dropTarget = (x, y) => {
    const M = G.players[me()], el = document.elementFromPoint(x, y); if(!el) return null;
    const ed = el.closest(".bz.mine [data-eddies]"); if(ed) return { kind: "sell", el: ed };
    let bc = el.closest(".bc"); if(bc && bc.dataset.gearOf) bc = bc.closest("[data-w]").querySelector(".bc.host") || bc;
    if(bc && bc.closest(`[data-field="${M.id}"]`)) return { kind: "unit", el: bc, uid: +bc.dataset.uid };
    if(bc && bc.dataset.legend && bc.closest(".bz.mine")){ const l = M.legends.find(l => l.uid === +bc.dataset.uid); if(l && l.faceUp && !l.onField && !l.removed) return { kind: "legend", el: bc, uid: l.uid }; if(l && !l.faceUp) return { kind: "facedown", el: null }; }
    const zone = el.closest(".bz.mine"); if(zone && !el.closest("[data-handrow]")) return { kind: "field", el: zone.querySelector(`[data-field="${M.id}"]`) };
    return null;
  };
  board.addEventListener("pointerdown", e => {
    if(drag) return;                                   // un secondo dito non avvia un altro trascinamento
    if(!e.isPrimary || !G || G.winner != null) return;
    const M = G.players[me()]; if(G.active !== M.id || G.phase !== "main" || G.pending || !human[M.id] || oppBusy()) return;
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
    if(d.legendIdx != null){ if((t.kind === "field" || t.kind === "unit") && tutorialAllows("gosolo")) after(act(M.id, { t: "gosolo", idx: d.legendIdx })); return; }
    const c = M.hand.find(x => x.uid === d.uid); if(!c) return;
    if(t.kind === "sell"){ if(!tutorialAllows("sell", c)) { note("Segui il passo del tutorial"); return; } if(c.card.eddiable) after(act(M.id, { t: "sell", uid: c.uid })); else note("Questa carta non ha il simbolo di vendita"); return; }
    if(!tutorialAllows("play", c)){ note("Segui il passo del tutorial"); return; }
    if(c.card.type === "Gear"){ if(t.kind === "unit" || t.kind === "legend") after(act(M.id, { t: "play", uid: c.uid, target: t.uid })); else note(t.kind === "facedown" ? "Un Gear si equipaggia solo a una Leggenda scoperta" : "Trascina il Gear su un'Unità o una Leggenda scoperta"); return; }
    if(t.kind === "field" || t.kind === "unit") after(act(M.id, { t: "play", uid: c.uid }));
  };
  board.addEventListener("pointerup", endDrag); board.addEventListener("pointercancel", endDrag);
  // rilascio fuori dalla plancia o finestra che perde il fuoco: niente copie fantasma in giro
  window.addEventListener("pointerup", e => { if(drag && e.pointerId === drag.id) endDrag(e); else if(!drag) killGhosts(); });
  window.addEventListener("blur", () => { drag = null; killGhosts(); });
  board.addEventListener("pointerup", lpCancel); board.addEventListener("pointercancel", lpCancel);
  let lpStart = null;
  board.addEventListener("pointerdown", e => { lpStart = { x: e.clientX, y: e.clientY }; }, true);
  for(const ev of ["pointerup", "pointercancel"]) window.addEventListener(ev, () => { lpStart = null; clearTimeout(lp); });
  board.addEventListener("pointermove", e => { if(lpStart && Math.hypot(e.clientX - lpStart.x, e.clientY - lpStart.y) > 10){ lpCancel(); unpeek(); } });
  board.addEventListener("click", e => {
    if(lpFired){ lpFired = false; return; }
    if(e.target.closest(".pop")) return;
    const t = e.target;
    // registro aperto: un tocco fuori dal pannello lo chiude
    if(showLog && !t.closest("#simLog")){ showLog = false; render(); return; }
    if(gearOpen != null && !t.closest(`[data-w="${gearOpen}"], .pop`)){ gearOpen = null; render(); if(!t.closest(".bc, [data-ask], button")) return; }
    // online: finché le mosse dell'avversario scorrono una alla volta, si guarda e basta
    if(oppBusy() && !t.closest("#bLog, #bLogClose, #bMenu, #bChat, #bChat2, [data-zoom], .pop")) return;
    if(t.closest("#bEnd")){ const ok = act(me(), { t: "end" }); after(ok); if(ok !== false && gmode === "hot" && G.winner == null){ handoff = true; render(); } return; }
    if(t.closest("#bCancel")){ targeting = null; sel = null; render(); return; }
    if(t.closest("#bLog")){ showLog = !showLog; render(); return; }
    if(t.closest("#bLogClose")){ showLog = false; render(); return; }
    if(t.closest("#bMenu")){ menu(t.closest("#bMenu")); return; }
    if(t.closest("#bChat") || t.closest("#bChat2")){ openTableChat(); return; }
    const dr = t.closest("[data-draw]"); if(dr){ ON.answerDraw(dr.dataset.draw === "1").catch(err => note(err.message)); return; }
    if(t.closest("#bNextGame")){ clearTimeout(seriesT); ON.nextGame().catch(err => note(err.message)); return; }
    if(t.closest("#bAgain")){ $("#board").hidden = true; renderSim(); start(); return; }
    if(t.closest("#bExit")){ closeBoard(); return; }
    if(t.closest("#bHand")){ handoff = false; render(); tick(); return; }
    if(t.closest("[data-react]")){ reactCover = G.pending; render(); return; }
    if(t.closest("#tutNext")){ tutorialStep(G, me(), true); render(); return; }
    if(payMode()){
      const pm = payMode();
      if(t.closest("#bPayCancel")){ res(payOpt(o => o.kind === "cancel")); render(); tick(); return; }
      if(t.closest("#bPayAll")){ res(payOpt(o => o.kind === "alleddies")); render(); tick(); return; }
      const ed = t.closest("[data-eddies]"); if(ed && +ed.dataset.eddies === pm.player){ const i = payOpt(o => o.kind === "eddie"); if(i >= 0){ res(i); render(); tick(); } else note("Nessun Eddie pronto"); return; }
      const lg = t.closest("[data-legend]"); if(lg){ const i = payOpt(o => o.l && o.l.uid === +lg.dataset.uid); if(i >= 0){ res(i); render(); tick(); } else note("Questa Leggenda non può pagare"); return; }
      if(!t.closest(".bstrip, .pop, #simLog")) note("Tocca un Eddie o una Leggenda, oppure Annulla");
      return;
    }
    const mull = t.closest("[data-mull]"); if(mull){ const who = mulliganPending(); doMull(who, mull.dataset.mull === "redo"); if(tutorialActive() && who === 0) ensureHand(G, 0); render(); tick(); return; }
    const zoom = t.closest("[data-zoom]"); if(zoom){ openLens(imgUrl(zoom.dataset.zoom)); return; }
    const pk = t.closest("[data-pick]"); if(pk && G.pending){ pickSel = { p: G.pending, i: +pk.dataset.pick }; render(); return; }
    const ask = t.closest("[data-ask]"); if(ask){ if(G.pending && G.pending.kind === "block" && human[G.pending.player]) G.tutReacted = true; res(+ask.dataset.ask); render(); tick(); return; }
    const gc = t.closest("[data-gear-of]"); if(gc){ gearCard(gc); return; }
    const hand = t.closest("[data-hand=\"1\"]"); if(hand){ handCard(hand, G.players[me()]); return; }
    const leg = t.closest("[data-legend]"); if(leg){ const owner = leg.closest(".bz").classList.contains("mine") ? me() : 1 - me(); legendCard(leg, owner); return; }
    const bc = t.closest(".bc"); if(bc){ const f = bc.closest("[data-field]"); if(f){ fieldCard(bc, +f.dataset.field); return; } }
    const gig = t.closest("[data-gig]"); if(gig && gig.dataset.gig){ gigChip(gig, +gig.closest("[data-owner]").dataset.owner); return; }
    const trash = t.closest("[data-trash]"); if(trash){ const P = G.players[+trash.dataset.trash]; showAsk(`Trash di ${P.name} (${P.trash.length})`, P.trash.slice(-24).map(c => ({ label: c.card.dn, pid: c.pid })), null, [{ label: "Chiudi", fn: () => {} }]); return; }
    closePop();
  });
  // con la chat aperta la tastiera cambia l'altezza dello schermo: la plancia si ridisegna quando si chiude
  window.addEventListener("resize", () => { if(G && !$("#board").hidden && !chatOpen()) render(); });
}
function pidOf(el){
  if(!G) return null; const uid = +el.dataset.uid;
  for(const P of G.players){ const x = [...P.hand, ...P.field, ...P.legends, ...[...P.field, ...P.legends].flatMap(u => u.gear || [])].find(c => c.uid === uid); if(x){ if(P.legends.includes(x) && !x.faceUp) return null; if(P.hand.includes(x) && P.id !== me()) return null; return x.pid; } }
  return null;
}
/* per i collaudi automatici: stessa strada dei tocchi sulla plancia */
window.__ncdSim = { chat: () => openTableChat(), G: () => G, seat: () => me(), clocks: () => clocks(),
  // solo in locale (collaudi): una partita online finta, senza server
  ...(/^(127\.0\.0\.1|localhost)$/.test(location.hostname) ? { fakeOnline: (row, moves) => { ON.T.row = row; ON.T.seat = 0; ON.T.nicks = ["A", "B"]; ON.T.ended = null; ON.T.stamps = moves.map(m => m.at); hooksForTest.start(row, 0, ["A", "B"], moves.map(m => ({ move: m.move, seat: m.seat }))); } } : {}), act: a => { const r = act(me(), a); after(r); return r; }, res: i => { res(i); render(); tick(); } };
/* per la Home: partita da riprendere e scorciatoia alla lobby online */
export const simInProgress = () => G && G.winner == null ? (gOnline ? "online" : "offline") : null;
export function resumeSim(){ if(G && G.winner == null){ openBoard(); render(); tick(); } }
export function showOnline(){ mode = "online"; renderSim(); }
