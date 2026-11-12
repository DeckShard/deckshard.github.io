/* Scanner della collezione: inquadri le carte una dopo l'altra, l'app
   legge il testo con l'OCR (Tesseract.js, caricato solo quando serve), lo
   abbina alle 151 carte del catalogo e mette ogni riconoscimento in una
   lista di sessione, che rivedi e poi aggiungi alla collezione in blocco.
   Funziona anche a scatto singolo o da una foto.                        */

import { DATA, thumbUrl } from "./data.js";
import { S, qtyOf, setQty } from "./store.js";
import { $, $$, esc, toast, openCard, askConfirm } from "./ui.js";

const TESS_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const AUTO_MIN = 0.7;        // punteggio minimo per l'aggiunta automatica
const AUTO_STABLE = 2;       // letture consecutive uguali prima di aggiungere
const AUTO_GAP = 2;          // letture "vuote" prima di poter riaggiungere la stessa carta
let worker = null, stream = null, busy = false, wired = false, lastHits = [], lastCamSig = null;
let auto = true, loopT = null, lastGuess = null, stableN = 0, lastAdded = null, gap = AUTO_GAP, flashT = null;

/* lista di sessione: resta salvata finché non la aggiungi o la svuoti */
let STAGE = (() => { try{ return JSON.parse(localStorage.getItem("ncd:scanlist") || "[]"); }catch(e){ return []; } })();
const saveStage = () => { try{ localStorage.setItem("ncd:scanlist", JSON.stringify(STAGE)); }catch(e){} };
export const stageCount = () => STAGE.reduce((a, e) => a + e.n, 0);
function stageAdd(c, pid, n = 1, twins){
  const e = STAGE.find(x => x.cid === c.id && x.pid === pid);
  if(e){ e.n += n; if(twins && twins.length > 1) e.tw = twins; } else STAGE.unshift({ cid: c.id, pid: pid || c.def.id, n, ...(twins && twins.length > 1 ? { tw: twins } : {}) });
  saveStage(); renderStage();
}

/* ------------------------------------------------------------ abbinamento */
const norm = s => String(s || "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function bigrams(s){ const out = new Map(); const t = s.replace(/ /g, ""); for(let i = 0; i < t.length - 1; i++){ const b = t.slice(i, i + 2); out.set(b, (out.get(b) || 0) + 1); } return out; }
function dice(a, b){
  if(!a.size || !b.size) return 0;
  let inter = 0; for(const [k, v] of a) if(b.has(k)) inter += Math.min(v, b.get(k));
  let na = 0, nb = 0; for(const v of a.values()) na += v; for(const v of b.values()) nb += v;
  return 2 * inter / (na + nb);
}
let INDEX = null;
const TYPE_WORDS = new Set(["LEGEND", "UNIT", "PROGRAM", "GEAR"]);   // l'etichetta del tipo stampata sulla carta: non è un nome
const wordsOf = s => new Set(s.split(" ").filter(w => w.length >= 3));
function index(){
  if(INDEX) return INDEX;
  INDEX = DATA.cards.map(c => {
    const full = norm(c.dn), name = norm(c.name), sub = norm(c.sub);
    // senza i promemoria tra parentesi, uguali su molte carte
    const body = norm([c.cls.join(" "), String(c.text || "").replace(/\([^)]*\)/g, " "), c.flavor].filter(Boolean).join(" "));
    return { c, full, name, sub, bFull: bigrams(full), bName: bigrams(name), bSub: bigrams(sub), wBody: wordsOf(body), bBody: bigrams(body) };
  });
  return INDEX;
}
/* ritorna i candidati ordinati per punteggio: nome (righe OCR) + testo di regole.
   Il testo conta a parole intere (le coppie di lettere si trovano per caso in qualsiasi lettura lunga), e pesa meno
   se la carta ha poche parole proprie (Leggende fatte quasi solo di promemoria tra parentesi). */
