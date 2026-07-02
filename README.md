# PixelTriks

A **2D + 3D scene studio** (pixeltriks.com) that runs in any browser and publishes
to the web. Make textures and art in 2D, turn them into 3D, build scenes — then
export a GLB or **a one-file interactive web page** anyone can host anywhere.

Open **`index.html`** (double-click — everything runs from `file://`, no build step).

## The workflow

1. **2D — make the art.** Open/paste/draw an image. Brush, eraser, fill, gradient,
   text, shapes; wand + marquee selections with a one-tap outcome bar (erase & heal,
   cut out, recolor, AI replace, fill); crop/straighten; live Adjust sliders +
   histogram; 6 filter presets; layers with 16 blend modes, masks, layer styles, and
   re-editable adjustment layers (Brightness/Contrast, Levels, Curves, Hue/Sat, B&W).
   AI (bring-your-own-key): remove.bg cutouts, fal.ai generative fill.
   Texture helpers: **Normal map** and **Seamless tile** right in the Image tab.
   Alt-click with brush/fill picks a colour.

2. **Make 3D — convert it.** The 3D panel's **Make 3D** section turns your image
   into geometry (uses your selection when one exists, else the active layer):
   - **Extrude cutout** — traces the visible silhouette (holes included) and
     extrudes a beveled, textured 3D piece. Wand-select a subject → 3D sticker.
   - **Relief map** — brightness becomes height: embossed art, terrain, logos.
   - **Lathe** — spins your shape's silhouette into vases, bottles, pillars.
   - **Layer stack** — every visible layer becomes a floating plane: instant diorama.
   Converters live in an extensible registry (`GF.make3d.register`) — AI depth maps
   and image-to-3D APIs plug in later without UI changes.

3. **3D — build the scene.** 28 primitives (basics, faceted crystals, flat shapes,
   extras), GLB/GLTF import (drag-drop anywhere), Poly Haven CC0 models & HDRIs,
   full transforms (orbit/move/rotate/scale + numeric), per-object materials using
   the document / any layer / an imported image (live-updating as you paint),
   HDRI lighting, its own undo stack (Ctrl+Z routes to whichever world you're in).

4. **Output — ship it.**
   - **Publish web page** — ONE self-contained `.html`: your scene embedded as GLB
     + an interactive three.js viewer (orbit + auto-rotate, your lighting and
     background, responsive). Upload it to GitHub Pages / Netlify / any static host.
     (Pages load the pinned three.js engine from a CDN — same version the app uses.)
   - **Export GLB** — whole scene or one object, for game engines/other tools.
   - **Flatten to layer** — render the scene into the 2D document and keep editing.
   - PNG / JPEG / WebP / split layers / `.forge.json` projects, as always.

## Power features

- **Command palette (⌘/Ctrl K)** — a fuzzy launcher over every action, generated
  from the same command catalog agents use (`GF.api`), so it can't drift. The
  panel is three tabs (Image | Layers | 3D); everything else is palette-first.
- **Scene-first front door** — Create a 3D scene / Turn an image into 3D /
  Texture a model / Edit a photo / Blank canvas.
- Procedural textures (`generate` command), installable PWA + IndexedDB autosave
  with crash-restore, scrubbable history, re-editable text layers, cheat sheet (`?`).

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
  vendor/three/     vendored Three.js 0.160 + addons (offline-first)
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
