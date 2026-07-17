# PixelTriks Plugins

PixelTriks is buildless, and so are its plugins: a plugin is **one ES module**
whose default export receives the global `GF` namespace. No bundler, no
manifest file — a JS object literal *is* the manifest.

```js
// my-plugin.js
export default function (GF) {
  GF.commands.register({
    id: 'myplugin.posterize4',            // namespace your ids
    title: 'Posterize to 4 colors',       // shown in the palette
    group: 'Plugins',                     // palette group header
    when: 'docOpen',                      // context gate (optional)
    run: () => GF.api.run('cleanColors', { colors: 4 }),
  });
  GF.commands.rebind('mod+shift+4', 'myplugin.posterize4');   // optional shortcut
}
```

## Loading

- **UI:** ⌘K → "Controls & plugins…" → Plugins → paste a URL → *Add & load*.
- **Console:** `GF.plugins.add('./plugins/hello.js')` (or any `https://` URL).
- Loaded URLs persist in localStorage and re-load on every boot, after all
  built-in commands are registered.

**Security:** loading a plugin executes its code with full access to the app
and your images. Only load plugins you trust.

## What a plugin can reach

| Surface | API | Effect |
|---|---|---|
| Command palette | `GF.commands.register({id, title, group, when?, run})` | Appears immediately, searchable |
| Keyboard | `GF.commands.rebind(sig, id)` — `'mod+shift+x'`, `'g'`, `']'` | Dispatched by the shared key handler |
| Gamepad | `GF.gamepad.setBinding('Y', id)` | Any face/shoulder/d-pad button |
| Engine ops | `GF.api.run(name, args)` / `GF.api.register(...)` | The 60+ engine command catalog (see API.md) |
| Context gates | `when: 'docOpen && !mode3d'` | Keys: docOpen, mode3d, selectionActive, has3dSelection, painting, textTool, animPlaying |
| Transforms | `GF.commands.execute('transform.nudge', {dx, dy})` etc. | Same verbs as the Transform Pad + gamepad |
| Everything else | `GF.doc / GF.layers / GF.filters / GF.scene3d / GF.select / …` | The full engine (see ARCHITECTURE.md) |

Registering a **duplicate id throws** — namespace your ids (`myplugin.*`).
`GF.commands.rebind` overwrites an existing key on purpose (user-level
override); `GF.commands.bind` throws on collisions (boot-integrity path) —
plugins should use `rebind`.

## Sample

`plugins/hello.js` in this repo registers one command and one shortcut in
seven lines. Start there.