export function matchText(text){
  const lines = text.split(/\n/).map(l => norm(l).split(" ").filter(w => !TYPE_WORDS.has(w)).join(" ")).filter(l => l.length >= 3);
  const cands = lines.slice();
  for(let i = 0; i + 1 < lines.length; i++) cands.push(lines[i] + " " + lines[i + 1]);   // nomi su due righe (Leggende)
  const ocrWords = wordsOf(norm(text.replace(/\([^)]*\)/g, " "))), bAll = bigrams(norm(text));
  const out = [];
  for(const e of index()){
    let best = 0, subBest = 0;
    for(const l of cands){
      const bl = bigrams(l);
      let s = dice(bl, e.bFull);
      if(e.sub){ const ds = dice(bl, e.bSub); s = Math.max(s, (dice(bl, e.bName) + ds) / 2, dice(bl, e.bName) * 0.85); if(e.sub.length >= 8) s = Math.max(s, ds * 0.9); if(ds > subBest) subBest = ds; }   // anche il solo sottotitolo identifica la carta
      else s = Math.max(s, dice(bl, e.bName));
      const L = " " + l + " ";
      if(L.includes(" " + e.full + " ") || (l.length >= 8 && l.includes(" ") && (" " + e.full + " ").includes(L))) s = Math.max(s, 0.9);   // a parole intere: «LEGEND» non è «… OF LEGENDS»
      if(s > best) best = s;
    }
    let hit = 0; for(const w of e.wBody) if(ocrWords.has(w)) hit++;
    let inter = 0, nb = 0; for(const [k, v] of e.bBody){ nb += v; if(bAll.has(k)) inter += Math.min(v, bAll.get(k)); }
    const nw = e.wBody.size, body = nw >= 3 ? Math.max(hit / nw, nb ? inter / nb * 0.9 : 0) * Math.min(1, nw / 6) : 0;   // parole intere, o lettere a coppie se l'OCR storpia
    // a parità di nome (più carte dello stesso personaggio) decide quanto si legge del sottotitolo
    const score = Math.max(best, body * 0.95, best * 0.6 + body * 0.5) + subBest * 0.12;
    out.push({ card: e.c, score, nameScore: best, bodyScore: body });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 5).filter(x => x.score >= 0.35);
}

/* ------------------------------------------------------------ variante dall'illustrazione
   Due passi. 1) L'illustrazione: tra le stampe della carta si cerca quella con l'arte più simile,
   provando piccoli spostamenti e zoom dell'inquadratura (la carta non è mai perfetta nel riquadro).
   2) Le gemelle: molte stampe hanno la stessa identica arte (retail e beta, starter, ristampe) e
   cambiano solo per timbri e codici minuscoli. Lì decidono l'«Edizione» scelta nello scanner e, se
   c'è, un timbro grande (prerelease, Edgerunner) nella zona in alto a destra. Nel dubbio la stampa
   resta quella dell'edizione scelta e la riga della lista mostra le gemelle da toccare. */
