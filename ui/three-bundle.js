/* PixelTriks — three-bundle.js
   The one ES module in the app: statically imports the vendored Three.js and
   the addons the 3D workspace needs, and hands them to the classic-script
   world via window.__THREE_BUNDLE. Static (not dynamic) imports are used
   deliberately — dynamic import() hangs on file:// in Chrome, and this app
   must run from a plain double-clicked index.html.
   If this module fails (missing vendor files, ancient browser), nothing else
   is affected: core/scene3d.js times out and degrades with a message. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

window.__THREE_BUNDLE = { THREE, OrbitControls, GLTFLoader, RGBELoader, GLTFExporter };
window.dispatchEvent(new Event('three-bundle-ready'));
