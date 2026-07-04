# PixelTriks — Agent API Reference

PixelTriks exposes every tool through a single JavaScript command catalog.
Agents (browser automation, MCP tools, LLM-driven scripts) drive the app
by calling `GF.api.run(name, args)` in the page context.

## Quick Start

```javascript
// Discover all commands
GF.api.describe()   // → [{name, params, doc}, ...]

// Run a command
GF.api.run('newDoc', { w: 1024, h: 1024, bg: 'white' })

// Inspect current state
GF.api.state()      // → { doc, layers, selection, tool, history }

// Get a PNG screenshot of the canvas
GF.api.snapshot()   // → data:image/png;base64,...

// Get one layer as PNG
GF.api.layerPng(layerId)  // → data:image/png;base64,...
```

Every `run()` call auto-refreshes the UI — agents never need to touch the DOM.

## Commands

### Document & Layers

| Command | Params | Description |
|---------|--------|-------------|
| `newDoc` | `w, h, bg?("white"\|"black")` | Create a document |
| `resize` | `w, h, scale?(bool)` | Resize the canvas |
| `addLayer` | `name?` | Add an empty layer |
| `duplicateLayer` | — | Duplicate the active layer |
| `deleteLayer` | — | Delete the active layer |
| `setActiveLayer` | `id` | Make a layer active |
| `setLayer` | `name?, visible?, opacity?(0-1), blend?, x?, y?` | Set layer properties |
| `mergeDown` | — | Merge active into the one below |
| `flatten` | — | Flatten all layers |

### Non-Destructive Editing

| Command | Params | Description |
|---------|--------|-------------|
| `addMask` | `init?("reveal"\|"selection")` | Add a layer mask |
| `removeMask` | — | Remove the mask |
| `invertMask` | — | Invert the mask |
| `applyMask` | — | Bake mask into pixels |
| `maskEdit` | `on?(bool)` | Toggle mask painting mode |
| `addAdjustment` | `kind, params?` | Add an adjustment layer |
| `setAdjust` | `params(obj)` | Update adjustment parameters |
| `curves` | `curves(obj), newLayer?(bool)` | Apply tone curves |

### Selection

| Command | Params | Description |
|---------|--------|-------------|
| `wandSelect` | `x, y, tolerance?, contiguous?, mode?` | Magic wand at a point |
| `selectRect` | `x, y, w, h, mode?` | Rectangular selection |
| `selectAll` | — | Select everything |
| `deselect` | — | Clear selection |
| `invertSelection` | — | Invert the selection |
| `growSelection` | `px` | Dilate the selection |
| `featherSelection` | `px` | Soften edges |
| `eraseSelection` | `defringe?(bool)` | Erase selected pixels |
| `layerViaCopy` | — | Copy selection to new layer |

### Painting & Drawing

| Command | Params | Description |
|---------|--------|-------------|
| `paint` | `points([[x,y],...]), color?, size?, erase?` | Stroke a polyline |
| `fillAt` | `x, y, color?, tolerance?` | Flood fill |
| `text` | `text, x, y, size?, color?, font?` | Render text to layer |
| `setBrushShape` | `shape("round"\|"square"\|"line"), pixel?` | Switch brush head |

### Retouch & Filters

| Command | Params | Description |
|---------|--------|-------------|
| `contentAwareFill` | — | Rebuild selected region from surroundings |
| `removeBackground` | `tolerance?, defringe?` | Auto-remove background |
| `colorReplace` | `from([r,g,b]), to?, tol?, dH?, dS?, dL?` | Replace/shift a color |
| `layerFX` | `kind, color?, size?, angle?, depth?` | Layer effect (outline, glow, shadow, bevel, emboss) |
| `inkOutline` | `sensitivity?, thickness?, color?` | Edge-detect ink outlines |
| `cleanColors` | `colors?, sharpen?, defringe?, splitLayers?` | Quantize to flat colors |
| `cutToLayer` | `cut?, bevel?` | Cut selection to its own layer |
| `smartUpscale` | `factor(2\|4), mode?("pixel"\|"photo")` | Upscale the document |
| `filter` | `name("grayscale"\|"invert"\|"blur"\|"sharpen"\|"edge"\|"autoLevels")` | One-shot filter |
| `brightnessContrast` | `brightness(-100..100), contrast(-100..100)` | Adjust B/C |
| `hsl` | `h(-180..180), s(-100..100), l(-100..100)` | Hue/Saturation/Lightness |

### Transform

| Command | Params | Description |
|---------|--------|-------------|
| `flipLayer` | `horizontal?(bool)` | Flip the active layer |
| `rotateLayer` | `cw?(bool)` | Rotate 90° |
| `trim` | — | Crop to visible content |
| `undo` | — | Undo (routes to 2D or 3D stack) |
| `redo` | — | Redo |

### Texture & Procedural

| Command | Params | Description |
|---------|--------|-------------|
| `generate` | `kind(clouds\|wood\|marble\|bricks\|checker\|gradient\|stone\|metal\|grass\|rust), asLayer?` | Procedural texture |

### 3D Scene

| Command | Params | Description |
|---------|--------|-------------|
| `scene3d.enter` | — | Ensure the 3D engine is booted (auto-boots on load) |
| `scene3d.exit` | — | Leave 3D (back to image editing) |
| `scene3d.addPrimitive` | `kind(sphere\|box\|cylinder\|cone\|...)` | Add a 3D primitive |
| `scene3d.importModel` | `url, name?` | Import a GLB/GLTF |
| `scene3d.list` | — | List scene objects |
| `scene3d.setObject` | `id, px?, py?, pz?, rx?, ry?, rz?, sx?, sy?, sz?, scale?` | Transform an object |
| `scene3d.setMaterial` | `id, mapSource?, color?, roughness?, metalness?` | Set material properties |
| `scene3d.snapshotToLayer` | — | Render 3D to a 2D layer |
| `scene3d.exportGLB` | `selection?("scene"\|"selected")` | Export as GLB |
| `scene3d.gizmo` | `mode?("translate"\|"rotate"\|"scale"), space?("world"\|"local")` | Set gizmo mode/space |

