/* Forge Studio — service worker (offline app shell).
   Registers only over http(s); a no-op when the app is opened from file://. */
'use strict';
const CACHE = 'forge-v9';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './icon.svg',
  './ui/forge.css', './ui/forge-ui.js', './ai/forge-ai.js', './modes/game-pbr.js',
  './core/util.js', './core/history.js', './core/layers.js', './core/filters.js',
  './core/select.js', './core/retouch.js', './core/tools.js', './core/exporter.js',
  './core/curves.js', './core/api.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // cache-first for the app shell, falling back to network (and caching new GETs)
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return resp;
    }).catch(() => hit))
  );
});
