/* Account e cloud (Supabase): accesso con link/codice email (e Google quando
   è configurato), sincronizzazione di collezione, mazzi, profilo,
   impostazioni e record tra dispositivi, profilo pubblico, amici, chat,
   presenza in linea, feedback anonimo.

   Il client Supabase si carica dalla CDN solo quando serve: senza account
   l'app resta tutta locale e funziona offline come prima.

   Sincronizzazione: ogni sezione ha un "timbro" (ms) dell'ultima modifica
   locale. Al primo accesso su un dispositivo che ha già dati si sceglie se
   unire, tenere il cloud o tenere il dispositivo; dopo, vince la modifica
   più recente sezione per sezione (i mazzi si uniscono mazzo per mazzo). */

import { S, onSave, quietly, rawGet, rawSet, DEFAULT_PROFILE } from "./store.js";

export const SUPABASE_URL = "https://uxbtwurhsujzyzvsvghm.supabase.co";
export const SUPABASE_KEY = "sb_publishable__IATo8hKZDNZMp9_jESfAQ_Ll6PwNqF";   // chiave pubblica: i permessi li fanno le regole del database
const SDK = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
const SECTIONS = ["coll", "decks", "profile", "settings", "record"];

/* configurazione sovrascrivibile per i collaudi (localStorage "ncd:cloudcfg") */
const cfg = (() => { try { return JSON.parse(localStorage.getItem("ncd:cloudcfg") || "null"); } catch(e){ return null; } })() || { url: SUPABASE_URL, key: SUPABASE_KEY };
export const cloudConfigured = () => !!(cfg.url && cfg.key);

let sb = null, loading = null;
export const state = { user: null, profile: null, status: "off", lastSync: rawGet("lastSync", null), error: null, online: new Set(), unread: 0, requests: 0 };
const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

export async function client(){
  if(sb) return sb;
  if(!cloudConfigured()) return null;
  loading = loading || import(SDK).then(m => {
    sb = m.createClient(cfg.url, cfg.key, { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "ncd:auth" } });
    sb.auth.onAuthStateChange((ev, session) => { setTimeout(() => onAuth(ev, session), 0); });
    return sb;
  }).catch(e => { loading = null; throw e; });
  return loading;
}
/* all'avvio: carica il client solo se c'è una sessione salvata o se si arriva da un link di accesso */
export async function bootCloud(){
  if(!cloudConfigured()) return;
  const hasSession = (() => { try { return !!localStorage.getItem("ncd:auth"); } catch(e){ return false; } })();
  const fromLink = /[?&]code=/.test(location.search) || /access_token=/.test(location.hash);
  if(!hasSession && !fromLink) return;
  try{
    const c = await client();
    const { data } = await c.auth.getSession();
    if(fromLink) history.replaceState(null, "", location.pathname + (location.hash && !/access_token/.test(location.hash) ? location.hash : ""));
    if(data.session) await onAuth("INITIAL_SESSION", data.session);
  }catch(e){ state.error = e.message; emit("ncd:cloud"); }
}

/* ---------------------------------------------------------------- accesso */
const redirectTo = () => location.origin + location.pathname;
export async function sendLoginEmail(email){
  const c = await client();
  const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo(), shouldCreateUser: true } });
  if(error) throw error;
}
export async function verifyCode(email, code){
  const c = await client();
  const { error } = await c.auth.verifyOtp({ email, token: code.trim(), type: "email" });
  if(error) throw error;
}
export async function signInGoogle(){
  const c = await client();
  const { error } = await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
  if(error) throw error;
}
export async function signInAnon(){   // solo per i collaudi
  const c = await client();
  const { error } = await c.auth.signInAnonymously();
  if(error) throw error;
}
export async function signOut(){
  const c = await client(); if(!c) return;
  // chi esce non deve più ricevere le notifiche dell'account su questo telefono
  try{ await disablePush(); if(S.settings.push){ S.settings.push.on = false; S.save("settings"); } }catch(e){}
  await c.auth.signOut();
}
export async function deleteAccount(){
  const c = await client();
  const { error } = await c.rpc("delete_me"); if(error) throw error;
  await c.auth.signOut();
}