### 2D → 3D Converters

| Command | Params | Description |
|---------|--------|-------------|
| `make3d.list` | — | List available converters |
| `make3d.run` | `key, ...options` | Run a converter |
| `make3d.cutout` | `depth?, bevel?` | Extrude cutout from image |
| `make3d.relief` | `depth?, detail?` | Relief map (brightness → height) |
| `make3d.lathe` | `segments?` | Spin silhouette into 3D |
| `make3d.layers` | `gap?` | Layer stack diorama |
| `make3d.svg` | `depth?` | Extrude SVG vector paths into 3D |
| `make3d.text3d` | `depth?, size?` | Extrude typed text into 3D (font TBD) |

### Publishing & Export

| Command | Params | Description |
|---------|--------|-------------|
| `publish.page` | `title?, background?, color?, autoRotate?` | Download interactive web page |
| `exportLayers` | `type?, scale?, quality?` | Export every layer separately |
| `copyToClipboard` | — | Copy composite image to clipboard as PNG (Ctrl+Shift+C) |

### Animation

| Command | Params | Description |
|---------|--------|-------------|
| `animation.play` | — | Play the animation |
| `animation.pause` | — | Pause the animation |
| `animation.stop` | — | Stop and rewind to start |
| `animation.setTime` | `time(seconds)` | Scrub to a specific time |
| `animation.setDuration` | `seconds` | Set animation duration |
| `animation.recordKeyframe` | `objectId` | Record pos/rot/scale at current time |
| `animation.addKeyframe` | `objectId, time, property, value` | Add a specific keyframe |
| `animation.getKeyframes` | `objectId?` | List keyframes |

### Asset Library

| Command | Params | Description |
|---------|--------|-------------|
| `assets.list` | `type?("model"\|"texture"\|"hdri"\|"material")` | List assets in the library |
| `assets.count` | `type?` | Count assets by type |
| `assets.search` | `query` | Search assets by name or tag |
| `assets.remove` | `id` | Remove an asset from the library |

### Procedural Materials

| Command | Params | Description |
|---------|--------|-------------|
| `materials.listPresets` | — | List 15 available PBR material presets |
| `materials.generate` | `preset, width?(512), height?(512)` | Generate a material and store in library |
| `materials.generateAll` | — | Generate all 15 material presets at once |

Available presets: `wood, brushed-metal, rough-metal, stone, marble, brick, concrete, fabric, leather, rust, ceramic, grass, sand, checker, carbon`

### 3D Texture Painting

| Command | Params | Description |
|---------|--------|-------------|
| `paint3d.enter` | `objectId?` | Enter 3D paint mode on the selected object |
| `paint3d.exit` | — | Exit 3D paint mode |
| `paint3d.setBrush` | `color?, size?(1-200), opacity?(0-1), roughness?(-1 to 1)` | Set 3D paint brush |
| `paint3d.clear` | — | Clear the 3D paint canvas |

### AI (Bring Your Own Key)

| Command | Params | Description |
|---------|--------|-------------|
| `aiGenerate` | `prompt?` | Run the configured AI provider |

## Agent Workflow Examples

### Create a textured 3D object

```javascript
// 1. Create a canvas and paint a texture
GF.api.run('newDoc', { w: 512, h: 512, bg: 'white' });
GF.api.run('generate', { kind: 'wood' });

// 2. Enter the 3D workspace and add a box
GF.api.run('scene3d.enter');
GF.api.run('scene3d.addPrimitive', { kind: 'box' });

// 3. The box auto-textures with the document — export it
GF.api.run('scene3d.exportGLB', {});
```

### Batch image processing

```javascript
// Apply filters and export
GF.api.run('newDoc', { w: 800, h: 600 });
GF.api.run('brightnessContrast', { brightness: 10, contrast: 20 });
GF.api.run('filter', { name: 'sharpen' });
const png = GF.api.snapshot(1);  // full-res PNG data URL
```

### Inspect and manipulate a 3D scene

```javascript
// List all objects
const objects = GF.api.run('scene3d.list');
// objects → [{id, name, kind, visible, selected}, ...]

// Transform the first object
GF.api.run('scene3d.setObject', { id: objects[0].id, ry: 45, scale: 1.5 });

// Change its material
GF.api.run('scene3d.setMaterial', { id: objects[0].id, color: '#ff6600', metalness: 0.8 });
```

## Introspection

```javascript
GF.api.describe()    // Full catalog: [{name, params, doc}, ...]
GF.api.state()       // {doc: {open, name, width, height}, layers: [...], selection: {count, bounds}, tool, history}
GF.api.snapshot(0.5) // Half-res PNG preview
GF.api.layerPng(id)  // One layer as PNG
GF.api.commands()    // Palette-facing subset with UI metadata
```

## Primitives (28 types)

`sphere, box, roundedbox, cylinder, cone, pyramid, prism, capsule, hemisphere, torus, torusknot, pipe, tetrahedron, octahedron, dodecahedron, icosahedron, gem, plane, panel, disc, ring, tile, hex, curved, star, heart, arrow, steps`

## Adjustment Layer Kinds

`brightnessContrast, hsl, posterize, invert, grayscale, autoLevels, curves`

## Blend Modes (16)

`source-over (Normal), multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity`
