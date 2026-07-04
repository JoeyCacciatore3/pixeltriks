# PixelTriks — Implementation Progress

## Phase 1: Layout Restructure — COMPLETE ✅
- [x] Step 1: HTML Grid Shell
- [x] Step 2: Scene Tree to Sidebar
- [x] Step 3: Tool Rail → Toolbar Dropdowns
- [x] Step 4: 3D Always On
- [x] Step 5: TransformControls
- [x] Step 6: Restructure Right Panel
- [x] Step 7: Update Tests
- [x] Step 8: Polish

## Phase 2: Asset Library — COMPLETE ✅
- [x] `core/assets.js` — IndexedDB CRUD, batch transactions, persistent storage, import pipeline (Jul 4)
- [x] `ui/assets-ui.js` — browsable grid in sidebar, tabs, search, drag support, import button (Jul 4)
- [x] 4 API commands: assets.list, assets.count, assets.search, assets.remove (Jul 4)
- [x] Material preset library — 15 PBR materials from procedural texgen (wood, metal, stone, marble, brick, etc.) (Jul 4)
- [x] 3 API commands: materials.listPresets, materials.generate, materials.generateAll (Jul 4)
- [x] Drag-from-library-to-viewport — models import, textures/materials apply to selected object (Jul 4)
- [x] Generate menu in asset UI — individual or batch generation of all 15 presets (Jul 4)
- [ ] Poly Haven cache-through integration

## Phase 3: Animation — COMPLETE ✅
- [x] `core/animation.js` — keyframe engine: play/pause/stop, scrub, record, interpolation, getClips() for GLTFExporter (Jul 4)
- [x] `ui/timeline-ui.js` — canvas-rendered timeline: playhead, track rows, diamond markers, play/stop/record controls (Jul 4)
- [x] 8 API commands: animation.play/pause/stop/setTime/setDuration/recordKeyframe/addKeyframe/getKeyframes (Jul 4)
- [x] CSS: timeline bar + expanded canvas view
- [x] GLB animation playback — AnimationMixer auto-plays imported clips, cleaned up on object remove (Jul 4)
- [x] Animated GLB export — exportGLBBuffer now auto-includes animation clips with trs:true (Jul 4)
- [x] Animated publish.js — published pages auto-play animations via AnimationMixer (Jul 4)

## Phase 4: 2D-to-3D + Competitive Enhancements — COMPLETE ✅
- [x] SVG extrusion converter (SVGLoader + toShapes + ExtrudeGeometry) (Jul 4)
- [x] Text 3D converter — FontLoader + vendored Helvetiker font, full TextGeometry extrusion (Jul 4)
- [x] Clipboard copy (Ctrl+Shift+C → PNG via navigator.clipboard.write) (Jul 4)
- [x] Multi-channel texture painting — `core/paint3d.js`, UV raycasting, color + roughness channels, brush size/opacity, undo (Jul 4)
- [x] 4 API commands: paint3d.enter/exit/setBrush/clear (Jul 4)
- [ ] DepthAnything v2 depth estimation (ONNX lazy-load) — deferred to Phase 6

## Phase 5: Polish — COMPLETE ✅
- [x] Brush stabilizer — moving-average of N recent points, configurable 0-20 window, slider in optbar (Jul 4)
- [x] Visual undo thumbnails — current-state canvas snapshot in history panel (Jul 4)
- [x] Contextual quick-actions — floating chip bar for selected 3D objects: Paint, Material, Frame, Duplicate, Delete (Jul 4)
- [x] First-use tooltips — one-sentence hints per tool, dismissible, persisted in localStorage (Jul 4)

## Step 1: HTML Grid Shell

Replace `#stage` from flex to CSS Grid. Keep all child elements — just change
the container.

```html
<main id="stage">
  <aside id="sidebar"><!-- scene tree + asset library --></aside>
  <section id="viewport"><!-- 3D canvas (always) + 2D overlay (paint mode) --></section>
  <aside id="panel"><!-- properties + layers --></aside>
  <div id="timeline"><!-- animation timeline stub --></div>
</main>
```

CSS:
```css
#stage {
  flex: 1 1 auto; min-height: 0;
  display: grid;
  grid-template-columns: var(--sidebar-w, 240px) 1fr var(--panel-w);
  grid-template-rows: 1fr auto;
  grid-template-areas:
    "sidebar viewport panel"
    "timeline timeline timeline";
}
#sidebar  { grid-area: sidebar; }
#viewport { grid-area: viewport; }
#panel    { grid-area: panel; }
#timeline { grid-area: timeline; height: 0; /* stub until Phase 3 */ }
```

**Test:** app loads, viewport fills center, right panel visible.

## Step 2: Move Scene Tree to Left Sidebar

Move `#s3-objects` (currently inside the 3D tab of the right panel) into the
new `#sidebar`. Add the scene tree section:

```html
<aside id="sidebar">
  <div class="sidebar-section" id="scene-tree">
    <h3 class="panel-h first">Scene</h3>
    <ul id="s3-objects" class="layer-list"></ul>
    <div class="s3-row">
      <button class="text-btn ghost" id="s3-add-menu">+ Add</button>
      <button class="text-btn ghost" id="s3-import">Import</button>
    </div>
  </div>
  <div class="sidebar-section" id="asset-section">
    <h3 class="panel-h">Assets</h3>
    <p class="s3-status">Asset library — coming in Phase 2</p>
  </div>
</aside>
```

