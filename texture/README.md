# Forge Studio — Texture

The **Texture** mode of [Forge Studio](../README.md) (formerly GameForge): a
layer-based image editor for game textures and assets that runs entirely in the
browser. No install, no build step, no server, no accounts. Normally opened
through Forge Studio (`../index.html`); `index.html` here also runs standalone.

## Run it

1. Unzip the folder.
2. Double-click `index.html` (or open it in any modern browser: Chrome, Edge,
   Firefox, Safari — desktop or mobile).

Everything works offline except the 3D material preview, which downloads
Three.js from a CDN the first time you start it.

**On mobile:** the side panels live in a bottom drawer — tap the amber
**PANELS** button. Draw with one finger; pinch with two fingers to zoom and pan.

## Features

### Editing core
- **Canvas presets** — power-of-two texture sizes (256–4096), sprite/tile sizes
  (16–128), HD/4K screens, or any custom size up to 8192².
- **Layers** — add, duplicate, delete, reorder, rename (double-tap the name),
  merge down, flatten, per-layer visibility and opacity.
- **16 blend modes** — Normal, Multiply, Screen, Overlay, Darken, Lighten,
  Color dodge/burn, Hard/Soft light, Difference, Exclusion, Hue, Saturation,
  Color, Luminosity (GPU-composited via the native canvas pipeline).
- **Tools** — Move (V), Brush (B), Eraser (E), Flood fill with tolerance (G),
  Eyedropper (I), Pan (H or hold Space), Magic wand (W), Magic eraser (X),
  Rect/ellipse/lasso select (M / L), Gradient (D), Shapes (U), Text (T),
  Clone stamp (C). Brush has size, opacity, and a crisp **pixel mode**.
- **Selections constrain everything** — brush, eraser, fill, gradients, shapes,
  clone and all filters respect the active selection (Shift adds, Alt
  subtracts; Esc deselects, Ctrl+A all, Ctrl+I invert, Ctrl+J layer-via-copy,
  Delete erases). Marching ants animate; the options bar shows the px count.
- **Retouch** — background removal + defringe, content-aware fill (PatchMatch),
  color replace, smart upscale (Scale2x / bicubic+unsharp).
- **Transforms** — flip / rotate 90° / scale per layer, flip / rotate the whole
  canvas, all offset-aware (content moved off-canvas is never lost).
- **Library** — built-in asset browser: offline procedural textures plus CC0
  textures / HDRIs / glTF models from Poly Haven (no key, no signup); HDRIs can
  light the 3D preview as a real environment map.
- **Undo / redo** — 25 steps, Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z).
- **Import** — drag-and-drop or Import button; images open as documents or land
  as new layers. **Export** — PNG / WebP / JPEG at 0.25×–4× scale, whole
  document or active layer only.
- **Project files** — Save/load `.gameforge.json` keeps every layer, blend
  mode, opacity and name intact (Ctrl+S).

### Adjustments (Adjust tab)
Brightness/contrast, hue/saturation/lightness, grayscale, invert, sharpen,
blur, edge detect, auto levels, posterize, pixelate. Applied to the active
layer; every application is one undo step.

### Texture tools (Texture tab)
- **Normal map generator** — Sobel-based, strength control, Invert Y for
  DirectX-convention engines, wrap-edges mode for tileable sources.
- **PBR set** — height, ambient occlusion (cavity-based), and roughness
  estimate generated from the active layer as hidden layers.
- **Seamless tiling** — half-offset + smoothstep cross-blend, plus an instant
  3×3 tiling preview layer to inspect seams.
- **Palette tools** — median-cut palette extraction (2–32 colors, tap a swatch
  to paint with it) and reduce-to-palette quantization.
- **Dithering** — Floyd–Steinberg and ordered Bayer 4×4, with Game Boy,
  4-step grayscale, or your extracted palette.
- **Channel tools** — view R/G/B/A in isolation; pack the luminance of any
  three layers into R/G/B (standard ORM order: AO→R, Roughness→G, Metallic→B
  for Unity/Unreal/Three.js).

### 3D preview (3D tab)
Live Three.js `MeshStandardMaterial` preview on a sphere, cube, plane, or
torus knot. The composite drives base color (correctly tagged sRGB); layers
named **“normal”** and **“roughness”** are wired to their map slots (kept
linear, as PBR expects) — the generator tools name their output layers so this
hooks up automatically. Drag to orbit; Refresh re-reads the maps after edits.

## Engine conventions worth knowing
- Three.js / OpenGL want normal maps with **Y up** (leave Invert Y off).
  DirectX-convention engines (e.g. Unreal) want **Invert Y on**.
- For Three.js, plug the packed ORM texture into `aoMap` + `roughnessMap` +
  `metalnessMap` (it reads G for roughness and B for metalness from the same
  texture).

## Known limits (v1, by design — not silent gaps)
- Adjustments are applied to pixels (with full undo) rather than as live
  adjustment layers. A non-destructive adjustment-layer engine is the headline
  item for v2.
- No AI tools (smart selection, background removal) in this build — they
  require multi-MB model downloads, which conflicts with “works offline from a
  double-click.” The architecture leaves room for them.
- No PSD or KTX2/Basis import/export yet; use PNG + project files.
- Pixel filters on canvases above 2048×2048 can take a few seconds — the app
  warns you when you create one.

## Platform — shared asset library

Forge Studio's **Texture** and **Sprite** modes plus **World Engine** share one
local asset library (`~/Desktop/game-assets/`): Texture mode makes
textures/materials, Sprite mode makes sprites, and World Engine consumes both to
build worlds.

Because a page opened from `file://` can't write to disk, publishing goes through
the **Asset Hub** — a tiny zero-dependency Node server that owns the library.

```bash
cd ~/Desktop/game-assets && npm start     # Asset Hub on http://localhost:8788
```

Then in Texture mode: **Export → Save to Library**. It bundles the document as a
**texture set** — the albedo (a composite of every non-PBR layer) plus any PBR
map layers it recognizes by name (`normal`, `roughness`, `ao`, `height`,
`metal`, `orm`) — and uploads it. The `materialWizard` command produces exactly
these layer names, so a wizard output saves as a complete material in one click.

Same thing from the agent API: `GF.api.run('saveToLibrary', {name, tileable})`.

The hub URL defaults to `http://localhost:8788`; override with
`localStorage.setItem('gf.hubUrl', '…')`. World Engine then picks the texture up
in its Library panel to skin terrain.

## Code layout
Classic scripts (no bundler) so the app runs from `file://`:
`util → history → layers → filters → texture → select → retouch → tools → exporter → preview3d → library → ui → main`,
all under the `GF` namespace. Each module is documented in its header comment.

## AI-operator API

The entire app is drivable by an automated agent — no DOM interaction needed.
Open the console (or inject via browser automation / an MCP wrapper) and use:

```js
GF.api.describe()              // machine-readable catalog: [{name, params, doc}, …]
GF.api.run('newDoc', {w:512, h:512})
GF.api.run('generate', {kind:'stone'})
GF.api.run('materialWizard', {tileable:true})
GF.api.state()                 // doc, layers, selection, tool, history
GF.api.snapshot()              // PNG dataURL of the composite — the agent's eyes
```

Every command auto-refreshes the UI; selections, history and layer naming all
behave exactly as if a human did it.
