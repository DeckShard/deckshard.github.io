/* Interfaccia dell'account e della parte social (scheda «Social»):
   accesso, stato della sincronizzazione, amici, richieste, ricerca,
   chat privata, blocco e segnalazione, feedback dalle Impostazioni.   */

import { S, wipe } from "./store.js";
import { $, $$, esc, toast, filtersHTML, setFilters, passes, bindFilters, sortCards, makeFilters } from "./ui.js";
import { cardQty } from "./store.js";
import * as cloud from "./cloud.js";
import { DATA, thumbUrl } from "./data.js";
import { openCard } from "./ui.js";
import { openSharedDeck } from "./deck.js";

/* l'avatar degli altri arriva dal database: solo immagini delle carte di questo sito e numeri veri */
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const AVA = f => { const a = (f.avatar && typeof f.avatar === "object") ? f.avatar : {}; const img = typeof a.img === "string" && /^\.\/img\/[\w-]{1,64}\.webp$/.test(a.img) ? a.img : "";
  return { favImg: img, favPos: num(a.pos, 34, 0, 100), favZoom: num(a.zoom, 150, 50, 400), fav: typeof a.fav === "string" ? a.fav.slice(0, 60) : "", nick: f.nick }; };
const initials = s => String(s || "?").split(/[\s_.-]+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
function miniAvatar(f, size = 38){
  const a = AVA(f);
  return a.favImg ? `<span class="mava" style="width:${size}px;height:${size}px;background-image:url('${esc(a.favImg)}');background-position:50% ${a.favPos}%;background-size:${a.favZoom}% auto"></span>`
                  : `<span class="mava ph" style="width:${size}px;height:${size}px">${esc(initials(f.nick))}</span>`;
}
const when = t => { const d = new Date(t), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }); };

