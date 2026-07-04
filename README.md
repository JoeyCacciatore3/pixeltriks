# PixelTriks

A **3D scene studio** (pixeltriks.com) that runs in any browser and publishes
to the web. Build 3D scenes, texture them with built-in 2D tools, convert images
into geometry — then export a GLB or **a one-file interactive web page** anyone
can host anywhere.

Open **`index.html`** (double-click — everything runs from `file://`, no build step).

## The workflow

1. **Build a 3D scene.** The viewport starts in 3D — 28 primitives, GLB/GLTF import
   (drag-drop anywhere), Poly Haven CC0 models & HDRIs. TransformControls gizmos
   for move/rotate/scale (W/E/R keys), HDRI lighting, per-object PBR materials.
   Scene tree in the left sidebar, properties panel on the right.

2. **Texture with 2D tools.** Built-in brush, eraser, fill, gradient, text, shapes;
   wand + marquee selections with a one-tap outcome bar (erase & heal, cut out,
   recolor, AI replace, fill); live Adjust sliders + histogram; 6 filter presets;
   layers with 16 blend modes, masks, layer styles, and re-editable adjustment
   layers. Normal map and Seamless tile generators. AI (BYOK): remove.bg cutouts,
   fal.ai generative fill.

3. **Convert 2D → 3D.** The Make 3D converters turn your images into geometry:
   - **Extrude cutout** — traces the visible silhouette and extrudes it.
   - **Relief map** — brightness becomes height: terrain, logos, embossing.
   - **Lathe** — spins a silhouette into vases, bottles, pillars.
   - **Layer stack** — every visible layer becomes a floating plane: instant diorama.
   Extensible via `GF.make3d.register()`.

4. **Ship it.**
   - **Publish web page** — ONE self-contained `.html` with interactive three.js viewer.
   - **Export GLB** — whole scene or selected object, for game engines/other tools.
   - **Flatten to layer** — render 3D onto 2D and keep editing.
   - PNG / JPEG / WebP / split layers / `.forge.json` projects.

## Power features

- **Command palette (⌘/Ctrl K)** — fuzzy launcher over 59 commands, same catalog
  agents use (`GF.api`). See `API.md` for the full reference.
- **3D-first front door** — 3D viewport loads immediately, scene tree in sidebar.
- **TransformControls** — visual gizmo handles (W=translate, E=rotate, R=scale).
- **Toolbar dropdowns** — + Add (primitives, import) and Tools (all 2D tools).
- Procedural textures, installable PWA + IndexedDB autosave with crash-restore,
  scrubbable history, re-editable text layers, cheat sheet (`?`).

## AI (bring your own key)

`ai/forge-ai.js` — open **✦ AI** to set a provider + key (kept in memory only):
**remove.bg** (one-click cutout), **fal.ai** (generative fill on a selection),
or a **custom endpoint**. If the browser blocks a request, run the bundled proxy:

```bash
node tools/cors-proxy.js     # http://localhost:8787/?url=
```

## How it's built

Classic scripts, no bundler; the app works offline from a double-click:

```
pixeltriks/
  index.html        single-page shell (+ import map for three.js)
  core/             engine (global GF): util · history · layers · filters ·
                    select · retouch · tools · exporter · curves · api ·
                    texgen · library · scene3d · make3d · publish
  ui/               forge-ui.js (2D UI) · scene3d-ui.js (3D panel/optbar) ·
                    three-bundle.js (the one ES module — hands three.js to
                    the classic-script world) · forge.css
  ai/               forge-ai.js (provider-agnostic AI adapter)
  vendor/three/     vendored Three.js r185 + addons (offline-first)
  vendor/imagetracer/  raster→vector tracer (public domain) for Make 3D
  assets/models/    sample GLBs
  tools/            cors-proxy.js (optional AI helper)
  tests/            browser e2e + userflow harnesses
```

Everything routes through one discoverable command catalog
(`GF.api.describe()` / `run(name, args)`) — including AI (`aiGenerate`), the 3D
workspace (`scene3d.*`), the converters (`make3d.*`), and the publisher
(`publish.page`) — which makes the whole app scriptable by automated agents.

## Verifying

```bash
bash tests/run-e2e.sh              # full feature audit incl. 3D + Make-3D + publish
bash tests/run-userflow.sh         # pointer/keyboard user flows, desktop
bash tests/run-userflow-mobile.sh  # same, mobile viewport
```