**Test:** scene tree shows objects in left sidebar. Click selects. Delete works.

## Step 3: Remove Tool Rail, Add Context Toolbar

Kill `#toolrail`. Move tools into dropdown menus in `#topbar`:

```html
<div class="tb-group tb-left">
  <span class="brand">...</span>
  <div class="dropdown" id="add-menu">
    <button class="text-btn">+ Add</button>
    <!-- primitives, import model, import image -->
  </div>
  <div class="dropdown" id="tools-menu">
    <button class="text-btn">Tools</button>
    <!-- brush, eraser, fill, text, shape, select, wand, crop -->
  </div>
</div>
```

The tool-specific options bar (`#optbar`) stays — it shows contextual controls
for whatever tool/object is active.

**Test:** can add a primitive via dropdown, paint with brush via dropdown,
all keyboard shortcuts still work (B, E, G, T, etc.).

## Step 4: 3D Always On

Change `body[data-mode]` default from `"image"` to `"3d"`.

CSS: remove the `display: none` on `#scene3d-host`. The 3D viewport is always
the background. When a 2D document is open, painting happens on a texture
overlay, not by switching modes.

JS changes in scene3d.js:
- Boot the renderer on page load (not on tool click)
- Show the empty-state intent grid OVER the 3D viewport

JS changes in forge-ui.js:
- Remove `setTool('scene3d')` / `setTool('move')` mode toggling
- Tool selection now sets the ACTIVE TOOL, not the mode
- 2D tools (brush, eraser, etc.) work on the selected object's texture

**Test:** page loads → 3D viewport visible with lighting. Add a box → it
appears. No mode toggle button needed.

## Step 5: TransformControls Integration

In scene3d.js `buildRenderer()`:

```javascript
const gizmo = new LIB.TransformControls(camera, renderer.domElement);
scene.add(gizmo.getHelper());

gizmo.addEventListener('dragging-changed', e => {
  controls.enabled = !e.value;
});

let gizmoBefore = null;
gizmo.addEventListener('mouseDown', () => {
  const o = selected();
  if (o) gizmoBefore = snapTransform(o);
});
gizmo.addEventListener('mouseUp', () => {
  const o = selected();
  if (o && gizmoBefore) {
    const after = snapTransform(o);
    hist.push('transform', () => writeTransform(o, gizmoBefore),
                            () => writeTransform(o, after));
    gizmoBefore = null;
    emit();
  }
});
```

In the `select()` function, attach/detach the gizmo:
```javascript
if (o) gizmo.attach(o.node);
else gizmo.detach();
```

Keyboard handling (in scene3d-ui.js or forge-ui.js):
```javascript
if (k === 'w') gizmo.setMode('translate');
if (k === 'e') gizmo.setMode('rotate');
if (k === 'r') gizmo.setMode('scale');
if (k === 'q') gizmo.setSpace(gizmo.space === 'world' ? 'local' : 'world');
```

**Test:** select a box → gizmo arrows appear. Press W/E/R to switch modes.
Drag an arrow → object moves on that axis. Ctrl+Z undoes it.

## Step 6: Restructure Right Panel

Remove the 3-tab system (Image | Layers | 3D). Replace with a single
scrollable panel:

```
Properties
├─ Transform (X Y Z, RX RY RZ, SX SY SZ)
├─ Material (texture, color, roughness, metalness)
├─ Texture Layers (when painting mode active)
│  ├─ Layer list
│  ├─ Blend mode
│  └─ Opacity
├─ Adjustments (exposure, contrast, etc.)
└─ Actions (export, flatten, publish)
```

The content changes based on context:
- Nothing selected → show actions + add menu
- 3D object selected → transform + material
- Paint mode active → layers + adjustments + filters

**Test:** select a box → transform sliders appear. Change material →
live update. Switch to another object → panel updates.

## Step 7: Update Tests

The e2e tests reference `#toolrail .tool[data-tool=...]` extensively.
Update selectors to match new dropdown structure. The `clickTool(name)`
helper needs to open the dropdown, then click the tool.

**Test:** 117/117 pass with new selectors.

## Step 8: Polish

- Sidebar collapse toggle (double-click divider or button)
- Panel resize drag handle
- Keyboard shortcut overlay (?) updated for new layout
- README.md workflow section rewritten for 3D-first
- Mobile responsive: sidebar collapses, panel becomes bottom sheet

## Files Modified

| File | Type | Scope |
|------|------|-------|
| index.html | Restructure | Grid layout, remove tool rail, add sidebar |
| ui/forge.css | Major | Grid, remove rail styles, add sidebar styles |
| ui/forge-ui.js | Major | Kill tab system, dropdown menus, context panel |
| ui/scene3d-ui.js | Merge | Move scene tree to sidebar, properties to panel |
| core/scene3d.js | Add | TransformControls, auto-boot renderer |
| core/tools.js | Minor | Remove mode toggling |
| tests/e2e.js | Update | New selectors for dropdown tools |
| sw.js | Minor | Cache version bump |

## Order of Execution

1 → 2 → 3 (these can be tested independently)
4 → 5 (must be done together — 3D-always-on + gizmos)
6 (can be done after 4+5)
7 → 8 (finalization)