let channel = null, presence = null;
async function onAuth(ev, session){
  const u = session && session.user;
  if(!u){ if(state.user){ state.user = null; state.profile = null; state.status = "off"; teardown(); emit("ncd:cloud"); } return; }
  if(state.user && state.user.id === u.id && ev !== "INITIAL_SESSION" && ev !== "SIGNED_IN") return;
  const first = !state.user || state.user.id !== u.id;
  state.user = u;
  if(!first) return;
  state.status = "sync"; emit("ncd:cloud");
  try{
    await loadProfile();
    await firstSync();
    subscribe();
    await refreshSocial();
  }catch(e){ state.error = e.message; state.status = "error"; }
  emit("ncd:cloud");
}

/* ---------------------------------------------------------------- profilo pubblico */
export async function loadProfile(){
  const c = await client();
  const { data, error } = await c.from("profiles").select("*").eq("id", state.user.id).maybeSingle();
  if(error) throw error;
  state.profile = data;
  // l'opzione «messaggi dagli amici» non esiste più: chi l'aveva chiusa torna a ricevere i messaggi degli amici
  if(data && data.dm_open === false){ try{ await c.from("profiles").update({ dm_open: true }).eq("id", state.user.id); data.dm_open = true; }catch(e){} }
  return data;
}
const NICK_RX = /^[A-Za-z0-9_.-]{3,24}$/;
export const nickValid = n => NICK_RX.test(n || "");
export const suggestNick = n => (n || "").normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
export async function setNick(nick){
  if(!nickValid(nick)) throw new Error("Il nick deve avere 3–24 caratteri: lettere, numeri, _ . -");
  const c = await client();
  const { error } = await c.from("profiles").update({ nick, updated_at: new Date().toISOString() }).eq("id", state.user.id);
  if(error){ if(/duplicate|unique/i.test(error.message)) throw new Error("Questo nick è già usato da un altro giocatore"); throw error; }
  state.profile.nick = nick;
  quietly(() => { S.profile.nick = nick; S.save("profile"); });
  touch("profile");
}
/* i campi pubblici del profilo seguono quelli locali (avatar, fazione, percorso, record) */
let pubTimer = null;
function schedulePublic(){
  if(!state.user || !state.profile) return;
  clearTimeout(pubTimer);
  pubTimer = setTimeout(async () => {
    const p = S.profile, r = S.record;
    const row = { avatar: { img: p.favImg || "", pos: p.favPos ?? 34, zoom: p.favZoom ?? 150, fav: p.fav || "" }, faction: p.faction || null, lifepath: p.lifepath || null,
      wins: r.wins || 0, losses: r.losses || 0, updated_at: new Date().toISOString() };
    try{ const c = await client(); await c.from("profiles").update(row).eq("id", state.user.id); Object.assign(state.profile, row); }catch(e){}
  }, 1200);
}
export async function setProfileFlags(flags){
  const c = await client();
  const { error } = await c.from("profiles").update(flags).eq("id", state.user.id); if(error) throw error;
  Object.assign(state.profile, flags); emit("ncd:cloud");
}

/* ---------------------------------------------------------------- sincronizzazione */
const stamps = () => rawGet("stamps", {});
const synced = () => rawGet("synced", {});
function touch(k){ const s = stamps(); s[k] = Date.now(); rawSet("stamps", s); }
onSave(k => {
  if(!SECTIONS.includes(k)) return;
  touch(k);
  if(k === "profile" || k === "record") schedulePublic();
  schedulePush();
});
let pushTimer = null;
function schedulePush(){ if(!state.user) return; clearTimeout(pushTimer); pushTimer = setTimeout(() => push().catch(() => {}), 1500); }