let STAMP_GAP = 0.06;
const SIG = 24, PDESC = new Map(), GROUPS = new Map();
const ART = [0.06, 0.12, 0.88, 0.46], STAMP = [0.55, 0.07, 0.43, 0.20], TAG = [0, 0.85, 0.22, 0.15];
/* firma normalizzata (media 0, varianza 1) in scala di grigi di una zona della carta */
function zoneSig(src, bx, by, bw, bh, z, nx = SIG, ny = SIG){
  const cv = document.createElement("canvas"); cv.width = nx; cv.height = ny;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(src, bx + bw * z[0], by + bh * z[1], bw * z[2], bh * z[3], 0, 0, nx, ny);
  const d = ctx.getImageData(0, 0, nx, ny).data, v = new Float32Array(nx * ny);
  let mean = 0; for(let i = 0; i < v.length; i++){ v[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]; mean += v[i]; }
  mean /= v.length; let sd = 0; for(let i = 0; i < v.length; i++){ v[i] -= mean; sd += v[i] * v[i]; } sd = Math.sqrt(sd / v.length) || 1;
  for(let i = 0; i < v.length; i++) v[i] /= sd;
  return v;
}
const signature = (src, sx, sy, sw, sh) => zoneSig(src, sx, sy, sw, sh, ART);
const corr = (a, b) => { let s = 0; for(let i = 0; i < a.length; i++) s += a[i] * b[i]; return s / a.length; };
/* fotografia dell'inquadratura con un margine attorno, per poter provare gli spostamenti senza uscire */
const MARGIN = 0.07;
function snapshot(src, sx, sy, sw, sh, srcW, srcH){
  const W = 440, H = Math.round(W * sh / sw), mx = sw * MARGIN, my = sh * MARGIN;
  const cv = document.createElement("canvas"); cv.width = Math.round(W * (1 + 2 * MARGIN)); cv.height = Math.round(H * (1 + 2 * MARGIN));
  const ctx = cv.getContext("2d", { willReadFrequently: true }); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cv.width, cv.height);
  const k = W / sw, x0 = Math.max(0, sx - mx), y0 = Math.max(0, sy - my), x1 = Math.min(srcW, sx + sw + mx), y1 = Math.min(srcH, sy + sh + my);
  if(x1 > x0 && y1 > y0) ctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, (x0 - (sx - mx)) * k, (y0 - (sy - my)) * k, (x1 - x0) * k, (y1 - y0) * k);
  return { cv, bx: W * MARGIN, by: H * MARGIN, bw: W, bh: H };
}
function printDesc(pid){
  if(PDESC.has(pid)) return PDESC.get(pid);
  const pr = new Promise(res => { const im = new Image(); im.onload = () => { const w = im.naturalWidth, h = im.naturalHeight;
    res({ art: zoneSig(im, 0, 0, w, h, ART), stamp: zoneSig(im, 0, 0, w, h, STAMP, 40, 24), tag: zoneSig(im, 0, 0, w, h, TAG, 20, 16) }); };
    im.onerror = () => res(null); im.src = thumbUrl(pid); });
  PDESC.set(pid, pr); return pr;
}
/* gruppi di stampe con la stessa illustrazione (somiglianza > 0.93 tra le immagini del catalogo) */
function artGroups(card, prints, D){
  if(GROUPS.has(card.id)) return GROUPS.get(card.id);
  const par = prints.map((_, i) => i), f = i => { while(par[i] !== i) i = par[i]; return i; };
  for(let i = 0; i < prints.length; i++) for(let j = i + 1; j < prints.length; j++) if(D[i] && D[j] && corr(D[i].art, D[j].art) > 0.93) par[f(i)] = f(j);
  const g = prints.map((_, i) => f(i)); GROUPS.set(card.id, g); return g;
}
/* edizione che si sta scansionando: decide tra le gemelle (Impostazioni dello scanner, ricordata) */
export const EDITIONS = [["auto", "Auto"], ["retail", "Retail"], ["beta", "Beta"], ["starter", "Starter"], ["starterb", "Starter beta"], ["demo", "Demo"]];
let autoPref = null;   // in «Automatica»: l'edizione dell'ultima correzione fatta a mano in questa sessione
let edition = (() => { try{ const v = localStorage.getItem("ncd:scanEd"); return EDITIONS.some(e => e[0] === v) ? v : "auto"; }catch(e){ return "auto"; } })();
const edClass = p => isDemo(p) ? "demo" : isStarter(p) ? (isBeta(p) ? "starterb" : "starter") : isBeta(p) ? "beta" : "retail";
const isBeta = p => /beta/i.test(p.set) || /^β/.test(p.num), isStarter = p => /starter/i.test(p.set), isDemo = p => /demo/i.test(p.set);
function edRank(p, card){
  const main = /^welcometonightcity/.test(p.set) ? 0 : 1, b = isBeta(p), st = isStarter(p), dm = isDemo(p);
  const want = { retail: !b && !st && !dm, beta: b && !st && !dm, starter: st && !b, starterb: st && b, demo: dm }[edition === "auto" && autoPref ? autoPref : edition];
  if(want !== undefined) return (want ? 0 : 8) + (st || dm ? 2 : 0) + (b ? 1 : 0) + main;
  return p === card.def ? 0 : (b ? 4 : 0) + (st || dm ? 2 : 0) + main + 1;   // automatica: la stampa predefinita del catalogo
}
/* nome breve dell'edizione, per i pulsanti delle gemelle */
const SHORT = [[/^welcometonightcityretail/, "Base"], [/^welcometonightcitybeta/, "Base β"], [/^theheistretail/, "Heist"], [/^theheistbeta/, "Heist β"],
  [/^embracingpowerretail/, "Power"], [/^embracingpowerbeta/, "Power β"], [/^prereleaseretail/, "Prerelease"], [/^prereleasebeta/, "Prerelease β"],
  [/^boxtoppersretail/, "Box topper"], [/^boxtoppersbeta/, "Box topper β"], [/demodeck$/, "Demo"], [/^edgerunner/, "Edgerunner"], [/^nightcitybrawl/, "Brawl"],
  [/^nightcityshowdown/, "Showdown"], [/^judge/, "Judge"], [/^PRM/, "Promo"]];
