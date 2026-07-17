# Game Deck V2 — Command Registry, Dedup, and Gamepad-as-Source-of-Truth

**Date:** 2026-07-17. Synthesizes (a) a full entry-point duplication audit of the
codebase and (b) research on gamepad-first creative tools (Dreams, Mario Maker 2,
Steam Deck), one-home command design (NN/g, Linear), and registry-driven UI
architecture (VS Code, Blender, Krita, GIMP 3).

**Relationship to `UI-UX-ARCHITECTURE-BLUEPRINT.md`:** that doc remains the
feature→home map, EXCEPT the four rows corrected in §4 below. Where they
conflict, this doc wins.

---

## 1. Audit results — where duplication and drift actually live

The `GF.api` catalog principle ("every action has exactly one implementation and
one catalog entry", core/api.js:22) is sound, but the UI layer never held to it.

**Redundancy ratio:** ~230–260 rendered buttons/entries for ~95–105 distinct
actions (~2.5:1). Open/Import alone: **~13 entry points** (topbar, hamburger,
palette, hotbar, 2 assets-tab buttons, 2 3D-panel buttons, drag-drop, 2 dangling,
plus **3 independent hand-rolled file-input pipelines** in hotbar.js:92,
assets-ui.js:60, scene3d-ui.js:313).

### Dead buttons (call command names the catalog renamed — throw "unknown command")
- `ui/hotbar.js`: `layer.add` (:130), `layer.mergeDown` (:131), `adjust.autoLevels`
  (:108), `filters.open` (:112), `brush.swapColors` (:129), `scene3d.deleteSelected`
  (:95), `scene3d.duplicateSelected` (:96), `scene3d.groupSelected` (:97),
  `scene3d.frameSelected` (:99), `scene3d.flattenToLayer` (:100) — **~11 dead hotbar buttons**
- `ui/forge-ui.js:110-113`: rail quick-actions call `flipH/flipV/rotateCW/rotateCCW`;
  catalog has `flipLayer`/`rotateLayer` — **4 dead buttons**

### Dangling wiring (targets DOM removed from index.html; some unguarded)
`#empty-open` (forge-ui.js:397 — null deref), `#empty-state` (:175), `.intent`
(:385), `#empty-new` (:398, + hotbar.js:155 `new-doc`), `#ab-generate`/`#ab-assets`
(:1530-1538).

### Independent reimplementations that will (or did) drift
- **File import:** 4 pipelines (`pickFile`/`#file-input`, `GF.library.handleDrop`,
  `GF.assets.importFiles`, `importTextureImage`) with different accept-lists.
- **3D duplicate:** only working path is polish.js:91's hand-rolled
  `duplicateObject()`; no shared `scene3d` method.
- **3D flatten:** `flattenAndReturn` (scene3d-ui) vs `GF.scene3d.snapshotToLayer`
  (palette) — two paths.
- **Material apply:** 3 unrelated code paths (inspector, polish.js
  `showMaterialPicker`, assets-ui `applyMaterial`).
- **Remove-BG:** `ACTIONS.removeBg` (config-aware) vs raw `GF.ai.removeBg` —
  different buttons decide differently.
- **Selection fill/delete/cutout:** selection-bar.js vs hotbar.js fallback
  branches — two maintained implementations.

### Buried features (opposite problem — one obscure entry or none)
Delete layer (no shortcut, absent from palette — `deleteLayer` lacks `ui` metadata,
api.js:33); Group 3D objects (only surface is a broken button — unreachable);
Curves (Ctrl+M + palette only); Color replace / Color range / Select subject /
Layer style (palette-only); 3D paint mode (one floating chip); Poly Haven browser;
masks; adjustment layers; 23 registered API commands with no button at all.

---

## 2. The fix: one command registry, five renderers

The VS Code / Blender pattern: **declare once, bind anywhere, gate by context.**
Every command is declared once with metadata; every surface renders FROM the
registry; no surface may hard-code a label, icon, or handler. Plain ES module,
no build step, works from `file://`.

```js
// core/commands.js  (GF.commands)
register({
  id: 'layer.duplicate',
  title: 'Duplicate Layer',
  icon: 'icon-dup',
  keywords: ['copy', 'clone'],                 // palette search
  when: 'mode2d && layerSelected',             // context gate (VS Code when-clause)
  home: { surface: 'inspector', section: 'layers', order: 3 },  // ONE persistent home
  hotbar: { contexts: ['2d-layer'], priority: 2 },
  bindings: { key: 'mod+j', pad: 'chord:L1+R2' },  // remappable data
  run(ctx) { return GF.api.run('duplicateLayer'); },
  // analog verbs: kind: 'axis', step(ctx, dx, dy, mag) → routed via TransformManager
});
```

- **Context keys** (`core/context.js`): flat key/value map (`mode2d`,
  `has3dSelection`, `selectionActive`, `activeTool`…) set by the engine;
  `setContext()` emits; surfaces re-evaluate `when` clauses. A ~30-line parser
  for `&&`/`||`/`!` is enough.
- **Surfaces are dumb renderers:** left rail, hotbar, topbar, inspector buttons
  render from `home`/`hotbar` metadata. The palette lists everything whose `when`
  passes and shows each command's binding glyphs **and its home path**
  ("Inspector ▸ Layers") — GIMP 3's trick; the palette teaches placement.
- **Keyboard + gamepad are pure data tables** `binding → commandId` dispatching
  the same `execute(id, args)`.
- **Enforcement beats convention:** startup dev assertions — (a) no command
  renders in two persistent surfaces with overlapping `when` (the NN/g same-view
  rule as a lint — this makes "Open appears 5×" *impossible*, not just fixed);
  (b) every binding references a registered id (this makes the 15 dead buttons
  impossible — an unknown id throws at boot, not silently at click-time).
- **Modularity for free:** a plugin is an ES module that calls `register()` and
  instantly appears in palette, remap UI, and any surface it declares. New input
  devices (gamepad today, whatever comes next) are just new binding tables.

**One-home heuristic (from NN/g + Linear research):** a command gets exactly one
persistent home per context (earned by frequency-in-context), is ALWAYS in the
palette, and may have keyboard + gamepad bindings. Duplication across
*modalities* (button + key + pad + palette = same id) is good redundancy;
duplication across *surfaces* is the bad kind.

---

## 3. Gamepad grammar — the pad as source of truth

Core lessons from Dreams (PS4/PS5, the gold standard for controller-first creation):
- **Triggers are held analog clutches** that temporarily rebind the sticks to
  transform verbs (L2+stick = rotate, R2+stick = move/scale). Release ends the
  verb. No sticky modes to forget you're in.
- **Trigger depth = precision** (half-press = fine nudge, full = normal).
- **D-pad = discrete steps; d-pad left/right = undo/redo.**
- **Modes never change what the verbs feel like** — only what nouns exist.
- Step size scales with zoom (Dreams' grid auto-refines as you zoom in).

Web Gamepad API notes: poll via `navigator.getGamepads()` in the existing rAF
loop (no button events); gated behind first button-press while focused ("press
any button" attract state); haptics = Chromium-only progressive enhancement;
use a **scaled radial dead zone** + power response curve ~1.5 (axial/bowtie dead
zone for pixel-grid nudging).

### Binding table (constants never rebound: LS = spatial, RS = camera/pan, A = confirm/grab, B = back/deselect, Start = palette, Select = 2D↔3D, d-pad ◄► = undo/redo)

| Input | 3D object selected | 2D layer (move) | Selection active | Painting |
|---|---|---|---|---|
| Left stick | Move on ground plane | Move layer | Move/transform marquee | Brush cursor |
| Right stick | Orbit camera | Pan canvas | Pan canvas | Pan canvas |
| L2 held + LS | Rotate (Y; +L1 = other axes) | Rotate layer | Rotate selection | Brush size (x) / opacity (y) |
| R2 held + LS | Scale (half-press = fine) | Scale layer | Scale selection | Paint (depth = pressure) |
| L1 / R1 tap | Cycle object prev/next | Cycle layer | Cycle selection tool | Cycle brush preset |
| D-pad ▲▼ | Nudge Y / snap steps | Nudge 1px (+R2 = 10px) | Grow/shrink | Brush size step |
| D-pad ◄► | **Undo / redo** | Undo / redo | Undo / redo | Undo / redo |
| A | Grab/confirm | Apply transform | Commit | Dab/confirm |
| B | Deselect | Deselect | Deselect | Exit to move |
| X / Y | Hotbar slots 1–2 (context) | slots 1–2 | slots 1–2 | slot 1 / eyedropper (hold Y) |
| L1+R2 chord | Clone object | Duplicate layer | Float/duplicate | — |

**Key insight: the bottom hotbar IS the face-button legend.** Hotbar slots render
with X/Y glyphs — the context-aware hotbar and physical face buttons become one
surface. The on-screen Transform Pad's 9 cells become rendered bindings of the
same `transform.nudge.*` commands the d-pad fires; both are clients of
`core/transform-manager.js`, never direct mutators.

---

## 4. Blueprint corrections (supersede these rows in UI-UX-ARCHITECTURE-BLUEPRINT.md)

1. **ABXY ≠ color swatches.** Binding physical face buttons to recent colors
   (shipped as the "face palette") breaks the universal A=confirm/B=back grammar
   and makes controller menu navigation impossible. Keep the on-screen widget;
   move the *physical* binding to a held chord (hold Y in paint context → d-pad
   picks among 4 recents).
2. **D-pad ≠ zoom.** Zoom is continuous → belongs on a stick (L2+RS or RS-click).
   D-pad up/down = discrete nudge/steps.
3. **D-pad ◄► ≠ tool switching; Start/Select ≠ undo/redo.** Undo/redo is the
   highest-frequency action → gets the most reachable discrete input (d-pad ◄►,
   Dreams convention). Start = command palette, Select = 2D/3D toggle (replacing
   the blueprint's L/R-shoulders-for-mode row; shoulders cycle objects/layers/tools).
4. **AI tools get ONE home** — the left rail (they're tools you use, not
   file-level actions). Palette covers the rest. The blueprint's "Top Bar AI/FX
   Menu & Left Panel" is a same-view duplicate (NN/g violation).

---

## 5. Roadmap (ordered; each phase ships independently)

> **Status 2026-07-17:** Phase A ✅ and Phase C ✅ are DONE (see IMPLEMENTATION.md
> for the change list; e2e 28/151 → 161/165 — the 4 remaining failures are
> pre-existing headless-environment issues, failing at HEAD too). Phases B, D, E
> are next. Notes: `obj-group` was removed rather than fixed (engine has no
> grouping — real feature work, tracked for later); asset-library import and
> 3D-texture import were kept separate from the main file pipeline because they
> have different destinations (library / texture slot), not because of drift.

### Phase A — Stop the bleeding (bug-fix pass, no architecture) — ✅ DONE
1. Fix the 15 dead buttons: point hotbar.js + rail quick-actions at real catalog
   names (`addLayer`, `mergeDown`, `flipLayer`, `rotateLayer`…); register the
   missing `scene3d.*` commands (delete/duplicate/frame/flatten/group) in
   core/api.js backed by real scene3d methods (promote polish.js's
   `duplicateObject` into core/scene3d.js).
2. Remove dangling wiring (`#empty-open`, `#empty-state`, `.intent`,
   `#ab-generate`…) — null derefs at forge-ui.js:175,397.
3. Decide fate of orphaned `ui/game-deck.css` (V2 grid, never linked into
   index.html): fold into Phase C or delete.
4. Add `ui` metadata to `deleteLayer` + other palette-absent commands; run e2e.

### Phase B — Command registry (the modular core)
1. `core/commands.js` (registry + execute) + `core/context.js` (context keys +
   when-parser). Boot-time assertions: unknown-id and same-view-duplicate throw.
2. Port the **command palette** to render from the registry (lowest risk,
   immediate single source of truth). Show binding glyphs + home path per entry.
3. Port the **hotbar** (already context-driven — natural second client). Its 7
   contexts become `when` clauses; dead-name drift becomes structurally impossible.
4. Port keyboard map + Transform Pad (pad cells = rendered `transform.nudge.*`
   bindings through TransformManager).

### Phase C — Dedup sweep (one home per command) — ✅ DONE
1. Collapse file import to ONE `import.file` command + one shared file-input
   pipeline that routes by MIME/extension (image → layer, .glb → scene, .hdr →
   environment, .forge.json → project). Every current entry point becomes a
   rendered binding or is deleted. Target: 13 surfaces → topbar button + palette
   + drag-drop.
2. Unify the 3 material-apply paths, 2 flatten paths, 2 remove-BG paths, 2
   selection-op paths — one implementation each, registry-fronted.
3. Apply the one-home rule across the blueprint mapping; unbury: Delete layer
   (shortcut + palette), Group (real button), Curves/Color-ops (Adjustments
   section), 3D paint (hotbar slot in 3d-selected).

### Phase D — Physical gamepad (cheap by now — it's just a binding table)
1. `ui/gamepad.js`: rAF poll, edge detection, scaled-radial dead zone + response
   curve, chord resolution → `GF.commands.execute()`; analog verbs → TransformManager.
2. Binding table from §3; persistent HUD glyph strip (hotbar = face-button legend).
3. "Press any button" attract state; Chromium rumble ticks on snap/delete/undo.
4. Controller-navigable palette + on-screen keyboard trigger (Steam Deck rules:
   everything reachable by pad alone; never lock out mouse ↔ pad — accumulate both).

### Phase E — Future-proofing
- Remap UI reading/writing the binding tables (they're already data).
- Plugin doc: third-party ES module calling `GF.commands.register()`.
- Per-axis sensitivity/curve sliders (Dreams a11y precedent).

## Research sources (key)
Dreams controls & modes: gamertweak.com/dreams-ps4-controls-guide, tapgiles.com/docs/modes,
docs.indreams.me edit-mode guides · SMM2 docked controls: shacknews.com/article/112648 ·
Steam Deck: partner.steamgames.com/doc/steamdeck/recommendations · Gamepad API: MDN
Gamepad_API, W3C WD 2025 · Dead zones: blog.hypersect.com/interpreting-analog-sticks,
joshsutphin.com thumbstick-deadzones · NN/g: duplicate-links, progressive-disclosure,
navigation-cognitive-strain · Palette-first: linear.app invisible-details ·
Registries: code.visualstudio.com contribution-points + when-clause-contexts,
Blender bpy KeyMapItem, Krita KisActionRegistry, GIMP 3 action system.