const isEmptyLocal = () => !Object.keys(S.coll).length && !S.decks.length;
async function fetchRemote(){
  const c = await client();
  const { data, error } = await c.from("user_data").select("*").eq("user_id", state.user.id).maybeSingle();
  if(error) throw error;
  return data;
}
/* primo collegamento di questo dispositivo all'account */
async function firstSync(){
  const remote = await fetchRemote();
  const linked = rawGet("syncUser", null);
  const remoteEmpty = !remote || !Object.keys(remote.stamps || {}).length;
  if(linked === state.user.id){ await pull(remote); await push(); return; }
  let choice = "cloud";
  if(remoteEmpty) choice = "device";
  else if(!isEmptyLocal()) choice = await askMerge(remote);
  if(choice === "merge") applyMerge(remote);
  else if(choice === "cloud") applyRemote(remote, SECTIONS);
  rawSet("syncUser", state.user.id);
  if(choice !== "cloud"){ const s = stamps(); for(const k of SECTIONS) if(!s[k] || choice === "merge") s[k] = Date.now(); rawSet("stamps", s); rawSet("synced", {}); }
  else rawSet("synced", { ...(remote.stamps || {}) });
  await push(true);
  // nick: se quello pubblico è provvisorio, si propone quello locale
  if(state.profile && /^choom_/.test(state.profile.nick) && nickValid(suggestNick(S.profile.nick))){ try{ await setNick(suggestNick(S.profile.nick)); }catch(e){} }
  else if(state.profile && S.profile.nick !== state.profile.nick) quietly(() => { S.profile.nick = state.profile.nick; S.save("profile"); });
  schedulePublic();
}
/* scelta dell'utente: la chiede l'interfaccia (social.js registra la funzione) */
let mergeAsker = async () => "merge";
export const setMergeAsker = f => { mergeAsker = f; };
const askMerge = remote => mergeAsker({ remoteCards: Object.values(remote.coll || {}).reduce((a, b) => a + b, 0), remoteDecks: (remote.decks || []).length,
  localCards: Object.values(S.coll).reduce((a, b) => a + b, 0), localDecks: S.decks.length });

