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
/* in due sullo stesso dispositivo: chi ha in mano il telefono ora, e l'ultima riga del registro che ciascuno ha visto (per il riepilogo) */
let holder = null, seenLog = [null, null];
/* messaggio di un amico durante la partita: un pulsante nella barra della plancia (niente avvisi in mezzo allo schermo) */
let boardChat = null;
document.addEventListener("ncd:boardchat", e => { boardChat = { ...e.detail, n: ((boardChat && boardChat.id === e.detail.id) ? boardChat.n : 0) + 1 }; sfx("sell"); if(G && !$("#board").hidden) render(); });
document.addEventListener("ncd:chatclosed", () => { if(G && !$("#board").hidden) render(); });
let drag = null;   // trascinamento in corso dalla mano
let peekPid = null;   // carta ingrandita con la pressione lunga
const peekInner = pid => `<img src="${imgUrl(pid)}" alt=""><div class="hint">Rilascia per chiudere · «Ingrandisci» nel menù per lo zoom</div>`;
const clearDrop = () => $$("#board .drop").forEach(x => x.classList.remove("drop"));
const killGhosts = () => { $$(".bc.ghost").forEach(g => g.remove()); $$("#board .dragging").forEach(x => x.classList.remove("dragging")); $$("#board .candrop").forEach(x => x.classList.remove("candrop", "sellside")); $$("#board .fxsell").forEach(x => x.remove()); $("#board").classList.remove("fxdrag"); clearDrop(); };
/* all'inizio del trascinamento: evidenzia dove la carta può essere lasciata */
function markDropZones(c){
  const M = G.players[me()];
  if(c.isLegendDrag){ const f = $(`#board [data-field="${M.id}"]`); if(f) f.classList.add("candrop"); return; }
  if(c.card.type === "Gear"){
    $$(`#board [data-field="${M.id}"] .bc`).forEach(x => x.classList.add("candrop"));
    for(const l of M.legends) if(l.faceUp && !l.onField && !l.removed){ const el = $(`#board [data-legend][data-uid="${l.uid}"]`); if(el) el.classList.add("candrop"); }
  } else { const f = $(`#board [data-field="${M.id}"]`); if(f) f.classList.add("candrop"); }
  if(c.card.eddiable && !M.sold){ const e = $(`#board [data-eddies="${M.id}"]`); if(e){ e.classList.add("candrop"); const side = e.closest(".rs.mine"); if(side && !fxOn()) side.classList.add("candrop", "sellside"); } }
  // grafiche avanzate: mano in ombra, campo «Gioca», pila €$ che diventa un'area «Vendi» grande (è lei il bersaglio del rilascio)
  if(fxOn()){
    const board = $("#board"); board.classList.add("fxdrag");
    const e = c.card.eddiable && !M.sold ? board.querySelector(`[data-eddies="${M.id}"]`) : null;
    // l'area «Vendi» prende tutto lo spazio sopra le Leggende (che sono bersagli per i Gear): a colonna, dal nome ai contatori della tua colonna;
    // classica, i contatori della tua fila (Mazzo, €$, Trash) fino alle Leggende
    let box = null;
    if(e && board.classList.contains("rail")){ const side = board.querySelector(".rs.mine"), rv = board.querySelector(".rs.rival"), res = side && side.querySelector(".res"); const rres = rv && rv.querySelector(".res"), a = side && localRect(board, side), top = rres && localRect(board, rres), b = res && localRect(board, res); if(a && b){ const y0 = top ? top.y + top.h + 4 : a.y + 2; /* dalle Leggende del rivale (sopra non ci sono bersagli) alle tue */ box = { x: a.x + 2, y: y0, w: a.w - 4, h: Math.max(56, b.y - y0 - 6) }; } }
    else if(e){ const row = e.parentElement, legs = row && row.querySelector(".legs"), first = row && row.querySelector(".stack"); const a = first && localRect(board, first), b = legs && localRect(board, legs), r0 = localRect(board, e); if(a && b && r0) box = { x: a.x, y: Math.min(a.y, r0.y) - 3, w: Math.max(150, b.x - a.x - 6), h: Math.max(a.h, r0.h) + 6 }; }
    if(box){
      const w = Math.min(box.w, board.clientWidth - 4), h = box.h, x = Math.max(2, Math.min(board.clientWidth - w - 2, box.x)), y = Math.max(2, box.y);
      const z = document.createElement("div"); z.className = "fxsell"; z.dataset.eddies = M.id; z.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
      z.innerHTML = `<b>Vendi</b><span class="hex">+1</span><small>per 1 €$ · una volta a turno</small>`; board.appendChild(z);
    }
  }
}
/* avviso dentro la plancia (il toast globale non segue la rotazione) */
function note(msg){ noteMsg = msg; clearTimeout(noteT); noteT = setTimeout(() => { noteMsg = ""; const n = $("#noteMsg"); if(n) n.remove(); }, 2600); render(); }
const names = () => [S.profile.nick || "Tu", gmode === "bot" ? "IA" : "Giocatore 2"];

/* tutte le mosse passano da qui: in una partita online vengono anche inviate all'avversario */
const online = () => gOnline && ON.T.row;
function act(pi, a){ markMove("mine"); const m = moveOf(a); const r = doAction(G, pi, m); if(online()){ ON.send({ k: "a", p: pi, a: m }); clockMark(); } return r; }
function res(i){ markMove("mine"); const r = resolve(G, i); if(online()){ ON.send({ k: "r", i: i == null ? -1 : i }); clockMark(); } return r; }
function doMull(pi, d){ if(G.players[pi].mulliganed) return; markMove("mine"); mulligan(G, pi, d); if(online()){ ON.send({ k: "m", p: pi, d: d ? 1 : 0 }); clockMark(); } }

/* ------------------------------------------------------------ animazioni delle carte
   La plancia si ridisegna da zero a ogni mossa; prima del ridisegno si annota dov'era ogni carta e dopo
   ogni carta parte dalla vecchia posizione e scivola nella nuova (una carta spesa ruota, una Leggenda
   chiamata si gira). Le carte sparite diventano una copia che vola dove sono finite: venduta → pila
   €$ e poi si gira; sconfitta o scartata → Trash. Le carte nuove arrivano dal mazzo (o dalla mano
   dell'avversario). Durata: Impostazioni → Simulator, separata per le tue mosse e per quelle avversarie;
   «Istantanea» o «Animazioni ridotte» = nessun movimento.                                              */
let animWho = null;   // chi ha fatto l'ultima mossa: "mine" | "opp" | null (ridisegno senza animazione)
let animBase = null;  // pile prima della mossa (Eddies e Trash): ciò che cresce va animato anche se la carta non era visibile (vendite e Programmi dell'avversario)
function markMove(who){ animWho = who; animBase = G ? { eddies: G.players.map(P => P.eddies.length), trash: G.players.map(P => P.trash.length), hand: new Map(G.players[me()].hand.map(c => [c.uid, c])) } : null; }   // anche la mano prima della mossa: un Programma in attesa di una scelta non è più da nessuna parte
/* la plancia si ridisegna anche a metà animazione (tick, selezioni): le copie volanti vivono in uno strato
   che sopravvive al ridisegno, e le animazioni delle carte si riapplicano all'elemento nuovo dal punto in cui erano */
const flyLayer = document.createElement("div"); flyLayer.id = "flyLayer";
const liveAnims = new Map();   // uid → { kf, opts, at }
function animEl(el, kf, opts){ const uid = +el.dataset.uid; el.animate(kf, opts); if(uid) liveAnims.set(uid, { kf, opts, at: performance.now() }); }
function reapplyAnims(board, fresh){
  const now = performance.now();
  for(const [uid, a] of liveAnims){
    const gone = now - a.at >= a.opts.duration + (a.opts.delay || 0); if(gone){ liveAnims.delete(uid); continue; }
    if(fresh.has(uid)) continue;
    const el = board.querySelector(`[data-uid="${uid}"]`); if(!el) continue;
    const an = el.animate(a.kf, a.opts); an.currentTime = now - a.at;
  }
}
const ANIM_MS = { instant: 0, fast: 220, normal: 380, slow: 650 };
const animMs = () => { if(!animWho || document.documentElement.dataset.motion === "reduce") return 0; const k = animWho === "mine" ? (ANIM_MS[S.settings.animMine] != null ? S.settings.animMine : "normal") : oppSpeed(); return ANIM_MS[k] || 0; };
function localRect(board, el){
  let x = 0, y = 0, n = el;
  while(n && n !== board){ x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; if(!n || n === document.body) return null; }
  for(let a = el.parentElement; a && a !== board; a = a.parentElement){ x -= a.scrollLeft; y -= a.scrollTop; }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight, cx: x + el.offsetWidth / 2, cy: y + el.offsetHeight / 2 };
}
function snapBoard(board){
  if(!G || board.hidden || !animMs()) return null;
  const m = new Map();
  for(const el of board.querySelectorAll("[data-uid]")){ const r = localRect(board, el); if(!r) continue; const img = el.querySelector(":scope > img"); m.set(+el.dataset.uid, { ...r, src: img ? img.getAttribute("src") : "", spent: el.classList.contains("spent"), back: el.classList.contains("back"), leg: !!el.dataset.legend, gear: !!el.dataset.gearOf, hand: !!el.dataset.hand, t: getComputedStyle(el).transform }); }
  const g = new Map();
  for(const el of board.querySelectorAll(".die[data-gig]")){ const uid = +el.dataset.gig; if(!uid) continue; const r = localRect(board, el); const o = el.closest("[data-owner]"); if(r) g.set(uid, { ...r, owner: o ? +o.dataset.owner : null }); }
  return { m, g, hand: (animBase || {}).hand || new Map(G.players[me()].hand.map(c => [c.uid, c])), eddies: (animBase || {}).eddies || G.players.map(P => P.eddies.length), trash: (animBase || {}).trash || G.players.map(P => P.trash.length) };
}
/* tiro di un dado: disturbo con parametri casuali e cifre che scorrono, poi il lampo; il d20 fa girare le facce
   e apre un anello. Lo stato sta in liveDice, così un ridisegno a metà tiro lo ritrova sull'elemento nuovo. */