export const edLabel = p => { const m = SHORT.find(([rx]) => rx.test(p.set)); return `${m ? m[1] : p.set} #${p.num}`; };
/* firme dell'inquadratura con piccoli spostamenti e zoom (la carta non è mai perfetta nel riquadro) */
function camBoxes(cam){
  const boxes = []; for(const s of [0.94, 1, 1.06]) for(const dx of [-0.04, 0, 0.04]) for(const dy of [-0.04, 0, 0.04]){
    const bw = cam.bw * s, bh = cam.bh * s; boxes.push([cam.bx + (cam.bw - bw) / 2 + dx * cam.bw, cam.by + (cam.bh - bh) / 2 + dy * cam.bh, bw, bh]); }
  return boxes;
}
/* spareggio tra carte diverse con il testo quasi pari (stesso personaggio, nome letto male): vince l'illustrazione più simile */
async function rerankByArt(hits, cam){
  if(!cam || hits.length < 2 || hits[0].score - hits[1].score > 0.1 || hits[1].score < 0.5) return hits;
  const near = hits.filter(h => h.score >= hits[0].score - 0.1).slice(0, 4);
  const sigs = camBoxes(cam).map(b => zoneSig(cam.cv, b[0], b[1], b[2], b[3], ART));
  for(const h of near){
    const prints = h.card.prints.filter(p => p.img && p.lang === "en"), D = await Promise.all(prints.map(p => printDesc(p.id)));
    h.art = Math.max(-1, ...D.filter(Boolean).map(d => Math.max(...sigs.map(c => corr(c, d.art)))));
  }
  const ranked = near.slice().sort((a, b) => b.art - a.art), win = ranked[0];
  if(win === hits[0] || win.art < 0.45 || win.art - ranked[1].art < 0.08) return hits;   // l'arte non è abbastanza chiara: resta il testo
  win.score = Math.max(win.score, hits[0].score);
  return [win, ...hits.filter(h => h !== win)];
}
async function bestVariant(card, cam){
  const prints = card.prints.filter(p => p.img && p.lang === "en");
  const none = { pid: card.def.id, alt: false, score: 0, twins: [] };
  if(prints.length < 2 || !cam) return none;
  const D = await Promise.all(prints.map(p => printDesc(p.id))), G = artGroups(card, prints, D);
  // 1) illustrazione: miglior allineamento tra piccoli spostamenti e zoom
  const boxes = camBoxes(cam);
  const sigs = boxes.map(b => zoneSig(cam.cv, b[0], b[1], b[2], b[3], ART));
  const sc = prints.map((p, i) => { if(!D[i]) return { s: -9, b: 0 }; let s = -9, bi = 0; sigs.forEach((c, k) => { const v = corr(c, D[i].art); if(v > s){ s = v; bi = k; } }); return { s, b: bi }; });
  const gs = new Map(); prints.forEach((p, i) => { if(!gs.has(G[i]) || sc[i].s > gs.get(G[i])) gs.set(G[i], sc[i].s); });
  const di = prints.indexOf(card.def);
  let g = [...gs.entries()].sort((a, b) => b[1] - a[1])[0][0];
  if(di >= 0 && gs.get(G[di]) >= gs.get(g) - 0.02) g = G[di];   // quasi pari: vince l'arte della stampa predefinita
  const mem = prints.map((_, i) => i).filter(i => G[i] === g);
  const twins = mem.map(i => prints[i].id);
  if(gs.get(g) < 0.3) return { ...none, twins: di >= 0 ? prints.map((_, i) => i).filter(i => G[i] === G[di]).map(i => prints[i].id) : [] };   // inquadratura illeggibile
  // 2) gemelle: l'edizione scelta, poi un timbro grande che la smentisce chiaramente
  mem.sort((a, b) => edRank(prints[a], card) - edRank(prints[b], card));
  let pick = mem[0];
  if(mem.length > 1){
    const best = boxes[sc[mem[0]].b], st = zoneSig(cam.cv, best[0], best[1], best[2], best[3], STAMP, 40, 24), tg = zoneSig(cam.cv, best[0], best[1], best[2], best[3], TAG, 20, 16);
    const z = i => D[i] ? corr(st, D[i].stamp) + 0.5 * corr(tg, D[i].tag) : -9;
    const zp = z(pick); let alt = null; for(const i of mem.slice(1)){ const v = z(i); if(v > zp + STAMP_GAP && (!alt || v > alt.v)) alt = { i, v }; }
    if(alt) pick = alt.i;
  }
  return { pid: prints[pick].id, alt: prints[pick] !== card.def, score: sc[pick].s, twins };
}