/* ---------------------------------------------------------------- scheda Account (in cima a Social) */
let rerender = () => {};
export function accountHTML(){
  if(!cloud.cloudConfigured()) return "";
  const st = cloud.state;
  if(!st.user){
    return `<div class="card acct" id="acct">
      <h3>Account</h3>
      <div class="sub">Accedi per avere collezione e mazzi su tutti i tuoi dispositivi, aggiungere amici e chattare. Senza account l'app continua a funzionare come ora, tutto resta su questo dispositivo.</div>
      <div style="margin-top:10px"><button class="btn acc2" id="acGoogle">Continua con Google</button></div>
      <div class="sub" style="margin-top:6px">L'email del tuo account Google non è mai visibile agli altri giocatori: vedono solo il nick che scegli.</div>
      ${st.error ? `<div class="sub bad" style="margin-top:6px">${esc(st.error)}</div>` : ""}
    </div>`;
  }
  const p = st.profile || {}, last = st.lastSync ? new Date(st.lastSync) : null;
  const status = st.status === "sync" ? "Sincronizzazione in corso…" : st.status === "error" ? `Errore di sincronizzazione: ${esc(st.error || "")}` : last ? `Sincronizzato alle ${last.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` : "Sincronizzato";
  return `<div class="card acct" id="acct">
    <h3>Account</h3>
    <div class="phead" style="gap:10px">${miniAvatar({ nick: p.nick, avatar: { img: S.profile.favImg, pos: S.profile.favPos, zoom: S.profile.favZoom } }, 46)}
      <div style="min-width:0"><b style="font-size:16px">${esc(p.nick || "…")}</b><div class="sub">${esc(st.user.email || "account di prova")}</div><div class="sub${st.status === "error" ? " bad" : ""}">☁ ${status}</div></div></div>
    <div class="field fcol" style="margin-top:8px"><label for="acNick">Nick pubblico<small>Così ti trovano gli amici</small></label><div class="acrow" style="margin:0"><input class="inp" id="acNick" value="${esc(p.nick || "")}" maxlength="24" autocomplete="off"><button class="btn sm" id="acNickSave">Salva</button></div></div>
    <div class="field"><label>Collezione visibile agli amici<small>Gli amici possono sfogliare le carte che hai (non i mazzi)</small></label>
      <span class="seg" id="acShow"><button data-v="1" aria-pressed="${!!p.show_collection}">Sì</button><button data-v="0" aria-pressed="${!p.show_collection}">No</button></span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn sm" id="acSync">Sincronizza ora</button>
      <button class="btn sm" id="acOut">Esci</button>
      <button class="btn sm" id="acDelete" style="color:var(--bad)">Elimina account</button>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- amici */
let searchRes = null, searchQ = "";
export function friendsHTML(){
  if(!cloud.state.user) return "";
  const fr = cloud.friends, online = cloud.state.online;
  const incoming = fr.filter(f => f.status === "pending" && f.incoming), outgoing = fr.filter(f => f.status === "pending" && !f.incoming);
  const acc = fr.filter(f => f.status === "accepted").sort((a, b) => (online.has(b.id) - online.has(a.id)) || (b.unread - a.unread) || String(a.nick).localeCompare(String(b.nick)));
  const row = (f, right) => `<div class="frow2" data-fid="${f.id}">${miniAvatar(f)}<div class="nm"><b>${esc(f.nick)}${online.has(f.id) ? ` <i class="dot on" title="in linea"></i>` : ""}</b><span>${[f.faction, `${f.wins}V – ${f.losses}S online`].filter(Boolean).map(esc).join(" · ")}</span></div>${right}</div>`;
  return `<div class="card" id="friends">
    <h3>Amici${acc.length ? ` <small style="color:var(--mute)">${acc.length}</small>` : ""}</h3>
    <div class="acrow"><input class="inp" id="frQ" placeholder="Cerca un giocatore per nick" value="${esc(searchQ)}" autocomplete="off"><button class="btn sm" id="frSearch">Cerca</button></div>
    ${searchRes ? `<div class="frlist">${searchRes.length ? searchRes.map(f => { const known = fr.find(x => x.id === f.id); return row(f, known ? `<span class="chip">${known.status === "accepted" ? "amico" : "richiesta inviata"}</span>` : `<button class="btn sm acc2" data-fadd="${esc(f.nick)}">Aggiungi</button>`); }).join("") : `<div class="sub">Nessun giocatore con questo nick.</div>`}</div>` : ""}
    ${incoming.length ? `<h4 class="frh">Richieste ricevute</h4><div class="frlist">${incoming.map(f => row(f, `<button class="btn sm yel" data-facc="${f.id}">Accetta</button><button class="btn sm" data-frej="${f.id}">Rifiuta</button>`)).join("")}</div>` : ""}
    ${acc.length ? `<div class="frlist">${acc.map(f => row(f, `${f.unread ? `<span class="badge">${f.unread}</span>` : ""}<button class="btn sm acc2" data-fduel="${f.id}" title="Sfida a una partita online">Sfida</button><button class="btn sm" data-fchat="${f.id}">Chat</button><button class="btn sm icon" data-fmenu="${f.id}" aria-label="Altro">⋯</button>`)).join("")}</div>`
      : `<div class="sub" style="margin-top:8px">La tua crew è ancora vuota: cerca il nick di chi conosci e mandagli una richiesta.</div>`}
    ${outgoing.length ? `<h4 class="frh">Richieste inviate</h4><div class="frlist">${outgoing.map(f => row(f, `<span class="chip">in attesa</span><button class="btn sm" data-fcancel="${f.id}">Annulla</button>`)).join("")}</div>` : ""}
  </div>`;
}

/* ---------------------------------------------------------------- scheda Chat (barra in basso)
   Le conversazioni con gli amici: prima chi ha messaggi da leggere, poi chi è in linea. Un tocco apre la chat. */
export function renderChatTab(){
  const root = $("#p-chat"); if(!root) return;
  if(!root.dataset.wired){ root.dataset.wired = "1"; root.addEventListener("click", e => { const r = e.target.closest("[data-chatwith]"); if(r){ openChat(r.dataset.chatwith); return; } if(e.target.closest("#chGoSocial")) location.hash = "#profile"; }); }
  if(!cloud.cloudConfigured() || !cloud.state.user){ root.innerHTML = `<div class="card"><h2>Chat</h2><p class="sub">Per scrivere agli amici serve un account: entra dal Social con Google, poi aggiungi i tuoi choom per nick.</p><button class="btn acc2" id="chGoSocial">Vai al Social</button></div>`; return; }
  const online = cloud.state.online, fr = cloud.friends.filter(f => f.status === "accepted");
  const req = cloud.friends.filter(f => f.status === "pending" && f.incoming).length;
  const list = fr.slice().sort((a, b) => (b.unread - a.unread) || (online.has(b.id) - online.has(a.id)) || String(a.nick).localeCompare(String(b.nick)));
  root.innerHTML = `<div class="card flush chats"><div class="hdr"><h2 style="margin:0">Chat</h2>${req ? `<button class="btn sm yel" id="chGoSocial">${req === 1 ? "1 richiesta di amicizia" : req + " richieste di amicizia"}</button>` : ""}</div>
    ${list.length ? list.map(f => `<button class="chrow${f.unread ? " new" : ""}" data-chatwith="${f.id}">${miniAvatar(f, 42)}<span class="nm"><b>${esc(f.nick)}${online.has(f.id) ? ` <i class="dot on" title="in linea"></i>` : ""}</b><span>${f.unread ? (f.unread === 1 ? "1 messaggio nuovo" : f.unread + " messaggi nuovi") : online.has(f.id) ? "in linea" : esc(f.faction || "")}</span></span>${f.unread ? `<span class="badge">${f.unread}</span>` : ""}</button>`).join("")
      : `<div class="sub" style="padding:14px">La tua crew è ancora vuota: aggiungi gli amici dal <a href="#profile">Social</a>.</div>`}</div>`;
}
/* dalla notifica di un messaggio (#chat/<id>) o dalla plancia: apre la conversazione appena l'amico è noto */
export function openChatWith(id){
  if(cloud.friends.some(f => f.id === id)){ openChat(id); return; }
  let tries = 0; const t = setInterval(() => { if(cloud.friends.some(f => f.id === id)){ clearInterval(t); openChat(id); } else if(++tries > 40) clearInterval(t); }, 250);
}
document.addEventListener("ncd:openchat", e => openChatWith(e.detail));

/* ---------------------------------------------------------------- chat */
let chatWith = null, chatMsgs = [];
async function openChat(id){
  const f = cloud.friends.find(x => x.id === id); if(!f) return;
  chatWith = f; chatMsgs = [];
  let el = $("#chat"); if(!el){ el = document.createElement("div"); el.id = "chat"; document.body.appendChild(el); }
  el.hidden = false; renderChat();
  try{ chatMsgs = await cloud.loadMessages(id); renderChat(true); await cloud.markRead(id); }catch(e){ toast(e.message, 4000); }
}
function closeChat(){ chatWith = null; const el = $("#chat"); if(el){ el.hidden = true; el.dataset.with = ""; if(el.contains(document.activeElement)) document.activeElement.blur(); } }
/* la finestra si costruisce una volta sola per amico; dopo si aggiornano solo intestazione e messaggi,
   così il campo di testo (e la tastiera del telefono) non viene mai ricreato mentre si scrive */
/* un messaggio con il link a un mazzo condiviso diventa un pulsante per aprirlo */
const DECK_RX = /https?:\/\/\S+#d=\S+/;
function msgBody(body){
  const m = DECK_RX.exec(body || ""); if(!m) return `<span>${esc(body)}</span>`;
  const rest = body.replace(m[0], "").trim();
  return `${rest ? `<span>${esc(rest)}</span>` : ""}<button class="btn sm acc2 msgdeck" data-deck="${esc(m[0])}">🃏 Apri il mazzo</button>`;
}
function renderChat(scroll){
  const el = $("#chat"); if(!el || !chatWith) return;
  const me = cloud.state.user.id, f = chatWith, on = cloud.state.online.has(f.id);
  if(el.dataset.with !== f.id || !$("#chText")){
    el.dataset.with = f.id;
    el.innerHTML = `<div class="box">
      <div class="chh">${miniAvatar(f, 34)}<div class="nm"><b>${esc(f.nick)}</b><span id="chOn"></span></div><button class="btn sm icon" id="chClose" aria-label="Chiudi">✕</button></div>
      <div class="chmsgs" id="chMsgs"></div>
      <form class="chin" id="chForm"><input class="inp" id="chText" maxlength="500" placeholder="Scrivi a ${esc(f.nick)}…" autocomplete="off" enterkeyhint="send"><button class="btn yel" type="submit">Invia</button></form>
    </div>`;
    if(matchMedia("(pointer: fine)").matches) $("#chText").focus({ preventScroll: true });   // sul telefono la tastiera si apre solo toccando il campo
  }
  $("#chOn").textContent = on ? "in linea" : "non in linea";
  const box = $("#chMsgs"), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = chatMsgs.length ? chatMsgs.map(m => `<div class="msg${m.sender === me ? " me" : ""}" data-mid="${m.id}">${msgBody(m.body)}<small>${when(m.created_at)}${m.sender === me && m.read_at ? " · letto" : ""}</small></div>`).join("") : `<div class="sub" style="text-align:center;margin:auto">Linea silenziosa: scrivi tu per primo.</div>`;
  if(scroll !== false && (scroll || atEnd || chatMsgs.length && chatMsgs[chatMsgs.length - 1].sender === me)) box.scrollTop = box.scrollHeight;
}
document.addEventListener("ncd:message", async e => {
  const m = e.detail;
  if(chatWith && m.sender === chatWith.id){ chatMsgs.push(m); renderChat(); try{ await cloud.markRead(chatWith.id); }catch(err){} }
  else {
    const f = cloud.friends.find(x => x.id === m.sender), board = $("#board");
    // in partita niente avviso in mezzo allo schermo: la plancia mostra un pulsante «💬 nick» che apre la chat
    if(board && !board.hidden) document.dispatchEvent(new CustomEvent("ncd:boardchat", { detail: { id: m.sender, nick: f ? f.nick : "Nuovo messaggio", body: m.body } }));
    else toast(`💬 ${f ? f.nick : "Nuovo messaggio"}: ${m.body.slice(0, 60)}`, 3500);
    if($("#p-chat")?.classList.contains("on")) renderChatTab();
  }
});
document.addEventListener("click", async e => {
  if(!$("#chat") || $("#chat").hidden) return;
  if(e.target.closest("#chClose") || e.target.id === "chat"){ closeChat(); rerender(); if($("#p-chat")?.classList.contains("on")) renderChatTab(); document.dispatchEvent(new Event("ncd:chatclosed")); return; }
  const dk = e.target.closest("[data-deck]"); if(dk){ closeChat(); openSharedDeck(dk.dataset.deck); return; }
  const m = e.target.closest(".msg:not(.me)");
  if(m && chatWith && confirm("Segnalare questo messaggio?")){ try{ await cloud.reportUser(chatWith.id, +m.dataset.mid, "messaggio in chat"); toast("Segnalazione inviata"); }catch(err){ toast(err.message, 4000); } }
});
document.addEventListener("submit", async e => {
  if(e.target.id !== "chForm") return;
  e.preventDefault();
  const t = $("#chText"), body = t.value.trim(); if(!body || !chatWith) return;
  t.value = ""; t.focus({ preventScroll: true });   // la tastiera resta aperta per il messaggio successivo
  try{ const m = await cloud.sendMessage(chatWith.id, body); chatMsgs.push(m); renderChat(true); }
  catch(err){ t.value = body; toast(err.message, 4000); }
});

/* ---------------------------------------------------------------- scelta al primo collegamento */
cloud.setMergeAsker(info => new Promise(resolve => {
  const el = document.createElement("div"); el.id = "mergeAsk";
  el.innerHTML = info.remoteEmpty ? `<div class="box"><h3>Su questo dispositivo ci sono già dei dati</h3>
    <p class="sub">${info.localCards} carte, ${info.localDecks} mazzi. Il tuo account è ancora vuoto: se questi dati non sono tuoi (telefono di qualcun altro), non portarli.</p>
    <div class="opts">
      <button class="btn yel" data-m="device">Portali nel mio account<small>Collezione, mazzi e profilo di questo dispositivo vanno nell'account</small></button>
      <button class="btn" data-m="cloud">Parti da zero<small>Questo dispositivo si svuota e segue l'account</small></button>
    </div></div>` : `<div class="box"><h3>Questo dispositivo e il tuo account hanno dati diversi</h3>
    <p class="sub">Qui: ${info.localCards} carte, ${info.localDecks} mazzi. Nell'account: ${info.remoteCards} carte, ${info.remoteDecks} mazzi.</p>
    <div class="opts">
      <button class="btn yel" data-m="merge">Unisci (consigliato)<small>Per ogni stampa tiene il numero più alto, i mazzi di entrambi</small></button>
      <button class="btn" data-m="cloud">Usa i dati dell'account<small>Quelli di questo dispositivo vengono sostituiti</small></button>
      <button class="btn" data-m="device">Usa i dati di questo dispositivo<small>Quelli nell'account vengono sostituiti</small></button>
    </div></div>`;
  el.addEventListener("click", ev => { const b = ev.target.closest("[data-m]"); if(!b) return; el.remove(); resolve(b.dataset.m); });
  document.body.appendChild(el);
}));

/* ---------------------------------------------------------------- collegamenti dei pulsanti (la scheda Social li ridisegna) */
export function wireSocial(root, redraw){
  rerender = redraw;
  root.addEventListener("click", async e => {
    const t = e.target, id = s => t.closest(s);
    try{
      if(id("#acGoogle")){ await cloud.signInGoogle(); return; }
      if(id("#acNickSave")){ await cloud.setNick($("#acNick").value.trim()); toast("Nuovo handle registrato"); redraw(); return; }
      const sh = id("#acShow button"); if(sh){ await cloud.setProfileFlags({ show_collection: sh.dataset.v === "1" }); return; }
      if(id("#acSync")){ await cloud.syncNow(); toast("Sincronizzato"); return; }
      if(id("#acOut")){ if(confirm("Uscire dall'account su questo dispositivo? Collezione e mazzi restano qui; gli altri dispositivi restano collegati.")){ await cloud.signOut(); } return; }
      if(id("#acDelete")){ if(confirm("Eliminare l'account? Profilo, amici, messaggi e dati salvati nel cloud vengono cancellati per sempre. Quello che c'è su questo dispositivo resta.")){ await cloud.deleteAccount(); toast("Account eliminato"); } return; }
      if(id("#frSearch")){ searchQ = $("#frQ").value.trim(); if(searchQ.length < 2){ toast("Scrivi almeno 2 lettere"); return; } searchRes = await cloud.searchPlayers(searchQ); redraw(); return; }
      const add = id("[data-fadd]"); if(add){ const r = await cloud.friendRequest(add.dataset.fadd); toast({ sent: "Richiesta inviata", accepted: "Siete amici!", already: "Siete già amici", not_found: "Giocatore non trovato", self: "Sei tu!" }[r] || r); redraw(); return; }
      const ac = id("[data-facc]"); if(ac){ await cloud.friendRespond(ac.dataset.facc, true); toast("Un nuovo choom nella tua crew"); return; }
      const rj = id("[data-frej]"); if(rj){ await cloud.friendRespond(rj.dataset.frej, false); return; }
      const cn = id("[data-fcancel]"); if(cn){ await cloud.friendRemove(cn.dataset.fcancel); return; }
      const ch = id("[data-fchat]"); if(ch){ openChat(ch.dataset.fchat); return; }
      const du = id("[data-fduel]"); if(du){ const f = cloud.friends.find(x => x.id === du.dataset.fduel); if(f) document.dispatchEvent(new CustomEvent("ncd:challenge", { detail: { id: f.id, nick: f.nick } })); return; }
      const mn = id("[data-fmenu]"); if(mn){ friendMenu(mn.dataset.fmenu); return; }
    }catch(err){ toast(err.message || String(err), 4500); const b = t.closest("button"); if(b) b.disabled = false; }
  });
  root.addEventListener("keydown", e => {
    if(e.key !== "Enter") return;
    if(e.target.id === "frQ"){ e.preventDefault(); $("#frSearch").click(); }
    if(e.target.id === "acNick"){ e.preventDefault(); $("#acNickSave").click(); }
  });
}
async function friendMenu(id){
  const f = cloud.friends.find(x => x.id === id); if(!f) return;
  const acts = [];
  if(f.show_collection) acts.push(["Guarda la collezione", async () => { const coll = await cloud.friendCollection(id); document.dispatchEvent(new CustomEvent("ncd:friendcoll", { detail: { nick: f.nick, coll: coll || {} } })); }]);
  acts.push(["Rimuovi dagli amici", async () => { if(confirm(`Rimuovere ${f.nick} dagli amici?`)) await cloud.friendRemove(id); }, "Non sarete più amici: potrete richiedere l'amicizia in futuro."]);
  acts.push(["Blocca", async () => { if(confirm(`Bloccare ${f.nick}? Non potrà più trovarti, scriverti né chiederti l'amicizia.`)){ await cloud.blockUser(id); toast("Bloccato: per te è fuori dalla Rete"); } }, "Toglie l'amicizia; non potrà più trovarti nella ricerca, scriverti, sfidarti né chiederti l'amicizia."]);
  acts.push(["Segnala", async () => { const why = prompt(`Perché segnali ${f.nick}?`); if(why != null){ await cloud.reportUser(id, null, why); toast("Segnalazione inviata"); } }, "Manda una segnalazione privata a chi gestisce l'app (per comportamenti scorretti): lui non lo saprà."]);
  const el = document.createElement("div"); el.id = "mergeAsk";
  // si chiude toccando fuori dal riquadro
  el.innerHTML = `<div class="box fmenu"><h3>${esc(f.nick)}</h3><div class="opts">${acts.map(([l, , d], i) => `<button class="btn" data-a="${i}"><span>${esc(l)}</span>${d ? `<small>${esc(d)}</small>` : ""}</button>`).join("")}</div></div>`;
  el.addEventListener("click", async ev => { const b = ev.target.closest("[data-a]"); if(!b && ev.target !== el) return; el.remove(); if(b && b.dataset.a !== "x"){ try{ await acts[+b.dataset.a][1](); }catch(err){ toast(err.message, 4000); } } });
  document.body.appendChild(el);
}

