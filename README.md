# PixelTriks

A **general-purpose, AI-assisted image editor** (pixeltriks.com) that runs in any browser — your go-to
tool for enhancing, retouching, cutting out, and creating images. Simple on the surface,
deep underneath: the 80/20 of everyday editing is one tap away, with full pro depth
(layers, masks, curves, channels) right behind it.

Open **`index.html`** (double-click — the classic core runs from `file://`, no build step).

## What it does

- **Open / import** any image (drag-drop or Open), or start a **New** canvas.
- **Tools** — Move, Marquee/Smart-select (magic wand), Crop, Brush, Eraser, Fill, Text,
  Shapes, Eyedropper. Selections constrain painting and filters.
- **Adjust** (the 80/20) — Exposure, Contrast, Saturation, Warmth with **live,
  non-destructive preview**; one-tap **Auto-enhance**; a strip of **filter presets**.
- **Hero actions** — **Remove background**, **Magic erase** (content-aware fill over a
  selection), and **Generative fill** (AI).
- **Layers** — full stack, 16 blend modes, opacity, masks, and **non-destructive
  adjustment layers** (Brightness/Contrast, Levels, Curves, Hue/Saturation, Posterize,
  B&W, Invert, Auto Levels) — add with the **fx** button, double-click to re-edit, delete
  to revert. Quick **Adjust** sliders also include **Vibrance** and **Clarity**.
- **Pro tools** ("More") — content-aware fill, color replace, smart upscale, curves,
  trim, flip/rotate, masks.
- **Export** — PNG / JPEG / WebP at 1×/2×/0.5×, or save a project file.
- **Responsive** — desktop panels on the right; on phones a bottom tool bar + a
  summonable bottom-sheet panel, pinch-zoom/pan, and a floating touch companion.

### Power features
- **Command palette** — press **⌘/Ctrl K** (or the search pill) for a Linear/Raycast-style
  fuzzy launcher over *every* action: tools, adjustments, filters, retouch, layers,
  transforms, modes, AI. Type, arrow, enter.
- **Pro crop** — interactive crop rectangle with 8 handles, **aspect presets**
  (Free · 1:1 · 4:5 · 16:9 · 9:16 · 3:2 · Original), a **rule-of-thirds overlay**, and a
  **straighten** slider (arbitrary-angle, canvas auto-expands).
- **Live histogram** in the Adjust panel (reflects the non-destructive preview), plus a
  **hold-to-compare** before/after button.
- **Image size** dialog (resample, lock aspect), **clipboard paste** (⌘V a screenshot
  straight onto the canvas), **selection feather / grow**, a **keyboard cheat-sheet** (`?`),
  and a **light / dark** theme toggle (dark-first, remembers your choice).
- **Scrubbable history panel** (More tab) — every named step, click to jump back or forward.
- **Re-editable text layers** — double-click a text layer to change the words, font, size,
  colour or outline; the edit re-renders and saves into the project file.
- **Installable PWA + autosave** — install PixelTriks as an app (served over http) and your work
  autosaves to IndexedDB, with a "restore last session" prompt after a refresh or crash.

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
node sprite/tools/proxy.js     # http://localhost:8787/?url=
```

## How it's built

Classic scripts, no bundler, so the core works offline from a double-click:

```
pixeltriks/
  index.html        responsive single-page shell
  core/             game-agnostic raster engine (global GF namespace):
                    util · history · layers · filters · select · retouch ·
                    tools · exporter · curves · api
  ui/               forge-ui.js (the UI) + forge.css (design system, responsive)
  ai/               forge-ai.js (provider-agnostic AI adapter)
  texture/          optional "Game / PBR" mode (normal/PBR maps, 3D preview, tiling)
  sprite/           optional "Sprite / Pixel" mode (pixel art + animation)
```

The UI drives the engine entirely through its public surface — chiefly
`GF.api.run(name, args)` (a discoverable command catalog; `GF.api.describe()`), plus
`GF.view`, `GF.doc`, `GF.filters`, `GF.retouch`, `GF.exporter`. That same API makes the
whole app scriptable by an automated agent. The engine depends on the UI only through a
tiny 6-method `GF.ui` contract.

The former two-mode iframe shell is preserved as `legacy-shell.html`; `texture/` and
`sprite/` remain fully functional and open standalone from the **More → Modes** panel.

## Verifying

```bash
node texture/tests/run.js     # core engine logic (pure, headless)
# headless boot / smoke:
google-chrome-stable --headless=new --screenshot=out.png file://$PWD/index.html
```