function mergeDecks(a, b){
  const m = new Map();
  for(const d of [...(a || []), ...(b || [])]){ const x = m.get(d.id); if(!x || (d.updated || 0) > (x.updated || 0)) m.set(d.id, d); }
  return [...m.values()].sort((x, y) => (y.updated || 0) - (x.updated || 0));
}
function applyMerge(remote){
  quietly(() => {
    const coll = { ...(remote.coll || {}) };
    for(const [pid, n] of Object.entries(S.coll)) coll[pid] = Math.max(coll[pid] || 0, n);   // unione: per ogni stampa il numero più alto, mai la somma
    S.coll = coll; S.save("coll");
    S.decks = mergeDecks(S.decks, remote.decks); S.save("decks");
    const rs = remote.stamps || {}, ls = stamps();
    for(const k of ["profile", "settings", "record"]) if((rs[k] || 0) > (ls[k] || 0)) applySection(k, remote[k]);
  });
}
function applySection(k, v){
  if(k === "coll") S.coll = v || {};
  else if(k === "decks") S.decks = v || [];
  else if(k === "profile") S.profile = Object.assign({}, DEFAULT_PROFILE, v || {});
  else if(k === "settings") S.settings = Object.assign(S.settings, v || {});
  else if(k === "record") S.record = Object.assign({ wins: 0, losses: 0, games: [] }, v || {});
  S.save(k);
}
function applyRemote(remote, keys){
  quietly(() => { for(const k of keys) applySection(k, remote[k]); });
  const s = stamps(); for(const k of keys) s[k] = (remote.stamps || {})[k] || s[k] || 0; rawSet("stamps", s);
  emit("ncd:synced", { keys });
}
/* dal cloud: le sezioni cambiate altrove e non toccate qui dall'ultima sincronizzazione */
export async function pull(remote){
  if(!state.user) return;
  remote = remote || await fetchRemote(); if(!remote) return;
  const rs = remote.stamps || {}, ls = stamps(), sy = synced(), take = [];
  for(const k of SECTIONS){
    const remoteNewer = (rs[k] || 0) > (sy[k] || 0), localDirty = (ls[k] || 0) > (sy[k] || 0);
    if(!remoteNewer) continue;
    if(!localDirty || (rs[k] || 0) > (ls[k] || 0)){
      if(k === "decks" && localDirty){ quietly(() => { S.decks = mergeDecks(S.decks, remote.decks); S.save("decks"); }); touch("decks"); continue; }
      take.push(k);
    }
  }
  if(take.length) applyRemote(remote, take);
  const nsy = synced(); for(const k of SECTIONS) if(take.includes(k)) nsy[k] = rs[k]; rawSet("synced", nsy);
  if(take.length) markSynced();
}
/* verso il cloud: le sezioni modificate qui */
export async function push(all = false){
  if(!state.user) return;
  const ls = stamps(), sy = synced(), row = {}, newSy = { ...sy };
  for(const k of SECTIONS) if(all || (ls[k] || 0) > (sy[k] || 0)){ row[k] = S[k]; newSy[k] = ls[k] || Date.now(); }
  if(!Object.keys(row).length){ markSynced(); return; }
  const c = await client();
  const remote = await fetchRemote();
  const rs = { ...((remote && remote.stamps) || {}) };
  for(const k of Object.keys(row)) rs[k] = newSy[k];
  const { error } = await c.from("user_data").upsert({ user_id: state.user.id, ...row, stamps: rs, updated_at: new Date().toISOString() });
  if(error){ state.status = "error"; state.error = error.message; emit("ncd:cloud"); throw error; }
  rawSet("synced", newSy);
  markSynced();
}
function markSynced(){ state.status = "ok"; state.error = null; state.lastSync = Date.now(); rawSet("lastSync", state.lastSync); emit("ncd:cloud"); }
export async function syncNow(){ await pull(); await push(); }
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible" && state.user) pull().catch(() => {}); });

