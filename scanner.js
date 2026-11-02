/* Scanner della collezione: inquadri la carta, l'app legge il nome con
   l'OCR (Tesseract.js, caricato solo quando serve) e lo abbina alle 151
   carte del catalogo. Funziona con la fotocamera o con una foto.         */

import { DATA, thumbUrl } from "./data.js";
import { qtyOf, setQty } from "./store.js";
import { $, $$, esc, toast, openCard } from "./ui.js";

const TESS_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
let worker = null, stream = null, busy = false, wired = false, lastHits = [];

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
function index(){
  if(INDEX) return INDEX;
  INDEX = DATA.cards.map(c => {
    const full = norm(c.dn), name = norm(c.name), sub = norm(c.sub);
    // senza i promemoria tra parentesi, uguali su molte carte
    const body = norm([c.cls.join(" "), String(c.text || "").replace(/\([^)]*\)/g, " "), c.flavor].filter(Boolean).join(" "));
    return { c, full, name, sub, bFull: bigrams(full), bName: bigrams(name), bSub: bigrams(sub), bBody: bigrams(body), bodyLen: body.length };
  });
  return INDEX;
}
/* ritorna i candidati ordinati per punteggio: nome (righe OCR) + testo di regole */
export function matchText(text){
  const lines = text.split(/\n/).map(norm).filter(l => l.length >= 3);
  const cands = lines.slice();
  for(let i = 0; i + 1 < lines.length; i++) cands.push(lines[i] + " " + lines[i + 1]);   // nomi su due righe (Leggende)
  const bAll = bigrams(norm(text));
  const out = [];
  for(const e of index()){
    let best = 0;
    for(const l of cands){
      const bl = bigrams(l);
      let s = dice(bl, e.bFull);
      if(e.sub) s = Math.max(s, (dice(bl, e.bName) + dice(bl, e.bSub)) / 2, dice(bl, e.bName) * 0.85);
      else s = Math.max(s, dice(bl, e.bName));
      if(l.includes(e.full) || (e.full.length >= 5 && e.full.includes(l) && l.length >= 6)) s = Math.max(s, 0.9);
      if(s > best) best = s;
    }
    // il testo di regole e il flavour: quanto del testo della carta compare nell'OCR
    let inter = 0; for(const [k, v] of e.bBody) if(bAll.has(k)) inter += Math.min(v, bAll.get(k));
    let nb = 0; for(const v of e.bBody.values()) nb += v;
    const body = nb >= 12 ? inter / nb : 0;          // 0..1: copertura del testo della carta
    const score = Math.max(best, body * 0.95, best * 0.6 + body * 0.5);
    out.push({ card: e.c, score, nameScore: best, bodyScore: body });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 5).filter(x => x.score >= 0.35);
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
/* ritaglio, scala di grigi e contrasto: la foto diventa più leggibile */
function prepare(src, sx, sy, sw, sh, invert = false){
  const W = 900, H = Math.round(W * sh / sw);
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
export async function recognize(canvas, st){
  const w = await getWorker(st);
  st("Leggo la carta…");
  const { data } = await w.recognize(canvas);
  return data.text || "";
}

/* ------------------------------------------------------------ interfaccia */
export function openScanner(){
  if(!wired){ wire(); wired = true; }
  $("#scan").hidden = false; document.body.style.overflow = "hidden";
  lastHits = []; renderHits();
  startCamera();
}
function closeScanner(){
  stopCamera(); $("#scan").hidden = true; document.body.style.overflow = "";
  document.dispatchEvent(new CustomEvent("ncd:collection"));
}
async function startCamera(){
  const v = $("#scanVideo"), msg = $("#scanMsg");
  if(!navigator.mediaDevices?.getUserMedia){ msg.textContent = "Fotocamera non disponibile: usa «Da foto»."; v.hidden = true; return; }
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    v.srcObject = stream; v.hidden = false; await v.play();
    msg.textContent = "Inquadra la carta nel riquadro, a fuoco e senza riflessi, poi «Scatta».";
  }catch(e){ v.hidden = true; msg.textContent = "Fotocamera non accessibile (" + (e.name === "NotAllowedError" ? "permesso negato" : e.message) + "): usa «Da foto»."; }
}
function stopCamera(){ if(stream){ for(const t of stream.getTracks()) t.stop(); stream = null; } const v = $("#scanVideo"); if(v) v.srcObject = null; }

/* il riquadro guida copre il centro dell'inquadratura con le proporzioni della carta */
function guideRect(vw, vh){
  const h = Math.min(vh * 0.9, (vw * 0.9) * 1024 / 733), w = h * 733 / 1024;
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}
async function scanFrom(src, sw, sh, crop){
  if(busy) return; busy = true;
  const st = t => { $("#scanMsg").textContent = t; };
  st("Preparo l'immagine…"); lastHits = []; renderHits();
  try{
    const r = crop ? guideRect(sw, sh) : { x: 0, y: 0, w: sw, h: sh };
    const cv = prepare(src, r.x, r.y, r.w, r.h);
    $("#scanPreview").src = cv.toDataURL("image/jpeg", 0.7); $("#scanPreview").hidden = false;
    let text = await recognize(cv, st);
    lastHits = matchText(text);
    if(!lastHits.length || lastHits[0].score < 0.7){   // nome chiaro su sfondo scuro: seconda lettura in negativo
      st("Seconda lettura…");
      const text2 = await recognize(prepare(src, r.x, r.y, r.w, r.h, true), st);
      text = text + "\n" + text2; lastHits = matchText(text);
    }
    window.__lastOcr = text;
    if(!lastHits.length) st("Non ho riconosciuto il nome. Avvicinati, evita i riflessi e riprova.");
    else st(lastHits[0].score >= 0.6 ? `Trovata: ${lastHits[0].card.dn}` : "Forse una di queste? Tocca quella giusta.");
    renderHits();
  }catch(e){ st("Errore: " + e.message); }
  busy = false;
}
function renderHits(){
  const box = $("#scanHits");
  box.innerHTML = lastHits.map((h, i) => `<button class="hit${i === 0 && h.score >= 0.6 ? " best" : ""}" data-hit="${i}">
      <img src="${thumbUrl(h.card.def.id)}" alt=""><span><b>${esc(h.card.dn)}</b><small>${Math.round(h.score * 100)}% · hai ${h.card.prints.reduce((a, p) => a + qtyOf(p.id), 0)}</small></span><i>+1</i></button>`).join("");
}
function wire(){
  const root = $("#scan");
  root.addEventListener("click", async e => {
    if(e.target.closest("#scanClose")){ closeScanner(); return; }
    if(e.target.closest("#scanShot")){
      const v = $("#scanVideo"); if(v.hidden || !v.videoWidth){ toast("Fotocamera non attiva: usa «Da foto»"); return; }
      await scanFrom(v, v.videoWidth, v.videoHeight, true); return;
    }
    if(e.target.closest("#scanPick")){ $("#scanFile").click(); return; }
    const hit = e.target.closest("[data-hit]"); if(hit){
      const c = lastHits[+hit.dataset.hit].card;
      if(e.target.closest("img")){ openCard(c.id, c.def.id); return; }   // tocca l'immagine per scegliere la stampa
      setQty(c.def.id, qtyOf(c.def.id) + 1); navigator.vibrate?.(12); toast(`+1 ${c.dn} (${qtyOf(c.def.id)})`); renderHits();
    }
  });
  $("#scanFile").addEventListener("change", async e => {
    const f = e.target.files[0]; if(!f) return;
    const url = URL.createObjectURL(f); const im = new Image();
    im.onload = async () => { await scanFrom(im, im.naturalWidth, im.naturalHeight, false); URL.revokeObjectURL(url); };
    im.src = url; e.target.value = "";
  });
  document.addEventListener("visibilitychange", () => { if(document.hidden) stopCamera(); else if(!$("#scan").hidden) startCamera(); });
}
