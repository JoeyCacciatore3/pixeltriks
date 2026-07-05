# PixelTriks

A **3D scene studio** (pixeltriks.com) that runs in any browser and publishes
to the web. Build 3D scenes, texture them with built-in 2D tools, convert images
into geometry — then export a GLB or **a one-file interactive web page** anyone
can host anywhere.

Open **`index.html`** (double-click — everything runs from `file://`, no build step).

## The Game Deck UI

PixelTriks uses a **four-edge "Game Deck" layout** inspired by handheld game
controllers — every screen edge has exactly one job, and the center is 100% canvas:

```
┌─────────────────────────────────────────────────────┐
│  TOP = Status: logo, undo/redo, zoom, search        │
├──────────┬──────────────────────────┬───────────────┤
│  LEFT    │                          │  RIGHT        │
│  = PICK  │     CENTER = VIEWPORT    │  = INSPECT    │
│  (tools) │     (100% canvas/3D)     │  (properties) │
│          │                          │               │
│  ↶ ↑ ↷   │                          │               │
│  ← ⊕ →   │◄── Transform Pad        │               │
│  − ↓ +   │                          │               │
├──────────┴──────────────────────────┴───────────────┤
│  BOTTOM = ACT (context-aware hotbar)                 │
└─────────────────────────────────────────────────────┘
```

- **Left edge (PICK):** 10 tools + Transform Pad (3×3 joystick for precise
  move/rotate/scale). Click a tool → its options fly out horizontally as a panel.
- **Right edge (INSPECT):** Context-sensitive — auto-shows Properties (3D),
  Layers (2D), or Adjust based on what you're doing.
- **Bottom edge (ACT):** Changes based on context — 3D idle shows primitives,
  2D selection shows one-tap outcomes (Remove, Fill, Cut Out, AI Replace…),
  painting shows layer shortcuts.
- **Top edge (STATUS):** Slim — logo, undo/redo, zoom, dimensions, search (⌘K).

## The workflow

1. **Build a 3D scene.** The viewport starts in 3D — 28 primitives, GLB/GLTF import
   (drag-drop anywhere), Poly Haven CC0 models & HDRIs. TransformControls gizmos
   for move/rotate/scale (W/E/R keys), HDRI lighting, per-object PBR materials.

2. **Texture with 2D tools.** 10 tools: brush (paint/erase toggle), fill, gradient,
   text, shapes, wand (select/auto-remove toggle), marquee, crop, move.
   Wand selections trigger the hotbar with one-tap outcomes — remove, cut out,
   fill, AI replace, recolor, copy to layer, crop. No hidden menus.
   Live Adjust sliders + histogram; 6 filter presets; layers with 16 blend modes,
   masks, layer styles, and re-editable adjustment layers.

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
- **Transform Pad** — 9-button joystick: 4 directional (move), 2 diagonal-top
  (rotate), 2 diagonal-bottom (scale), center (cycle axis lock: Free/X/Y/Z).
  Tap = 1px nudge, hold = accelerating continuous movement, Shift = 10× precision.
- **Tool flyout** — tool options extend horizontally from the active tool button
  with a connector triangle, keeping the viewport clear.
- **Context hotbar** — 7 auto-detected contexts, no mode switching needed.
- Procedural textures, installable PWA + IndexedDB autosave with crash-restore,
  scrubbable history, re-editable text layers, keyboard cheat sheet (`?`).

## AI (bring your own key)

`ai/forge-ai.js` — open **✦ AI** (in the hotbar) to set a provider + key
(kept in memory only): **remove.bg** (one-click cutout), **fal.ai**
(generative fill on a selection), or a **custom endpoint**.

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
                    texgen · library · scene3d · make3d · animation ·
                    publish · paint3d · assets
  ui/               forge-ui.js (main UI + tool flyout wiring)
                    hotbar.js (context-aware bottom bar — 7 contexts)
                    transform-pad.js (3×3 joystick for transforms)
                    selection-bar.js (selection outcome actions)
                    tool-guides.js (in-app help per tool)
                    scene3d-ui.js (3D panel/optbar)
                    assets-ui.js (asset library grid)
                    timeline-ui.js (animation playback)
                    polish.js (keyboard shortcuts, compare, paste)
                    three-bundle.js (ES module → classic-script bridge)
                    forge.css (all styles)
  ai/               forge-ai.js (provider-agnostic AI adapter)
  vendor/three/     vendored Three.js r185 + addons (offline-first)
  vendor/imagetracer/  raster→vector tracer (public domain) for Make 3D
  assets/models/    sample GLBs
  tools/            cors-proxy.js (optional AI helper)
  tests/            browser e2e (165 tests) + userflow harnesses
```

Everything routes through one discoverable command catalog
(`GF.api.describe()` / `run(name, args)`) — including AI (`aiGenerate`), the 3D
workspace (`scene3d.*`), the converters (`make3d.*`), and the publisher
(`publish.page`) — which makes the whole app scriptable by automated agents.

## Documentation

| File | What it covers |
|------|---------------|
| `README.md` | This file — overview, workflow, how to run |
| `API.md` | Agent API reference — every `GF.api.run()` command |
| `ARCHITECTURE.md` | **Full technical reference** — every module, CSS variable, event, data flow, bug class, modification guide |
| `AGENTS.md` | Shared contributor rules for all agents/humans |
| `IMPLEMENTATION.md` | Phase-by-phase implementation tracker |

## Verifying

```bash
bash tests/run-e2e.sh              # full feature audit (165 tests) incl. Game Deck
bash tests/run-userflow.sh         # pointer/keyboard user flows, desktop
bash tests/run-userflow-mobile.sh  # same, mobile viewport
```
