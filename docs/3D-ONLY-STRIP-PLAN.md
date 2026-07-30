# PixelTriks → 3D-Only Asset Studio — Strip Plan

**Date:** 2026-07-19. Branch: `feat/3d-only-pivot`.
**Goal:** Remove the 2D image editor from PixelTriks so it becomes a dedicated
3D game-asset creation/modification tool (mesh editing, per-zone textures/layers).
The extracted 2D editor lives as a separate app in `~/Desktop/2dAI` (a full copy,
untouched for now).

**Decisions locked (2026-07-19):**
- PixelTriks → 3D-only. 2D editor removed.
- `make3d.js` (2D→3D converters) **dropped for now** — returns later as a lean
  "import image → 3D" feature. This frees full deletion of the 2D core.
- Mesh editing target: **full edit mode** (verts/edges/faces; extrude, inset,
  bevel, loop cut, subdivide, merge, dissolve) — later phases, not this strip.

---

## File-level split

**KEEP (3D engine + shared shell):**
- core: `util, context, commands, plugins, transform-manager, scene3d, animation,
  paint3d, publish, assets, texgen, library` + `api` (trimmed to 3D)
- ui: `three-bundle, scene3d-ui, assets-ui, timeline-ui, hotbar` (3D contexts),
  `gamepad`/`transform-pad` (3D halves), `remap, polish`, a shell from `forge-ui`
- vendor: `three, imagetracer`

**REMOVE (2D editor):**
- core: `history, layers, filters, select, retouch, tools, exporter, curves, make3d`
- ui: `selection-bar, tool-guides` (2D), 2D DOM in `index.html`, 2D blocks in `api.js`
- `forge-ui.js`: 2D-only blocks (adjust/filters/layers/crop/curves/histogram/text/
  wand/AI-image/adjustment-layers) — keep only shell + 3D stubs

**SHARED-SHELL to preserve out of `forge-ui.js`:** init/boot, topbar wiring,
command palette (fuzzy search), panel switching, drop/file input, keyboard binding
table + `file.*`/`view.*`/`edit.*` commands, PWA/autosave/restore, theme,
statusbar, `modal`/`closeModal`, `setDims`/`updateUndoRedo`.

---

## Engine touchpoints (the non-file coupling — must rewire, not just delete)

The 3D engine assumes a coexisting 2D document in three spots:
1. **undo/redo** (`api.js` ~56-59): delegates to `GF.history` unless in 3D.
   → 3D-only: undo/redo always routes to the scene's own history stack.
2. **flatten to layer** (`scene3d` `snapshotToLayer`/`flatten2d`): renders the 3D
   view into a **new 2D layer**. → 3D-only: becomes "Export view as PNG" (download),
   no 2D-layer target.
3. **material from named layer** (`scene3d` material source = a 2D layer canvas):
   → 3D-only: material/texture sources come from imported images + `texgen`/`library`
   procedural textures only.

Mode system: app is locked to 3D. Remove the `view.toggleMode` command + gamepad
SELECT→toggle; `body.dataset.mode` stays `"3d"`. Collapse the 2D↔3D forks in
`context.js`, `gamepad.js`, `transform-pad.js`, `hotbar.js` to the 3D half.

---

## Staged execution (each stage boots clean + verified vs `tests/run-e2e.sh`)

**Baseline:** e2e 175/177 (2 known headless-graphics failures). The 2D tests get
removed as their features go; the 3D suite (`3d:` block, ~14 tests) is the guardrail
and gets rewritten where it asserts 2D coexistence.

1. **Rebrand + lock to 3D.** Title/meta/manifest/statusbar → 3D asset studio.
   Remove `view.toggleMode` + SELECT binding. App boots and stays in 3D.
2. **Remove 2D UI.** 2D tool-rail tools, Adjust/Layers/Guide-2D panes (DOM) +
   their `forge-ui` wiring + `hotbar` 2D contexts + `tool-guides`/`selection-bar` +
   2D `api.js` commands. Extract shared shell so the app still boots.
3. **Rewire the 3 engine touchpoints** (undo, flatten→PNG, material source).
   Rewrite the affected `3d:` e2e tests.
4. **Remove 2D core files** (`history, layers, filters, select, retouch, tools,
   exporter, curves, make3d`) + prune `forge.css`. Re-scope test suite to 3D.

**After the strip (separate phases, not this branch):** 3D-first dashboard →
editable mesh core → mesh operators → material zones → glTF export. See the
roadmap discussion; tracked separately.
