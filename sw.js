/* DeckShard — service worker.
   Rete prima, cache come ripiego: l'app si aggiorna da sola a ogni apertura
   online e continua a funzionare offline con l'ultima versione vista.
   Le immagini delle carte sono messe in cache man mano che le vedi.     */
const CACHE = "ncd-v1";  // chat, filtri, temi e novità: 1.9.18
const CORE = ["./", "./index.html", "./theme.css", "./sim.css", "./app.js", "./data.js", "./store.js", "./ui.js",
  "./collection.js", "./deck.js", "./profile.js", "./sim.js", "./engine.js", "./bot.js", "./scanner.js", "./parser.js", "./rules.js", "./prerelease.js", "./tutorial.js", "./i18n.js", "./cloud.js", "./social.js", "./online.js", "./home.js", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE).catch(() => {}))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener("fetch", e => {
  const req = e.request; if(req.method !== "GET") return;
  const url = new URL(req.url); if(url.origin !== location.origin) return;
  const isImg = /\/img\//.test(url.pathname);
  if(isImg){ // immagini: cache prima (non cambiano), poi rete
    e.respondWith(caches.open(CACHE).then(async c => { const hit = await c.match(req); if(hit) return hit; try{ const r = await fetch(req); if(r.ok) c.put(req, r.clone()); return r; }catch(err){ return new Response("", { status: 404 }); } }));
    return;
  }
  // tutto il resto: rete prima (senza cache HTTP per i file dell'app), ripiego sulla cache
  const fresh = req.mode === "navigate" ? new Request(url.pathname.endsWith("/") || url.pathname.endsWith(".html") ? url.href : url.href, { cache: "no-cache" }) : new Request(req, { cache: "no-cache" });
  e.respondWith(fetch(fresh).then(r => { if(r.ok){ const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })
    .catch(async () => (await caches.match(req)) || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())));
});

/* notifiche push: messaggi, sfide e richieste d'amicizia (le manda la Edge Function «push»).
   Come icona il ritratto di chi scrive, ritagliato come il suo avatar nell'app (Android e PC;
   su iPhone il sistema mostra sempre l'icona dell'app). Se qualcosa va storto, logo dell'app. */
const AVA_INK = "#ff3b3b", AVA_BG = "#120a0b";
async function avatarIcon(a){
  if(!a || typeof OffscreenCanvas === "undefined") return null;
  const S = 192, cv = new OffscreenCanvas(S, S), g = cv.getContext("2d");
  g.fillStyle = AVA_BG; g.fillRect(0, 0, S, S);
  if(a.img && /^\.\/img\/[\w-]+\.webp$/.test(a.img)){
    const url = new URL(a.img, self.registration.scope).href;
    const r = (await caches.match(url)) || await fetch(url); if(!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob());
    // come in CSS: background-size zoom% auto, background-position 50% pos%
    const w = S * (+a.zoom || 150) / 100, h = w * bmp.height / bmp.width;
    g.drawImage(bmp, (S - w) / 2, (S - h) * (+a.pos || 34) / 100, w, h);
  }else{
    const ini = String(a.name || "").split(/\s+/).filter(Boolean).map(x => x[0]).join("").slice(0, 2).toUpperCase(); if(!ini) return null;
    g.fillStyle = AVA_INK; g.font = "800 84px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(ini, S / 2, S / 2 + 4);
  }
  const buf = new Uint8Array(await (await cv.convertToBlob({ type: "image/jpeg", quality: .85 })).arrayBuffer());
  let bin = ""; for(let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return "data:image/jpeg;base64," + btoa(bin);
}
self.addEventListener("push", e => {
  let d = {}; try{ d = e.data ? e.data.json() : {}; }catch(err){ d = { title: "DeckShard", body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    let icon = null; try{ icon = await avatarIcon(d.ava); }catch(err){ icon = null; }
    await self.registration.showNotification(d.title || "DeckShard", {
      body: d.body || "", icon: icon || "icon-192.png", badge: "icon-192.png", tag: d.tag || undefined, renotify: !!d.tag,
      data: { url: new URL(d.url || "./", self.registration.scope).href }
    });
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  let url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  // messaggio di un amico: si apre direttamente la sua conversazione nella scheda Chat
  const tag = e.notification.tag || ""; if(/^msg-[\w-]{8,64}$/.test(tag)) url = new URL("./#chat/" + tag.slice(4), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for(const c of list){ if(c.url.startsWith(self.registration.scope)){ c.focus(); return c.navigate ? c.navigate(url) : undefined; } }
    return self.clients.openWindow(url);
  }));
});