/* ------------------------------------------------------------ OCR */
async function loadTesseract(){
  if(window.Tesseract) return;
  await new Promise((res, rej) => { const s = document.createElement("script"); s.src = TESS_URL; s.onload = res; s.onerror = () => rej(new Error("impossibile caricare il motore OCR (serve la rete)")); document.head.appendChild(s); });
}
async function getWorker(st){
  if(worker) return worker;
  st("Carico il motore di lettura (solo la prima volta)…");
  await loadTesseract();
  worker = await window.Tesseract.createWorker("eng", 1, { logger: m => { if(m.status === "loading language traineddata" || m.status === "loading tesseract core") st("Scarico i dati di lettura… " + Math.round((m.progress || 0) * 100) + "%"); } });
  await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:'-.,()+ " });
  return worker;
}
/* ritaglio, scala di grigi e contrasto (eventualmente in negativo) */
function prepare(src, sx, sy, sw, sh, invert = false, W = 900){
  const H = Math.round(W * sh / sw);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
  const im = ctx.getImageData(0, 0, W, H), d = im.data;
  for(let i = 0; i < d.length; i += 4){
    let g = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    g = (g - 128) * 1.35 + 128; g = g < 0 ? 0 : g > 255 ? 255 : g;
    if(invert) g = 255 - g;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(im, 0, 0);
  return cv;
}
async function recognize(canvas, st){
  const w = await getWorker(st);
  const { data } = await w.recognize(canvas);
  return data.text || "";
}
/* legge un'immagine (o un fotogramma) e ritorna i candidati */
async function readImage(src, sw, sh, crop, st, quick){
  const r = crop ? viewRect(src, sw, sh) : { x: 0, y: 0, w: sw, h: sh };
  const W = quick ? 720 : 900;
  lastCamSig = snapshot(src, r.x, r.y, r.w, r.h, sw, sh);
  const cv = prepare(src, r.x, r.y, r.w, r.h, false, W);
  $("#scanPreview").src = cv.toDataURL("image/jpeg", 0.6); $("#scanPreview").hidden = false;
  let text = await recognize(cv, st);
  let hits = matchText(text);
  if(!hits.length || hits[0].score < AUTO_MIN){   // nome chiaro su sfondo scuro: seconda lettura in negativo
    const text2 = await recognize(prepare(src, r.x, r.y, r.w, r.h, true, W), st);
    text = text + "\n" + text2; hits = matchText(text);
  }
  window.__lastOcr = text;
  return rerankByArt(hits, lastCamSig);
}

/* ------------------------------------------------------------ interfaccia */
export function openScanner(){
  if(!wired){ wire(); wired = true; }
  $("#scan").hidden = false; document.body.style.overflow = "hidden";
  lastHits = []; renderHits(); renderStage(); renderEd();
  $("#scanAuto").setAttribute("aria-pressed", String(auto));
  startCamera();
}
function closeScanner(){
  stopLoop(); stopCamera(); $("#scan").hidden = true; document.body.style.overflow = "";
  document.dispatchEvent(new CustomEvent("ncd:collection"));
}
async function startCamera(){
  const v = $("#scanVideo"), msg = $("#scanMsg");
  if(!navigator.mediaDevices?.getUserMedia){ msg.textContent = "Fotocamera non disponibile: usa «Da foto»."; v.hidden = true; return; }
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    v.srcObject = stream; v.hidden = false; await v.play();
    msg.textContent = auto ? "Inquadra una carta nel riquadro: appena la riconosco la metto in lista. Poi passa alla successiva." : "Inquadra la carta nel riquadro e premi «Scatta».";
    if(auto) startLoop();
  }catch(e){ v.hidden = true; msg.textContent = "Fotocamera non accessibile (" + (e.name === "NotAllowedError" ? "permesso negato" : e.message) + "): usa «Da foto»."; }
}
function stopCamera(){ if(stream){ for(const t of stream.getTracks()) t.stop(); stream = null; } const v = $("#scanVideo"); if(v) v.srcObject = null; }