const liveDice = new Map();   // uid → { until, sides, final, vars }
function rollDie(el, sides, finalValue, ms){
  const uid = +el.dataset.gig, dur = Math.max(320, ms * (sides === 20 ? 1.6 : 1.1));
  const vars = { "--gx1": (Math.random() * 6 - 3).toFixed(1) + "px", "--gx2": (Math.random() * 6 - 3).toFixed(1) + "px", "--gs1": (Math.random() * 16 - 8).toFixed(1) + "deg", "--gs2": (Math.random() * 16 - 8).toFixed(1) + "deg", "--gy": Math.round(20 + Math.random() * 55) + "%" };
  liveDice.set(uid, { until: performance.now() + dur, sides, final: finalValue, vars, next: 0 });
  sfx("roll"); sfx("land", dur);
  applyDice(el.closest("#board") || $("#board"));
}
function applyDice(board){
  const now = performance.now();
  for(const el of board.querySelectorAll('.die[data-gig][style*="hidden"]')) if(!liveDice.has(+el.dataset.gig)) el.style.visibility = "";   // rete di sicurezza: nessun dado resta nascosto senza un effetto in corso
  for(const [uid, d] of liveDice){
    const el = board.querySelector(`.die[data-gig="${uid}"]`); if(!el){ if(now > d.until + 1000) liveDice.delete(uid); continue; }
    if(d.big){ if(now < d.until) el.style.visibility = "hidden"; else { el.style.visibility = ""; el.classList.add("landed"); setTimeout(() => el.classList.remove("landed"), 900); liveDice.delete(uid); } continue; }
    if(now < d.until){
      if(!el.classList.contains("rolling")){ el.classList.add("rolling"); for(const [k, v] of Object.entries(d.vars)) el.style.setProperty(k, v); }
      if(!d.timer) d.timer = setInterval(() => {
        const e = board.querySelector(`.die[data-gig="${uid}"]`), t = performance.now();
        if(!e || t >= d.until){ clearInterval(d.timer); d.timer = null; if(e){ e.classList.remove("rolling"); e.querySelector("b").textContent = d.final; e.classList.add("landed"); setTimeout(() => e.classList.remove("landed"), 900); } liveDice.delete(uid); return; }
        if(t >= d.next){ d.next = t + 40 + Math.random() * 50; e.querySelector("b").textContent = 1 + Math.floor(Math.random() * d.sides); for(const k of Object.keys(d.vars)){ d.vars[k] = k === "--gy" ? Math.round(15 + Math.random() * 65) + "%" : k.startsWith("--gs") ? (Math.random() * 18 - 9).toFixed(1) + "deg" : (Math.random() * 7 - 3.5).toFixed(1) + "px"; e.style.setProperty(k, d.vars[k]); } }
      }, 30);
    }
  }
}
function animateBoard(board, prev){
  board.appendChild(flyLayer);
  const ms = animMs(), who = animWho; animWho = null; const fresh = new Set();
  applyDice(board);
  if(!ms || !prev || !G){ fxLastLog = G ? (G.log[G.log.length - 1] || null) : null; reapplyAnims(board, fresh); return; }
  const ease = "cubic-bezier(.2,.7,.2,1)", seen = new Set();
  // grafiche avanzate: le carte dell'avversario passano dalla vetrina al centro, i Gig girano al centro
  const fx = fxOn(), fxOpp = fx && who === "opp", R = G.players[1 - me()], oppName = R.name;
  const findInst = (P, uid) => { for(const u of [...P.field, ...P.legends]){ if(u.uid === uid) return u; for(const g of u.gear || []) if(g.uid === uid) return g; } return null; };
  const typeTag = c => c.card.type === "Unit" ? `Unità · ${c.card.cost ?? 0} €$` : c.card.type;
  const anchor = (kind, pid) => { const el = board.querySelector(`[data-${kind}="${pid}"]`); return el ? localRect(board, el) : null; };
  const srcOf = (kind, pid) => anchor(kind, pid) || anchor("deck", pid);
  const tf = t => t && t !== "none" ? t : "";
  // attacchi dichiarati dall'ultimo ridisegno: lo scontro si disegna per ultimo (dopo vetrine e dadi degli effetti
  // innescati), e le carte sconfitte partono per il Trash solo a scontro finito
  const shots = [], hitUids = new Set(), deferredFly = [], deferredSteal = [];   // il Gig rubato parte dopo lo scontro
  if(fx){
    const i = fxLastLog ? G.log.lastIndexOf(fxLastLog) : -1, freshLog = i >= 0 ? G.log.slice(i + 1) : (fxLastLog ? G.log.slice(-6) : []);
    // con una decisione in sospeso (quale Gig rubare, come bloccare: tua, del bot o dell'avversario online) lo scontro aspetta:
    // la finestra lo coprirebbe, e un Blocker può ancora deviarlo
    // …ma se lo scontro è già risolto (riga «fight» o «steal» dopo l'attacco: la decisione in sospeso è un effetto successivo,
    // es. River Ward a Unità sconfitta) si disegna subito, altrimenti le carte sconfitte sarebbero già sparite
    const resolved = e => { if(G.pending && G.pending.kind === "steal") return false; const i = G.log.indexOf(e); return i >= 0 && G.log.slice(i + 1).some(x => x.kind === "fight" || x.kind === "steal"); };   // con due Gig da rubare si scelgono entrambi, poi lo scontro
    const humanWait = !!G.pending;
    const list = humanWait ? fxHeld.filter(resolved) : fxHeld.splice(0); if(humanWait) fxHeld = fxHeld.filter(e => !resolved(e));
    for(const e of freshLog){ if(e.kind !== "attack" || !e.d) continue; (humanWait && !resolved(e) ? fxHeld : list).push(e); }
    for(const e of list){
      if(e.d.block != null){ const prevShot = shots.find(x => x.a === e.d.a && !x.done); if(prevShot){ prevShot.t = e.d.block; prevShot.pd = e.d.pb; } continue; }   // un Blocker devia lo scontro su di sé
      shots.push({ a: e.d.a, t: e.d.t, pa: e.d.pa, pd: e.d.pd, who: e.d.who });
    }
    for(const x of shots){ hitUids.add(x.a); if(x.t != null) hitUids.add(x.t); }
  }
  // le altre carte della fila di una Unità sconfitta non si stringono finché lo scontro non è finito e la carta non è partita
  const onBoardUid = uid => !!board.querySelector(`.bz [data-uid="${uid}"]`);
  const hitRows = new Set(); for(const x of shots){ if(!onBoardUid(x.a)) hitRows.add(x.who); if(x.t != null && !onBoardUid(x.t)) hitRows.add(1 - x.who); }
  const deferredFlip = [];
  const fireShots = () => {
    const hitDelay = new Map();
    for(const x of shots){
      const aEl = board.querySelector(`.bz [data-uid="${x.a}"]`), aR = aEl ? localRect(board, aEl) : prev.m.get(x.a); if(!aR) continue;
      const tEl = x.t != null ? board.querySelector(`.bz [data-uid="${x.t}"]`) : null, tR = x.t != null ? (tEl ? localRect(board, tEl) : prev.m.get(x.t)) : anchor("owner", 1 - x.who) || anchor("eddies", 1 - x.who);
      if(!tR) continue;
      const at = fxShot(board, aR, tR, x.pa, x.pd, ms, tEl, aEl); hitDelay.set(x.a, at); if(x.t != null) hitDelay.set(x.t, at);
    }
    for(const f of deferredFly) fly(f.from, f.to, f.src, f.kind, hitDelay.get(f.uid) || 0);
    const rowDelay = new Map(); for(const f of deferredFly){ const owner = f.owner; if(owner == null) continue; rowDelay.set(owner, Math.max(rowDelay.get(owner) || 0, (hitDelay.get(f.uid) || 0) + ms * 1.1)); }
    for(const d of deferredFlip) animEl(d.el, d.kf, { duration: ms, easing: ease, delay: rowDelay.get(d.pid) || Math.max(0, ...rowDelay.values(), 0), fill: "backwards" });
    if(shots.length) for(const h of fxHeldSteals.splice(0)){ const e2 = board.querySelector(`.die[data-gig="${h.uid}"]`); if(e2){ const now2 = localRect(board, e2); if(now2) fxSteal(board, e2, h.was, now2, h.gig, h.who, ms); } else liveDice.delete(h.uid); }   // prima il Gig rubato per primo
    for(const run of deferredSteal) run();
  };
  fxLastLog = G.log[G.log.length - 1] || null;
  for(const el of board.querySelectorAll("[data-uid]")){
    const uid = +el.dataset.uid; seen.add(uid); const now = localRect(board, el); if(!now) continue;
    const was = prev.m.get(uid), endT = tf(getComputedStyle(el).transform) || "none";
    const owner = el.closest("[data-field], [data-handrow], [data-side], .bz"); let pid = null;
    if(owner){ pid = owner.dataset.field ?? owner.dataset.handrow ?? owner.dataset.side; if(pid == null) pid = owner.classList.contains("mine") ? me() : 1 - me(); }
    const gearHost = fx && el.dataset.gearOf ? board.querySelector(`.bz .bc[data-uid="${el.dataset.gearOf}"]`) : null;
    const gearBadge = (c, delay) => { if(!gearHost || pid == null) return; const host = findInst(G.players[+pid], +el.dataset.gearOf); const plus = c.card.power ?? 0; if(host && plus) fxPower(board, gearHost, shownPower(host) - plus, plus, delay, ms); };
    if(was){
      if(was.hand && !el.dataset.hand && !gearHost) sfx("play");   // carta giocata dalla mano (la tua: l'avversario passa dalla vetrina)
      if(gearHost && !was.gear && pid != null){ const c = findInst(G.players[+pid], uid); if(c) gearBadge(c, ms); }   // Gear appena equipaggiato dalla mano: somma della potenza
      if(fx && was.leg && !el.dataset.legend && el.closest("[data-field]")){ fresh.add(uid); fxSlam(board, el, ms); continue; }   // Go Solo: la Leggenda piomba in campo
      if(fx && was.back && !el.classList.contains("back") && el.dataset.legend){   // Leggenda scoperta: scansione d'identità al centro, poi nello slot
        const owner = G.players[+el.dataset.lo], c = owner && findInst(owner, uid);
        if(c && c.pid){ fresh.add(uid); fxLegend(board, { src: thumbUrl(c.pid), name: c.card.dn, label: `${owner.id === me() ? "Chiami" : owner.name + " chiama"} una Leggenda`, to: now, hideEl: el }, ms); continue; } }
      if(was.back !== el.classList.contains("back")){ if(was.back && el.dataset.legend) sfx("call"); fresh.add(uid); animEl(el, [{ transform: `${tf(endT)} rotateY(90deg)` }, { transform: `${tf(endT)} rotateY(0deg)` }], { duration: ms, easing: ease }); continue; }
      const dx = was.cx - now.cx, dy = was.cy - now.cy, sx = was.w / now.w, sy = was.h / now.h;
      if(Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < .02 && was.spent === el.classList.contains("spent")) continue;
      fresh.add(uid);
      const rowOwner = el.closest("[data-field]"); const kfMove = [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy}) ${tf(was.t)}` }, { transform: endT }];
      if(rowOwner && hitRows.has(+rowOwner.dataset.field)) deferredFlip.push({ el, kf: kfMove, pid: +rowOwner.dataset.field });
      else animEl(el, kfMove, { duration: ms, easing: ease });
      continue;
    }
    // carta nuova: arriva dal mazzo (mia) o dalla mano/mazzo dell'avversario
    if(pid == null || el.dataset.legend) continue;
    if(fxOpp && +pid !== me()){
      const c = findInst(R, uid); if(!c) continue; const isGear = !!el.dataset.gearOf;
      fresh.add(uid); const tot = fxShowcase(board, { src: c.pid ? thumbUrl(c.pid) : "", label: `${oppName} ${isGear ? "equipaggia" : "gioca"}`, tag: typeTag(c), name: c.card.dn, to: now, hideEl: el }, ms); if(isGear) gearBadge(c, tot); continue; }
    if(gearHost && +pid === me()){ const c = findInst(G.players[+pid], uid); if(c) gearBadge(c, ms); }
    const from = +pid === me() ? anchor("deck", pid) : srcOf("handc", pid); if(!from) continue;
    fresh.add(uid); animEl(el, [{ transform: `translate(${from.cx - now.cx}px, ${from.cy - now.cy}px) scale(${Math.min(1, from.w / now.w)})`, opacity: .2 }, { transform: endT, opacity: 1 }], { duration: ms, easing: ease });
  }
  reapplyAnims(board, fresh);
  // dadi: un Gig nuovo è appena stato tirato; uno che cambia fila è stato rubato
  for(const el of board.querySelectorAll(".die[data-gig]")){
    const uid = +el.dataset.gig; if(!uid) continue; const now = localRect(board, el); if(!now) continue;
    const was = prev.g.get(uid);
    if(!was){ const owner = G.players.find(P => P.gigs.some(x => x.uid === uid)), gig = owner && owner.gigs.find(x => x.uid === uid); if(gig){ if(fx) fxRoll(board, el, gig, owner.id === me() ? "Tu" : owner.name, ms); else rollDie(el, gig.sides, gig.value, ms); } continue; }
    const dx = was.cx - now.cx, dy = was.cy - now.cy; if(Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    const ownerNow = el.closest("[data-owner]"), changed = ownerNow && prev.g.get(uid) && was.owner != null && +ownerNow.dataset.owner !== was.owner;
    if(fx && changed){ const P = G.players[+ownerNow.dataset.owner], gig = P && P.gigs.find(x => x.uid === uid); if(gig){
      const run = () => fxSteal(board, el, was, now, gig, P.id === me() ? `Rubato a ${R.name}` : `${P.name} ti ruba un Gig`, ms);
      if(shots.length){ el.style.visibility = "hidden"; liveDice.set(uid, { until: performance.now() + 15000, big: true }); deferredSteal.push(run); }
      else if(fxHeld.length){ el.style.visibility = "hidden"; liveDice.set(uid, { until: performance.now() + 15000, big: true }); fxHeldSteals.push({ uid, was, now, gig, who: P.id === me() ? `Rubato a ${R.name}` : `${P.name} ti ruba un Gig` }); }   // lo scontro è rimandato (altra scelta in corso): il dado parte con lui
      else run(); continue; } }
    el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(1.3)`, filter: "drop-shadow(0 0 10px var(--c))" }, { transform: "none" }], { duration: ms * 1.4, easing: ease });
  }
  // copie volanti
  const main = board.querySelector(".bmain") || board, mainR = localRect(board, main) || { cx: board.clientWidth / 2, cy: board.clientHeight / 2 };
  const fly = (from, to, src, kind, delay = 0) => {
    if(!from || !to) return;
    const g = document.createElement("div"); g.className = "bc fly"; g.style.cssText = `left:${from.x}px;top:${from.y}px;width:${from.w}px;height:${from.h}px`;
    if(src) g.innerHTML = `<img src="${src}" alt="">`; flyLayer.appendChild(g);
    const dx = to.cx - from.cx, dy = to.cy - from.cy, sc = Math.min(1, to.w / from.w, to.h / from.h);
    let kf, dur = ms * 1.1;
    if(kind === "sell"){ kf = [{ transform: "none", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${sc}) rotateY(0deg)`, opacity: 1, offset: .62 }, { transform: `translate(${dx}px, ${dy}px) scale(${sc}) rotateY(90deg)`, opacity: .9 }]; dur = ms * 1.6; }
    else if(kind === "program"){   // si mostra al centro della plancia, poi va nel Trash
      const cx = mainR.cx - from.cx, cy = mainR.cy - from.cy, big = Math.max(1.4, Math.min(2.2, (parseFloat(getComputedStyle(board).getPropertyValue("--cw")) * 2.2) / from.w));
      kf = [{ transform: "none", opacity: 1, easing: ease }, { transform: `translate(${cx}px, ${cy}px) scale(${big})`, opacity: 1, offset: .3, easing: "linear" }, { transform: `translate(${cx}px, ${cy}px) scale(${big})`, opacity: 1, offset: .72, easing: ease }, { transform: `translate(${dx}px, ${dy}px) scale(${sc * .8}) rotate(12deg)`, opacity: 0 }]; dur = ms * 3.2; }
    else if(kind === "trash") kf = [{ transform: "none", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${sc * .8}) rotate(12deg)`, opacity: 0 }];
    else kf = [{ transform: "none", opacity: 1 }, { transform: "scale(.6)", opacity: 0 }];
    const a = g.animate(kf, { duration: dur, delay, easing: kind === "program" ? "linear" : ease, fill: "forwards" }); a.onfinish = () => g.remove(); setTimeout(() => g.remove(), delay + dur + 200);
  };
  const grown = G.players.map((P, i) => ({ e: P.eddies.slice(prev.eddies[i]), t: P.trash.slice(prev.trash[i]) }));
  for(const [uid, was] of prev.m){
    if(seen.has(uid) || was.back) continue;
    const ePl = G.players.find(P => P.eddies.some(e => e.uid === uid)), tPl = G.players.find(P => P.trash.some(c => c.uid === uid));
    if(ePl){ fly(was, anchor("eddies", ePl.id), was.src, "sell"); if(was.hand) sfx("sell"); grown[ePl.id].e = grown[ePl.id].e.filter(e => e.uid !== uid); }
    else if(tPl){ const c = tPl.trash.find(c => c.uid === uid), prog = c && c.card && c.card.type === "Program";
      if(fx && prog && who === "mine" && tPl.id === me()) fxShowcase(board, { src: was.src, label: "Lanci un Programma", tag: "Programma", name: c.card.dn, bar: true, who: "mine", to: anchor("trash", tPl.id) }, ms);
      else if(hitUids.has(uid)) deferredFly.push({ uid, owner: tPl.id, from: was, to: anchor("trash", tPl.id), src: was.src, kind: prog ? "program" : "trash" });
      else fly(was, anchor("trash", tPl.id), was.src, prog ? "program" : "trash");
      grown[tPl.id].t = grown[tPl.id].t.filter(c => c.uid !== uid); }
    else if(fx && who === "mine" && was.hand && prev.hand.get(uid) && prev.hand.get(uid).card.type === "Program") fxShowcase(board, { src: was.src, label: "Lanci un Programma", tag: "Programma", name: prev.hand.get(uid).card.dn, bar: true, who: "mine", to: anchor("trash", me()) }, ms);   // Programma in attesa di una scelta: finirà nel Trash
    else fly(was, was, was.src, "fade");
  }
  // vendite e scarti dell'avversario (la sua mano non si vede): dalla mano alla pila
  for(const P of G.players){
    if(P.id === me()) continue;
    for(const e of grown[P.id].e){ if(fxOpp) fxShowcase(board, { src: e.pid ? thumbUrl(e.pid) : "", label: `${oppName} vende`, tag: "+1 €$", cls: "yel", to: anchor("eddies", P.id) }, ms); else fly(srcOf("handc", P.id), anchor("eddies", P.id), e.pid ? thumbUrl(e.pid) : "", "sell"); }
    for(const c of grown[P.id].t){
      const ty = c.card ? c.card.type : "";
      if(fxOpp) fxShowcase(board, { src: c.pid ? thumbUrl(c.pid) : "", label: `${oppName} ${ty === "Program" ? "lancia" : ty === "Quick" ? "gioca" : "scarta"}`, tag: ty || "", name: c.card ? c.card.dn : "", bar: ty === "Program", to: anchor("trash", P.id) }, ms);
      else fly(srcOf("handc", P.id), anchor("trash", P.id), c.pid ? thumbUrl(c.pid) : "", ty === "Program" ? "program" : "trash"); }
  }
  fireShots();
}