/* ---------------------------------------------------------------- feedback (Impostazioni) */
let fbKind = "idea", fbDev = null;
// dove si usa l'app: indovinato dallo schermo, ma chi scrive può correggerlo (una segnalazione da PC si legge in modo diverso)
const guessDev = () => matchMedia("(pointer: coarse)").matches ? (Math.min(screen.width, screen.height) >= 700 ? "tablet" : "telefono") : "pc";
export function feedbackHTML(){
  if(!cloud.cloudConfigured()) return "";
  return `<div class="card" id="fb">
    <h3>Feedback</h3>
    <div class="sub">Segnala un problema o proponi un'idea. Arriva in una casella privata letta solo da chi sviluppa l'app; non serve un account e non viene pubblicato niente.</div>
    <div class="field" style="margin-top:8px"><label>Tipo</label><span class="seg" id="fbKind">${[["bug", "Problema"], ["idea", "Idea"], ["altro", "Altro"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${fbKind === v}">${t}</button>`).join("")}</span></div>
    <div class="field" style="margin-top:6px"><label>Da dove</label><span class="seg" id="fbDev">${[["telefono", "Telefono"], ["tablet", "Tablet"], ["pc", "PC"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${(fbDev || guessDev()) === v}">${t}</button>`).join("")}</span></div>
    <textarea class="inp" id="fbBody" rows="4" maxlength="2000" placeholder="Cosa è successo, o cosa ti piacerebbe trovare nell'app" style="width:100%;margin-top:6px"></textarea>
    <input class="inp" id="fbContact" maxlength="120" placeholder="Contatto (facoltativo, solo se vuoi una risposta)" style="width:100%;margin-top:6px" autocomplete="off">
    <div style="margin-top:8px"><button class="btn yel" id="fbSend">Invia feedback</button></div>
  </div>`;
}
export function wireFeedback(root, version){
  root.addEventListener("click", async e => {
    const k = e.target.closest("#fbKind button"); if(k){ fbKind = k.dataset.v; $$("#fbKind button").forEach(b => b.setAttribute("aria-pressed", String(b === k))); return; }
    const dv = e.target.closest("#fbDev button"); if(dv){ fbDev = dv.dataset.v; $$("#fbDev button").forEach(b => b.setAttribute("aria-pressed", String(b === dv))); return; }
    if(!e.target.closest("#fbSend")) return;
    const body = $("#fbBody").value.trim(); if(body.length < 3){ toast("Scrivi qualche parola in più"); return; }
    const btn = e.target.closest("#fbSend"); btn.disabled = true;
    try{ await cloud.sendFeedback({ kind: fbKind, body, contact: $("#fbContact").value.trim(), version, lang: S.profile.lang || "it", platform: fbDev || guessDev() }); $("#fbBody").value = ""; $("#fbContact").value = ""; toast("Messaggio ricevuto, choom. Grazie!"); }
    catch(err){ toast("Invio non riuscito: " + (err.message || err), 4500); }
    btn.disabled = false;
  });
}

/* azzera tutto: se c'è un account si esce prima, così il cloud non viene svuotato */
export async function safeWipe(){ if(cloud.state.user){ try{ await cloud.signOut(); }catch(e){} } wipe(); }

/* collezione di un amico (se l'ha resa visibile): ricerca, filtri come nella Collection, ordinamento,
   e il confronto con la propria («mi mancano», «ha doppie») utile per gli scambi */
document.addEventListener("ncd:friendcoll", e => {
  const { nick, coll } = e.detail;
  const byCard = new Map();
  for(let [pid, n] of Object.entries(coll || {})){ const p = DATA.byPrint.get(pid); n = Math.max(0, Math.min(999, Math.floor(Number(n)) || 0)); if(!p || !n) continue; const c = p.card; const x = byCard.get(c.id) || { c, n: 0, p }; x.n += n; byCard.set(c.id, x); }
  const all = [...byCard.values()];
  const F = Object.assign(makeFilters("friend"), { owned: "", show: "all", sort: "name" });
  const el = document.createElement("div"); el.id = "mergeAsk"; el.className = "wide";
  el.innerHTML = `<div class="box fcoll"><h3>Collezione di ${esc(nick)}</h3><p class="sub">${all.length} di ${DATA.cards.length} carte · ${all.reduce((a, x) => a + x.n, 0)} copie</p>
    <div class="search" style="padding:0;margin:8px 0 6px"><input class="inp" id="fcQ" type="search" placeholder="Cerca per nome, testo o tratto…" autocomplete="off"><button class="btn sm" id="fcFilt">Filtri</button></div>
    <div class="filters" id="fcFilters" style="padding:0">${filtersHTML(F)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0 8px">
      <span class="seg" id="fcShow"><button data-v="all" aria-pressed="true">Tutte</button><button data-v="missing" aria-pressed="false">Mi mancano</button><button data-v="extra" aria-pressed="false">Ha doppie</button></span>
      <select class="inp" id="fcSort" aria-label="Ordina"><option value="name">Nome</option><option value="cost">Costo</option><option value="power">Potenza</option><option value="color">Colore</option><option value="pdesc">Prezzo ↓</option><option value="pasc">Prezzo ↑</option></select>
      <span class="sub" id="fcCount"></span></div>
    <div class="grid fc" id="fcGrid"></div></div>`;
  const draw = () => {
    const ok = new Set(all.map(x => x.c).filter(c => passes(c, F)).map(c => c.id));
    let list = all.filter(x => ok.has(x.c.id));
    if(F.show === "missing") list = list.filter(x => !cardQty(x.c));
    if(F.show === "extra") list = list.filter(x => x.n >= 2);
    const order = sortCards(list.map(x => x.c), F.sort).map(c => c.id), pos = new Map(order.map((id, i) => [id, i]));
    list.sort((a, b) => pos.get(a.c.id) - pos.get(b.c.id));
    el.querySelector("#fcCount").textContent = `${list.length} carte`;
    el.querySelector("#fcGrid").innerHTML = list.map(x => `<div class="gc" data-cid="${x.c.id}" data-pid="${x.p.id}"><img src="${thumbUrl(x.p.id)}" alt="${esc(x.c.dn)}" loading="lazy"><span class="qty">×${x.n}</span></div>`).join("") || `<div class="sub">Nessuna carta con questi filtri.</div>`;
  };
  // si chiude toccando fuori dal riquadro
  el.addEventListener("click", ev => {
    const g = ev.target.closest(".gc"); if(g){ openCard(g.dataset.cid, g.dataset.pid); return; }
    if(ev.target === el){ el.remove(); return; }
    if(ev.target.closest("#fcFilt")){ el.querySelector("#fcFilters").classList.toggle("on"); return; }
    const sh = ev.target.closest("#fcShow button"); if(sh){ F.show = sh.dataset.v; el.querySelectorAll("#fcShow button").forEach(b => b.setAttribute("aria-pressed", String(b === sh))); draw(); return; }
  });
  bindFilters(el.querySelector("#fcFilters"), F, () => { setFilters(el.querySelector("#fcFilters"), F); draw(); });
  el.querySelector("#fcQ").addEventListener("input", ev => { F.q = ev.target.value.trim(); draw(); });
  el.querySelector("#fcSort").addEventListener("change", ev => { F.sort = ev.target.value; draw(); });
  document.body.appendChild(el); draw();
});
