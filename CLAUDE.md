# Pixeltriks: Humans vs AI

**Vibe Jam 2026 entry.** Turn-based 3D artillery game (Worms-style). Pure browser, no login, <200KB, instant load.

**Stack:** TypeScript, Vite, Vitest, Three.js, WebSocket (ws)

**Deadline:** May 1, 2026 @ 13:37 UTC

---

## Commands

- `npm run dev` — start Vite dev server (client)
- `npm run dev:server` — start WebSocket game server
- `npm run build` — production build
- `npm run test` — run sim test suite (vitest)
- `npm run typecheck` — tsc --noEmit

---

## Architecture

```
src/
├── sim/          Pure deterministic simulation — zero DOM, zero Three.js
│   ├── game.ts   Main step(world, input) → StepEvents loop
│   ├── character.ts  Physics: move, jump, fall damage, water death
│   ├── projectile.ts 6 weapons, trajectory, explosion, knockback
│   ├── terrain.ts    256×256 heightmap, generation, explosion carving
│   ├── turn.ts       Phase state machine (aim → firing → resolving → between_turns)
│   ├── ai.ts         Trajectory search, 3 difficulty levels
│   ├── world.ts      WorldState factory, FNV-1a hash for desync detection
│   └── prng.ts       Mulberry32 seeded PRNG
├── client/       Three.js renderer + input + audio + networking
│   ├── main.ts   Game loop, menu, app state machine
│   ├── camera.ts Smooth follow camera
│   ├── input.ts  Keyboard + mouse input
│   ├── audio.ts  Procedural Web Audio (zero file downloads)
│   ├── net.ts    WebSocket client
│   ├── aiController.ts  Local AI turn execution
│   ├── render/
│   │   ├── terrainRenderer.ts   BufferGeometry heightfield, vertex colors
│   │   ├── characterRenderer.ts Capsule + box procedural geometry
│   │   ├── projectileRenderer.ts InstancedMesh spheres
│   │   ├── explosionRenderer.ts  Particle burst + point light
│   │   ├── waterRenderer.ts      Animated plane shader
│   │   ├── skyRenderer.ts        Gradient background
│   │   └── aimRenderer.ts        Trajectory preview dots
│   └── ui/
│       ├── hud.ts           Health bars, timer, weapon display
│       └── touchControls.ts Mobile button overlay
├── server/       WebSocket game server (Node/tsx)
│   └── index.ts  Room management, server-authoritative sim
└── shared/
    ├── constants.ts  Physics, terrain, game tuning values
    ├── types.ts      WorldState, GameInput, StepEvents
    └── net.ts        WebSocket message protocol
```

**Key invariant:** `sim/` is a pure function. `step(world, input) → events`. No browser APIs. Runs identically on server and in tests. This is the multiplayer foundation.

---

## Art Direction

**Style:** Low-poly flat shading + toon outlines. Zero texture files — all procedural vertex colors.

**Color Palette (6 core + 2 accent):**
- Sky: `#1a2a4a` → `#4a6fa5` gradient
- Terrain top (grass): `#4a7c3f`
- Terrain mid (dirt): `#8b5a2b`
- Terrain base (rock): `#5a5a6a`
- Water: `#1a3a5c` (animated, semi-transparent)
- Team A (Human): `#3a8fff` blue
- Team B (AI): `#ff4a3a` red
- Accent/explosion: `#ffaa22` orange

**Rendering approach:**
- `MeshToonMaterial` with `flatShading: true` for characters
- Vertex colors on terrain (`geometry.setAttribute('color', ...)`)
- `MeshPhongMaterial` with `flatShading: true` for terrain (vertex-colored)
- No texture samplers anywhere — keeps bundle <200KB

**Character design:** Procedural capsule body + box head + team-color material. No model files.

---

## Game Design

**Turn flow:** 25s aim phase → fire → projectile resolves → terrain deforms → knockback settles → 1.5s pause → next turn. Sudden death (rising water) after turn 20.

**Weapons (6 types):**
| Weapon    | Speed | Radius | Damage | Notes                        |
|-----------|-------|--------|--------|------------------------------|
| Bazooka   | 12    | 35     | 45     | Arc trajectory               |
| Grenade   | 10    | 30     | 40     | 3 bounces, 3s fuse           |
| Shotgun   | 20    | 15     | 25     | Hitscan, 2 shots             |
| Airstrike | 14    | 40     | 55     | Fast, high damage            |
| Teleport  | 18    | 0      | 0      | Relocate character           |
| Dynamite  | 2     | 50     | 70     | Dropped at feet, huge blast  |

**Teams:** 3 characters per team, 100 HP each.

**Power-ups:** Airdropped crates every 5s (max 3 on map). Contents: extra time, skip turn, double damage, health pack, bomb trap.

**AI:** 36 angles × 5 power levels × 4 weapons = 720 candidates/turn. Noise-based difficulty (easy ±0.4 rad, hard ±0.05 rad).

---

## Multiplayer

Server-authoritative: server runs `step()`, broadcasts world state. Clients send `GameInput` on their turn only.

- Room codes: 4-char alphanumeric
- Auto-AI fallback if no second player joins within 15s
- Protocol: see `shared/net.ts`

---

## Performance Budget

- Bundle target: <200KB gzipped (Three.js tree-shaken + zero assets)
- Draw calls: <100/frame
- Mobile: 30fps minimum on Safari iOS (test this weekly)
- Terrain update: position attribute swap, not geometry rebuild

---

## Vibe Jam Compliance

| Requirement       | Status                                    |
|-------------------|-------------------------------------------|
| New game (post 4/1) | ✅ Fresh codebase                        |
| 90%+ AI code      | ✅ Claude Code throughout                 |
| Web only          | ✅ Vite + CF Pages                        |
| No login/signup   | ✅ Room codes only                        |
| Instant load      | ✅ <200KB, zero asset files               |
| Widget script     | ✅ `vibej.am/2026/widget.js` in index.html|
| Multiplayer       | ✅ 2-player WebSocket rooms               |
| Three.js          | ✅                                        |
| Portal/webring    | ⚠️ Exit portal needed (query param link) |

---

## Conventions

- Verify before building — check paths and file existence before writing code
- Run `npm run test` after sim changes
- Run `npm run typecheck` before any commit
- Keep sim/ pure — no DOM, no Three.js, no browser APIs
- Keep bundle lean — no new npm deps without justification
- One concern per commit, small focused changes