/* ------------------------------------------------------------ grafiche avanzate (beta)
   Impostazioni → Simulator → Grafiche avanzate. Effetti in più, tutti nello strato flyLayer (che
   sopravvive ai ridisegni): la vetrina al centro per le carte dell'avversario, il Gig che gira al
   centro dentro un anello, la fascia di cambio turno e le zone di rilascio accese durante il
   trascinamento. Spenti con «Animazioni ridotte»; la durata segue i ritmi (tuo e dell'avversario). */
/* suoni sintetizzati (WebAudio, nessun file): Impostazioni → Simulator → Suoni. L'AudioContext nasce al primo tocco. */
let actx = null, noiseBuf = null;
const sfxOn = () => !!S.settings.sfx;
function ensureAudio(){ if(actx || !sfxOn()) return; try{ actx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ actx = null; } }
window.addEventListener("pointerdown", () => { ensureAudio(); if(actx && actx.state === "suspended") actx.resume().catch(() => {}); }, { passive: true });
function sfx(kind, delay = 0){
  if(!sfxOn()) return; ensureAudio(); if(!actx || actx.state !== "running") return;
  const t0 = actx.currentTime + Math.max(0, delay) / 1000, out = actx.createGain(); out.gain.value = .12; out.connect(actx.destination);
  const tone = (type, f0, f1, t, dur, g = 1) => { const o = actx.createOscillator(), v = actx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); if(f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur); v.gain.setValueAtTime(g, t); v.gain.exponentialRampToValueAtTime(.001, t + dur); o.connect(v); v.connect(out); o.start(t); o.stop(t + dur + .02); };
  const noise = (t, dur, fc, q = 1, g = 1) => { if(!noiseBuf){ noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate); const d = noiseBuf.getChannelData(0); for(let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } const n = actx.createBufferSource(); n.buffer = noiseBuf; const f = actx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = fc; f.Q.value = q; const v = actx.createGain(); v.gain.setValueAtTime(g, t); v.gain.exponentialRampToValueAtTime(.001, t + dur); n.connect(f); f.connect(v); v.connect(out); n.start(t); n.stop(t + dur + .02); };
  switch(kind){
    case "play": noise(t0, .18, 700, .8, .7); tone("sine", 320, 180, t0, .18, .3); break;                       // carta che si posa
    case "sell": tone("sine", 880, 880, t0, .07, .6); tone("sine", 1320, 1320, t0 + .07, .12, .6); break;      // moneta
    case "roll": for(let i = 0; i < 7; i++) tone("square", 180 + Math.random() * 120, 120, t0 + i * .05, .03, .25); noise(t0, .35, 2500, .6, .25); break;
    case "land": tone("sine", 660, 660, t0, .12, .6); tone("sine", 990, 990, t0 + .03, .18, .3); break;
    case "shot": noise(t0, .11, 900, .5, 1); tone("sine", 140, 50, t0, .14, .9); break;
    case "hit": tone("sine", 90, 40, t0, .22, 1); noise(t0, .06, 300, .7, .6); break;
    case "pew": tone("square", 900, 280, t0, .13, .35); break;
    case "steal": tone("sine", 300, 900, t0, .26, .5); tone("triangle", 450, 1350, t0 + .02, .24, .25); break;
    case "turn": tone("sine", 523, 523, t0, .09, .5); tone("sine", 784, 784, t0 + .1, .16, .5); break;
    case "equip": tone("triangle", 400, 800, t0, .1, .4); tone("sine", 1200, 1200, t0 + .1, .08, .3); break;
    case "launch": noise(t0, .25, 600, .6, .8); tone("sawtooth", 220, 90, t0, .25, .35); break;      // partenza del missile
    case "boom": tone("sine", 60, 25, t0, .5, 1); noise(t0, .35, 300, .4, 1); noise(t0 + .05, .4, 1500, .3, .4); break;   // esplosione
    case "slam": tone("sine", 70, 30, t0, .35, 1); noise(t0, .18, 400, .5, .9); noise(t0 + .05, .3, 2200, .3, .3); break;   // Go Solo: tonfo e crepe
    case "call": noise(t0, .3, 1800, .4, .35); tone("sine", 392, 392, t0, .14, .45); tone("sine", 523, 523, t0 + .12, .14, .45); tone("sine", 784, 784, t0 + .24, .3, .5); break;   // Leggenda scoperta: accordo che sale
  }
}
const fxOn = () => !!S.settings.fx && document.documentElement.dataset.motion !== "reduce";
const fxCenter = board => { const main = board.querySelector(".bmain") || board; return localRect(board, main) || { x: 0, y: 0, w: board.clientWidth, h: board.clientHeight, cx: board.clientWidth / 2, cy: board.clientHeight / 2 }; };
const fxEase = "cubic-bezier(.2,.7,.2,1)";
/* gli effetti al centro si mettono in fila: ognuno parte quando il precedente è uscito (fascia, dado,
   vetrina), così nessuno copre l'altro; se la fila si allunga troppo (più di 3 s) si sovrappongono */
let fxBusyUntil = 0, fxAskUntil = 0, fxLastLog = null, fxHeld = [], fxHeldSteals = [];   // fxLastLog: ultima riga del registro già vista (per gli attacchi); fxHeld: colpi rimandati
function fxSlot(dur){ const now = performance.now(), start = Math.min(Math.max(now, fxBusyUntil), now + 3000); fxBusyUntil = start + dur; return start - now; }
/* carta in vetrina: entra al centro, resta, poi scivola dove è finita (to). L'elemento vero (hideEl)
   resta invisibile finché la copia non arriva, così il ridisegno non la mostra in anticipo. */
