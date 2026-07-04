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
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { FontLoader, Font } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

window.__THREE_BUNDLE = { THREE, OrbitControls, TransformControls, GLTFLoader, HDRLoader, GLTFExporter, RoundedBoxGeometry, mergeGeometries, SVGLoader, FontLoader, Font, TextGeometry };
window.dispatchEvent(new Event('three-bundle-ready'));