/* si legge esattamente ciò che sta dentro il riquadro giallo: la sua posizione sullo schermo viene
   riportata nei pixel del video, tenendo conto del ritaglio dell'anteprima (object-fit: cover) */
function viewRect(v, vw, vh){
  const g = $(".scanView .guide"), r = v.getBoundingClientRect && v.getBoundingClientRect(), gr = g && g.getBoundingClientRect();
  if(!r || !gr || !r.width || !gr.width) return guideRect(vw, vh);
  const k = Math.max(r.width / vw, r.height / vh), ox = (r.width - vw * k) / 2, oy = (r.height - vh * k) / 2, b = 2;
  const x = (gr.left + b - r.left - ox) / k, y = (gr.top + b - r.top - oy) / k, w = (gr.width - 2 * b) / k, h = (gr.height - 2 * b) / k;
  return { x: Math.max(0, x), y: Math.max(0, y), w: Math.min(w, vw - Math.max(0, x)), h: Math.min(h, vh - Math.max(0, y)) };
}
function guideRect(vw, vh){
  const h = Math.min(vh * 0.9, (vw * 0.9) * 1024 / 733), w = h * 733 / 1024;
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

/* --- scansione continua */
function startLoop(){ stopLoop(); lastGuess = null; stableN = 0; gap = AUTO_GAP; loopT = setTimeout(loopStep, 300); }
function stopLoop(){ clearTimeout(loopT); loopT = null; }
async function loopStep(){
  loopT = null;
  const v = $("#scanVideo");
  if(!auto || $("#scan").hidden || v.hidden || !v.videoWidth || document.hidden){ loopT = setTimeout(loopStep, 500); return; }
  if(!busy){
    busy = true;
    try{
      const st = t => { if(!worker) $("#scanMsg").textContent = t; };
      const hits = await readImage(v, v.videoWidth, v.videoHeight, true, st, true);
      onAutoResult(hits);
    }catch(e){ $("#scanMsg").textContent = "Errore: " + e.message; }
    busy = false;
  }
  loopT = setTimeout(loopStep, 150);
}
function onAutoResult(hits){
  const top = hits[0];
  if(top && top.score >= AUTO_MIN){
    if(lastGuess === top.card.id) stableN++; else { lastGuess = top.card.id; stableN = 1; }
    const same = lastAdded === top.card.id && gap < AUTO_GAP;
    if(stableN >= AUTO_STABLE && !same){
      lastAdded = top.card.id; gap = 0; stableN = 0;
      const sig = lastCamSig;
      bestVariant(top.card, sig).then(v => {
        stageAdd(top.card, v.pid, 1, v.twins);
        navigator.vibrate?.([30, 40, 30]);
        const p = DATA.byPrint.get(v.pid);
        flash(`✔ ${top.card.dn} · ${edLabel(p)} in lista (${stageCount()} carte)`);
      });
      $("#scanLive").textContent = ""; return;
    }
    $("#scanLive").textContent = same ? `${top.card.dn}: già aggiunta, allontana la carta per contarne un'altra copia` : `Vedo: ${top.card.dn} (${Math.round(top.score * 100)}%)…`;
  } else {
    gap++; lastGuess = null; stableN = 0;
    $("#scanLive").textContent = top ? `Forse ${top.card.dn} (${Math.round(top.score * 100)}%): avvicinati o metti a fuoco` : "";
  }
}
function flash(t){ const m = $("#scanMsg"); m.textContent = t; m.classList.add("ok"); clearTimeout(flashT); flashT = setTimeout(() => m.classList.remove("ok"), 1500); }

/* --- scatto singolo o foto: mostra i candidati */
async function scanOnce(src, sw, sh, crop){
  if(busy) return; busy = true;
  const st = t => { $("#scanMsg").textContent = t; };
  st("Leggo la carta…"); lastHits = []; renderHits();
  try{
    lastHits = await readImage(src, sw, sh, crop, st, false);
    const sig = lastCamSig;
    for(const h of lastHits){ h.variant = await bestVariant(h.card, sig); }
    if(!lastHits.length) st("Non ho riconosciuto il nome. Avvicinati, evita i riflessi e riprova.");
    else if(lastHits[0].score >= AUTO_MIN){ const v = lastHits[0].variant; stageAdd(lastHits[0].card, v.pid, 1, v.twins); flash(`✔ ${lastHits[0].card.dn} · ${edLabel(DATA.byPrint.get(v.pid))} in lista`); }
    else st("Forse una di queste? Tocca quella giusta per metterla in lista.");
    renderHits();
  }catch(e){ st("Errore: " + e.message); }
  busy = false;
}
function renderHits(){
  const box = $("#scanHits");
  box.innerHTML = lastHits.map((h, i) => { const pid = h.variant ? h.variant.pid : h.card.def.id, p = DATA.byPrint.get(pid); return `<button class="hit${i === 0 && h.score >= AUTO_MIN ? " best" : ""}" data-hit="${i}">
      <img src="${thumbUrl(pid)}" alt=""><span><b>${esc(h.card.dn)}</b><small>${Math.round(h.score * 100)}% · ${esc(edLabel(p))} · in collezione ${h.card.prints.reduce((a, x) => a + qtyOf(x.id), 0)}</small></span><i>+1</i></button>`; }).join("");
}
function renderEd(){ const b = $("#scanEd"); if(b) b.innerHTML = `<span>Edizione</span>${EDITIONS.map(([v, t]) => `<button data-ed="${v}" aria-pressed="${edition === v}">${t}</button>`).join("")}`; }
function renderStage(){
  const n = stageCount(), box = $("#scanList");
  $("#scanCommit").textContent = n ? `Aggiungi ${n} ${n === 1 ? "carta" : "carte"} alla collezione` : "Lista vuota";
  $("#scanCommit").disabled = !n; $("#scanClear").hidden = !n;
  box.innerHTML = STAGE.map((e, i) => {
    const c = DATA.byId.get(e.cid), p = DATA.byPrint.get(e.pid) || c.def;
    return `<div class="srow" data-i="${i}">
      <img src="${thumbUrl(p.id)}" alt="" data-pick="1" title="Cambia stampa">
      <span><b>${esc(c.dn)}</b><small>${esc(edLabel(p))} · hai già ${qtyOf(p.id)}</small>${(e.tw || []).length > 1 ? `<span class="twins">${e.tw.map(t => DATA.byPrint.get(t)).filter(Boolean).map(t => `<button data-tw="${esc(t.id)}" aria-pressed="${t.id === p.id}">${esc(edLabel(t).replace(/ #.*/, ""))}</button>`).join("")}</span>` : ""}</span>
      <span class="qtyctl"><button data-sq="-1" aria-label="meno">−</button><b>${e.n}</b><button data-sq="1" aria-label="più">+</button></span>
      <button class="btn sm icon" data-srm="1" aria-label="Togli">✕</button>
    </div>`; }).join("") || `<div class="empty" style="padding:14px">Le carte riconosciute compaiono qui; le controlli e poi le aggiungi tutte insieme.</div>`;
}
function commitStage(){
  if(!STAGE.length) return;
  let n = 0; for(const e of STAGE){ setQty(e.pid, qtyOf(e.pid) + e.n); n += e.n; }
  STAGE = []; saveStage(); renderStage();
  toast(`${n} carte aggiunte alla collezione`); navigator.vibrate?.(20);
  document.dispatchEvent(new CustomEvent("ncd:collection"));
}

function wire(){
  const root = $("#scan");
  root.addEventListener("click", async e => {
    if(e.target.closest("#scanClose")){ closeScanner(); return; }
    if(e.target.closest("#scanAuto")){ auto = !auto; $("#scanAuto").setAttribute("aria-pressed", String(auto)); if(auto) startLoop(); else { stopLoop(); $("#scanLive").textContent = ""; } return; }
    if(e.target.closest("#scanShot")){
      const v = $("#scanVideo"); if(v.hidden || !v.videoWidth){ toast("Fotocamera non attiva: usa «Da foto»"); return; }
      await scanOnce(v, v.videoWidth, v.videoHeight, true); return;
    }
    if(e.target.closest("#scanPick")){ $("#scanFile").click(); return; }
    const ed = e.target.closest("#scanEd [data-ed]"); if(ed){ edition = ed.dataset.ed; try{ localStorage.setItem("ncd:scanEd", edition); }catch(err){} renderEd(); return; }
    if(e.target.closest("#scanCommit")){ commitStage(); return; }
    if(e.target.closest("#scanClear")){ askConfirm("Svuotare la lista di scansione?", { ok: "Svuota", danger: true }).then(ok => { if(ok){ STAGE = []; saveStage(); renderStage(); } }); return; }
    const hit = e.target.closest("[data-hit]"); if(hit){
      const h = lastHits[+hit.dataset.hit], c = h.card, pid = h.variant ? h.variant.pid : c.def.id;
      if(e.target.closest("img")){ openCard(c.id, pid, { pick: p2 => stageAdd(c, p2, 1) }); return; }
      stageAdd(c, pid, 1, h.variant && h.variant.twins); navigator.vibrate?.(12); flash(`✔ ${c.dn} in lista`); return;
    }
    const row = e.target.closest(".srow"); if(row){
      const i = +row.dataset.i, en = STAGE[i]; if(!en) return;
      if(e.target.closest("[data-srm]")){ STAGE.splice(i, 1); saveStage(); renderStage(); return; }
      const tw = e.target.closest("[data-tw]"); if(tw){ const tp = DATA.byPrint.get(tw.dataset.tw); if(tp && edition === "auto") autoPref = edClass(tp); const same = STAGE.find((x, k) => k !== i && x.cid === en.cid && x.pid === tw.dataset.tw); if(same){ same.n += en.n; STAGE.splice(i, 1); } else en.pid = tw.dataset.tw; saveStage(); renderStage(); return; }
      const q = e.target.closest("[data-sq]"); if(q){ en.n = Math.max(0, en.n + (+q.dataset.sq)); if(!en.n) STAGE.splice(i, 1); saveStage(); renderStage(); return; }
      if(e.target.closest("[data-pick]")){ const c = DATA.byId.get(en.cid); openCard(c.id, en.pid, { pick: pid => { en.pid = pid; saveStage(); renderStage(); } }); }
    }
  });
  $("#scanFile").addEventListener("change", async e => {
    const f = e.target.files[0]; if(!f) return;
    const url = URL.createObjectURL(f); const im = new Image();
    im.onload = async () => { await scanOnce(im, im.naturalWidth, im.naturalHeight, false); URL.revokeObjectURL(url); };
    im.src = url; e.target.value = "";
  });
  document.addEventListener("visibilitychange", () => { if($("#scan").hidden) return; if(document.hidden){ stopLoop(); stopCamera(); } else startCamera(); });
}
export const _scanTest = { signature: (...a) => signature(...a), snapshot: (...a) => snapshot(...a), bestVariant: (...a) => bestVariant(...a), setEdition: v => { edition = v; autoPref = null; }, viewRect: (...a) => viewRect(...a), last: () => lastCamSig, setGap: v => { STAMP_GAP = v; }, edLabel };   // per i collaudi