/* ---------------------------------------------------------------- tempo reale: dati, messaggi, amicizie, presenza */
function subscribe(){
  teardown();
  const me = state.user.id;
  channel = sb.channel("me:" + me)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "user_data", filter: `user_id=eq.${me}` }, () => pull().catch(() => {}))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient=eq.${me}` }, p => { emit("ncd:message", p.new); refreshSocial(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => refreshSocial())
    .subscribe();
  presence = sb.channel("online", { config: { presence: { key: me } } });
  presence.on("presence", { event: "sync" }, () => { state.online = new Set(Object.keys(presence.presenceState())); emit("ncd:presence"); })
    .subscribe(async st => { if(st === "SUBSCRIBED") await presence.track({ at: Date.now() }); });
}
function teardown(){ if(channel){ sb.removeChannel(channel); channel = null; } if(presence){ sb.removeChannel(presence); presence = null; } state.online = new Set(); }

/* ---------------------------------------------------------------- social */
export let friends = [];
export async function refreshSocial(){
  if(!state.user) return;
  try{
    const c = await client();
    const { data, error } = await c.rpc("friends_list"); if(error) throw error;
    friends = data || [];
    state.unread = friends.reduce((a, f) => a + (f.unread || 0), 0);
    state.requests = friends.filter(f => f.status === "pending" && f.incoming).length;
  }catch(e){ state.error = e.message; }
  emit("ncd:social");
}
const rpc = async (fn, args) => { const c = await client(); const { data, error } = await c.rpc(fn, args); if(error) throw error; return data; };
export const searchPlayers = q => rpc("search_players", { q });
export async function friendRequest(nick){ const r = await rpc("friend_request", { target_nick: nick }); await refreshSocial(); return r; }
export async function friendRespond(id, accept){ await rpc("friend_respond", { other: id, accept }); await refreshSocial(); }
export async function friendRemove(id){ await rpc("friend_remove", { other: id }); await refreshSocial(); }
export async function blockUser(id, on = true){ await rpc("block_user", { other: id, on_off: on }); await refreshSocial(); }
export const reportUser = (id, msg, why) => rpc("report_user", { other: id, msg: msg || null, why: why || null });
export const friendCollection = id => rpc("friend_collection", { other: id });
export async function markRead(id){ await rpc("mark_read", { other: id }); await refreshSocial(); }
export async function loadMessages(id, limit = 60){
  const c = await client(); const me = state.user.id;
  const { data, error } = await c.from("messages").select("*").or(`and(sender.eq.${me},recipient.eq.${id}),and(sender.eq.${id},recipient.eq.${me})`).order("created_at", { ascending: false }).limit(limit);
  if(error) throw error;
  return (data || []).reverse();
}
export async function sendMessage(id, body){
  const c = await client();
  const { data, error } = await c.from("messages").insert({ sender: state.user.id, recipient: id, body: body.slice(0, 1000) }).select().single();
  if(error){ if(/row-level security/i.test(error.message)) throw new Error("Non puoi scrivere a questo giocatore"); throw error; }
  return data;
}

/* ---------------------------------------------------------------- feedback (anche senza account) */
export async function sendFeedback({ kind, body, contact, version, lang }){
  const c = await client(); if(!c) throw new Error("Servizio non configurato");
  const device = `${navigator.userAgent.match(/\(([^)]+)\)/)?.[1] || ""} · ${innerWidth}×${innerHeight}`.slice(0, 200);
  const { error } = await c.from("feedback").insert({ kind, body, contact: contact || null, app_version: version, lang, device });
  if(error) throw error;
}

/* ---------------------------------------------------------------- notifiche push
   Il telefono si iscrive con la chiave pubblica che gli dà la Edge Function «push» e registra l'iscrizione
   nel database (save_push). Le preferenze (messaggi, sfide, richieste) viaggiano con l'iscrizione. */
const urlB64 = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while(s.length % 4) s += "="; const b = atob(s); return Uint8Array.from(b, c => c.charCodeAt(0)); };
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
/* iPhone e iPad: le notifiche web funzionano solo con l'app aggiunta alla schermata Home */
export const pushNeedsInstall = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window.matchMedia("(display-mode: standalone)").matches || navigator.standalone);
export async function pushSubscription(){ if(!pushSupported()) return null; const reg = await navigator.serviceWorker.getRegistration(); return reg ? reg.pushManager.getSubscription() : null; }
export async function enablePush(prefs, lang){
  if(!state.user) throw new Error("Serve un account");
  if(!pushSupported()) throw new Error("Questo browser non supporta le notifiche");
  const perm = await Notification.requestPermission();
  if(perm !== "granted") throw new Error("Permesso negato: riattivalo dalle impostazioni del browser per questo sito");
  const c = await client(); const { data: s } = await c.auth.getSession();
  if(!s || !s.session) throw new Error("Serve un account");
  const r = await fetch(`${cfg.url}/functions/v1/push`, { headers: { apikey: cfg.key, Authorization: `Bearer ${s.session.access_token}` } });
  if(!r.ok) throw new Error("Servizio notifiche non disponibile (" + r.status + ")");
  const { publicKey } = await r.json();
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if(sub && sub.options && sub.options.applicationServerKey && b64url(sub.options.applicationServerKey) !== publicKey){ await sub.unsubscribe(); sub = null; }
  if(!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(publicKey) });
  const j = sub.toJSON();
  const { error } = await c.rpc("save_push", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_prefs: prefs, p_lang: lang === "en" ? "en" : "it" });
  if(error) throw new Error(error.message);
  return true;
}
export async function disablePush(){
  const sub = await pushSubscription(); if(!sub) return;
  try{ if(state.user){ const c = await client(); await c.rpc("delete_push", { p_endpoint: sub.endpoint }); } }catch(e){}
  await sub.unsubscribe();
}
