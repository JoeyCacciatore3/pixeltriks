# PixelTriks — Architecture & Developer Reference

> Complete technical documentation for debugging, modification, and development.
> Every module, system, CSS variable, event, shortcut, and design decision —
> in one place.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [File Map](#2-file-map)
3. [Module Architecture](#3-module-architecture)
4. [The GF Namespace](#4-the-gf-namespace)
5. [Data Flow & Rendering](#5-data-flow--rendering)
6. [UI Architecture — The Game Deck](#6-ui-architecture--the-game-deck)
7. [CSS Design System](#7-css-design-system)
8. [Event Bus](#8-event-bus)
9. [Keyboard Shortcuts](#9-keyboard-shortcuts)
10. [Tool System](#10-tool-system)
11. [Layer System](#11-layer-system)
12. [Selection System](#12-selection-system)
13. [Filter & Retouch Pipeline](#13-filter--retouch-pipeline)
14. [3D Engine](#14-3d-engine)
15. [2D→3D Converters](#15-2d3d-converters)
16. [Animation System](#16-animation-system)
17. [AI Integration](#17-ai-integration)
18. [Export & Publishing](#18-export--publishing)
19. [Asset Library](#19-asset-library)
20. [Service Worker & PWA](#20-service-worker--pwa)
21. [Caching & Deployment](#21-caching--deployment)
22. [Testing](#22-testing)
23. [Common Bug Classes](#23-common-bug-classes)
24. [Modification Guide](#24-modification-guide)

---

## 1. System Overview

PixelTriks is a **zero-build-step** browser application — vanilla JavaScript
with ES modules for Three.js only. It runs from `file://` (double-click
`index.html`) or any static host. No bundler, no package.json, no node_modules.

**Architecture in one sentence:** 28 IIFE modules register on a global `GF`
namespace; `core/api.js` wraps every mutation as a named command; the UI binds
to those commands plus custom DOM events.

```
┌──────────────────────────────────────────────────────┐
│                     index.html                        │
│  (single page: HTML shell + import map for Three.js)  │
├──────────────────────────────────────────────────────┤
│  <script> tags load in dependency order:              │
│                                                       │
│  core/util.js          ← GF.util  (no deps)          │
│  core/history.js       ← GF.history                  │
│  core/layers.js        ← GF.doc   (util, history)    │
│  core/select.js        ← GF.select                   │
│  core/filters.js       ← GF.filters                  │
│  core/curves.js        ← GF.curveEditor              │
│  core/retouch.js       ← GF.retouch                  │
│  core/tools.js         ← GF.view  (all of the above) │
│  core/texgen.js        ← GF.texture                  │
│  core/exporter.js      ← GF.exporter                 │
│  core/library.js       ← GF.library                  │
│  core/api.js           ← GF.api   (wraps everything) │
│  core/scene3d.js       ← GF.scene3d                  │
│  core/make3d.js        ← GF.make3d                   │
│  core/animation.js     ← GF.animation                │
│  core/paint3d.js       ← GF.paint3d                  │
│  core/publish.js       ← GF.publish                  │
│  core/assets.js        ← GF.assets                   │
│  ai/forge-ai.js        ← GF.ai                       │
│  ui/three-bundle.js    ← re-exports Three.js globals  │
│  ui/forge-ui.js        ← GF.ui   (DOM wiring)        │
│  ui/scene3d-ui.js      ← GF.scene3dUI                │
│  ui/hotbar.js          ← GF.hotbar                   │
│  ui/transform-pad.js   ← GF.transformPad             │
│  ui/selection-bar.js   ← GF.selectionBar             │
│  ui/tool-guides.js     ← GF.toolGuides               │
│  ui/assets-ui.js       ← GF.assetsUI                 │
│  ui/timeline-ui.js     ← GF.timelineUI               │
│  ui/polish.js          ← GF.polish                   │
└──────────────────────────────────────────────────────┘
```

**Key invariant:** every module is an IIFE that captures its dependencies at
definition time. If a module calls `GF.foo` in a function body, `GF.foo` must
have been defined by a `<script>` tag that loaded earlier. The load order in
`index.html` IS the dependency graph.

---

## 2. File Map

```
pixeltriks/                     112,000 total lines (90,000 in vendor)
├── index.html              260 lines   HTML shell, CSS + JS load order
├── _headers                 35 lines   CF Pages custom headers (preview only)
├── sw.js                    53 lines   Service worker (offline cache)
├── manifest.webmanifest              PWA manifest
├── icon.svg                          App icon (SVG)
├── AGENTS.md                         Shared contributor rules
├── README.md                         User/overview documentation
├── API.md                            Agent API reference
├── IMPLEMENTATION.md                 Implementation progress tracker
├── ARCHITECTURE.md                   ← THIS FILE
│
├── core/                   4,765 lines — ENGINE (pure logic, no DOM)
│   ├── util.js         132   Helpers: $, $$, toast, downloadBlob, ctx2d, clamp
│   ├── history.js      128   Undo/redo stack (push/undo/redo/clear)
│   ├── layers.js       506   Document model: layers, masks, adjustments, composite
│   ├── select.js       263   Selection engine: wand, rect, ellipse, lasso, masks
│   ├── filters.js      316   Image filters: B/C, HSL, blur, sharpen, edge, curves
│   ├── curves.js       135   Interactive tone-curve editor widget
│   ├── retouch.js      479   High-level retouching: BG removal, color replace, FX
│   ├── tools.js        754   Viewport: zoom, pan, brush/fill/shape/move rendering
│   ├── texgen.js       449   Procedural texture generator: Perlin, cellular, PBR
│   ├── exporter.js     168   Export: PNG/WebP/JPEG, project files, clipboard
│   ├── library.js      211   Asset sources: procedural generators + Poly Haven API
│   ├── api.js          184   Command catalog: cmd(), run(), describe(), state()
│   ├── scene3d.js      933   Three.js 3D engine: renderer, scene, physics, gizmos
│   ├── make3d.js       351   2D→3D converter registry + 6 built-in converters
│   ├── animation.js    206   Keyframe animation engine
│   ├── paint3d.js      190   3D texture painting (UV raycasting)
│   ├── publish.js      137   Export 3D scene as self-contained HTML page
│   └── assets.js       224   IndexedDB asset library CRUD
│
├── ui/                     3,505 lines — UI (DOM + events, no canvas math)
│   ├── forge-ui.js   1,458   Main UI controller: panels, dialogs, keybinds
│   ├── forge.css       986   ALL styles (single file)
│   ├── scene3d-ui.js   440   3D panel UI: scene tree, inspector, primitives
│   ├── hotbar.js       365   Context-aware bottom action bar (8 contexts)
│   ├── transform-pad.js 315  3×3 joystick for transforms (move/rotate/scale)
│   ├── assets-ui.js    237   Asset library grid UI
│   ├── polish.js       199   Quick-actions, tooltips, visual undo
│   ├── selection-bar.js 111  Selection outcome utility functions
│   ├── tool-guides.js   65   In-app help documentation per tool
│   ├── timeline-ui.js   47   Animation timeline playback controls
│   └── three-bundle.js  22   ES module → classic-script bridge for Three.js
│
├── ai/                       205 lines
│   └── forge-ai.js           Provider-agnostic AI adapter (removebg, fal, custom)
│
├── vendor/                ~90,000 lines (vendored, don't edit)
│   ├── three/                Three.js r185 + addons
│   │   ├── three.module.js   Core (ES module)
│   │   ├── three.core.js     Core (classic script fallback)
│   │   └── addons/           OrbitControls, TransformControls, GLTFExporter,
│   │                         GLTFLoader, HDRLoader, SVGLoader, FontLoader, etc.
│   ├── imagetracer/          Raster→vector tracer (public domain)
│   └── fonts/                Helvetiker typeface JSON for 3D text
│
├── assets/models/            Sample GLB files (cone, cube, cylinder, plane, sphere)
│
├── tools/
│   └── cors-proxy.js    60   Optional Node.js CORS proxy for AI providers
│
└── tests/               1,555 lines
    ├── e2e.js        1,059   165-test browser-injected feature audit
    ├── userflow.js     236   Pointer/keyboard user-flow test
    ├── run-e2e.sh            Headless Chrome test runner
    ├── run-userflow.sh       Desktop userflow runner
    └── run-userflow-mobile.sh  Mobile viewport userflow runner
```

---

## 3. Module Architecture

Every module follows the same IIFE pattern:

```javascript
'use strict';
window.GF = window.GF || {};

GF.moduleName = (function () {
  // Private state (closure-scoped)
  const U = GF.util, D = GF.doc;

  // Private functions
  function doSomething() { ... }

  // Public API (returned object)
  return { doSomething, anotherThing };
})();
```

**Rules:**
- No module imports or `export` statements — everything is on the `GF` global.
- Dependencies are captured at IIFE execution time via closure.
- Each module returns a frozen public API object.
- `core/` modules have ZERO DOM access. DOM lives in `ui/`.

---

## 4. The GF Namespace

Every module registers on `window.GF`. Here is the complete map:

| Module | File | Purpose |
|--------|------|---------|
| `GF.util` | core/util.js | `$`, `$$`, `toast`, `downloadBlob`, `ctx2d`, `clamp`, `debounce` |
| `GF.history` | core/history.js | Undo/redo stack with snapshot-based states |
| `GF.doc` | core/layers.js | Document model: layers, masks, adjustments, composite |
| `GF.select` | core/select.js | Selection engine: wand, rect, ellipse, lasso, grow, feather |
| `GF.filters` | core/filters.js | Pixel-level: B/C, HSL, blur, sharpen, edge, curves, levels |
| `GF.curveEditor` | core/curves.js | Interactive curves widget (canvas-rendered) |
| `GF.retouch` | core/retouch.js | High-level: BG removal, color replace, layer FX, upscale |
| `GF.view` | core/tools.js | Viewport: zoom/pan, pointer input, brush/fill/move rendering |
| `GF.texture` | core/texgen.js | Procedural textures: Perlin noise, heightfields, normal maps |
| `GF.exporter` | core/exporter.js | Export PNG/WebP/JPEG, project save/load, clipboard |
| `GF.library` | core/library.js | Procedural generators + Poly Haven CC0 API |
| `GF.api` | core/api.js | Command catalog: `cmd()`, `run()`, `describe()`, `state()` |
| `GF.scene3d` | core/scene3d.js | Three.js renderer, scene graph, gizmos, materials |
| `GF.make3d` | core/make3d.js | 2D→3D converter registry + 6 built-in converters |
| `GF.animation` | core/animation.js | Keyframe engine: tracks, mixer, play/pause/scrub |
| `GF.paint3d` | core/paint3d.js | 3D texture painting via UV raycasting |
| `GF.publish` | core/publish.js | Export 3D scene as self-contained HTML |
| `GF.assets` | core/assets.js | IndexedDB asset library CRUD |
| `GF.ai` | ai/forge-ai.js | AI adapter: removebg, fal.ai, custom endpoints |
| `GF.ui` | ui/forge-ui.js | Main UI: panels, dialogs, keybinds, tool switching |
| `GF.scene3dUI` | ui/scene3d-ui.js | 3D panel: scene tree, inspector, primitives grid |
| `GF.hotbar` | ui/hotbar.js | Context-aware bottom action bar (8 contexts) |
| `GF.transformPad` | ui/transform-pad.js | 3×3 joystick for move/rotate/scale |
| `GF.selectionBar` | ui/selection-bar.js | Selection outcome utility functions |
| `GF.toolGuides` | ui/tool-guides.js | In-app help per tool |
| `GF.assetsUI` | ui/assets-ui.js | Asset library grid UI |
| `GF.timelineUI` | ui/timeline-ui.js | Animation timeline playback |
| `GF.polish` | ui/polish.js | Quick-actions, first-run tips, visual undo |

---

## 5. Data Flow & Rendering

### The command pipeline

```
User action (click/key/hotbar)
  → GF.api.run(name, args)
    → Engine mutation (GF.doc / GF.scene3d / etc.)
      → GF.history.push() (if undoable)
      → GF.view.requestRender() (marks viewport dirty)
      → GF.ui.refreshLayers() (updates layer panel)
      → Custom event dispatch (pt:toolchange, pt:layerchange, etc.)
```

Every `run()` call auto-refreshes the UI. Agents and automated scripts NEVER
need to touch the DOM — they call `GF.api.run()` and the UI stays in sync.

### The render loop

`GF.view` owns the 2D viewport. It uses `requestAnimationFrame` with a dirty
flag (`requestRender()` sets `dirty = true`; the rAF callback only redraws if
dirty). The render pipeline:

```
requestRender()
  → rAF fires
    → fitCanvasToViewport() (resize if needed)
    → clear canvas
    → draw checkerboard (transparency indicator)
    → for each visible layer (bottom to top):
        → ctx.globalCompositeOperation = layer.blend
        → ctx.globalAlpha = layer.opacity
        → drawImage(layer.canvas, layer.x, layer.y)
    → draw selection marching ants (if GF.select.has())
    → draw crop overlay (if crop tool active)
    → draw shape preview (if shape drag active)
    → draw gradient preview (if gradient drag active)
    → draw tool cursor
```

The 3D renderer (`GF.scene3d`) has its own `requestAnimationFrame` loop in
`core/scene3d.js` that drives `renderer.render(scene, camera)`.

### Document model (GF.doc)

```javascript
GF.doc.doc = {
  open: true,
  name: 'untitled',
  width: 800,
  height: 600,
  layers: [
    {
      id: 'layer_1',
      name: 'Background',
      canvas: HTMLCanvasElement,      // the pixel data
      visible: true,
      opacity: 1,                     // 0–1
      blend: 'source-over',          // CSS composite mode
      x: 0, y: 0,                    // offset from doc origin
      mask: HTMLCanvasElement | null, // non-destructive mask
      text: { ... } | null,          // re-editable text params
      adjustment: { kind, params } | null,  // adjustment layer
      nineSlice: null,
      clip: false
    },
    // ... more layers
  ],
  activeId: 'layer_1',
  maskEdit: false,          // true = painting on the mask
  preview: null             // live adjust preview
};
```

### Active layer access

```javascript
GF.doc.active()       // returns the active layer object (NOT activeLayer!)
GF.doc.doc.activeId   // the active layer's ID string
```

**⚠ CRITICAL:** The method is `GF.doc.active()`, NOT `GF.doc.activeLayer()`.
This has caused bugs multiple times.

---

## 6. UI Architecture — The Game Deck

Four screen edges, each with exactly one job:

```
┌────────────────────────────────────────────────────────┐
│  TOP BAR (STATUS): logo, undo/redo, zoom, ⌘K search   │
├──────┬─────────┬───────────────────────┬───────────────┤
│ TOOL │ OPTBAR  │                       │    PANEL      │
│ RAIL │ (inline │    VIEWPORT           │  (Properties  │
│ 92px │  panel) │    (canvas / 3D)      │   Layers      │
│      │  164px  │                       │   Adjust)     │
│      │         │                       │               │
│ [pad]│         │                       │               │
├──────┴─────────┴───────────────────────┴───────────────┤
│  HOTBAR (ACT): context-aware action buttons             │
└────────────────────────────────────────────────────────┘
```

### CSS Grid layout

```css
#stage {
  grid-template-columns: var(--rail-w) auto 1fr var(--panel-w);
  grid-template-rows: 1fr auto;
  grid-template-areas:
    "toolrail optbar viewport panel"
    "toolrail optbar actionbar panel";
}
```

The `optbar` column is `auto` — it's 0px when no tool is selected (panel has
`max-width: 0`), and 164px when a tool with options is active (panel gets
class `open` and `max-width: 164px`).

### The top bar

3-column grid: `1fr auto 1fr` (left, center, right).

- **Left:** ☰ menu, "Open" button, document dimensions
- **Center:** undo/redo, zoom pill (−/label/+)
- **Right:** ⌘K search trigger, settings, AI button, Export

When a document is open: AI and Export hide from the top bar (they're in the
hotbar). Document dimensions show. When no document: "Open" hides, dims show
"—".

### Tool rail (left edge)

10 tools in a vertical column, 92px wide:

| Key | Tool | Icon | Engine property |
|-----|------|------|-----------------|
| V | Move | ⊞ arrows | `view.tool = 'move'` |
| M | Select | □ dashed | `view.tool = 'select'` |
| W | Smart Select | ✨ wand | `view.tool = 'wand'` |
| J | Crop | ⌐ corners | `view.tool = 'crop'` |
| B | Brush | ● circle | `view.tool = 'brush'` |
| G | Fill | ◧ bucket | `view.tool = 'fill'` |
| D | Gradient | ◐ half | `view.tool = 'gradient'` |
| T | Text | A letter | `view.tool = 'text'` |
| U | Shape | ◇ diamond | `view.tool = 'shape'` |
| H | Pan | ✋ hand | `view.tool = 'pan'` |

Below the tools: the **Transform Pad** (3×3 joystick grid).

### Optbar (inline tool options panel)

When a tool is selected, its options appear as a vertical panel between the
tool rail and the viewport (164px wide). The panel uses CSS `max-width`
transition for smooth open/close.

Each tool's panel is built by `buildOptbar(toolName)` in `forge-ui.js`:

| Tool | Options |
|------|---------|
| Brush | Paint/Erase toggle, Size slider, Opacity slider, Pixel checkbox |
| Wand | Select/Remove toggle, Tolerance slider, keyboard hints |
| Select | Rect/Ellipse/Lasso toggle, keyboard hints |
| Crop | 7 aspect ratio buttons (Free/1:1/4:5/16:9/9:16/3:2/Orig), Straighten slider, Apply/Cancel |
| Fill | Tolerance slider |
| Gradient | Linear/Radial toggle, Fade checkbox |
| Shape | Rect/Ellipse/Line toggle, Fill checkbox |
| Move | Usage hint text |
| Pan | Usage hint text |
| Text | Usage hint text |

Every optbar has a `?` guide button at the bottom that opens the tool's help
documentation from `tool-guides.js`.

### Hotbar (bottom edge)

`ui/hotbar.js` — detects the current context and renders appropriate action
buttons. Context detection runs on every `pt:toolchange`, `pt:selectionchange`,
`pt:modechange`, `pt:docopen`, `pt:docclose`, and `pt:sceneselect` event.

**8 contexts:**

| Context key | Label | Trigger | Actions |
|-------------|-------|---------|---------|
| `empty` | START | No document open | Open, New |
| `3d-idle` | 3D SCENE | 3D mode, nothing selected | Box, Sphere, Cylinder, Plane, Import, Play, AI, Assets, Export |
| `3d-selected` | 3D OBJECT | 3D mode, object selected | Delete, Dup, Group, Material, To 2D, Frame, Play, Export |
| `3d-anim` | PLAYING | Animation playing | Stop, Pause |
| `2d-idle` | IMAGE | 2D mode, no selection, not painting | Enhance, Remove BG, AI, Adjust, Filters, Flip H/V, Rot CW, New Layer, Dup Lyr, Flatten, Trim, Copy, Export |
| `2d-selection` | SELECTION | Selection active | Remove, Cut Out, Fill, AI Fill, Recolor, Copy Lyr, Crop, Expand, Feather, Invert, Deselect |
| `2d-painting` | PAINTING | Brush/fill/gradient tool active | Swap, New Layer, Dup Lyr, Merge, Flip H, Rot CW, AI, Export |
| `2d-text` | TEXT | Text tool active | New Layer, Dup Lyr, Merge, Flip H/V, Rot CW, AI, Export |

All icons are inline SVGs defined in the `ICONS` object at the top of
`hotbar.js`. The context label is an amber pill at the left of the bar.

### Right panel

Three tabs: **Properties** (3D), **Layers** (2D), **Adjust** (2D).

**Auto-switching:** When the mode or tool changes, `switchPanel()` auto-selects
the relevant tab. If the user manually clicks a tab, auto-switching pauses
until the next mode or tool change. This prevents the panel from fighting the
user.

### Transform Pad

`ui/transform-pad.js` — a 3×3 button grid embedded at the bottom of the tool
rail:

```
┌────┬────┬────┐
│ ↶  │ ↑  │ ↷  │  ↶↷ = Rotate left/right
├────┼────┼────┤
│ ←  │ ⊕  │ →  │  ←↑→↓ = Move (nudge)
├────┼────┼────┤
│ −  │ ↓  │ +  │  −+ = Scale down/up
└────┴────┴────┘
```

- **Center button (⊕):** Cycles axis lock: Free → X → Y → Z
- **Tap:** 1px nudge (1° rotate, 0.01 scale)
- **Hold:** Accelerating continuous movement (starts slow, speeds up)
- **Shift held:** 10× precision multiplier

Works on both 2D layers (`GF.doc.active()`) and 3D objects
(`GF.scene3d.selected()`), auto-detected.

---

## 7. CSS Design System

All styles live in `ui/forge.css` (986 lines, single file).

### CSS Custom Properties (design tokens)

#### Dark theme (default)

```css
:root {
  /* Surfaces (darkest → lightest) */
  --bg:        #0e0f13;     /* app background */
  --bg-2:      #15171d;     /* toolrail, panel, hotbar background */
  --surface:   #1a1d24;     /* cards, layer items */
  --surface-2: #22262f;     /* hover states, elevated cards */
  --line:      #2c313b;     /* subtle dividers */
  --line-soft: #23272f;     /* very subtle dividers */

  /* Typography */
  --ink:       #e9ecf2;     /* primary text */
  --ink-2:     #aeb6c4;     /* secondary text */
  --ink-3:     #79808d;     /* tertiary / disabled */

  /* Brand / accent */
  --accent:    #e8a33d;     /* amber — buttons, active states, labels */
  --accent-2:  #f4b860;     /* lighter amber — hover states */
  --accent-ink:#1a1206;     /* text on accent backgrounds */

  /* Semantic */
  --ai:        #8a7bff;     /* AI features (lavender) */
  --ai-2:      #a99bff;     /* AI hover */
  --danger:    #e5634d;     /* destructive actions */
  --ok:        #5bbf7a;     /* success */

  /* Game Deck system — THE border language */
  --game-border:   #3a3f4d;     /* border color */
  --game-border-w: 2px;         /* border width */
  --game-r:        8px;         /* border radius */
  --game-glow:     0 0 12px color-mix(in srgb, var(--accent) 50%, transparent);
  --game-active-bg: color-mix(in srgb, var(--accent) 18%, var(--surface));

  /* Layout */
  --bar-h:     clamp(48px, 6vh, 56px);   /* top bar height */
  --rail-w:    92px;                      /* tool rail width */
  --panel-w:   clamp(280px, 24vw, 340px); /* right panel width */

  /* Generic */
  --r:         12px;         /* large radius (modals, cards) */
  --r-sm:      8px;          /* small radius (buttons, inputs) */
  --shadow:    0 8px 30px rgba(0,0,0,.45);
  --shadow-sm: 0 2px 10px rgba(0,0,0,.3);
  --font:      "Inter", ui-sans-serif, system-ui, sans-serif;
}
```

#### Light theme

Activated by `@media (prefers-color-scheme: light)` AND `[data-theme="light"]`:

```css
--bg:#eef0f4; --bg-2:#e7eaef; --surface:#fff; --surface-2:#f3f5f8;
--line:#d6dae1; --line-soft:#e4e7ec;
--ink:#1c2128; --ink-2:#4a5260; --ink-3:#828b98;
--accent-ink:#fff;
--ai:#6a52f0; --ai-2:#5540d6;
```

### The Game Deck border language

**Every interactive element** uses these 5 variables. Zero `box-shadow: inset`
borders remain in the codebase.

| Element | Border | Hover | Active |
|---------|--------|-------|--------|
| Tool buttons | `var(--game-border)` | `border-color: var(--accent)` + glow | amber bg |
| Hotbar buttons | `var(--game-border)` | `border-color: var(--accent)` | scale(.95) |
| Panel tabs | `var(--game-border)` | — | amber fill |
| Layer items | `var(--game-border)` | — | accent border + glow |
| Filter chips | `var(--game-border)` | glow | — |
| Modal cards | `var(--game-border)` | — | — |
| Inputs/selects | `var(--game-border)` | accent border | — |
| Quick-action chips | `var(--game-border)` | accent border + glow | scale(.95) |
| Keyboard hints | `var(--game-border)` | — | — |

### Responsive breakpoints

| Breakpoint | Target | Layout changes |
|------------|--------|----------------|
| `max-width: 880px` | Mobile/tablet | Tool rail → bottom bar, panel → bottom sheet, hotbar above tools, transform pad floats bottom-left |
| `max-width: 560px` | Small phone | Intent grid 3→2 columns |
| `prefers-reduced-motion` | Accessibility | All animations disabled |

### Mobile layout

```
┌──────────────────────────────┐
│  TOP BAR (slim)              │
├──────────────────────────────┤
│                              │
│         VIEWPORT             │
│         (full width)         │
│                              │
│  [Transform Pad]             │
│  (floating bottom-left)      │
├──────────────────────────────┤
│  HOTBAR (context actions)    │  ← 44px
├──────────────────────────────┤
│  TOOL STRIP (horizontal)    │  ← 62px
└──────────────────────────────┘
```

The right panel becomes a **bottom sheet** (swipe up from panel grip).

---

## 8. Event Bus

Custom DOM events dispatched on `window`. Every module can listen:

```javascript
window.addEventListener('pt:toolchange', e => {
  const { tool, prev } = e.detail;
});
```

| Event | Detail | Fired when |
|-------|--------|------------|
| `pt:toolchange` | `{ tool, prev }` | Active tool changes |
| `pt:modechange` | `{ mode }` | 2D↔3D mode switch (`mode: '2d'` or `'3d'`) |
| `pt:selectionchange` | `{ has }` | Selection created/cleared |
| `pt:layerchange` | `{}` | Layers modified (add/delete/reorder/rename) |
| `pt:sceneselect` | `{ id }` | 3D object selected/deselected |
| `pt:docopen` | `{}` | Document opened |
| `pt:docclose` | `{}` | Document closed |
| `pt:animstate` | `{ playing }` | Animation play/pause/stop |

**Wiring in modules:**
- `hotbar.js` listens to ALL events to re-detect context
- `transform-pad.js` listens to `pt:sceneselect`, `pt:layerchange`
- `forge-ui.js` fires most events from `setTool()`, `onDocumentOpened()`
- `scene3d.js` fires `pt:sceneselect` and `pt:modechange`

---

## 9. Keyboard Shortcuts

### Tool shortcuts (single key, no modifier)

| Key | Tool |
|-----|------|
| V | Move |
| M | Select (marquee) |
| W | Smart Select (wand) |
| C (or J) | Crop |
| B | Brush |
| G | Fill (bucket) |
| D | Gradient |
| T | Text |
| U | Shape |
| H | Pan (hand) |

### Modifier shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Z | Undo |
| Ctrl+Y / Ctrl+Shift+Z | Redo |
| Ctrl+S | Save project (.forge.json) |
| Ctrl+E | Export dialog |
| Ctrl+M | Curves dialog |
| Ctrl+A | Select all |
| Ctrl+I | Invert selection |
| Ctrl+Shift+C | Copy to clipboard (PNG) |
| Ctrl+K / ⌘+K | Command palette |
| Escape | Close modal → deselect |
| ] | Zoom in |
| [ | Zoom out |
| ? | Keyboard cheat sheet |
| Space (hold) | Temporary pan |

### 3D-specific shortcuts

| Key | Action |
|-----|--------|
| W | Translate gizmo |
| E | Rotate gizmo |
| R | Scale gizmo |
| Q | Toggle local/world space |
| Delete | Delete selected object |
| F | Frame selected object |

---

## 10. Tool System

`core/tools.js` (`GF.view`) owns the viewport and input handling.

### View state

```javascript
GF.view.view = {
  zoom: 1,           // current zoom level
  panX: 0, panY: 0,  // pan offset in CSS pixels
  tool: 'brush',      // currently active tool name
  brush: {
    size: 16,         // diameter in document pixels
    opacity: 1,       // 0–1
    color: '#e8a33d',
    pixel: false,     // snap to integer coords (pixel art)
    shape: 'round',   // 'round' | 'square' | 'line'
    hardness: 100,    // edge softness
    flow: 100,
    spacing: 25,
    stabilizer: 0,    // moving-average window (0 = off, 1–20)
    erasing: false    // true = erase mode (via Paint/Erase toggle)
  },
  fillTolerance: 24,
  wand: {
    tolerance: 32,
    contiguous: true,
    defringe: true,
    heal: false,
    antialias: true,
    autoRemove: false  // true = auto-remove mode (via Select/Remove toggle)
  },
  marquee: { shape: 'rect' },         // 'rect' | 'ellipse' | 'lasso'
  gradient: { kind: 'linear', color2: '#1a1d24', toAlpha: true },
  shape: { kind: 'rect', fill: true, stroke: false, strokeW: 4 },
  spacePan: false      // true when Space is held (temporary pan)
};
```

### Pointer event pipeline

```
pointerdown on #viewport
  → screenToDoc(clientX, clientY)  // convert to document coords
  → switch(view.tool):
      'brush':  start stroke buffer, sample first point
      'fill':   GF.view.fillAt(x, y)
      'wand':   GF.select.wand(x, y, opts)
      'select': start selection drag (rect/ellipse/lasso)
      'crop':   start crop drag
      'move':   capture layer offset for drag
      'gradient': start gradient drag
      'shape':  start shape drag
      'text':   open text dialog at (x, y)
      'pan':    start pan

pointermove
  → update current drag/stroke

pointerup
  → finalize: composite stroke, commit selection, apply crop, etc.
  → GF.history.push() if state changed
  → GF.view.requestRender()
```

### Brush rendering (stroke buffer)

Brush strokes use an **off-screen canvas** (stroke buffer) to accumulate the
stroke, then composite it onto the layer on `pointerup`. This enables:
- Opacity accumulation (overlapping stamps don't over-darken)
- Erase mode (composited with `destination-out`)
- Selection masking (stroke clipped to selection)
- Mask editing (stroke goes to `layer.mask` instead of `layer.canvas`)

---

## 11. Layer System

`core/layers.js` (`GF.doc`) manages the document and layer stack.

### Layer types

| Type | Properties | Behavior |
|------|-----------|----------|
| Normal | canvas, opacity, blend | Pixel layer — brush, filter, etc. |
| Text | canvas + `text: { ... }` | Re-editable: double-click to edit params |
| Adjustment | `adjustment: { kind, params }` | Non-destructive: affects layers below |
| Mask | `mask: HTMLCanvasElement` | White=visible, black=hidden, grayscale=partial |

### Composite pipeline

`GF.doc.composite(scale)` builds the final image by drawing layers bottom-to-top:

```
for each layer (bottom to top):
  if (!layer.visible) continue;
  if (layer.adjustment) {
    // apply adjustment to everything below
    apply adjustment filter to composite-so-far
    continue;
  }
  ctx.globalCompositeOperation = layer.blend;
  ctx.globalAlpha = layer.opacity;
  if (layer.mask) {
    // draw layer through mask
    tempCanvas = layer.canvas masked by layer.mask
    ctx.drawImage(tempCanvas, layer.x, layer.y);
  } else {
    ctx.drawImage(layer.canvas, layer.x, layer.y);
  }
```

### 16 blend modes

All standard CSS `globalCompositeOperation` values:

`source-over` (Normal), `multiply`, `screen`, `overlay`, `darken`, `lighten`,
`color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`,
`exclusion`, `hue`, `saturation`, `color`, `luminosity`

### Adjustment layer kinds

`brightnessContrast`, `hsl`, `posterize`, `invert`, `grayscale`, `autoLevels`,
`curves`

---

## 12. Selection System

`core/select.js` (`GF.select`) manages pixel-level selections using an
off-screen alpha mask canvas (same size as the document).

### Selection modes

| Mode | Method | Description |
|------|--------|-------------|
| Magic wand | `wand(x, y, opts)` | Flood-fill from point by color similarity |
| Rectangle | `combine('rect', {x,y,w,h}, mode)` | Rectangular marquee |
| Ellipse | `combine('ellipse', {x,y,w,h}, mode)` | Elliptical marquee |
| Lasso | `combine('lasso', {pts}, mode)` | Freehand polygon |
| All | `selectAll()` | Select entire document |

### Combine modes

The `mode` parameter controls how a new selection interacts with the existing
selection:

| Mode | Behavior |
|------|----------|
| `'add'` (default) | Union with existing |
| `'subtract'` | Remove from existing |
| `'intersect'` | Intersection with existing |
| `'replace'` | Replace entirely |

### Selection operations

| Method | What it does |
|--------|-------------|
| `feather(px)` | Gaussian blur the selection mask |
| `grow(px)` | Dilate the selection |
| `contract(px)` | Erode the selection |
| `smooth()` | Median filter the selection edge |
| `invert()` | Invert the selection |
| `selectColor(r,g,b,tol)` | Select by color across entire image |
| `selectBackground()` | Auto-detect and select the background |

### Marching ants

The selection boundary is rendered as animated "marching ants" in the viewport.
The animation phase increments every 200ms via `setInterval`.

---

## 13. Filter & Retouch Pipeline

### Pixel-level filters (GF.filters)

These operate on raw `ImageData`:

| Filter | Params | Description |
|--------|--------|-------------|
| `brightnessContrast` | brightness, contrast | -100 to 100 each |
| `hsl` | hue, saturation, lightness | -180/100/100 to 180/100/100 |
| `grayscale` | — | Luminance conversion |
| `invert` | — | Channel inversion |
| `posterize` | levels | Reduce to N levels per channel |
| `autoLevels` | — | Stretch histogram to full range |
| `blur` | — | 3×3 Gaussian |
| `sharpen` | — | 3×3 unsharp mask |
| `edge` | — | 3×3 Laplacian edge detection |
| `boxBlur` | radius, passes | Multi-pass box blur |
| `pixelate` | blockSize | Block averaging |
| `isolateChannel` | channel (0/1/2) | Extract R/G/B |
| `curves` | luts | Per-channel LUT application |
| `levels` | black, white, gamma | Input/output levels |
| `sobelEdges` | sensitivity | Sobel edge magnitude |
| `dilateAlpha` | px | Expand alpha channel |

### Selection-aware application

`GF.filters.applyToLayer(layer, label, filterFn)` applies a filter ONLY to the
selected region (if a selection exists), blending the filtered result with the
original at the selection boundary. It auto-pushes to `GF.history`.

### High-level retouch (GF.retouch)

| Function | What it does |
|----------|-------------|
| `removeBackground(layer, tol, defringe)` | Edge-walk BG removal |
| `eraseSelection(layer, defringe)` | Clear selected pixels to transparent |
| `colorReplace(layer, opts)` | Shift/replace a color range |
| `contentAwareFill()` | Rebuild selected region from surrounding texture |
| `smartUpscale(factor, mode)` | 2× or 4× upscale (pixel-art or photo mode) |
| `layerFX(layer, kind, color, size, opts)` | Outline/glow/shadow/bevel/emboss |
| `inkOutline(layer, opts)` | Sobel → bold ink lines |
| `cleanColors(layer, opts)` | Quantize + deblur to flat colors |
| `cutToLayer(layer, opts)` | Cut selection to its own layer |

### Live adjust preview

The Adjust tab provides **non-destructive live preview**: slider changes call
`GF.doc.setPreview(layerId, filterFn)`, which stores a preview function.
The composite pipeline applies the preview at render time WITHOUT modifying the
original pixels. "Apply" bakes the preview; "Reset" discards it.

**Adjust sliders:** Exposure, Contrast, Saturation, Vibrance, Warmth, Clarity
(all -100 to 100).

---

## 14. 3D Engine

`core/scene3d.js` (`GF.scene3d`) — the Three.js r185 renderer.

### Initialization

The 3D engine boots automatically on page load. It creates a WebGL renderer,
a `PerspectiveCamera`, `OrbitControls` for navigation, and a `TransformControls`
gizmo for direct manipulation.

### Scene graph

```
Scene
├── AmbientLight (0xffffff, 0.4)
├── DirectionalLight (0xffffff, 0.8)
├── GridHelper (visible on ground plane)
├── Primitives / imported models
│   └── Each wrapped in { id, name, kind, node: THREE.Object3D }
└── TransformControls (attached to selected object)
```

### 28 primitive types

Grouped in the UI:

| Group | Primitives |
|-------|-----------|
| Basics (12) | sphere, box, roundedbox, cylinder, cone, pyramid, prism, capsule, hemisphere, torus, torusknot, pipe |
| Crystals (5) | tetrahedron, octahedron, dodecahedron, icosahedron, gem |
| Flat (7) | plane, panel, disc, ring, tile, hex, curved |
| Extras (4) | star, heart, arrow, steps |

### Materials

Default material: `MeshStandardMaterial` with PBR properties:
- `color`, `roughness` (0–1), `metalness` (0–1)
- `map` (diffuse texture from 2D canvas)
- `normalMap`, `roughnessMap` (from texture module)

Materials are editable per-object in the Inspector panel.

### TransformControls gizmo

| Mode | Key | Description |
|------|-----|-------------|
| Translate | W | Move along axes |
| Rotate | E | Rotate around axes |
| Scale | R | Scale along axes |
| Space toggle | Q | Switch local↔world coordinate space |

Gizmo operations are undoable via `GF.scene3d.hist` (separate from 2D history).

### Import/Export

- **Import:** GLB, GLTF, OBJ, FBX (drag-drop anywhere)
- **Export GLB:** `GF.scene3d.exportGLB()` — whole scene or selected object
- **Flatten to layer:** Render the 3D viewport to a 2D layer

---

## 15. 2D→3D Converters

`core/make3d.js` (`GF.make3d`) — extensible converter registry.

### Built-in converters

| Key | Name | What it does |
|-----|------|-------------|
| `cutout` | Extrude Cutout | Traces the visible silhouette → extrudes to 3D mesh |
| `relief` | Relief Map | Brightness → height: terrain, logos, embossing |
| `lathe` | Lathe | Spins a silhouette profile into rotational geometry |
| `layers` | Layer Stack | Each visible layer becomes a floating plane (diorama) |
| `svg` | SVG Extrude | Traces to SVG paths → extrudes vector shapes |
| `text3d` | 3D Text | Extrudes typed text using Helvetiker font |

### Adding a custom converter

```javascript
GF.make3d.register('myConverter', {
  label: 'My Converter',
  desc: 'Description shown in the panel',
  options: [
    { key: 'depth', label: 'Depth', min: 0.05, max: 1, step: 0.05, def: 0.2 },
  ],
  convert(canvas, opts) {
    // canvas = the 2D source (already doc-aligned)
    // Return { geometry: THREE.BufferGeometry } or { node: THREE.Object3D }
    const geometry = new THREE.BoxGeometry(1, 1, opts.depth);
    return { geometry };
  }
});
```

---

## 16. Animation System

`core/animation.js` (`GF.animation`) — keyframe-based animation.

### Data model

```javascript
keyframe = {
  id: Number,
  objectId: String,     // scene3d object ID
  time: Number,         // seconds (0 to duration)
  property: String,     // 'position' | 'rotation' | 'scale' | 'opacity'
  value: [x, y, z]      // or Number for opacity
}
```

### Playback

Uses Three.js `AnimationMixer` with `KeyframeTrack` for interpolation.
Supports loop modes: `once`, `loop`, `pingpong`.

### GLB animation export

`GF.animation.getClips()` returns Three.js `AnimationClip` objects that
the `GLTFExporter` includes in the exported GLB file.

---

## 17. AI Integration

`ai/forge-ai.js` (`GF.ai`) — bring-your-own-key, provider-agnostic.

### Providers

| Provider | Capability | Requires |
|----------|-----------|----------|
| `removebg` | One-click background removal | remove.bg API key |
| `fal` | Generative fill (inpaint) | fal.ai API key |
| `custom` | Any endpoint that returns an image | URL + optional key |

### Configuration

```javascript
GF.ai.setConfig({
  provider: 'fal',
  key: 'your-api-key',
  proxy: 'http://localhost:8787/?url=',  // optional CORS proxy
  endpoint: '',                           // custom provider URL
  falModel: 'fal-ai/flux-pro/v1/fill',
});
```

The API key is **in-memory only** — never written to disk or localStorage.

### CORS proxy

For `file://` or cross-origin scenarios, run `node tools/cors-proxy.js` to
forward requests through `http://localhost:8787/?url=<encoded-url>`.

---

## 18. Export & Publishing

### Image export (GF.exporter)

| Format | Function | Notes |
|--------|----------|-------|
| PNG | `exportImage({ type: 'image/png', scale })` | Lossless, default |
| WebP | `exportImage({ type: 'image/webp', quality })` | Lossy, smaller |
| JPEG | `exportImage({ type: 'image/jpeg', quality })` | Lossy, no alpha |
| Split layers | `exportLayersSeparate({ type })` | One file per visible layer |
| Project | `saveProject()` | `.forge.json` — all layers + metadata |
| Clipboard | `copyToClipboard()` | PNG to system clipboard |

### 3D publish (GF.publish)

`downloadPage()` generates a **self-contained HTML file** with:
- The 3D scene as a base64-encoded GLB
- A minimal Three.js viewer (orbit controls, lighting, background)
- Three.js loaded from CDN (pinned to r185)

Drop the file on any static host — it runs standalone.

---

## 19. Asset Library

`core/assets.js` (`GF.assets`) — IndexedDB-based persistent storage.

### Asset types

| Type | Source | Description |
|------|--------|-------------|
| `model` | Import / Poly Haven | GLB/GLTF 3D models |
| `texture` | Generate / Poly Haven | PBR texture sets |
| `hdri` | Poly Haven | Environment lighting |
| `material` | Generate | Procedural PBR presets |

### 15 procedural material presets

`wood`, `brushed-metal`, `rough-metal`, `stone`, `marble`, `brick`, `concrete`,
`fabric`, `leather`, `rust`, `ceramic`, `grass`, `sand`, `checker`, `carbon`

### Poly Haven integration

CC0-licensed assets from `api.polyhaven.com`. No API key needed. Browser search,
preview thumbnails, one-click import. HDRIs become environment lighting; textures
become material maps; models import directly into the scene.

---

## 20. Service Worker & PWA

### Service worker (sw.js)

**Cache strategy:** cache-first with version-gated invalidation.

```javascript
const CACHE = 'forge-v33';     // ← bump this on every deploy
const ASSETS = [ ... ];         // every app shell file

// Install: pre-cache all assets
// Activate: delete every cache that isn't CACHE
// Fetch: cache-first (respond from cache, fall back to network)
```

**⚠ CRITICAL:** When adding or renaming files, you MUST:
1. Add the file to the `ASSETS` array in `sw.js`
2. Bump the `CACHE` version string

### PWA manifest

```json
{
  "name": "PixelTriks",
  "display": "standalone",
  "background_color": "#0e0f13",
  "theme_color": "#0e0f13",
  "categories": ["photo", "graphics", "productivity"]
}
```

### IndexedDB autosave

The app auto-saves the current document to IndexedDB every 30 seconds.
On reload, if an autosave exists, a restore dialog appears.

---

## 21. Caching & Deployment

### Deployment pipeline

```
git push origin main  →  Cloudflare Pages (git-triggered)
   — OR —
npx wrangler pages deploy . --project-name=pixeltriks  (direct)
```

Push-to-main = production. Cloudflare Pages deploys in ~15 seconds.

### Cache control — two layers

#### Layer 1: Cloudflare zone-level rules (AUTHORITATIVE on pixeltriks.com)

8 HTTP Response Header Modification rules in the `pixeltriks.com` zone:

| Rule | Match | Cache-Control |
|------|-------|--------------|
| Service worker | `uri.path eq "/sw.js"` | `no-cache, no-store, must-revalidate` |
| HTML app shell | `uri.path eq "/"` OR `ends_with "/index.html"` | `no-cache, must-revalidate` |
| PWA manifest | `ends_with ".webmanifest"` | `public, max-age=3600, must-revalidate` |
| App JS/CSS | `ends_with ".js"` or `".css"` (excluding sw.js/vendor) | `public, max-age=3600, must-revalidate` |
| Images | `ends_with ".svg"` or `".png"` or `".ico"` | `public, max-age=86400` |
| Vendor libs | `uri.path contains "/vendor/"` | `public, max-age=604800, immutable` |
| 3D assets | `ends_with ".glb"` or `".json"` (font) | `public, max-age=604800, immutable` |
| Font files | `ends_with ".woff2"` | `public, max-age=604800, immutable` |

#### Layer 2: `_headers` file (preview deployments only)

CF Pages `_headers` works on preview URLs (`*.pixeltriks.pages.dev`) but is
**overridden** by zone-level rules on the custom domain. The file serves as
documentation and fallback for preview builds.

**⚠ Known issue:** CF Pages MERGES all matching `_headers` rules (it doesn't
use most-specific-wins). Non-overlapping paths are required to avoid
contradictory headers.

### Deploy + cache purge recipe

```bash
# 1. Deploy
npx wrangler pages deploy . --project-name=pixeltriks --branch=main

# 2. Purge edge cache
ZONE_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones?name=pixeltriks.com" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"purge_everything":true}'

# 3. Verify
curl -s https://pixeltriks.com/sw.js | head -5   # check CACHE version
```

---

## 22. Testing

### E2E tests (tests/e2e.js)

165 tests injected into the real app in headless Chrome. Tests exercise both
the engine API and DOM controls.

**Test categories:**
- Document (new, resize, close)
- Tools (click rail, verify engine tool, aria-pressed)
- Optbar (builds for each tool, panel mode)
- Paint (brush stroke modifies canvas)
- Selection (wand, rect, operations)
- Adjust (live preview, apply, reset, compare)
- Filters (click chips, verify pixel change)
- Headline actions (enhance, remove-bg, ink-outline, clean-colors)
- Layers (add, delete, duplicate, merge, flatten, reorder, visibility, blend, text)
- Power ops (resize, upscale, curves, adjustment layers, generate, mask)
- Undo/redo
- Export/project
- Zoom
- AI adapter
- Keyboard shortcuts
- Command palette
- Crop overhaul
- Pro adjust (histogram, image size)
- Quick wins (quick-adjust dialog, filters, paste, autosave)
- Adjustment layers (non-destructive)
- Vibrance/clarity
- Font picker
- History panel
- Re-editable text layers
- PWA + autosave
- Pro selections + guides
- 3D workspace (primitives, transform, material, scene tree, gizmo, import)
- Brush stabilizer
- Paint3D
- Polish (keyboard, compare)
- Procedural materials
- Transform pad (module, axis mode, actions)
- Context hotbar (module, context detection, buttons)
- Game deck integration

**Running:**
```bash
bash tests/run-e2e.sh              # all 165 tests
```

### Userflow tests (tests/userflow.js)

Tests real pointer events (PointerEvent with bubbles/cancelable) through the
engine's input pipeline. Covers: brush strokes, marquee selection, move drag,
shape drawing, crop handles.

**Running:**
```bash
bash tests/run-userflow.sh         # desktop viewport
bash tests/run-userflow-mobile.sh  # mobile viewport
```

### Test helpers

```javascript
// In e2e.js
const $ = s => document.querySelector(s);
const freshDoc = () => GF.api.run('newDoc', { w: 100, h: 100 });
const clickTool = name => $(`#toolrail .tool[data-tool="${name}"]`).click();
const paletteRun = label => { /* opens ⌘K, types label, clicks first match */ };
```

---

## 23. Common Bug Classes

### 1. `$` vs `$$` — querySelector vs querySelectorAll

```javascript
// ❌ WRONG — $ returns ONE element, .forEach doesn't exist on it
$('.ptab').forEach(t => t.addEventListener('click', ...));

// ✅ RIGHT — $$ returns a NodeList (or Array via our helper)
$$('.ptab').forEach(t => t.addEventListener('click', ...));
```

**Impact:** Silent failure — no error, no event listeners, buttons don't work.
This has caused 54-test regressions.

### 2. GF.doc.active() vs GF.doc.activeLayer()

```javascript
// ❌ WRONG — activeLayer() does not exist
const layer = GF.doc.activeLayer();

// ✅ RIGHT
const layer = GF.doc.active();
```

### 3. Unicode smart quotes from external terminals

When another agent (e.g. Norm via Jake's terminal) pastes code, their terminal
may convert `'` to `'` (U+2018/U+2019) or `"` to `"` (U+201C/U+201D).
JavaScript syntax silently breaks — no build step catches this.

**Prevention:** Grep for smart quotes before merging external PRs:
```bash
grep -rn '[''""–—]' core/ ui/ ai/ --include='*.js'
```

### 4. Service worker cache staleness

If a file is added/renamed but not added to `sw.js`'s `ASSETS` array AND the
cache version isn't bumped, returning users get the old cached version
indefinitely.

**Prevention:** Bump `CACHE` constant AND update `ASSETS` on every file change.

### 5. Cloudflare edge cache persisting old content

After deploying, the Cloudflare edge may serve stale content for up to 4 hours
(default `max-age`). Always run `purge_everything` after deploy.

### 6. `data-mode` not switching

The `body[data-mode]` attribute (`'2d'` or `'3d'`) controls which UI surfaces
are visible. If mode doesn't switch when expected, the hotbar context detection
fails. The mode is set by `GF.scene3dUI` or `GF.ui.setTool()`.

---

## 24. Modification Guide

### Adding a new tool

1. **core/tools.js:** Add to `SHORTCUTS`, add pointer handling in the
   `switch(view.tool)` block
2. **ui/forge-ui.js:** Add to `buildOptbar()` for tool-specific options
3. **index.html:** Add `<button class="tool" data-tool="name">` to `#toolrail`
4. **ui/hotbar.js:** Update context detection if the tool creates a new context
5. **tests/e2e.js:** Add tool verification tests
6. **sw.js:** Bump cache version

### Adding a new filter

1. **core/filters.js:** Add the filter function
2. **core/api.js:** Register with `cmd()` if it should be API-callable
3. **ui/forge-ui.js:** Add a filter chip in the Adjust tab HTML
4. **tests/e2e.js:** Add a test that verifies pixel change

### Adding a new 3D primitive

1. **core/scene3d.js:** Add geometry creation in the `addPrimitive()` switch
2. **ui/scene3d-ui.js:** Add to the appropriate `PRIM_GROUPS` array
3. **tests/e2e.js:** The existing primitive test iterates `PRIM_GROUPS`
   automatically — verify it still covers the new one

### Adding a new hotbar action

1. **ui/hotbar.js:** Add to the `ACTIONS` object with icon, label, action
2. Add to the appropriate context's action list in `CONTEXTS`
3. If the icon doesn't exist, add an SVG to the `ICONS` object

### Adding a new 2D→3D converter

1. **core/make3d.js:** Call `register(key, { label, desc, options, convert })`
2. The UI auto-discovers it via `GF.make3d.list()` — no UI code needed

### Changing the color theme

All colors are in CSS custom properties in `:root` at the top of `forge.css`.
Change the 5 game-deck variables to retheme every interactive element:

```css
--game-border:   #3a3f4d;
--game-border-w: 2px;
--game-r:        8px;
--game-glow:     0 0 12px color-mix(in srgb, var(--accent) 50%, transparent);
--game-active-bg: color-mix(in srgb, var(--accent) 18%, var(--surface));
```

### Deployment checklist

1. Run `bash tests/run-e2e.sh` — must be 165/165 ALLPASS
2. Bump `CACHE` in `sw.js` if any file changed
3. Update `ASSETS` array if files were added/renamed
4. `git commit && git push origin main`
5. `npx wrangler pages deploy .` (or wait for git-triggered deploy)
6. Purge Cloudflare edge cache
7. Verify `sw.js` version via `curl -s https://pixeltriks.com/sw.js | head -5`

---

## Appendix: localStorage Keys

| Key | Module | Purpose |
|-----|--------|---------|
| `forge.theme` | forge-ui.js | User's theme preference ('light' / 'dark') |
| `forge.wandSeen` | forge-ui.js | Whether the wand coach-mark has been dismissed |
| `pt-dismissed-tips` | polish.js | Set of dismissed first-use tip IDs |

## Appendix: IndexedDB Databases

| Database | Store | Purpose |
|----------|-------|---------|
| `pixeltriks-assets` | `assets` | Asset library (models, textures, HDRIs) |
| `pixeltriks-autosave` | `projects` | Auto-saved document state |

## Appendix: Three.js Version

Vendored at **r185** in `vendor/three/`. The publish module pins CDN to the
same version (`https://cdn.jsdelivr.net/npm/three@0.185.0`). Both MUST be
updated together if upgrading Three.js.
