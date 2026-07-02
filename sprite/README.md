# Forge Studio — Sprite

The **Sprite** mode of [Forge Studio](../README.md) (formerly PixelForge): a self-contained pixel-art animation and asset-pipeline studio — no install, no build step, no server, no dependencies. Built for the generate → isolate → animate → export workflow used in AI-assisted game asset production. Normally opened through Forge Studio (`../index.html`); `index.html` here also runs standalone.

## Quick start

1. Unzip anywhere and open `index.html` (double-click works; it runs from `file://`).
2. Draw on the canvas, add frames on the timeline, press **P** to play.
3. **Export → Sprite sheet + atlas JSON** produces a packed PNG and an Aseprite-compatible atlas your game loads directly.

The forge viewport in the header always plays your current animation range while you work.

## What it does

**Draw & animate.** Pencil, eraser, flood fill, line, eyedropper, move — all selection-aware. Layers with visibility, reordering, and renaming. Frame timeline with duplicate/delete, onion skinning, adjustable fps, and named animation tags (`walk`, `idle`, `attack`) that travel into the exported atlas.

**Isolate regions (the segmentation workflow).** The magic wand (**W**) selects a contiguous region; Shift-click selects that color everywhere. **Isolate → layer** splits the selection onto its own layer — exactly the "segment a generated character into parts" step, so you can edit, move, recolor, or replace a part without touching the rest. Research consistently shows post-hoc segmentation of stylized art is unreliable, so Sprite mode makes isolation a first-class manual operation you control.

**Recolor variants.** **Recolor** remaps one palette color to another across every frame and layer in two clicks — instant enemy variants, team colors, or seasonal skins from one source sprite. **From sprite** rebuilds the palette from the pixels actually in use.

**Import anything.** Drag and drop a PNG (imported as a layer, or sliced as a sprite sheet with any frame size) or a saved project file. A fresh project adopts an imported sheet's frame size automatically.

**Export for games.** Row-packed sprite sheet PNG plus an atlas JSON in Aseprite's `json-array` format — `frames[]` with per-frame rects and durations, `meta.frameTags` with your animation ranges. Any loader that reads Aseprite output reads Sprite-mode output.

**AI Bridge.** Call any image-generation API — PixelLab, Retro Diffusion, a local ComfyUI — straight from the studio: set URL, method, headers (your API key goes here and lives only in memory for the session), and body. Every image in the response (data URLs, image links, raw base64) is detected and offered for one-click import as a layer or sliced sheet. Generation stays vendor-agnostic: when you switch providers, only the request changes.

### CORS proxy

Browsers block some APIs from web pages. If a request fails with a CORS error:

```
node tools/proxy.js          # listens on http://localhost:8787
```

then prefix the URL in the AI Bridge with `http://localhost:8787/?url=`. The proxy forwards method, body, `Content-Type`, `Authorization`, `Accept`, and `X-Api-Key`, binds to localhost only, and has zero dependencies.

## Keyboard shortcuts

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| B | Pencil | V | Move selection/layer |
| E | Eraser | I | Eyedropper |
| G | Fill | H / hold Space | Pan |
| L | Line | P | Play / stop |
| W | Magic wand | , / . | Previous / next frame |
| Shift+W click | Select color globally | [ / ] | Zoom out / in |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo | Ctrl+S | Save project file |
| Esc | Clear selection / close dialog | Mouse wheel | Zoom to cursor |

## Using the export in a game (canvas/JS)

```js
async function loadSprite(base) {
  const [atlas, img] = await Promise.all([
    fetch(base + '.json').then(r => r.json()),
    new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej;
      i.src = base + '.png';
    })
  ]);
  const tags = {};
  for (const t of atlas.meta.frameTags) tags[t.name] = t;
  return { img, frames: atlas.frames, tags };
}

// Advance with sprite.frames[i].duration (ms); draw a frame with:
function drawFrame(ctx, sprite, i, x, y) {
  const f = sprite.frames[i].frame;
  ctx.drawImage(sprite.img, f.x, f.y, f.w, f.h, x, y, f.w, f.h);
}
```

Loop a tag by cycling `i` from `tags.walk.from` to `tags.walk.to`. This drops into the Eldervale codebase (or any canvas game) without libraries.

## The pipeline this app implements

1. **Generate** a character or sheet with any AI tool (or draw it).
2. **Import** it — sliced into frames if it's a sheet.
3. **Isolate** regions to layers with the wand; fix or replace parts independently.
4. **Animate** with frames + tags; **recolor** for variants.
5. **Export** sheet + atlas; load it with the snippet above.
6. **Regenerate** any time: re-import, re-export — the atlas is the stable contract, so game code never changes.

## Testing

```
node tests/run.js     # 38 assertions: core logic (fill, wand, packing, atlas, RLE, serialization)
node tests/smoke.js   # 21 assertions: the real app driven headlessly (draw, undo, frames, tags,
                      #                atlas export, region isolation, AI response scanning)
```

Both suites pass on Node 18+. The core module (`js/core.js`) is pure and dependency-free, which is what makes the app testable without a browser.

## Platform — shared asset library

Forge Studio's **Sprite** and **Texture** modes plus **World Engine** share one
local asset library (`~/Desktop/game-assets/`): Sprite mode makes sprites,
Texture mode makes textures/materials, and World Engine consumes both to build
worlds.

Because a page opened from `file://` can't write to disk, publishing goes through
the **Asset Hub** — a tiny zero-dependency Node server that owns the library.

```bash
cd ~/Desktop/game-assets && npm start     # Asset Hub on http://localhost:8788
```

Then use **Export → Save to Library (Asset Hub)**. It uploads the sprite as one
asset: the packed **sheet PNG** plus its **Aseprite `json-array` atlas**, with
frame size, fps, and animation tags recorded in the manifest. World Engine reads
that frame metadata to place the sprite as a camera-facing **billboard** in the
3D world (Breath of Fire 3 style), cropping the sheet to the first frame.

The hub URL defaults to `http://localhost:8788`; override with
`localStorage.setItem('pf.hubUrl', '…')`. This reuses the same upload mechanism
as the CORS proxy precedent in `tools/proxy.js`.

## Project structure

```
pixelforge/
├── index.html        app shell
├── css/style.css     forge theme, responsive to mobile
├── js/core.js        pure logic: fill, wand, masks, packing, atlas, RLE, project files
├── js/app.js         UI, tools, timeline, import/export, AI Bridge
├── tools/proxy.js    optional zero-dependency CORS proxy for the AI Bridge
└── tests/            run.js (core) + smoke.js (app, headless)
```

## Design notes

- **Nothing is stored in the browser.** Projects save to explicit `.pixelforge.json` files you keep; API keys exist only in the AI Bridge fields for the session. Predictable, portable, no surprises.
- Project files are versioned, validated on load, and RLE-compressed; malformed files fail with a specific message rather than a half-loaded project.
- Canvas size up to 512×512, sheets pack up to 4096px wide, undo history holds 64 steps.
