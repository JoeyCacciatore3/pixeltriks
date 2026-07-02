# PixelTriks

A **general-purpose, AI-assisted image editor with a built-in 3D workspace**
(pixeltriks.com) that runs in any browser. Two things, done deeply:

1. **Image alteration & enhancement** — retouch, cut out, recolor, adjust, filter,
   with layers/masks/curves underneath.
2. **3D + GLB** — import GLB/GLTF models (or add primitives), pose them, texture them
   with *your own images and designs*, then export a `.glb` or flatten a render back
   onto the canvas as a normal layer. One canvas is the ops center for both.

Open **`index.html`** (double-click — everything runs from `file://`, no build step).

## Image editing

- **Open / import** any image (drag-drop, paste, or Open), or start a **New** canvas.
- **Tools** — Move, Marquee, Magic Wand, Magic Erase, Crop/Straighten, Brush, Eraser,
  Clone stamp, Fill, Gradient, Text, Shapes, Eyedropper. Selections constrain painting
  and filters.
- **Adjust** — Exposure, Contrast, Saturation, Vibrance, Warmth, Clarity with **live,
  non-destructive preview** + histogram + hold-to-compare; one-tap **Auto enhance**;
  a strip of **filter presets**.
- **Hero actions** — **Remove background**, **Magic erase** (content-aware), and
  **Generative fill** (AI).
- **Selection outcome bar** — make any selection and a bar of one-tap outcomes appears
  right at it: Erase & heal, Cut out, Recolor, Replace (AI), Fill, plus refine actions.
- **Layers** — full stack, 16 blend modes, opacity, masks, layer styles
  (outline/glow/shadow/bevel/emboss), and **re-editable adjustment layers**
  (Brightness/Contrast, Levels, Curves, Hue/Saturation, Posterize, B&W, Invert,
  Auto Levels). Re-editable **text layers** (double-click to change).
- **More tab** — scrubbable named history + the pro ops grid (content-aware fill,
  color replace, smart upscale, curves, trim, flip/rotate, mask, ink outline,
  clean colors, normal map, seamless tile).
- **Export** — PNG / JPEG / WebP at 1×/2×/0.5×, split layers, GLB (when a 3D scene
  exists), or save a `.forge.json` project.

## 3D workspace (the ⬡ tool)

- **Import** `.glb` / `.gltf` (drag-drop anywhere — the app jumps straight into 3D),
  add primitives (box, sphere, cylinder, cone, torus, knot, capsule, plane, panel,
  tile, hex, curved), or pull CC0 models from **Poly Haven**.
- **Pose** — Orbit / Move / Rotate / Scale modes; click to select (Del removes,
  F frames); exact numeric transforms (position / rotation / scale per axis).
- **Texture with your images** — per object, use the whole document, any single layer,
  or an imported image as the color map; normal/roughness maps bind by layer-name
  convention or explicit pick. **Paint in 2D and the model updates live.**
- **Light** — HDRI environments (file or Poly Haven) with proper reflections;
  studio / transparent / solid backgrounds.
- **Output** — **Export GLB** (whole scene or selected object), or **Flatten to
  layer**: a document-resolution transparent render lands as a regular 2D layer and
  you're back in the image editor.
- 3D edits have their own undo stack; Ctrl+Z routes to whichever world you're in.

Three.js (0.160) is vendored in `vendor/three/` — the 3D workspace works offline too.

## Power features

- **Command palette** — **⌘/Ctrl K**: a fuzzy launcher over *every* action. The list is
  generated from the same command catalog agents use (`GF.api`), so it can't drift.
- **Pro crop** — 8 handles, aspect presets, rule-of-thirds grid, arbitrary-angle
  straighten with canvas auto-expand.
- **Procedural textures** — clouds/wood/marble/bricks/checker/gradient/stone/metal/
  grass/rust via `GF.api.run('generate', {kind})`, offline.
- **Installable PWA + autosave** — install over http(s); work autosaves to IndexedDB
  with crash-restore. Keyboard cheat-sheet (`?`), light/dark theme.

## AI (bring your own key)

`ai/forge-ai.js` is a provider-agnostic adapter — open **✦ AI** to set a provider + key
(kept **in memory only**, never written to disk):

- **remove.bg** — one-click cutout (also auto-upgrades the *Remove background* hero).
- **fal.ai** — generative fill / inpaint: select a region, describe it, and the result
  comes back as a **new non-destructive layer**.
- **Custom** — any endpoint; the response is scanned for an image (data URL, link, or
  base64).

If a request is blocked by the browser (common from `file://`), run the bundled
zero-dependency CORS proxy and set its prefix in the ✦ AI dialog:

```bash
node tools/cors-proxy.js     # http://localhost:8787/?url=
```

## How it's built

Classic scripts, no bundler, so the app works offline from a double-click:

```
pixeltriks/
  index.html        responsive single-page shell (+ import map for three.js)
  core/             raster + 3D engine (global GF namespace):
                    util · history · layers · filters · select · retouch ·
                    tools · exporter · curves · api · texgen · library · scene3d
  ui/               forge-ui.js (2D UI) · scene3d-ui.js (3D panel/optbar) ·
                    three-bundle.js (the one ES module: hands three.js to the
                    classic-script world) · forge.css
  ai/               forge-ai.js (provider-agnostic AI adapter)
  vendor/three/     vendored Three.js 0.160 + addons (offline-first)
  assets/models/    bundled sample GLBs (also e2e fixtures)
  tools/            cors-proxy.js (optional AI helper)
  tests/            browser e2e + userflow harnesses
```

The UI drives the engine entirely through its public surface — chiefly
`GF.api.run(name, args)` over a **single discoverable command catalog**
(`GF.api.describe()`), which now includes the AI (`aiGenerate`) and 3D
(`scene3d.*`) commands; modules self-register via `GF.api.register`. Commands
annotated with UI metadata surface automatically in the command palette. That same
API makes the whole app scriptable by an automated agent. The engine depends on the
UI only through a small `GF.ui` contract.

## Verifying

```bash
bash tests/run-e2e.sh              # full feature audit incl. the 3D suite (software WebGL)
bash tests/run-userflow.sh         # pointer/keyboard user flows, desktop
bash tests/run-userflow-mobile.sh  # same, mobile viewport
```
