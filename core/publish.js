/* PixelTriks — publish.js
   "Create amazing sites": exports the current 3D scene as ONE self-contained
   interactive web page (GF.publish). The .html embeds the scene as a base64
   GLB plus a small three.js viewer (orbit controls, the app's light rig, your
   background) — drop it on any static host (GitHub Pages, Netlify, a plain
   web server) and it just runs. The page pulls the three.js engine from a
   PINNED CDN build matching the version vendored in the app, so what you see
   here is what visitors see there. (Embedding the engine inline for fully
   offline pages is a planned toggle.) */
'use strict';
window.GF = window.GF || {};

GF.publish = (function () {
  const U = GF.util, D = GF.doc;
  const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.185.0';   // keep in lockstep with vendor/three

  function b64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** The one-file page as an HTML string (null when the scene is empty). */
  async function buildPage(opts) {
    opts = opts || {};
    if (!GF.scene3d || !GF.scene3d.count()) { U.toast('Add something to the 3D scene first'); return null; }
    const buf = await GF.scene3d.exportGLBBuffer({});
    if (!buf) return null;
    const glb = b64(buf);
    const bg = GF.scene3d.background();
    const bgMode = opts.background || bg.mode;                     // default | transparent | color
    const bgColor = opts.color || (bgMode === 'color' ? bg.color : '#0c0e11');
    const title = esc(opts.title || D.doc.name || 'PixelTriks scene');
    const autoRotate = opts.autoRotate !== false;
    const transparent = bgMode === 'transparent';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: ${transparent ? 'transparent' : bgColor}; font-family: system-ui, sans-serif; }
  #v { width: 100%; height: 100%; display: block; touch-action: none; }
  #load { position: fixed; inset: 0; display: grid; place-items: center; color: #98a1ad;
          font-size: 12px; letter-spacing: .12em; text-transform: uppercase; }
  #credit { position: fixed; right: 10px; bottom: 8px; color: #98a1ad; opacity: .55;
            font-size: 11px; text-decoration: none; }
  #credit:hover { opacity: 1; }
</style>
<script type="importmap">
{ "imports": {
    "three": "${THREE_CDN}/build/three.module.js",
    "three/addons/": "${THREE_CDN}/examples/jsm/"
} }
</script>
</head>
<body>
<div id="load">Loading scene…</div>
<canvas id="v"></canvas>
<a id="credit" href="https://pixeltriks.com" target="_blank" rel="noopener">made with PixelTriks</a>
<script id="scene-glb" type="application/octet-stream">${glb}</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const raw = document.getElementById('scene-glb').textContent.trim();
const bin = Uint8Array.from(atob(raw), c => c.charCodeAt(0));

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('v'), antialias: true, alpha: ${transparent} });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));

const scene = new THREE.Scene();
${transparent ? '' : `scene.background = new THREE.Color('${bgColor}');`}
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
camera.position.set(2.2, 1.6, 3.2);
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2.5, 2.5, 3); scene.add(key);
const rim = new THREE.DirectionalLight(0xe8a33d, 0.5); rim.position.set(-3, -1, -2); scene.add(rim);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.autoRotate = ${autoRotate}; controls.autoRotateSpeed = 1.1;

let mixer = null, clock = null;
new GLTFLoader().parse(bin.buffer, '', g => {
  scene.add(g.scene);
  const box = new THREE.Box3().setFromObject(g.scene);
  const size = box.getSize(new THREE.Vector3()).length() || 2;
  const center = box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(size * 0.55, size * 0.4, size * 0.85));
  if (g.animations && g.animations.length) {
    mixer = new THREE.AnimationMixer(g.scene);
    clock = new THREE.Clock();
    g.animations.forEach(clip => mixer.clipAction(clip).play());
  }
  const load = document.getElementById('load'); if (load) load.remove();
}, () => { document.getElementById('load').textContent = 'Could not load the scene.'; });

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
renderer.setAnimationLoop(() => { if (mixer && clock) mixer.update(clock.getDelta()); controls.update(); renderer.render(scene, camera); });
</script>
</body>
</html>`;
  }

  async function downloadPage(opts) {
    const html = await buildPage(opts);
    if (!html) return false;
    const name = ((opts && opts.title) || D.doc.name || 'scene').replace(/[^\w-]+/g, '-').toLowerCase();
    U.downloadBlob(new Blob([html], { type: 'text/html' }), name + '.html');
    U.toast('Interactive page saved — upload it to any static host');
    return true;
  }

  if (GF.api && GF.api.register) {
    GF.api.register('publish.page', 'title?, background?("default"|"transparent"|"color"), color?, autoRotate?(bool)',
      'Download the 3D scene as a one-file interactive web page',
      a => (GF.scene3dUI && GF.scene3dUI.publishDialog) ? GF.scene3dUI.publishDialog() : downloadPage(a || {}),
      { group: '3D', label: 'Publish web page…' });
  }

  return { buildPage, downloadPage };
})();
