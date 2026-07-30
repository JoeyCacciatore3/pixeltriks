/* PixelTriks — service worker (offline app shell).
   Registers only over http(s); a no-op when the app is opened from file://. */
'use strict';
const CACHE = 'forge-v42';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png',
  './ui/forge.css', './ui/forge-ui.js', './ui/scene3d-ui.js', './ui/assets-ui.js',
  './ui/timeline-ui.js', './ui/polish.js', './ui/three-bundle.js',
  './ui/hotbar.js', './ui/transform-pad.js', './ui/gamepad.js', './ui/remap.js',
  './ui/editmesh-ui.js',
  './core/util.js', './core/api.js', './core/context.js', './core/commands.js',
  './core/plugins.js', './core/transform-manager.js', './core/texgen.js', './core/library.js',
  './core/scene3d.js', './core/editmesh.js', './core/animation.js', './core/publish.js',
  './core/paint3d.js', './core/assets.js',
  './vendor/three/three.module.js',
  './vendor/three/three.core.js',
  './vendor/three/addons/controls/OrbitControls.js',
  './vendor/three/addons/controls/TransformControls.js',
  './vendor/three/addons/loaders/GLTFLoader.js',
  './vendor/three/addons/loaders/HDRLoader.js',
  './vendor/three/addons/loaders/SVGLoader.js',
  './vendor/three/addons/loaders/TTFLoader.js',
  './vendor/three/addons/exporters/GLTFExporter.js',
  './vendor/three/addons/geometries/RoundedBoxGeometry.js',
  './vendor/three/addons/geometries/TextGeometry.js',
  './vendor/three/addons/loaders/FontLoader.js',
  './vendor/three/addons/utils/BufferGeometryUtils.js',
  './vendor/three/addons/utils/SkeletonUtils.js',
  './vendor/fonts/helvetiker_regular.typeface.json',
  './demo-robot.html',
  './assets/models/quaternius_Robot.glb',
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
