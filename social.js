/* Interfaccia dell'account e della parte social (scheda «Social»):
   accesso, stato della sincronizzazione, amici, richieste, ricerca,
   chat privata, blocco e segnalazione, feedback dalle Impostazioni.   */

import { S, wipe } from "./store.js";
import { $, $$, esc, toast } from "./ui.js";
import * as cloud from "./cloud.js";
import { DATA, thumbUrl } from "./data.js";
import { openCard } from "./ui.js";

const AVA = f => { const a = f.avatar || {}; return { favImg: a.img || "", favPos: a.pos ?? 34, favZoom: a.zoom ?? 150, fav: a.fav || "", nick: f.nick }; };
const initials = s => String(s || "?").split(/[\s_.-]+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
function miniAvatar(f, size = 38){
  const a = AVA(f);
  return a.favImg ? `<span class="mava" style="width:${size}px;height:${size}px;background-image:url('${esc(a.favImg)}');background-position:50% ${a.favPos}%;background-size:${a.favZoom}% auto"></span>`
                  : `<span class="mava ph" style="width:${size}px;height:${size}px">${esc(initials(f.nick))}</span>`;
}
const when = t => { const d = new Date(t), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }); };

/* ---------------------------------------------------------------- scheda Account (in cima a Social) */
let pendingEmail = "", googleOn = null, rerender = () => {};
async function googleEnabled(){
  if(googleOn != null) return googleOn;
  try{ const r = await fetch(cloud.SUPABASE_URL + "/auth/v1/settings", { headers: { apikey: cloud.SUPABASE_KEY } }); const j = await r.json(); googleOn = !!(j.external && j.external.google); }catch(e){ googleOn = false; }
  return googleOn;
}
export function accountHTML(){
  if(!cloud.cloudConfigured()) return "";
  const st = cloud.state;
  if(!st.user){
    if(googleOn == null) googleEnabled().then(() => rerender());
    return `<div class="card acct" id="acct">
      <h3>Account</h3>
      <div class="sub">Accedi per avere collezione e mazzi su tutti i tuoi dispositivi, aggiungere amici e chattare. Senza account l'app continua a funzionare come ora, tutto resta su questo dispositivo.</div>
      ${googleOn ? `<div style="margin-top:10px"><button class="btn acc2" id="acGoogle">Continua con Google</button></div>` : ""}
      ${pendingEmail ? `<div class="sub" style="margin-top:10px">Abbiamo scritto a <b>${esc(pendingEmail)}</b>: tocca il link nella mail <b>da questo dispositivo</b>, oppure inserisci qui il codice che contiene.</div>
        <div class="acrow"><input class="inp" id="acCode" inputmode="numeric" autocomplete="one-time-code" placeholder="Codice" maxlength="10"><button class="btn yel" id="acVerify">Conferma</button></div>
        <button class="btn sm" id="acReset" style="margin-top:6px">Usa un'altra email</button>`
      : `<div class="acrow"><input class="inp" id="acEmail" type="email" autocomplete="email" placeholder="La tua email"><button class="btn yel" id="acSend">Accedi via email</button></div>
        <div class="sub" style="margin-top:4px">Ti arriva un link (e un codice) per entrare: nessuna password da ricordare.</div>`}
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
    <div class="field"><label>Messaggi dagli amici<small>Solo chi hai accettato come amico può scriverti</small></label>
      <span class="seg" id="acDm"><button data-v="1" aria-pressed="${p.dm_open !== false}">Sì</button><button data-v="0" aria-pressed="${p.dm_open === false}">No</button></span></div>
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
  const row = (f, right) => `<div class="frow2" data-fid="${f.id}">${miniAvatar(f)}<div class="nm"><b>${esc(f.nick)}${online.has(f.id) ? ` <i class="dot on" title="in linea"></i>` : ""}</b><span>${[f.faction, `${f.wins}V – ${f.losses}S`].filter(Boolean).map(esc).join(" · ")}</span></div>${right}</div>`;
  return `<div class="card" id="friends">
    <h3>Amici${acc.length ? ` <small style="color:var(--mute)">${acc.length}</small>` : ""}</h3>
    <div class="acrow"><input class="inp" id="frQ" placeholder="Cerca un giocatore per nick" value="${esc(searchQ)}" autocomplete="off"><button class="btn sm" id="frSearch">Cerca</button></div>
    ${searchRes ? `<div class="frlist">${searchRes.length ? searchRes.map(f => { const known = fr.find(x => x.id === f.id); return row(f, known ? `<span class="chip">${known.status === "accepted" ? "amico" : "richiesta inviata"}</span>` : `<button class="btn sm acc2" data-fadd="${esc(f.nick)}">Aggiungi</button>`); }).join("") : `<div class="sub">Nessun giocatore con questo nick.</div>`}</div>` : ""}
    ${incoming.length ? `<h4 class="frh">Richieste ricevute</h4><div class="frlist">${incoming.map(f => row(f, `<button class="btn sm yel" data-facc="${f.id}">Accetta</button><button class="btn sm" data-frej="${f.id}">Rifiuta</button>`)).join("")}</div>` : ""}
    ${acc.length ? `<div class="frlist">${acc.map(f => row(f, `${f.unread ? `<span class="badge">${f.unread}</span>` : ""}<button class="btn sm acc2" data-fduel="${f.id}" title="Sfida a una partita online">Sfida</button><button class="btn sm" data-fchat="${f.id}">Chat</button><button class="btn sm icon" data-fmenu="${f.id}" aria-label="Altro">⋯</button>`)).join("")}</div>`
      : `<div class="sub" style="margin-top:8px">Ancora nessun amico: cerca il nick di chi conosci e mandagli una richiesta.</div>`}
    ${outgoing.length ? `<h4 class="frh">Richieste inviate</h4><div class="frlist">${outgoing.map(f => row(f, `<span class="chip">in attesa</span><button class="btn sm" data-fcancel="${f.id}">Annulla</button>`)).join("")}</div>` : ""}
  </div>`;
}

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
  box.innerHTML = chatMsgs.length ? chatMsgs.map(m => `<div class="msg${m.sender === me ? " me" : ""}" data-mid="${m.id}"><span>${esc(m.body)}</span><small>${when(m.created_at)}${m.sender === me && m.read_at ? " · letto" : ""}</small></div>`).join("") : `<div class="sub" style="text-align:center;margin:auto">Nessun messaggio: scrivi tu per primo.</div>`;
  if(scroll !== false && (scroll || atEnd || chatMsgs.length && chatMsgs[chatMsgs.length - 1].sender === me)) box.scrollTop = box.scrollHeight;
}
document.addEventListener("ncd:message", async e => {
  const m = e.detail;
  if(chatWith && m.sender === chatWith.id){ chatMsgs.push(m); renderChat(); try{ await cloud.markRead(chatWith.id); }catch(err){} }
  else { const f = cloud.friends.find(x => x.id === m.sender); toast(`💬 ${f ? f.nick : "Nuovo messaggio"}: ${m.body.slice(0, 60)}`, 3500); }
});
document.addEventListener("click", async e => {
  if(!$("#chat") || $("#chat").hidden) return;
  if(e.target.closest("#chClose") || e.target.id === "chat"){ closeChat(); rerender(); return; }
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
  el.innerHTML = `<div class="box"><h3>Questo dispositivo e il tuo account hanno dati diversi</h3>
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
      if(id("#acSend")){ const em = $("#acEmail").value.trim(); if(!/^\S+@\S+\.\S+$/.test(em)){ toast("Scrivi un indirizzo email valido"); return; }
        t.closest("button").disabled = true; await cloud.sendLoginEmail(em); pendingEmail = em; cloud.state.error = null; redraw(); return; }
      if(id("#acVerify")){ const code = $("#acCode").value.trim(); if(code.length < 6){ toast("Il codice ha 6 cifre"); return; } await cloud.verifyCode(pendingEmail, code); pendingEmail = ""; return; }
      if(id("#acReset")){ pendingEmail = ""; redraw(); return; }
      if(id("#acNickSave")){ await cloud.setNick($("#acNick").value.trim()); toast("Nick salvato"); redraw(); return; }
      const sh = id("#acShow button"); if(sh){ await cloud.setProfileFlags({ show_collection: sh.dataset.v === "1" }); return; }
      const dm = id("#acDm button"); if(dm){ await cloud.setProfileFlags({ dm_open: dm.dataset.v === "1" }); return; }
      if(id("#acSync")){ await cloud.syncNow(); toast("Sincronizzato"); return; }
      if(id("#acOut")){ if(confirm("Uscire dall'account? I dati restano anche su questo dispositivo.")){ await cloud.signOut(); } return; }
      if(id("#acDelete")){ if(confirm("Eliminare l'account? Profilo, amici, messaggi e dati salvati nel cloud vengono cancellati per sempre. Quello che c'è su questo dispositivo resta.")){ await cloud.deleteAccount(); toast("Account eliminato"); } return; }
      if(id("#frSearch")){ searchQ = $("#frQ").value.trim(); if(searchQ.length < 2){ toast("Scrivi almeno 2 lettere"); return; } searchRes = await cloud.searchPlayers(searchQ); redraw(); return; }
      const add = id("[data-fadd]"); if(add){ const r = await cloud.friendRequest(add.dataset.fadd); toast({ sent: "Richiesta inviata", accepted: "Siete amici!", already: "Siete già amici", not_found: "Giocatore non trovato", self: "Sei tu!" }[r] || r); redraw(); return; }
      const ac = id("[data-facc]"); if(ac){ await cloud.friendRespond(ac.dataset.facc, true); toast("Richiesta accettata"); return; }
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
    if(e.target.id === "acEmail"){ e.preventDefault(); $("#acSend").click(); }
    if(e.target.id === "acCode"){ e.preventDefault(); $("#acVerify").click(); }
    if(e.target.id === "acNick"){ e.preventDefault(); $("#acNickSave").click(); }
  });
}
async function friendMenu(id){
  const f = cloud.friends.find(x => x.id === id); if(!f) return;
  const acts = [];
  if(f.show_collection) acts.push(["Guarda la collezione", async () => { const coll = await cloud.friendCollection(id); document.dispatchEvent(new CustomEvent("ncd:friendcoll", { detail: { nick: f.nick, coll: coll || {} } })); }]);
  acts.push(["Rimuovi dagli amici", async () => { if(confirm(`Rimuovere ${f.nick} dagli amici?`)) await cloud.friendRemove(id); }]);
  acts.push(["Blocca", async () => { if(confirm(`Bloccare ${f.nick}? Non potrà più trovarti, scriverti né chiederti l'amicizia.`)){ await cloud.blockUser(id); toast("Giocatore bloccato"); } }]);
  acts.push(["Segnala", async () => { const why = prompt(`Perché segnali ${f.nick}?`); if(why != null){ await cloud.reportUser(id, null, why); toast("Segnalazione inviata"); } }]);
  const el = document.createElement("div"); el.id = "mergeAsk";
  el.innerHTML = `<div class="box"><h3>${esc(f.nick)}</h3><div class="opts">${acts.map(([l], i) => `<button class="btn" data-a="${i}">${esc(l)}</button>`).join("")}<button class="btn" data-a="x">Chiudi</button></div></div>`;
  el.addEventListener("click", async ev => { const b = ev.target.closest("[data-a]"); if(!b && ev.target !== el) return; el.remove(); if(b && b.dataset.a !== "x"){ try{ await acts[+b.dataset.a][1](); }catch(err){ toast(err.message, 4000); } } });
  document.body.appendChild(el);
}

/* ---------------------------------------------------------------- feedback (Impostazioni) */
let fbKind = "idea";
export function feedbackHTML(){
  if(!cloud.cloudConfigured()) return "";
  return `<div class="card" id="fb">
    <h3>Feedback</h3>
    <div class="sub">Segnala un problema o proponi un'idea. Arriva in una casella privata letta solo da chi sviluppa l'app; non serve un account e non viene pubblicato niente.</div>
    <div class="field" style="margin-top:8px"><label>Tipo</label><span class="seg" id="fbKind">${[["bug", "Problema"], ["idea", "Idea"], ["altro", "Altro"]].map(([v, t]) => `<button data-v="${v}" aria-pressed="${fbKind === v}">${t}</button>`).join("")}</span></div>
    <textarea class="inp" id="fbBody" rows="4" maxlength="2000" placeholder="Cosa è successo, o cosa ti piacerebbe trovare nell'app" style="width:100%;margin-top:6px"></textarea>
    <input class="inp" id="fbContact" maxlength="120" placeholder="Contatto (facoltativo, solo se vuoi una risposta)" style="width:100%;margin-top:6px" autocomplete="off">
    <div style="margin-top:8px"><button class="btn yel" id="fbSend">Invia feedback</button></div>
  </div>`;
}
export function wireFeedback(root, version){
  root.addEventListener("click", async e => {
    const k = e.target.closest("#fbKind button"); if(k){ fbKind = k.dataset.v; $$("#fbKind button").forEach(b => b.setAttribute("aria-pressed", String(b === k))); return; }
    if(!e.target.closest("#fbSend")) return;
    const body = $("#fbBody").value.trim(); if(body.length < 3){ toast("Scrivi qualche parola in più"); return; }
    const btn = e.target.closest("#fbSend"); btn.disabled = true;
    try{ await cloud.sendFeedback({ kind: fbKind, body, contact: $("#fbContact").value.trim(), version, lang: S.profile.lang || "it" }); $("#fbBody").value = ""; $("#fbContact").value = ""; toast("Grazie! Feedback inviato"); }
    catch(err){ toast("Invio non riuscito: " + (err.message || err), 4500); }
    btn.disabled = false;
  });
}

/* azzera tutto: se c'è un account si esce prima, così il cloud non viene svuotato */
export async function safeWipe(){ if(cloud.state.user){ try{ await cloud.signOut(); }catch(e){} } wipe(); }

/* collezione di un amico (se l'ha resa visibile): le carte che possiede, con le copie */
document.addEventListener("ncd:friendcoll", e => {
  const { nick, coll } = e.detail;
  const byCard = new Map();
  for(const [pid, n] of Object.entries(coll || {})){ const p = DATA.byPrint.get(pid); if(!p || !n) continue; const c = p.card; const x = byCard.get(c.id) || { c, n: 0, p }; x.n += n; byCard.set(c.id, x); }
  const list = [...byCard.values()].sort((a, b) => a.c.dn.localeCompare(b.c.dn));
  const el = document.createElement("div"); el.id = "mergeAsk"; el.className = "wide";
  el.innerHTML = `<div class="box"><h3>Collezione di ${esc(nick)}</h3><p class="sub">${list.length} di ${DATA.cards.length} carte · ${list.reduce((a, x) => a + x.n, 0)} copie</p>
    <div class="grid fc">${list.map(x => `<div class="gc" data-cid="${x.c.id}" data-pid="${x.p.id}"><img src="${thumbUrl(x.p.id)}" alt="${esc(x.c.dn)}" loading="lazy"><span class="qty">×${x.n}</span></div>`).join("") || `<div class="sub">Nessuna carta.</div>`}</div>
    <div class="opts"><button class="btn" data-a="x">Chiudi</button></div></div>`;
  el.addEventListener("click", ev => { const g = ev.target.closest(".gc"); if(g){ openCard(g.dataset.cid, g.dataset.pid); return; } if(ev.target.closest("[data-a]") || ev.target === el) el.remove(); });
  document.body.appendChild(el);
});