function fxShowcase(board, o, ms){
  const main = fxCenter(board), cw = parseFloat(getComputedStyle(board).getPropertyValue("--cw")) || 50;
  const w = Math.max(60, Math.min(cw * 2.4, main.h * .58 / 1.4)), h = w * 1.4;
  const g = document.createElement("div"); g.className = "fxshow" + (o.cls ? " " + o.cls : "");
  g.style.cssText = `left:${main.cx - w / 2}px;top:${main.cy - h / 2}px;width:${w}px;height:${h}px`;
  g.innerHTML = `<div class="kick">${esc(o.label)}</div><div class="crd">${o.src ? `<img src="${o.src}" alt="">` : `<div class="n">${esc(o.name || "")}</div>`}</div>${o.tag ? `<span class="tag">${esc(o.tag)}</span>` : ""}${o.bar ? `<div class="ldr"><div class="l1"><span>▶ esecuzione</span><span class="pc">0%</span></div><div class="bar"><i></i></div><div class="l2">&gt; run <b>${esc((o.name || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_"))}</b></div></div>` : o.name ? `<div class="nm">${esc(o.name)}</div>` : ""}`;
  flyLayer.appendChild(g);
  // un Programma resta di più: la barra si riempie nei primi 4/5 della sosta, poi «100 %» fermo, e solo dopo la carta va nel Trash
  const enter = ms * .8, exit = ms * 1.2, hold = o.bar ? Math.max(1400, ms * 4.5) : Math.max(300, Math.min(Math.max(ms * 2.2, 500), (o.who === "mine" ? 1e9 : oppDelay(gOnline)) - enter - exit)), delay = fxSlot(enter + hold + exit), total = delay + enter + hold + exit;
  if(o.bar){ const fill = g.querySelector(".bar i"), pc = g.querySelector(".pc"), span = enter + hold + exit, load = hold * .8; fill.animate([{ width: "0%" }, { width: "0%", offset: enter / span }, { width: "100%", offset: (enter + load) / span }, { width: "100%" }], { duration: span, delay, fill: "both" }); const t0 = performance.now() + delay + enter; const iv = setInterval(() => { const k = Math.max(0, Math.min(1, (performance.now() - t0) / load)); pc.textContent = k >= 1 ? "100% ✓" : Math.round(k * 100) + "%"; if(k >= 1) clearInterval(iv); }, 50); setTimeout(() => clearInterval(iv), total + 100); }
  const to = o.to, dx = to ? to.cx - main.cx : 0, dy = to ? to.cy - main.cy : 0, sc = to ? Math.min(1, to.w / w, to.h / h) : .6;
  // l'andamento va dato tratto per tratto: un unico easing sull'intera animazione comprimerebbe la sosta e anticiperebbe l'uscita
  const kf = [
    { transform: "scale(.5)", opacity: 0, easing: fxEase },
    { transform: "scale(1)", opacity: 1, offset: enter / (enter + hold + exit), easing: "linear" },
    { transform: "scale(1)", opacity: 1, offset: (enter + hold) / (enter + hold + exit), easing: fxEase },
    { transform: `translate(${dx}px, ${dy}px) scale(${sc})`, opacity: to ? .95 : 0 }];
  const a = g.animate(kf, { duration: enter + hold + exit, delay, fill: "both" });
  sfx(o.cls === "yel" ? "sell" : o.tag === "Leggenda" ? "call" : "play", delay);
  // etichette: sfumano prima dell'uscita
  for(const el of g.querySelectorAll(".kick, .nm, .tag, .ldr")) el.animate([{ opacity: 1, offset: (enter + hold) / (enter + hold + exit) }, { opacity: 0 }], { duration: enter + hold + exit, delay, fill: "both" });
  a.onfinish = () => g.remove(); setTimeout(() => g.remove(), total + 300);
  if(o.hideEl){ animEl(o.hideEl, [{ opacity: 0 }, { opacity: 0, offset: .96 }, { opacity: 1 }], { duration: total, fill: "backwards" }); }
  return total;
}
/* Gig tirato: il dado gira grande al centro dentro un anello, poi vola nella fila (dove il dado vero
   resta nascosto fino all'arrivo: lo gestisce applyDice con la voce «big» di liveDice) */
function fxRoll(board, el, gig, who, ms){
  const roll = Math.max(500, ms * (gig.sides === 20 ? 2.2 : 1.6)), hold = Math.max(400, ms * 1.2), fly = ms * 1.1, wait = fxSlot(roll + hold + fly);
  liveDice.set(+el.dataset.gig, { until: performance.now() + wait + roll + hold + fly, big: true }); el.style.visibility = "hidden";
  if(!wait){ fxRollNow(board, el, gig, who, ms); return; }
  setTimeout(() => { const b2 = $("#board"), e2 = b2 && b2.querySelector(`.die[data-gig="${el.dataset.gig}"]`); if(e2) fxRollNow(b2, e2, gig, who, ms); else liveDice.delete(+el.dataset.gig); }, wait);
  setTimeout(() => applyDice($("#board")), wait + roll + hold + fly + 600);   // rete di sicurezza: il dado vero torna visibile comunque
}
function fxRollNow(board, el, gig, who, ms){
  const uid = +el.dataset.gig, main = fxCenter(board), S_ = Math.max(90, Math.min(220, main.h * .6)), dw = Math.round(S_ * .42);
  const g = document.createElement("div"); g.className = "fxdie"; g.style.cssText = `left:${main.cx - S_ / 2}px;top:${main.cy - S_ / 2}px;width:${S_}px;height:${S_}px;--s:${S_}px`;
  g.innerHTML = `<i class="r1"></i><i class="r2"></i><i class="r3"></i><span class="die d${gig.sides}" style="--dw:${dw}px">${dieSVG(gig.sides)}<b>?</b><small>d${gig.sides}</small></span><div class="kick">${esc(who)} tira · d${gig.sides}</div>`;
  flyLayer.appendChild(g);
  const die = g.querySelector(".die"), b = die.querySelector("b"); g.style.setProperty("--c", getComputedStyle(die).getPropertyValue("--c") || "var(--acc2)");
  const roll = Math.max(500, ms * (gig.sides === 20 ? 2.2 : 1.6)), hold = Math.max(400, ms * 1.2), fly = ms * 1.1, total = roll + hold + fly;
  const vars = {}; const glitch = () => { for(const k of ["--gx1", "--gx2"]) vars[k] = (Math.random() * 7 - 3.5).toFixed(1) + "px"; for(const k of ["--gs1", "--gs2"]) vars[k] = (Math.random() * 18 - 9).toFixed(1) + "deg"; vars["--gy"] = Math.round(15 + Math.random() * 65) + "%"; for(const [k, v] of Object.entries(vars)) die.style.setProperty(k, v); };
  glitch(); die.classList.add("rolling"); sfx("roll"); sfx("land", roll);
  const t0 = performance.now(); let next = 0;
  const iv = setInterval(() => { const t = performance.now() - t0; if(t >= roll){ clearInterval(iv); die.classList.remove("rolling"); b.textContent = gig.value; die.classList.add("landed"); g.classList.add("done"); return; } if(t >= next){ next = t + 40 + Math.random() * 50; b.textContent = 1 + Math.floor(Math.random() * gig.sides); glitch(); } }, 30);
  liveDice.set(uid, { until: performance.now() + total, big: true }); el.style.visibility = "hidden";
  const to = localRect(board, el);
  if(to){ const dx = to.cx - main.cx, dy = to.cy - main.cy, sc = to.w / dw; g.animate([{ transform: "none", easing: "linear" }, { transform: "none", offset: (roll + hold) / total, easing: fxEase }, { transform: `translate(${dx}px, ${dy}px) scale(${sc})` }], { duration: total, fill: "forwards" }); g.querySelector(".kick").animate([{ opacity: 1, offset: (roll + hold) / total }, { opacity: 0 }], { duration: total, fill: "forwards" }); }
  setTimeout(() => { g.remove(); applyDice(board); }, total + 60);
  g.animate([{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "none" }], { duration: Math.max(150, ms * .5), easing: fxEase });
}
/* scontro: l'Unità che attacca spara al bersaglio (Unità o fila dei Gig) con la pistola gialla a contorno neon; se il
   bersaglio è un'Unità risponde con la pistola rossa, oppure, se ha potenza 0, con la mano a pistola (gesto di
   scherno, olografico). Traccianti, vampa e impatto; chi è colpito vibra. Tutto disegno nostro.
   Restituisce il momento (ms da ora) in cui lo scontro è finito, per far partire dopo le carte sconfitte. */
function fxShot(board, a, t, pa, pd, ms, targetEl, attackerEl){
  // durata: 1,3 s con le animazioni normali (o veloci), 2,3 s con quelle lente
  const D = Math.max(1300, 1300 + (ms - 380) * 3.7), exchange = pd != null, total = exchange ? D * 1.6 : D, delay = fxSlot(total);
  const weapon = pw => pw >= 10 ? "missile" : pw > 0 ? "gun" : "hand";
  setTimeout(() => fxShotNow(board, a, t, pa, D, "#fcee0a", weapon(pa), targetEl, true, pd), delay);
  if(exchange) setTimeout(() => fxShotNow(board, t, a, pd, D, "#ff2e55", weapon(pd), attackerEl, false, null), delay + D * .6);
  return delay + total * .9;
}
/* lanciamissili (potenza ≥ 10): tubo a spalla con mirino, il missile parte con un arco e una scia, esplosione a doppio anello;
   tre missili dalla potenza 20 in su. Stesso contorno neon a glitch delle pistole. */
function fxMissile(board, a, t, pw, dur, col, targetEl, withBadge, pd){
  const impactAt = .5, n = pw >= 20 ? 3 : 1;
  const dxx = t.cx - a.cx, dyy = t.cy - a.cy, L = Math.hypot(dxx, dyy) || 1, ux = dxx / L, uy = dyy / L;
  const ax = a.cx + ux * a.h * .3, ay = a.cy + uy * a.h * .3, tx = t.cx - ux * Math.min(t.h, t.w) * .25, ty = t.cy - uy * Math.min(t.h, t.w) * .25;
  const ang = Math.atan2(ty - ay, tx - ax) * 180 / Math.PI, cw = parseFloat(getComputedStyle(board).getPropertyValue("--cw")) || 50, sc = Math.max(1, Math.min(1.8, cw / 52));
  // arco: il punto di controllo sta dalla parte «alta» della plancia rispetto alla linea di tiro
  const mx = (ax + tx) / 2, my = (ay + ty) / 2, nx = -uy, ny = ux, lift = Math.min(140, L * .45) * (ny < 0 ? 1 : -1);
  const cx = mx + nx * lift, cy = my + ny * lift, path = `M${ax.toFixed(1)} ${ay.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}`;
  const svgNS = "http://www.w3.org/2000/svg", sv = document.createElementNS(svgNS, "svg"); sv.setAttribute("class", "fxshot"); sv.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible";
  const launcher = `<path d="M-10 -5 H 34 V 3 H -10 Z"/><path d="M34 -7 H 40 V 5 H 34"/><path d="M-10 -4 H -18 L -20 -2 V 1 L -18 3 H -10"/><path d="M4 -5 V -11 H 14 V -5"/><path d="M6 -9 H 12"/><path d="M6 3 L 4 12 H 11 L 12 3"/><path d="M12 3 L 13 7 H 17"/><path d="M-6 3 V 8 H 2 V 3"/><path d="M18 -5 V -8 H 30 V -5"/>`;
  const missile = `<polygon points="0,-3 14,-3 20,0 14,3 0,3" fill="#fff"/><polygon points="0,-3 -6,-7 -3,0 -6,7 0,3" fill="${col}"/><circle cx="-9" cy="0" r="3" fill="none" stroke="#fff" opacity=".6"/><circle cx="-16" cy="0" r="4.5" fill="none" stroke="#fff" opacity=".3"/>`;
  sv.innerHTML = `<defs><filter id="fxgl"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <path class="trail" d="${path}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="6 5" opacity=".55" pathLength="1"/>
    <g transform="translate(${ax} ${ay}) rotate(${ang})" filter="url(#fxgl)">
      <g class="gun" transform="scale(${sc})" fill="none" stroke-linejoin="round" stroke-linecap="round"><g stroke="var(--acc2)" stroke-width="1.3" opacity=".55" transform="translate(1.5 -1)">${launcher}</g><g stroke="${col}" stroke-width="1.3" stroke-dasharray="9 2 4 2">${launcher}</g><rect x="-8" y="-3" width="6" height="2" fill="${col}"/><circle cx="24" cy="-1" r="1.5" fill="${col}"/></g>
      <g class="fl" transform="translate(${42 * sc} -1) scale(${sc * .7})" fill="#fff"><polygon points="0,0 14,-9 6,-1 20,0 6,1 14,9 0,0"/><circle r="4" fill="${col}"/></g>
      <g class="bk" transform="translate(${-22 * sc} -1) scale(${sc * .5})" fill="${col}" opacity=".8"><polygon points="0,0 -14,-7 -6,0 -14,7"/></g>
    </g>
    ${Array.from({ length: n }, (_, i) => `<g class="ms m${i}" style="offset-path:path('${path}');offset-rotate:auto;offset-distance:0%" transform="scale(${sc * .9})">${missile}</g>`).join("")}
    <g class="im" transform="translate(${tx} ${ty})" filter="url(#fxgl)"><circle class="fl2" r="12" fill="#fff"/><circle r="22" fill="none" stroke="${col}" stroke-width="3"/><circle r="40" fill="none" stroke="${col}" stroke-width="1.2" opacity=".6"/><circle r="56" fill="none" stroke="${col}" stroke-width="1" opacity=".3"/>${[0,30,60,90,120,150,180,210,240,270,300,330].map(d => `<line x1="0" y1="0" x2="${Math.cos(d * Math.PI / 180) * 52}" y2="${Math.sin(d * Math.PI / 180) * 52}" stroke="#fff" stroke-width="1.5" opacity=".75" transform="rotate(7)"/>`).join("")}</g>`;
  flyLayer.appendChild(sv);
  const E = "cubic-bezier(.2,.7,.2,1)", launch = .2, land = impactAt;
  sv.querySelector(".gun").animate([{ opacity: 0, transform: `scale(${sc * .6})` }, { opacity: 1, transform: `scale(${sc})`, offset: .12 }, { opacity: 1, offset: .82 }, { opacity: 0 }], { duration: dur, easing: E, fill: "forwards" });
  sv.querySelector(".fl").animate([{ opacity: 0 }, { opacity: 0, offset: launch - .01 }, { opacity: 1, offset: launch }, { opacity: 0, offset: launch + .08 }], { duration: dur, fill: "forwards" });
  sv.querySelector(".bk").animate([{ opacity: 0 }, { opacity: 0, offset: launch - .01 }, { opacity: .9, offset: launch + .01 }, { opacity: 0, offset: launch + .12 }], { duration: dur, fill: "forwards" });
  sv.querySelector(".trail").animate([{ strokeDashoffset: 1, opacity: 0 }, { strokeDashoffset: 1, opacity: .55, offset: launch }, { strokeDashoffset: 0, opacity: .55, offset: land }, { strokeDashoffset: 0, opacity: 0, offset: land + .25 }, { opacity: 0 }], { duration: dur, fill: "forwards" });
  sv.querySelector(".trail").style.strokeDasharray = "1"; sv.querySelector(".trail").style.strokeDashoffset = "1";
  sv.querySelectorAll(".ms").forEach((m, i) => { const o = i * .05; m.animate([{ offsetDistance: "0%", opacity: 0 }, { offsetDistance: "0%", opacity: 0, offset: launch + o }, { offsetDistance: "0%", opacity: 1, offset: launch + o + .005 }, { offsetDistance: "100%", opacity: 1, offset: land + o }, { offsetDistance: "100%", opacity: 0, offset: land + o + .005 }, { opacity: 0 }], { duration: dur, fill: "forwards", easing: "linear" }); });
  const im = sv.querySelector(".im"); im.animate([{ opacity: 0, transform: `translate(${tx}px, ${ty}px) scale(.2)` }, { opacity: 0, offset: land }, { opacity: 1, transform: `translate(${tx}px, ${ty}px) scale(.5)`, offset: land + .02 }, { opacity: 1, transform: `translate(${tx}px, ${ty}px) scale(1.15)`, offset: land + .22 }, { opacity: 0, transform: `translate(${tx}px, ${ty}px) scale(1.5)` }], { duration: dur, fill: "forwards" });
  sv.querySelector(".fl2").animate([{ opacity: 0 }, { opacity: 0, offset: land }, { opacity: 1, offset: land + .02 }, { opacity: 0, offset: land + .12 }], { duration: dur, fill: "forwards" });
  sfx("launch", dur * launch); sfx("boom", dur * land);
  if(targetEl) setTimeout(() => { if(!targetEl.isConnected) return; targetEl.animate([{ transform: "translate(0,0)" }, { transform: "translate(-6px,3px)" }, { transform: "translate(6px,-3px)" }, { transform: "translate(-4px,-2px)" }, { transform: "translate(4px,2px)" }, { transform: "translate(-2px,1px)" }, { transform: "translate(0,0)" }], { duration: 480, easing: "linear", composite: "add" }); targetEl.animate([{ boxShadow: `0 0 0 4px ${col}, 0 0 30px ${col}` }, { boxShadow: "0 0 0 0 transparent" }], { duration: 800 }); const main = board.querySelector(".bmain") || board; main.animate([{ transform: "translate(0,0)" }, { transform: "translate(-3px,2px)" }, { transform: "translate(3px,-2px)" }, { transform: "translate(0,0)" }], { duration: 260, easing: "linear" }); }, dur * land);
  let badge = null;
  if(withBadge){
    const bx = (ax + tx) / 2 + 36, by = (ay + ty) / 2;
    badge = document.createElement("div"); badge.className = "fxpw hot"; badge.style.cssText = `left:${Math.max(40, Math.min(board.clientWidth - 40, bx))}px;top:${by}px`; badge.innerHTML = `<em>${pw}</em><i>⚔</i>${pd != null ? pd : "Gig"}`; flyLayer.appendChild(badge);
    const bd = pd != null ? dur * 1.6 : dur;
    badge.animate([{ opacity: 0, transform: "translate(-50%,-50%) scale(.6)" }, { opacity: 1, transform: "translate(-50%,-50%) scale(1)", offset: Math.min(.15, 200 / bd) }, { opacity: 1, offset: .88 }, { opacity: 0, transform: "translate(-50%,-50%) scale(.9)" }], { duration: bd, fill: "forwards" });
    setTimeout(() => badge && badge.remove(), bd + 100);
  }
  setTimeout(() => sv.remove(), dur + 100);
}
function fxShotNow(board, a, t, pw, dur, col, mode, targetEl, withBadge, pd){
  if(mode === "missile"){ fxMissile(board, a, t, pw, dur, col, targetEl, withBadge, pd); return; }
  const impactAt = .45;
  const dxx = t.cx - a.cx, dyy = t.cy - a.cy, L = Math.hypot(dxx, dyy) || 1, ux = dxx / L, uy = dyy / L;
  const ax = a.cx + ux * a.h * .3, ay = a.cy + uy * a.h * .3, tx = t.cx - ux * Math.min(t.h, t.w) * .25, ty = t.cy - uy * Math.min(t.h, t.w) * .25;
  const ang = Math.atan2(ty - ay, tx - ax) * 180 / Math.PI, len = Math.max(20, Math.hypot(tx - ax, ty - ay)), cw = parseFloat(getComputedStyle(board).getPropertyValue("--cw")) || 50, sc = Math.max(1, Math.min(1.8, cw / 52));
  const svgNS = "http://www.w3.org/2000/svg", sv = document.createElementNS(svgNS, "svg"); sv.setAttribute("class", "fxshot"); sv.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible";
  const tr = Math.max(10, len - 46 * sc), hand = mode === "hand";
  const gunPath = `<path d="M-2 -6 H 22 L 25 -4 V 0 H 9 L 7 3 L 5 11 H -1 L 1 3 L -2 0 Z"/>`;
  const handPath = `<rect x="6" y="-3.5" width="18" height="3.6" rx="1.8"/><rect x="-5" y="-4" width="13" height="13" rx="2.5"/><path d="M-2 0.5 H 6 M-2 4 H 6 M-2 7.5 H 5" stroke-width="1"/><rect x="-1.5" y="-13" width="3.4" height="10" rx="1.7"/>`;
  const weapon = hand ? handPath : gunPath;
  sv.innerHTML = `<defs><filter id="fxgl"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <g transform="translate(${ax} ${ay}) rotate(${ang})" filter="url(#fxgl)">
      <g class="gun" transform="scale(${sc})" fill="none" stroke-linejoin="round" stroke-linecap="round"><g stroke="var(--acc2)" stroke-width="1.4" opacity=".55" transform="translate(1.5 -1)">${weapon}</g><g stroke="${col}" stroke-width="1.4" ${hand ? "" : 'stroke-dasharray="7 2 3 2"'}>${weapon}</g>${hand ? "" : `<path d="M2 0 L 3 4 H 7" stroke="${col}" stroke-width="1.2"/><path d="M2 -3 H 20" stroke="${col}" stroke-width="1" opacity=".5"/>`}</g>
      ${hand ? `<g class="tr"><text x="${30 * sc}" y="-6" fill="${col}" font-size="${10 * sc}" font-family="var(--display)" font-weight="700" letter-spacing=".2em">PEW</text></g><g class="fl" transform="translate(${27 * sc} -2) scale(${sc * .3})" fill="#fff"><polygon points="0,0 14,-9 6,-1 20,0 6,1 14,9 0,0"/></g>`
      : `<g class="tr"><rect x="${28 * sc}" y="-2" width="${tr}" height="4" rx="2" fill="${col}" opacity=".55"/><rect x="${28 * sc}" y="-.6" width="${tr}" height="1.2" fill="#fff"/></g>
      ${[0, 1, 2].map(i => `<rect class="bl b${i}" x="${28 * sc}" y="-2.5" width="14" height="5" rx="2.5" fill="#fff"/>`).join("")}
      <g class="fl" transform="translate(${27 * sc} -3) scale(${sc * .5})" fill="#fff"><polygon points="0,0 14,-9 6,-1 20,0 6,1 14,9 0,0"/><circle r="3.5" fill="${col}"/></g>`}
    </g>
    ${hand ? "" : `<g class="im" transform="translate(${tx} ${ty})" filter="url(#fxgl)"><circle r="14" fill="none" stroke="${col}" stroke-width="2"/><circle r="24" fill="none" stroke="${col}" stroke-width="1" opacity=".5"/>${[0,45,90,135,180,225,270,315].map(d => `<line x1="0" y1="0" x2="${Math.cos(d * Math.PI / 180) * 30}" y2="${Math.sin(d * Math.PI / 180) * 30}" stroke="#fff" stroke-width="1.5" opacity=".8" transform="rotate(12)"/>`).join("")}</g>`}`;
  flyLayer.appendChild(sv);
  if(hand) sfx("pew", dur * .34); else { sfx("shot", dur * .22); sfx("hit", dur * impactAt); }
  const E = "cubic-bezier(.2,.7,.2,1)";
  sv.querySelector(".gun").animate([{ opacity: 0, transform: `scale(${sc * .6})` }, { opacity: 1, transform: `scale(${sc})`, offset: .12 }, { opacity: 1, offset: .82 }, { opacity: 0 }], { duration: dur, easing: E, fill: "forwards" });
  if(hand){
    sv.querySelector(".gun").animate([{ transform: `scale(${sc}) rotate(0deg)` }, { transform: `scale(${sc}) rotate(0deg)`, offset: .3 }, { transform: `scale(${sc}) rotate(-18deg)`, offset: .36 }, { transform: `scale(${sc}) rotate(0deg)`, offset: .5 }], { duration: dur, composite: "add" });
    sv.querySelector(".tr").animate([{ opacity: 0 }, { opacity: 0, offset: .34 }, { opacity: 1, offset: .38 }, { opacity: 1, offset: .62 }, { opacity: 0, offset: .75 }], { duration: dur, fill: "forwards" });
    sv.querySelector(".fl").animate([{ opacity: 0 }, { opacity: 0, offset: .34 }, { opacity: 1, offset: .36 }, { opacity: 0, offset: .46 }], { duration: dur, fill: "forwards" });
  } else {
    sv.querySelector(".tr").animate([{ opacity: 0 }, { opacity: 0, offset: .22 }, { opacity: 1, offset: .3 }, { opacity: .6, offset: .6 }, { opacity: 0 }], { duration: dur, fill: "forwards" });
    sv.querySelector(".fl").animate([{ opacity: 0 }, { opacity: 0, offset: .22 }, { opacity: 1, offset: .26 }, { opacity: 0, offset: .4 }, { opacity: 1, offset: .44 }, { opacity: 0, offset: .55 }], { duration: dur, fill: "forwards" });
    sv.querySelectorAll(".bl").forEach((b, i) => b.animate([{ transform: "translateX(0)", opacity: 0 }, { opacity: 0, offset: .22 + i * .05 }, { transform: "translateX(0)", opacity: 1, offset: .23 + i * .05 }, { transform: `translateX(${tr}px)`, opacity: 1, offset: impactAt + i * .05 }, { opacity: 0, offset: impactAt + .01 + i * .05 }], { duration: dur, fill: "forwards" }));
    sv.querySelector(".im").animate([{ opacity: 0, transform: `translate(${tx}px, ${ty}px) scale(.3)` }, { opacity: 0, offset: impactAt }, { opacity: 1, transform: `translate(${tx}px, ${ty}px) scale(.6)`, offset: impactAt + .02 }, { opacity: 1, transform: `translate(${tx}px, ${ty}px) scale(1.1)`, offset: impactAt + .2 }, { opacity: 0, transform: `translate(${tx}px, ${ty}px) scale(1.4)` }], { duration: dur, fill: "forwards" });
    if(targetEl) setTimeout(() => { if(!targetEl.isConnected) return; targetEl.animate([{ transform: "translate(0,0)" }, { transform: "translate(-4px,2px)" }, { transform: "translate(4px,-2px)" }, { transform: "translate(-3px,-1px)" }, { transform: "translate(3px,1px)" }, { transform: "translate(0,0)" }], { duration: 320, easing: "linear", composite: "add" }); targetEl.animate([{ boxShadow: `0 0 0 3px ${col}, 0 0 24px ${col}` }, { boxShadow: "0 0 0 0 transparent" }], { duration: 600 }); }, dur * impactAt);
  }
  let badge = null;
  if(withBadge){
    const bx = (ax + tx) / 2 + 36, by = (ay + ty) / 2;
    badge = document.createElement("div"); badge.className = "fxpw hot"; badge.style.cssText = `left:${Math.max(40, Math.min(board.clientWidth - 40, bx))}px;top:${by}px`; badge.innerHTML = `<em>${pw}</em><i>⚔</i>${pd != null ? pd : "Gig"}`; flyLayer.appendChild(badge);
    const bd = pd != null ? dur * 1.6 : dur;
    badge.animate([{ opacity: 0, transform: "translate(-50%,-50%) scale(.6)" }, { opacity: 1, transform: "translate(-50%,-50%) scale(1)", offset: Math.min(.15, 200 / bd) }, { opacity: 1, offset: .88 }, { opacity: 0, transform: "translate(-50%,-50%) scale(.9)" }], { duration: bd, fill: "forwards" });
    setTimeout(() => badge && badge.remove(), bd + 100);
  }
  setTimeout(() => sv.remove(), dur + 100);
}
/* somma della potenza dopo un equipaggiamento: «3 + 1 = 4» sopra l'Unità */
function fxPower(board, hostEl, base, plus, delay, ms){
  const r = localRect(board, hostEl); if(!r) return;
  const b = document.createElement("div"); b.className = "fxpw"; b.style.cssText = `left:${Math.max(70, Math.min(board.clientWidth - 70, r.cx))}px;top:${Math.max(14, r.y - 12)}px`;
  b.innerHTML = `${base} <i>+</i><em>${plus}</em> <i>=</i> <em>${base + plus}</em>`; flyLayer.appendChild(b);
  const dur = Math.max(1100, ms * 3.5); sfx("equip", delay);
  b.animate([{ opacity: 0, transform: "translate(-50%,-50%) scale(.6)" }, { opacity: 1, transform: "translate(-50%,-50%) scale(1.08)", offset: .12 }, { opacity: 1, transform: "translate(-50%,-50%) scale(1)", offset: .2 }, { opacity: 1, offset: .85 }, { opacity: 0, transform: "translate(-50%,-60%)" }], { duration: dur, delay, fill: "both" });
  setTimeout(() => b.remove(), delay + dur + 100);
}
/* Gig rubato: il dado lascia la fila del rivale, passa ingrandito dal centro e si posa nella fila di chi lo ha rubato */
function fxSteal(board, el, was, now, gig, who, ms){
  const uid = +el.dataset.gig, main = fxCenter(board), S_ = Math.max(70, Math.min(170, main.h * .45)), dw = Math.round(S_ * .5);
  const hold = Math.max(500, ms * 1.6), leg = Math.max(260, ms * 1.1), total = leg + hold + leg, wait = fxSlot(total);
  liveDice.set(uid, { until: performance.now() + wait + total, big: true }); el.style.visibility = "hidden";
  setTimeout(() => {
    const g = document.createElement("div"); g.className = "fxdie steal"; g.style.cssText = `left:${main.cx - S_ / 2}px;top:${main.cy - S_ / 2}px;width:${S_}px;height:${S_}px`;
    g.innerHTML = `<i class="r2"></i><span class="die d${gig.sides}" style="--dw:${dw}px">${dieSVG(gig.sides)}<b>${gig.value}</b><small>d${gig.sides}</small></span><div class="kick">${esc(who)}</div>`;
    g.style.setProperty("--c", getComputedStyle(g.querySelector(".die")).getPropertyValue("--c") || "var(--acc2)");
    flyLayer.appendChild(g); sfx("steal");
    const from = `translate(${was.cx - main.cx}px, ${was.cy - main.cy}px) scale(${was.w / dw})`, to = `translate(${now.cx - main.cx}px, ${now.cy - main.cy}px) scale(${now.w / dw})`;
    g.animate([{ transform: from, opacity: 1, easing: fxEase }, { transform: "none", opacity: 1, offset: leg / total, easing: "linear" }, { transform: "none", opacity: 1, offset: (leg + hold) / total, easing: fxEase }, { transform: to, opacity: 1 }], { duration: total, fill: "forwards" });
    g.querySelector(".kick").animate([{ opacity: 0 }, { opacity: 1, offset: leg / total }, { opacity: 1, offset: (leg + hold) / total }, { opacity: 0 }], { duration: total, fill: "forwards" });
    setTimeout(() => { g.remove(); applyDice($("#board")); }, total + 60);
  }, wait);
  setTimeout(() => applyDice($("#board")), wait + total + 600);
}
/* Leggenda scoperta: al centro, coperta da una cortina a strisce che una riga di scansione apre dall'alto in basso,
   con la riga da terminale «scan identità… NN%» che finisce in «IDENTIFICATA»; poi la carta vola nel suo slot. */
function fxLegend(board, o, ms){
  const main = fxCenter(board), cw = parseFloat(getComputedStyle(board).getPropertyValue("--cw")) || 50;
  const w = Math.max(60, Math.min(cw * 2.4, main.h * .56 / 1.4)), h = w * 1.4;
  const enter = Math.max(200, ms * .8), scan = Math.max(900, ms * 2.6), hold = Math.max(450, ms * 1.2), exit = ms * 1.2, span = enter + scan + hold + exit, delay = fxSlot(span), total = delay + span;
  const g = document.createElement("div"); g.className = "fxleg"; g.style.cssText = `left:${main.cx - w / 2}px;top:${main.cy - h / 2}px;width:${w}px;height:${h}px`;
  const short = (o.name || "").split(":")[0].toUpperCase();
  g.innerHTML = `<div class="kick">${esc(o.label)}</div><div class="crd"><img src="${o.src}" alt=""><div class="veil"></div><div class="scan"></div></div><div class="ring"></div><div class="term">&gt; scan identità… <b class="pc">0%</b> ▌ <em>${esc(short)}</em></div>`;
  flyLayer.appendChild(g);
  const to = o.to, dx = to ? to.cx - main.cx : 0, dy = to ? to.cy - main.cy : 0, sc = to ? Math.min(1, to.w / w, to.h / h) : .6;
  g.animate([{ transform: "scale(.6)", opacity: 0, easing: fxEase }, { transform: "scale(1)", opacity: 1, offset: enter / span, easing: "linear" }, { transform: "scale(1)", opacity: 1, offset: (enter + scan + hold) / span, easing: fxEase }, { transform: `translate(${dx}px, ${dy}px) scale(${sc})`, opacity: to ? .95 : 0 }], { duration: span, delay, fill: "both" });
  const veil = g.querySelector(".veil"), line = g.querySelector(".scan"), pc = g.querySelector(".pc"), term = g.querySelector(".term");
  veil.animate([{ top: "0%" }, { top: "0%", offset: enter / span }, { top: "100%", offset: (enter + scan) / span }, { top: "100%" }], { duration: span, delay, fill: "both" });
  line.animate([{ top: "0%", opacity: 0 }, { top: "0%", opacity: 1, offset: enter / span }, { top: "100%", opacity: 1, offset: (enter + scan) / span }, { top: "100%", opacity: 0, offset: (enter + scan) / span + .01 }, { opacity: 0 }], { duration: span, delay, fill: "both" });
  for(const el of [g.querySelector(".kick"), term, g.querySelector(".ring")]) el.animate([{ opacity: 1, offset: (enter + scan + hold) / span }, { opacity: 0 }], { duration: span, delay, fill: "both" });
  const t0 = performance.now() + delay + enter; const iv = setInterval(() => { const k = Math.max(0, Math.min(1, (performance.now() - t0) / scan)); pc.textContent = Math.round(k * 100) + "%"; if(k >= 1){ clearInterval(iv); term.innerHTML = `&gt; identità confermata ✓ <em>${esc(short)}</em>`; } }, 50); setTimeout(() => clearInterval(iv), total + 100);
  sfx("call", delay + enter);
  setTimeout(() => g.remove(), total + 300);
  if(o.hideEl) animEl(o.hideEl, [{ opacity: 0 }, { opacity: 0, offset: .96 }, { opacity: 1 }], { duration: total, fill: "backwards" });
  return total;
}
/* Go Solo: la Leggenda piomba in campo con uno schiacciamento; sotto si apre un cratere scuro dal bordo neon con l'ellisse
   d'urto, poche crepe corte e detriti che schizzano; tutto si richiude in poco più di un secondo. Scossa della plancia e tonfo. */
function fxSlam(board, el, ms){
  const r = localRect(board, el); if(!r) return;
  const dur = Math.max(260, ms * .7), hold = Math.max(1100, ms * 2.4);
  animEl(el, [{ transform: "scale(1.9) translateY(-22%)", opacity: 0, filter: "brightness(2.2)", easing: "cubic-bezier(.5,0,1,.6)" }, { transform: "scale(1.08, .9)", opacity: 1, filter: "brightness(2)", offset: dur / (dur + hold), easing: "cubic-bezier(.2,.7,.2,1)" }, { transform: "scale(.98, 1.03)", filter: "brightness(1.3)", offset: (dur + 120) / (dur + hold) }, { transform: "scale(1)", filter: "brightness(1)", offset: (dur + 260) / (dur + hold) }, { transform: "scale(1)", filter: "brightness(1)" }], { duration: dur + hold });
  setTimeout(() => {
    const svgNS = "http://www.w3.org/2000/svg", sv = document.createElementNS(svgNS, "svg"); sv.setAttribute("class", "fxcrack"); sv.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible";
    const RX = Math.max(r.w, r.h) * 1.15, RY = RX * .28, cx = r.cx, cy = r.y + r.h * .92;   // alla base della carta
    const id = "fxcr" + Math.floor(Math.random() * 1e6); let cracks = "";
    const n = 4 + Math.floor(Math.random() * 3);
    for(let i = 0; i < n; i++){ const a = (i / n) * Math.PI * 2 + (Math.random() - .5) * .7, x0 = cx + Math.cos(a) * RX * .95, y0 = cy + Math.sin(a) * RY * .95, len = RX * (.25 + Math.random() * .35); let d = `M${x0.toFixed(1)} ${y0.toFixed(1)}`, x = x0, y = y0; for(let k = 1; k <= 2; k++){ const an = a + (Math.random() - .5) * .8; x += Math.cos(an) * len / 2; y += Math.sin(an) * len / 2 * .45; d += ` L${x.toFixed(1)} ${y.toFixed(1)}`; } cracks += d + " "; }
    const debris = Array.from({ length: 9 }, () => { const a = Math.PI + Math.random() * Math.PI, sp = .6 + Math.random() * .8; return { x: cx + (Math.random() - .5) * r.w * .8, y: cy, vx: Math.cos(a) * RX * sp * .9, vy: Math.sin(a) * RY * sp * 5, s: 3 + Math.random() * 4, rot: Math.random() * 90 }; });
    sv.innerHTML = `<defs><radialGradient id="${id}"><stop offset="0" stop-color="#000" stop-opacity=".95"/><stop offset=".7" stop-color="#000" stop-opacity=".6"/><stop offset="1" stop-color="var(--yel)" stop-opacity="0"/></radialGradient><filter id="${id}g"><feGaussianBlur stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <g class="crat"><ellipse cx="${cx}" cy="${cy}" rx="${RX}" ry="${RY}" fill="url(#${id})"/><ellipse cx="${cx}" cy="${cy}" rx="${RX * .8}" ry="${RY * .72}" fill="none" stroke="var(--yel)" stroke-width="2" filter="url(#${id}g)"/><path d="${cracks}" fill="none" stroke="#0b0608" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="${cracks}" fill="none" stroke="var(--yel)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}g)"/></g>
      <ellipse class="wave" cx="${cx}" cy="${cy}" rx="${RX}" ry="${RY}" fill="none" stroke="var(--yel)" stroke-width="2.5"/>
      ${debris.map((d, i) => `<rect class="db d${i}" x="${d.x - d.s / 2}" y="${d.y - d.s / 2}" width="${d.s}" height="${d.s}" fill="var(--yel)" transform="rotate(${d.rot} ${d.x} ${d.y})"/>`).join("")}`;
    flyLayer.appendChild(sv);
    const wave = sv.querySelector(".wave"); wave.style.transformOrigin = `${cx}px ${cy}px`;
    wave.animate([{ transform: "scale(.35)", opacity: 1 }, { transform: "scale(1.9)", opacity: 0 }], { duration: Math.max(500, ms * 1.4), easing: "cubic-bezier(.1,.8,.3,1)", fill: "forwards" });
    const crat = sv.querySelector(".crat"); crat.style.transformOrigin = `${cx}px ${cy}px`;
    crat.animate([{ transform: "scale(.6)", opacity: 0 }, { transform: "scale(1)", opacity: 1, offset: .12 }, { opacity: 1, offset: .62 }, { transform: "scale(1)", opacity: 0 }], { duration: hold, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" });
    sv.querySelectorAll(".db").forEach((e, i) => { const d = debris[i]; e.animate([{ transform: "translate(0,0)", opacity: 1 }, { transform: `translate(${d.vx * .6}px, ${d.vy * .6 - RY * 1.2}px)`, opacity: 1, offset: .45 }, { transform: `translate(${d.vx}px, ${Math.abs(d.vy) * .3}px)`, opacity: 0 }], { duration: hold * .8, easing: "cubic-bezier(.2,.7,.4,1)", fill: "forwards", composite: "add" }); });
    const main = board.querySelector(".bmain") || board; main.animate([{ transform: "translate(0,0)" }, { transform: "translate(-4px,3px)" }, { transform: "translate(4px,-2px)" }, { transform: "translate(-3px,-2px)" }, { transform: "translate(2px,2px)" }, { transform: "translate(0,0)" }], { duration: 360, easing: "linear" });
    sfx("slam");
    setTimeout(() => sv.remove(), hold + 300);
  }, dur);
}
/* fascia di cambio turno */
let fxTurnKey = null;
function fxBanner(board){
  if(!G || G.winner != null || (G.phase !== "main" && G.phase !== "start")) return;
  const key = `${G.turn}:${G.active}`; if(key === fxTurnKey) return; const resumed = fxTurnKey === "resume"; fxTurnKey = key; if(resumed) return;
  if(!fxOn() || (oppSpeed() === "instant" && S.settings.animMine === "instant")) return;
  board.appendChild(flyLayer);
  const mine = G.active === me(), main = fxCenter(board);
  const who = mine ? "Il tuo turno" : gmode === "hot" ? `Turno di ${G.players[G.active].name}` : "Turno dell'avversario";
  const g = document.createElement("div"); g.className = "fxbanner " + (mine ? "mine" : "opp"); g.style.top = `${main.cy - 26}px`;
  g.innerHTML = `<small>T${G.turn}</small><b>${esc(who)}</b><small>${esc(G.players[G.active].name)}</small>`;
  flyLayer.appendChild(g);
  const d = fxSlot(1500); fxAskUntil = performance.now() + d + 1500;   // una scelta (es. il dado del fixer) compare dopo la fascia
  sfx("turn", d);
  const a = g.animate([{ clipPath: "inset(0 100% 0 0)", opacity: 1, easing: "ease-out" }, { clipPath: "inset(0 0 0 0)", opacity: 1, offset: .18, easing: "linear" }, { clipPath: "inset(0 0 0 0)", opacity: 1, offset: .8, easing: "ease-in" }, { clipPath: "inset(0 0 0 100%)", opacity: 1 }], { duration: 1500, delay: d, fill: "both" });
  a.onfinish = () => g.remove(); setTimeout(() => g.remove(), d + 1700);
}

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
  if(c.o.match) parts.push(`<span class="clk${c.on === mine ? " on" : ""}">Tuo tempo ${mmss(c.o.match * 60 - c.used[mine])}</span><span class="clk${c.on === 1 - mine ? " on" : ""}">Suo tempo ${mmss(c.o.match * 60 - c.used[1 - mine])}</span>`);
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
/* le tre schede del Simulator: Costruito · Prerelease · Regole (le Regole hanno una pagina a sé, #rules) */
export const simKindHTML = k => `<div class="simkind" id="simKind"><button data-v="built" aria-pressed="${k === "built"}">Costruito</button><button data-v="sealed" aria-pressed="${k === "sealed"}">Prerelease</button><button data-v="rules" aria-pressed="${k === "rules"}">Regole</button></div>`;
document.addEventListener("click", e => { const b = e.target.closest("#p-rules #simKind button"); if(!b) return; if(b.dataset.v !== "rules"){ kind = b.dataset.v; S.settings.simKind = kind; S.save("settings"); location.hash = "#sim"; } });
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
      ${simKindHTML(kind)}
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
  G = createGame([{ ...d0, name: nm[0] }, { ...d1, name: nm[1] }], DATA.byId, { bot0: !human[0], bot1: !human[1], autoPay: [!!S.profile.autoPay, !!S.profile.autoPay], seed: tut ? TUTORIAL_SEED : undefined, first: tut ? 1 : undefined, chooseFirst: !tut });
  if(tut) ensureHand(G, 0);
  G.decide = botDecide; G.mulliganAsked = [false, false];
  sel = null; targeting = null; pop = null; handoff = false; holder = mode === "hot" ? 0 : null; seenLog = [null, null]; lastSeen = { turn: 0, seen: 0 }; fxTurnKey = null; fxBusyUntil = 0; fxAskUntil = 0; fxLastLog = null; fxHeld = []; fxHeldSteals = [];
  $("#board").innerHTML = ""; openBoard();
  // mulligan: ai bot no; agli umani lo chiede la plancia (vedi mulliganHTML: fa parte
  // dello stato, così un ridisegno — es. l'ingresso a schermo intero — non lo perde)
  for(const i of [0, 1]) if(!human[i] && G.phase === "mulligan") mulligan(G, i, false);
  render(); tick();
}
const mulliganPending = () => G && G.phase === "mulligan" ? [0, 1].find(k => human[k] && !G.players[k].mulliganed) : null;
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
  // app installata: niente schermo intero (il telefono mostrerebbe il suo avviso «scorri per uscire»), si prova solo a girare in orizzontale.
  // Nel browser lo schermo intero serve a togliere le barre; si può spegnere dalle Impostazioni.
  // Senza schermo intero, se il telefono non si lascia girare, la plancia si ruota da sola dentro lo schermo (e si gioca lo stesso).
  const installed = matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || navigator.standalone === true;
  const full = S.settings.fullscreen ?? !installed;   // predefinito: sì nel browser, no nell'app installata
  try{
    if(full) document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.("landscape").catch(() => {})).catch(() => {});
    else screen.orientation?.lock?.("landscape").catch(() => {});
  }catch(e){}
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
const boardLayout = () => S.settings.boardLayout === "rail" ? "rail" : "classic";
const OPP_SPEED = { instant: [650, 0], fast: [1100, 700], normal: [1800, 1300], slow: [2800, 2300] };
const oppSpeed = () => OPP_SPEED[S.settings.oppSpeed] ? S.settings.oppSpeed : "normal";
const oppDelay = online => OPP_SPEED[oppSpeed()][online ? 1 : 0];
let feed = [], feedT = null, flashUids = new Set(), oppQ = [], oppQT = null;
const fieldUids = () => new Set(G.players.flatMap(P => [...P.field, ...P.legends].map(u => u.uid)));
const snapBefore = () => ({ last: G.log[G.log.length - 1], uids: fieldUids() });
function showOpp(b){
  if(!G || oppSpeed() === "instant") return;
  if(S.settings.oppFeed === false){ const now = fieldUids(); flashUids = new Set([...now].filter(u => !b.uids.has(u))); clearTimeout(feedT); feedT = setTimeout(() => { flashUids = new Set(); document.querySelectorAll("#board .justnow").forEach(x => x.classList.remove("justnow")); }, 2200); return; }
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
  markMove("opp"); applyMoveAs(G, seat, m); clockMark();
  if(targeting && !G.players[me()].hand.some(c => c.uid === targeting.uid) && !G.players[me()].field.some(u => u.uid === targeting.uid)) targeting = null;
  if(m.k !== "m") showOpp(b);
  render(); tick();
  const d = m.k === "m" ? 0 : Math.max(oppDelay(true), fxOn() ? fxBusyUntil - performance.now() + 150 : 0);
  if(oppQ.length){ oppQT = setTimeout(() => { oppQT = null; drainOpp(); }, d); }
}
const oppBusy = () => gOnline && (oppQ.length > 0);
function tick(){
  clearTimeout(botTimer);
  if(!G) return;
  // mulligan dei bot: appena si sa chi inizia (dopo la scelta di chi ha vinto il tiro)
  if(G.phase === "mulligan") for(const i of [0, 1]) if(!human[i] && !G.players[i].mulliganed) mulligan(G, i, false);
  if(mulliganPending() != null){ render(); return; }
  if(G.winner != null){ finish(); render(); return; }
  if(gmode === "online"){ render(); return; }   // l'avversario gioca dal suo telefono
  if(G.pending){ if(human[G.pending.player]) { render(); return; } // decisione umana in attesa
    // decisione del bot rimasta in sospeso (es. la scelta di chi inizia, fatta prima che il bot fosse collegato): la prende ora
    const pd = G.pending, o = botDecide(G, pd.player, pd.kind, pd.options, pd.ctx || {}); markMove("opp"); resolve(G, Math.max(0, pd.options.indexOf(o)));
    render(); tick(); return;
  }
  if(!human[G.active] && G.phase === "main" && !G.pending){
    // la mossa successiva (anche la fine del turno) aspetta che gli effetti in fila siano finiti, così il tuo turno non comincia sopra le sue animazioni
    botTimer = setTimeout(() => { const b = snapBefore(); markMove("opp"); const more = botStep(G, G.active); showOpp(b); render(); if(G.winner != null) finish(); if(more || G.active !== undefined) tick(); }, Math.max(oppDelay(false), fxOn() ? fxBusyUntil - performance.now() + 150 : 0));
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
    sel = null; targeting = null; pop = null; handoff = false; showLog = false; lastSeen = { turn: 0, seen: 0 }; fxTurnKey = "resume"; fxBusyUntil = 0; fxAskUntil = 0; fxLastLog = null; fxHeld = []; fxHeldSteals = [];
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
const me = () => gmode === "bot" ? 0 : gmode === "online" ? gSeat : G.active;
/* chi deve avere il dispositivo: chi fa il mulligan, chi sceglie chi inizia, altrimenti chi è di turno (le reazioni
   dell'altro hanno la loro copertura a parte). Se non è chi lo ha in mano, compare la schermata di passaggio. */
function hotNeeded(){
  if(!G || gmode !== "hot" || G.winner != null) return null;
  const mp = mulliganPending(); if(mp != null) return mp;
  if(G.phase === "roll" && G.pending) return G.pending.player;
  return G.active;
}
function hotRecap(pi){
  const from = seenLog[pi], i = from ? G.log.lastIndexOf(from) : -1;
  return (i >= 0 ? G.log.slice(i + 1) : []).filter(e => e.text && e.kind !== "turn").slice(-14);
}   // in hot-seat la plancia è sempre dal punto di vista di chi gioca
/* se le righe non ci stanno (browser con le barre visibili, schermi bassi) le carte si rimpiccioliscono
   finché tutto entra: altrimenti la zona in basso taglia le proprie Unità dall'alto */
function fitBoard(board, H){
  const main = board.querySelector(".bmain") || board;
  for(let i = 0; i < 4; i++){
    let need = 0;
    for(const z of main.children){
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
  const lo = mine ? me() : 1 - me();
  if(!l.faceUp) return `<div class="bc back${l.spent ? " spent" : ""}${cls}" data-uid="${l.uid}" data-legend="1" data-lo="${lo}">?</div>`;
  return cardHTML(l, cls, "").replace('class="bc ', 'class="bc leg ').replace(`data-uid="${l.uid}"`, `data-uid="${l.uid}" data-legend="1" data-lo="${lo}"`);
}
/* dadi olografici: contorno al neon con gli spigoli interni (forma vera del poliedro), cifra, etichetta a chip */
const DIE_SHAPES = {
  4: ["M50 6 L94 90 L6 90 Z", "M50 6 L50 90 M6 90 L50 40 L94 90"],
  6: ["M14 14 H86 V86 H14 Z", "M26 26 H74 V74 H26 Z"],
  8: ["M50 4 L96 50 L50 96 L4 50 Z", "M4 50 H96 M50 4 L50 96"],
  10: ["M50 2 L98 50 L50 98 L2 50 Z", "M2 50 L24 48 L50 2 L76 48 L98 50 M24 48 L50 60 L76 48 M50 60 L50 98"],
  12: ["M50 4 L94 36 L78 92 H22 L6 36 Z", "M50 4 L50 24 M94 36 L72 42 M78 92 L64 76 M22 92 L36 76 M6 36 L28 42 M50 24 L72 42 L64 76 L36 76 L28 42 Z"],
  20: ["M50 4 L92 27 L92 73 L50 96 L8 73 L8 27 Z", "M50 4 L28 60 L72 60 Z M28 60 L8 73 M72 60 L92 73 M28 60 L8 27 M72 60 L92 27 M50 4 L8 27 M50 4 L92 27 M50 96 L28 60 M50 96 L72 60"]
};
export const dieSVG = sides => { const [o, i] = DIE_SHAPES[sides] || DIE_SHAPES[6]; return `<svg viewBox="0 0 100 100" aria-hidden="true"><path class="fill" d="${o}"/><path class="in" d="${i}"/><path class="out" d="${o}"/></svg>`; };
const dieHTML = (g, cls = "") => `<span class="die d${g.sides} ${cls}" data-gig="${g.uid || ""}" title="d${g.sides}${g.value != null ? " = " + g.value : " (fixer: non ancora tirato)"}">${dieSVG(g.sides)}<b>${g.value ?? ""}</b><small>d${g.sides}</small></span>`;

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
  const status = G.winner != null ? `Fine: ${esc(G.reason)}` : G.phase === "roll" ? (G.pending && human[G.pending.player] ? "Hai vinto il tiro: scegli chi inizia" : `${esc(G.players[G.pending ? G.pending.player : 0].name)} ha vinto il tiro e sceglie…`) : waitMull ? `Mulligan: in attesa di ${esc(R.name)}` : myTurn ? "Il tuo turno" : human[G.active] || gmode === "online" ? `Turno di ${esc(G.players[G.active].name)}` : "Turno dell'IA…";
  const last = G.log.slice(-1)[0];
  if(gmode === "hot"){ const need = hotNeeded(); handoff = need != null && need !== holder ? need : false; }
  const ob = handoff !== false ? null : onBoardAsk();   // reazione o bersaglio da scegliere toccando la plancia
  // misura delle carte dall'altezza disponibile: 2 righe rivale + campo + pile + mano (1,15×) + barra e margini
  // altezza utile: senza i margini di sicurezza (su iPhone in orizzontale la barra della home toglie ~20px)
  const cs = getComputedStyle(board), H = board.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
  board.style.setProperty("--bh", H + "px");
  if(drag){ drag = null; killGhosts(); }   // un ridisegno durante un trascinamento lo annulla, senza lasciare copie in giro
  const prevSnap = snapBoard(board);
  // carte grandi quanto lo schermo permette (anche su un monitor da PC), senza superare la larghezza utile;
  // --bz ingrandisce in proporzione scritte, dadi e pile (resta 1 sui telefoni)
  // plancia «a colonna» (beta, Impostazioni → Simulator): contatori, Leggende e dadi in una colonna a sinistra,
  // le righe centrali solo per le carte; su schermi larghi registro e chat in un pannello a destra
  const rail = boardLayout() === "rail", W = board.clientWidth, logW = rail && W >= 1100 ? 300 : 0;
  let cw;
  if(rail){ cw = Math.max(24, Math.min(150, (H - 70) / 4.81, (W - logW - 60) / 9.8)); }
  else cw = Math.max(24, Math.min(150, (H - 110) / (1.4 * 4.15 + 0.6), (W - 320) / 9));
  const railW = rail ? Math.max(150, Math.round(cw * 2.3)) : 0;
  board.classList.toggle("rail", rail); board.classList.toggle("logp", logW > 0);
  board.style.setProperty("--cw", cw.toFixed(1) + "px"); board.style.setProperty("--railw", railW + "px"); board.style.setProperty("--logw", logW + "px");
  board.style.setProperty("--bz", Math.max(1, Math.min(2.2, cw / 52)).toFixed(3));
  const stacksHTML = (P, mine) => `
        <div class="stack" title="Mazzo" data-deck="${P.id}"><b>${P.deck.length}</b><small>mazzo</small></div>
        ${mine ? "" : `<div class="stack" title="Mano" data-handc="${P.id}"><b>${P.hand.length}</b><small>mano</small></div>`}
        <div class="stack ed${readyEddies(P) ? "" : " lo"}${pm && pm.player === P.id && payOpt(o => o.kind === "eddie") >= 0 ? " target" : ""}" data-eddies="${P.id}" title="Eddies: pronti/totali"><b>${readyEddies(P)}/${P.eddies.length}</b><small>€$</small></div>
        <div class="stack" data-trash="${P.id}" title="Trash"><b>${P.trash.length}</b><small>trash</small></div>
        <div class="legs" style="display:flex;gap:3px">${P.legends.map(l => legendHTML(l, mine)).join("")}</div>
        <div style="flex:1"></div>
        <div class="dice" data-owner="${P.id}">${P.gigs.map(g => dieHTML(g)).join("")}${P.fixer.map(s => dieHTML({ sides: s }, "fx")).join("")}<span class="cred">☆ ${streetCred(P)} · ${P.gigs.length} Gig</span></div>`;
  const railSideHTML = (P, mine) => `<div class="rs ${mine ? "mine" : "rival"}" data-side="${P.id}">
        <div class="who">${esc(P.name)}</div>
        <div class="cnt"><div class="stack" title="Mazzo" data-deck="${P.id}"><b>${P.deck.length}</b><small>mazzo</small></div><div class="stack" data-trash="${P.id}" title="Trash"><b>${P.trash.length}</b><small>trash</small></div></div>
        <div class="res"><div class="stack ed${readyEddies(P) ? "" : " lo"}${pm && pm.player === P.id && payOpt(o => o.kind === "eddie") >= 0 ? " target" : ""}" data-eddies="${P.id}" title="Eddies: pronti/totali"><b>${readyEddies(P)}/${P.eddies.length}</b><small>€$</small></div><div class="legs">${P.legends.map(l => legendHTML(l, mine)).join("")}</div></div>
        <div class="dice" data-owner="${P.id}">${P.gigs.map(g => dieHTML(g)).join("")}${P.fixer.map(s => dieHTML({ sides: s }, "fx")).join("")}<span class="cred">☆ ${streetCred(P)} · ${P.gigs.length} Gig</span></div>
        ${mine ? "" : `<div class="rhand" data-handc="${P.id}" title="Carte in mano">${"<i></i>".repeat(Math.min(10, P.hand.length))}<span>${P.hand.length} in mano</span></div>`}
      </div>`;
  const rivalFieldHTML = `<div class="brow field" data-field="${R.id}"><span class="lbl">${esc(R.name)}</span>${R.field.map(u => cardHTML(u, (targeting && targeting.kind === "attack" && u.spent) ? "target" : "")).join("") || `<span style="color:var(--mute)">nessuna Unità</span>`}</div>`;
  const logPanelHTML = logW ? `<div class="logpanel"><h4>Registro</h4><div class="lgl">${G.log.slice(-60).map(e => `<div class="e ${e.kind}">${esc(e.text)}</div>`).join("")}</div>${gmode === "online" ? `<button class="btn sm" id="bChat2">💬 Chat del tavolo${ON.T.chatUnread && !chatOpen() ? ` (${ON.T.chatUnread})` : ""}</button>` : ""}</div>` : "";
  board.innerHTML = `${feed.length ? `<div id="oppFeed" role="status" aria-live="polite">${feed.map(t => `<div>${esc(t)}</div>`).join("")}</div>` : ""}
    ${rail ? `<div class="railbox">${railSideHTML(R, false)}${railSideHTML(M, true)}</div>` : ""}
    <div class="bmain">
    <div class="bz rival">
      ${rail ? "" : `<div class="brow">${stacksHTML(R, false)}</div>`}
      ${rivalFieldHTML}
    </div>

    <div class="bstrip${ob ? " asking" : ""}">
      ${ob ? onBoardStrip(ob) : `<span class="st">T${G.turn} · ${status}</span>`}
      ${ob ? "" : `<span class="lg" id="lastLog" title="${esc(last ? last.text : "")}">${payTxt ? payTxt + " · " : ""}${noteMsg ? `<b id="noteMsg" style="color:var(--acc2)">${esc(noteMsg)} · </b>` : ""}${pendingTxt ? `<b>${esc(pendingTxt)}</b> · ` : ""}${esc(last ? last.text : "")}</span>`}
      ${!ob && myTurn && human[M.id] && tutorialAllows("end") ? `<button class="btn sm yel" id="bEnd">Fine turno</button>` : ""}
      ${ob ? "" : pm ? `${payOpt(o => o.kind === "alleddies") >= 0 ? `<button class="btn sm acc2" id="bPayAll">Tutto con Eddies</button>` : ""}<button class="btn sm" id="bPayCancel">Annulla</button>` : targeting ? `<button class="btn sm" id="bCancel">Annulla</button>` : ""}
      ${gmode === "online" ? `<span id="onlBadge">${onlineBadgeHTML()}</span><button class="btn sm icon" id="bChat" title="Chat del tavolo">💬${ON.T.chatUnread && !chatOpen() ? `<span class="nbadge">${ON.T.chatUnread}</span>` : ""}</button>` : ""}
      ${boardChat ? `<button class="btn sm acc2" id="bFChat" title="Messaggio di ${esc(boardChat.nick)}: ${esc(String(boardChat.body || "").slice(0, 60))}">💬 ${esc(boardChat.nick)}${boardChat.n > 1 ? ` (${boardChat.n})` : ""}</button>` : ""}
      ${logW ? "" : `<button class="btn sm icon" id="bLog" title="Registro">≡</button>`}
      <button class="btn sm icon" id="bMenu" title="Menù">⋯</button>
    </div>

    <div class="bz mine">
      <div class="brow field" data-field="${M.id}"><span class="lbl">${esc(M.name)}</span>${M.field.map(u => cardHTML(u, targeting && targeting.kind === "gear" ? "target" : "")).join("") || `<span style="color:var(--mute)">nessuna Unità in campo</span>`}</div>
      ${rail ? "" : `<div class="brow">${stacksHTML(M, true)}</div>`}
      <div class="brow hand" data-handrow="${M.id}"><span class="lbl">mano · ${ready(M)} €$</span>${handHTML || `<span style="color:var(--mute)">mano vuota</span>`}</div>
    </div>
    </div>
    ${logPanelHTML}
    ${tutorialActive() ? tutorialBarHTML(G, me()) : ""}
    ${showLog ? `<div id="simLog"><div style="display:flex;justify-content:space-between;align-items:center"><b>Registro</b><button class="btn sm icon" id="bLogClose">✕</button></div>${G.log.slice(-80).map(e => `<div class="e ${e.kind}">${esc(e.text)}</div>`).join("")}</div>` : ""}
    ${handoff !== false ? "" : mulliganPending() != null ? mulliganHTML() : pm || ob ? "" : G.pending && human[G.pending.player] ? askHTML() : ""}
    ${G.winner != null ? `<div class="winbox"><div class="box"><h2>${G.winner === -1 ? "PATTA" : G.winner === me() ? "VITTORIA" : gmode === "hot" ? "VINCE " + esc(G.players[G.winner].name).toUpperCase() : "SCONFITTA"}</h2><p class="wflav">${G.winner === -1 ? "Stavolta la città non è di nessuno." : G.winner === me() || gmode === "hot" ? "Night City ricorderà il tuo nome." : "Flatline. Rialzati, choom."}</p><p>${esc(G.reason)}</p><p style="color:var(--mute)">${G.turn} turni</p>${gmode === "online" ? seriesHTML() : ""}<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">${gmode === "online" ? `<button class="btn" id="bChat2">💬 Chat</button>${series && series.next ? `<button class="btn acc2" id="bNextGame">Partita successiva</button>` : ""}<button class="btn yel" id="bExit">Torna alla lobby</button>` : `<button class="btn yel" id="bAgain">Rivincita</button><button class="btn" id="bExit">Esci</button>`}</div></div></div>` : ""}
    ${gmode === "online" ? drawOfferHTML() : ""}
    ${peekPid ? `<div id="peek">${peekInner(peekPid)}</div>` : ""}
    ${handoff != null && handoff !== false ? (() => { const who = G.players[handoff], rec = hotRecap(handoff), what = mulliganPending() === handoff ? "Tocca a te scegliere se tenere la mano." : G.phase === "roll" ? "Hai vinto il tiro: scegli chi inizia." : "";
      return `<div class="handoff"><h2>Passa il dispositivo a ${esc(who.name)}</h2><p>${what || "Il tuo rivale non guarda, promesso."}</p>${rec.length ? `<div class="recap"><h4>Cosa è successo mentre non guardavi</h4>${rec.map(e => `<div class="e ${e.kind}">${esc(e.text)}</div>`).join("")}</div>` : ""}<button class="btn yel" id="bHand">Sono ${esc(who.name)}, pronto</button></div>`; })() : ""}`;
  board.classList.toggle("asking", !!ob); board.classList.remove("ask-wait");
  if(ob && !applyOnBoard(board, ob)){ askList = G.pending; render(); return; }   // nessuna carta trovata sulla plancia: finestra classica
  fitBoard(board, H);
  board.classList.toggle("fx", fxOn());
  fxBanner(board);   // prima delle animazioni: vetrina e dado si mettono in fila dopo la fascia
  animateBoard(board, prevSnap);
  // una scelta compare dopo la fascia e dopo gli effetti in fila (es. l'abilità di una Leggenda che scatta a scontro finito)
  const askEl = $("#simAsk"), askLeft = Math.max(fxAskUntil, fxBusyUntil) - performance.now();
  if(askEl && askLeft > 60 && fxOn()) askEl.animate([{ opacity: 0, visibility: "hidden" }, { opacity: 0, visibility: "hidden", offset: .97 }, { opacity: 1, visibility: "visible" }], { duration: askLeft, fill: "backwards" });
  if(ob && askLeft > 60){ board.classList.add("ask-wait"); const pend = G.pending; setTimeout(() => { if(G && G.pending === pend) board.classList.remove("ask-wait"); }, askLeft); }
  const hl = tutorialHighlight(); if(hl) $$("#board " + hl.split(",").join(", #board ")).forEach(x => x.classList.add("tuthl"));
  if(showLog){ const l = $("#simLog"); l.scrollTop = l.scrollHeight; }
  // scelta tra carte: subito la miniatura, poi l'immagine grande appena è scaricata (leggibile anche il testo)
  $$("#simAsk .pk img[data-full], #simAsk .mc img[data-full]").forEach(img => { const full = img.dataset.full, pre = new Image(); pre.onload = () => { if(img.isConnected) img.src = full; }; pre.src = full; });
  if(tutorialActive() && tutorialStep(G, me())) { /* passo completato: la barra si aggiorna al prossimo ridisegno */ setTimeout(() => { if(G) render(); }, 0); }
}

/* richieste risolte direttamente sulla plancia (grafiche avanzate): la reazione a un attacco (Blocker, Leggende coperte,
   carte Quick in mano e abilità Quick si accendono con un'etichetta; «Non reagire» e «Lista» nella barra) e il bersaglio
   di un effetto fra le carte in campo («Scegli» sulle candidate, la carta che produce l'effetto nella barra).
   «Lista» riapre la finestra classica per la richiesta in corso. */
let askList = null;
function onBoardAsk(){
  const p = G && G.pending; if(!p || !human[p.player] || !fxOn() || askList === p || tutorialTour()) return null;
  if(gmode === "hot" && p.player !== G.active && reactCover !== p) return null;
  const P = G.players[p.player];
  if(p.kind === "block"){
    const marks = [], extra = [];
    p.options.forEach((o, i) => {
      if(o.kind === "none"){ extra.push({ i, label: o.label, cls: "yel" }); return; }
      if(o.kind === "block") marks.push({ i, uid: o.uid, label: "Blocca" });
      else if(o.kind === "call"){ const l = P.legends[o.idx]; if(l) marks.push({ i, uid: l.uid, label: "Chiama", cost: "1 €$", cls: "yel" }); else extra.push({ i, label: o.label }); }
      else if(o.kind === "quick") marks.push({ i, uid: o.uid, label: "Quick", cost: `${(o.c && o.c.card.cost) || 0} €$` });
      else if(o.kind === "qspend") marks.push({ i, uid: o.uid, label: "Quick", cost: "abilità" });
      else extra.push({ i, label: o.label });
    });
    const a = p.ctx && p.ctx.attacker, t = p.ctx && p.ctx.target;
    const text = a ? `<b>${esc(a.card.dn)} (${powerIn(G, G.players[G.active], a, { attacking: true })})</b> attacca ${t ? `<em>${esc(t.card.dn)} (${shownPower(t)})</em>` : "la tua area Gig"} · tocca un Blocker, una Leggenda coperta o una carta Quick` : "Reagisci: tocca una carta accesa";
    return { kind: "block", title: "Reazione", marks, extra, text, hot: a ? a.uid : null, focus: t ? t.uid : null };
  }
  if(p.kind === "target"){
    const marks = [], extra = [];
    for(const [i, o] of p.options.entries()){ if(o.unit && o.unit.uid != null) marks.push({ i, uid: o.unit.uid, label: "Scegli" }); else if(!o.unit) extra.push({ i, label: o.label }); else return null; }
    if(!marks.length) return null;
    const text = `${p.ctx && p.ctx.src ? `<b>${esc(p.ctx.src)}</b> · ` : ""}${esc(p.ctx && p.ctx.text ? p.ctx.text : "scegli il bersaglio")} <em>(tocca la carta)</em>`;
    return { kind: "target", title: "Scelta", marks, extra, text, srcPid: p.ctx && p.ctx.srcPid };
  }
  return null;
}
function onBoardStrip(ob){
  return `<span class="st">${ob.title}</span>${ob.srcPid ? `<img class="rsrc" src="${thumbUrl(ob.srcPid)}" alt="">` : ""}<span class="lg react">${ob.text}</span>${ob.extra.map(x => `<button class="btn sm ${x.cls || ""}" data-ask="${x.i}">${esc(x.label)}</button>`).join("")}<button class="btn sm" id="bAskList" title="Mostra le opzioni in una finestra">Lista</button>`;
}
function applyOnBoard(board, ob){
  const find = uid => [...board.querySelectorAll(`[data-uid="${uid}"]`)].find(e => !e.closest("#flyLayer") && !e.classList.contains("up"));
  let any = false;
  for(const m of ob.marks){ const el = find(m.uid); if(!el) continue; any = true; el.dataset.rx = m.i; if(!el.dataset.legend){ el.dataset.rlabel = m.label; if(m.cost) el.dataset.rcost = m.cost; } if(m.cls) el.classList.add("rx-" + m.cls); }   // sulle Leggende (piccole) solo il contorno: giallo per chiamare, ciano per l'abilità Quick
  if(ob.hot != null){ const el = find(ob.hot); if(el) el.classList.add("rhot"); }
  if(ob.focus != null){ const el = find(ob.focus); if(el) el.classList.add("rfocus"); }
  board.classList.add("asking");
  return any;
}
/* richieste del motore (dado, blocco, furto, bersaglio…) */
function askHTML(){
  const p = G.pending, P = G.players[p.player];
  const titles = { die: "Quale dado tiri dal fixer?", block: `${esc(P.name)}: come reagisci?`, steal: "Quale Gig rubi?", target: "Scegli il bersaglio", discard: "Scegli la carta da scartare", gigpick: "Quale Gig?", gigvalue: "Nuovo valore", pickcard: "Scegli la carta", choice: "Scegli un effetto", yesno: "Vuoi farlo?", pay: p.ctx && p.ctx.confirm ? `Per pagare ${p.ctx.cost} €$ serve una Leggenda che ha un effetto quando la spendi (abilità {Spend} o un Gear come Zetatech Faceplate): la spendo?` : `Come paghi? ${p.ctx ? `${p.ctx.paid}/${p.ctx.cost} €$ pagati` : ""}` , ...(p.ctx && p.ctx.goFirst ? { choice: "Hai vinto il tiro iniziale: chi inizia?" } : {}) };
  const ctx = p.kind === "block" && p.ctx.attacker ? `<p style="color:var(--ink2);margin:0 0 8px">${esc(p.ctx.attacker.card.dn)} (${powerIn(G, G.players[G.active], p.ctx.attacker, { attacking: true })}) attacca ${p.ctx.target ? esc(p.ctx.target.card.dn) + " (" + shownPower(p.ctx.target) + ")" : "la tua area Gig"}. Puoi bloccare, chiamare una Leggenda o usare una carta Quick, anche più volte.</p>` : "";
  // in due sullo stesso dispositivo: la decisione del difensore si apre solo dopo un tocco, così l'attaccante non vede le sue carte
  if(gmode === "hot" && p.player !== G.active && reactCover !== p) return `<div id="simAsk"><div class="box"><h3>Reazione di ${esc(P.name)}</h3><p>${esc(G.players[G.active].name)}, passa il dispositivo: le opzioni del rivale compaiono solo dopo il suo tocco.</p><div class="opts"><button class="btn yel" data-react="1">Sono ${esc(P.name)}, mostra le opzioni</button></div></div></div>`;
  if((p.kind === "pickcard" || p.kind === "discard") && p.options.some(o => o.c && o.c.pid)) return pickerHTML(p, P, titles[p.kind]);
  // grafiche avanzate: la scelta del dado è un pannello in basso che lascia vedere la plancia, con il fixer del rivale e la Street Cred
  if(p.kind === "die" && p.options.every(o => o.sides) && fxOn()){
    const R = rival(G, P);
    return `<div id="simAsk" class="fxsheet"><div class="box"><h3>Tira un dado dal fixer</h3><div class="row">${p.options.map((o, i) => `<button class="btn die-opt" data-ask="${i}"${o.disabled ? " disabled" : ""}><span class="die d${o.sides}">${dieSVG(o.sides)}<small>d${o.sides}</small></span><small class="avg">media ${(o.sides + 1) / 2}</small></button>`).join("")}
      <div style="flex:1"></div><div class="side"><span>Fixer di ${esc(R.name)}</span>${R.fixer.length ? R.fixer.map(s => `<span class="die d${s} fx">${dieSVG(s)}<small>d${s}</small></span>`).join("") : "<span>—</span>"}</div></div>
      <div class="side">Street Cred · <b>${P.id === me() ? "tu" : esc(P.name)} ${streetCred(P)}</b> · <b>${esc(R.name)} ${streetCred(R)}</b></div></div></div>`;
  }
  // da dove viene la richiesta (anche per un furto di Gig dovuto a un Gear o a un Programma, es. Gorilla Arms: il furto dell'attacco non ha fonte)
  const srcLine = p.ctx && p.ctx.src && p.kind !== "die" && p.kind !== "block" ? `<div class="sub" style="margin:-4px 0 8px">${p.ctx.srcPid ? `<img src="${thumbUrl(p.ctx.srcPid)}" alt="" style="width:28px;vertical-align:middle;border-radius:2px;margin-right:6px">` : ""}<b>${esc(p.ctx.src)}</b>${p.ctx.text ? ` — ${esc(p.ctx.text)}` : ""}</div>` : "";
  return `<div id="simAsk"><div class="box"><h3>${titles[p.kind] || "Scegli"}</h3>${srcLine}${ctx}<div class="opts">${p.options.map((o, i) => {
    const pid = o.unit?.pid || o.c?.pid || o.g?.pid, gig = o.gig && o.gig.sides ? o.gig : null;
    // un Gig da scegliere (rubare, scambiare, copiare) si mostra come dado con il valore; resta il prefisso del testo («tuo», «rivale», «come»)
    const gigCap = gig ? esc(o.label.replace(/d\d+\s*=\s*\d+/, "").trim()) : "";
    return `<button class="btn${pid ? " card-opt" : ""}${(p.kind === "die" && o.sides) || gig ? " die-opt" : ""}" data-ask="${i}"${o.disabled ? " disabled" : ""}>${pid ? `<img src="${thumbUrl(pid)}" alt="">` : ""}${p.kind === "die" && o.sides ? `<span class="die d${o.sides}">${dieSVG(o.sides)}<small>d${o.sides}</small></span>` : gig ? `${gigCap ? `<small class="cap">${gigCap}</small>` : ""}<span class="die d${gig.sides}">${dieSVG(gig.sides)}<b>${gig.value}</b><small>d${gig.sides}</small></span>` : esc(o.label)}</button>`; }).join("")}</div></div></div>`;
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
  for(const g of u.gear || []) items.push({ label: `Gear: ${g.card.dn} (ingrandisci)`, fn: () => openLens(imgUrl(g.pid)) });

  openPop(el, items, `${u.card.dn} · potenza ${shownPower(u)}`);
}
function legendCard(el, owner){
  const P = G.players[owner], l = P.legends.find(x => x.uid === +el.dataset.uid); if(!l) return;
  const M = G.players[me()], mine = owner === M.id;
  const myTurn = G.active === M.id && G.phase === "main" && !G.pending && G.winner == null && human[M.id];
  if(targeting && targeting.kind === "gear" && mine && l.faceUp && !l.onField && !l.removed && myTurn){ after(act(M.id, { t: "play", uid: targeting.uid, target: l.uid })); return; }
  const items = [], idx = P.legends.indexOf(l);
  if(mine && myTurn && !l.removed && !l.onField){
    if(!l.faceUp) items.push({ label: "Chiama questa Leggenda (1 €$)", cls: "acc", disabled: P.called || !canPay(P, 1) || !tutorialAllows("call"), fn: () => after(act(M.id, { t: "call", idx })) });
    if(l.faceUp && (l.card.kw || []).includes("Go Solo") && l.card.cost != null) items.push({ label: `Go Solo (${l.card.cost} €$): entra come Unità pronta${l.spent ? "" : ", può pagare 1 €$ da sé"}`, disabled: !canPay(P, l.card.cost) || !tutorialAllows("gosolo"), fn: () => after(act(M.id, { t: "gosolo", idx })) });
    if(l.faceUp && l.fx.spend.length) items.push({ label: "Abilità {Spend}", disabled: l.spent || !tutorialAllows("spend"), fn: () => after(act(M.id, { t: "spend", uid: l.uid })) });
    if(MANUAL) items.push({ label: l.spent ? "Prepara (manuale)" : "Spendi come 1 €$ (manuale)", fn: () => { manual.toggleSpent(G, owner, l.uid); after(); } });
    if(MANUAL && !l.faceUp) items.push({ label: "Scopri senza chiamare (manuale)", fn: () => { manual.flip(G, owner, idx); after(); } });
  }
  if(l.faceUp){ items.push({ label: "Ingrandisci", fn: () => openLens(imgUrl(l.pid)) }, { label: "Scheda carta", fn: () => openCard(l.cid, l.pid) }); for(const g of l.gear || []) items.push({ label: `Gear: ${g.card.dn} (ingrandisci)`, fn: () => openLens(imgUrl(g.pid)) }); }
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
    const kb = e.target.closest("#simKind button"); if(kb){ if(kb.dataset.v === "rules"){ location.hash = "#rules"; return; } kind = kb.dataset.v; S.settings.simKind = kind; S.save("settings"); renderSim(); return; }
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

  const dropTarget = (x, y, dd = drag) => {
    const M = G.players[me()], el = document.elementFromPoint(x, y); if(!el) return null;
    const ed = el.closest(`[data-eddies="${M.id}"]`); if(ed) return { kind: "sell", el: ed };
    let bc = el.closest(".bc"); if(bc && bc.dataset.gearOf) bc = bc.closest("[data-w]").querySelector(".bc.host") || bc;
    if(bc && bc.closest(`[data-field="${M.id}"]`)) return { kind: "unit", el: bc, uid: +bc.dataset.uid };
    // vendita: il bersaglio non è solo la pila degli €$ ma tutta la tua zona dei contatori
    // (a colonna: il tuo riquadro laterale; classica: Mazzo, €$ e Trash). Le Leggende restano bersagli dei Gear.
    const dc = dd && dd.legendIdx == null ? M.hand.find(h => h.uid === dd.uid) : null, edp = $(`#board [data-eddies="${M.id}"]`);
    if(dc && dc.card.eddiable && edp && !(dc.card.type === "Gear" && bc && bc.dataset.legend)){
      const st = el.closest(".stack"); if(el.closest(".rs.mine") || (st && st.parentElement === edp.parentElement)) return { kind: "sell", el: edp };
    }
    if(bc && bc.dataset.legend && +bc.dataset.lo === M.id){ const l = M.legends.find(l => l.uid === +bc.dataset.uid); if(l && l.faceUp && !l.onField && !l.removed) return { kind: "legend", el: bc, uid: l.uid }; if(l && !l.faceUp) return { kind: "facedown", el: null }; }
    const zone = el.closest(".bz.mine"); if(zone && !el.closest("[data-handrow], .rs")) return { kind: "field", el: zone.querySelector(`[data-field="${M.id}"]`) };
    return null;
  };
  board.addEventListener("pointerdown", e => {
    if(drag) return;                                   // un secondo dito non avvia un altro trascinamento
    if(!e.isPrimary || !G || G.winner != null) return;
    const M = G.players[me()]; if(G.active !== M.id || G.phase !== "main" || G.pending || !human[M.id] || oppBusy()) return;
    const el = e.target.closest("[data-handrow] .bc");
    const lg = !el && e.target.closest(`[data-legend][data-lo="${M.id}"]`);
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
    // il bersaglio si legge prima di togliere le zone evidenziate (l'area «Vendi» grande è una di loro)
    const t = d.active && e.type !== "pointercancel" ? dropTarget(e.clientX, e.clientY, d) : null;
    killGhosts();
    if(!d.active) return;
    // (nessun "click" segue un trascinamento che finisce su un altro elemento: non serve ignorarlo)
    const M = G.players[me()];
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
    if(t.closest("#bEnd")){ const ok = act(me(), { t: "end" }); after(ok); return; }
    if(t.closest("#bCancel")){ targeting = null; sel = null; render(); return; }
    if(t.closest("#bLog")){ showLog = !showLog; render(); return; }
    if(t.closest("#bLogClose")){ showLog = false; render(); return; }
    if(t.closest("#bMenu")){ menu(t.closest("#bMenu")); return; }
    if(t.closest("#bChat") || t.closest("#bChat2")){ openTableChat(); return; }
    if(t.closest("#bFChat")){ const id = boardChat && boardChat.id; boardChat = null; render(); if(id) document.dispatchEvent(new CustomEvent("ncd:openchat", { detail: id })); return; }
    const dr = t.closest("[data-draw]"); if(dr){ ON.answerDraw(dr.dataset.draw === "1").catch(err => note(err.message)); return; }
    if(t.closest("#bNextGame")){ clearTimeout(seriesT); ON.nextGame().catch(err => note(err.message)); return; }
    if(t.closest("#bAgain")){ $("#board").hidden = true; renderSim(); start(); return; }
    if(t.closest("#bExit")){ closeBoard(); return; }
    if(t.closest("#bHand")){ const to = handoff; if(holder != null) seenLog[holder] = G.log[G.log.length - 1] || null; holder = to; handoff = false; render(); tick(); return; }
    if(t.closest("[data-react]")){ reactCover = G.pending; render(); return; }
    const rx = t.closest("[data-rx]"); if(rx && G.pending && !board.classList.contains("ask-wait")){ if(G.pending.kind === "block") G.tutReacted = true; res(+rx.dataset.rx); render(); tick(); return; }
    if(t.closest("#bAskList")){ askList = G.pending; render(); return; }
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
    const gc = t.closest("[data-gear-of]"); if(gc){ const host = +gc.dataset.gearOf; if(gearOpen !== host){ gearOpen = host; render(); } else gearCard(gc); return; }
    const hand = t.closest("[data-hand=\"1\"]"); if(hand){ handCard(hand, G.players[me()]); return; }
    const leg = t.closest("[data-legend]"); if(leg){ legendCard(leg, +leg.dataset.lo); return; }
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
window.__ncdSim = { chat: () => openTableChat(), G: () => G, seat: () => me(), clocks: () => clocks(), render: () => render(), asOpp: fn => { markMove("opp"); fn(); render(); },
  // solo in locale (collaudi): una partita online finta, senza server
  ...(/^(127\.0\.0\.1|localhost)$/.test(location.hostname) ? { fakeOnline: (row, moves) => { ON.T.row = row; ON.T.seat = 0; ON.T.nicks = ["A", "B"]; ON.T.ended = null; ON.T.stamps = moves.map(m => m.at); hooksForTest.start(row, 0, ["A", "B"], moves.map(m => ({ move: m.move, seat: m.seat }))); } } : {}), act: a => { const r = act(me(), a); after(r); return r; }, res: i => { res(i); render(); tick(); } };
/* per la Home: partita da riprendere e scorciatoia alla lobby online */
export const simInProgress = () => G && G.winner == null ? (gOnline ? "online" : "offline") : null;
export function resumeSim(){ if(G && G.winner == null){ openBoard(); render(); tick(); } }
export function showOnline(){ mode = "online"; renderSim(); }
