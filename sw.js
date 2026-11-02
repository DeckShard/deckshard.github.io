/* Night City Deck — service worker.
   Rete prima, cache come ripiego: l'app si aggiorna da sola a ogni apertura
   online e continua a funzionare offline con l'ultima versione vista.
   Le immagini delle carte sono messe in cache man mano che le vedi.     */
const CACHE = "ncd-v1";
const CORE = ["./", "./index.html", "./theme.css", "./sim.css", "./app.js", "./data.js", "./store.js", "./ui.js",
  "./collection.js", "./deck.js", "./profile.js", "./sim.js", "./engine.js", "./bot.js", "./scanner.js", "./parser.js", "./rules.js", "./prerelease.js", "./tutorial.js", "./manifest.webmanifest", "./icon.svg"];

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
