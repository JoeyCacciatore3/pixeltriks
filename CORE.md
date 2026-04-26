# Pixeltriks Artillery — Core Reference Document

The definitive reference for building "Blindfire" (the Vibe Jam 2026 entry) from
pixeltriks artillery's proven foundation. This documents what works, what carries
over conceptually, and what must be rebuilt from scratch in Three.js.

---

## Codebase Anatomy

**4,942 lines** across 3 packages, **141 tests** in 14 suites.

```
packages/
├── shared/   72 LOC  — Constants, types, protocol definitions
├── sim/    1,681 LOC  — Pure deterministic simulation (zero DOM)
│   ├── prng.ts        — Mulberry32 seeded PRNG (52 LOC)
│   ├── terrain.ts     — Uint8Array heightmap mask, generation, explosion carving (138 LOC)
│   ├── world.ts       — WorldState factory, FNV-1a hash for desync detection (78 LOC)
│   ├── blindman.ts    — Character physics: move, jump, climb, fall damage, water death (227 LOC)
│   ├── projectile.ts  — 6 weapon types, trajectory sim, explosion + knockback (213 LOC)
│   ├── turn.ts        — Phase state machine: aiming → firing → resolving → between_turns (72 LOC)
│   ├── game.ts        — Main step() loop integrating all systems (272 LOC)
│   ├── ai.ts          — AI opponent: trajectory search, difficulty noise, 3 levels (248 LOC)
│   ├── objects.ts     — Barrels + proximity mines with chain reactions (139 LOC)
│   ├── blindbox.ts    — Airdropped power-up crates (121 LOC)
│   └── rope.ts        — Ninja rope: fire, attach, pendulum swing (110 LOC)
└── client/ 3,189 LOC  — PixiJS renderer, input, audio, HUD
    ├── main.ts        — Game loop, input merge, AI execution, camera follow (525 LOC)
    └── render/        — 17 renderer modules (2,664 LOC total)
```

## Architecture — What's Proven

### 1. Sim/Client Separation (Carry Forward: Architecture Pattern)

The sim is a pure function: `step(world, input) → events`. Zero browser deps, runs
in Node for tests, can run on a server for authoritative multiplayer.

**Why this matters for Blindfire:** This exact pattern enables server-authoritative
multiplayer. The server runs `step()`, both clients render from the same world state.
Desync detection is already built via FNV-1a world hashing.

### 2. Deterministic Simulation (Carry Forward: Approach)

- Seeded PRNG (Mulberry32) — single uint32 state, trivial to serialize
- Fixed 60Hz timestep — render framerate independent
- No `Math.random()` anywhere in sim
- World hash verified per-turn for desync detection
- Tested: same seed + inputs → identical hash across runs

**Why this matters:** Lockstep multiplayer requires byte-identical simulation on
both clients. This is already solved and tested.

### 3. Event-Driven Rendering (Carry Forward: Pattern)

`step()` returns `StepEvents` — explosions, deaths, turn advances, etc. The client
consumes these for effects (particles, sound, screen shake) then discards them.
World state is the only persistent truth.

```typescript
interface StepEvents {
  explosions: ProjectileResult[]
  objectExplosions: ObjectExplosionResult[]
  blindboxCollected: BlindboxCollectResult[]
  deaths: number[]
  turnAdvanced: boolean
  gameOver: boolean
  blindboxSpawned: boolean
}
```

### 4. Input Protocol (Carry Forward: Concept)

Single `GameInput` interface per tick — this is the ONLY thing that needs to cross
the network for multiplayer:

```typescript
interface GameInput {
  moveDirection?: -1 | 0 | 1
  jump?: boolean
  fire?: { angle: number; power: number; weapon: WeaponKind }
  endTurn?: boolean
  ropeActivate?: { angle: number }
  ropeRelease?: boolean
  ropeExtend?: -1 | 0 | 1
}
```

**Network-ready:** During the aim phase, only the active player's inputs matter.
Server receives inputs from active player only, broadcasts to both.

---

## Game Mechanics — What's Proven Fun

### Turn Structure
- 25-second aim phase per turn
- Player moves character, aims, charges power (hold-release mechanic), fires
- Projectile flies → explodes → terrain destroyed → knockback applied → characters settle
- Between-turns pause (1.5s) → next player's turn
- Sudden death after turn 20: rising water level

### Weapon Balance (6 weapons, tested and tuned)

| Weapon    | Speed | Radius | Damage | Behavior                        |
|-----------|-------|--------|--------|---------------------------------|
| Bazooka   | 12    | 35     | 45     | Wind-affected, explode on contact |
| Grenade   | 10    | 30     | 40     | 3 bounces, 3s fuse              |
| Shotgun   | 20    | 15     | 25     | Hitscan, no gravity, 2 shots    |
| Airstrike | 14    | 40     | 55     | Fast, high damage, no wind      |
| Teleport  | 18    | 0      | 0      | Moves player to landing spot    |
| Dynamite  | 2     | 50     | 70     | Dropped at feet, huge blast     |

### Physics Constants (all tuned through playtesting)
- Gravity: 0.3 px/tick²
- Wind: ±0.25 px/tick² acceleration on projectiles
- Character speed: 1.5 px/tick
- Jump impulse: -6 px/tick
- Fall damage threshold: 8 px/tick velocity
- Knockback: distance-based falloff, up to 8px/tick
- Terrain climb: up to 4px height difference

### Power-Up System (Blindboxes)
- Airdropped every 5 seconds, max 3 on map
- 5 content types: extra time (+10s), skip opponent's turn, double damage, health pack (+25), bomb trap
- Weighted distribution: 25% extra time, 20% skip, 15% double damage, 20% health, 20% bomb

### Environmental Objects
- Explosive barrels (radius 30, damage 50) — chain reaction on hit
- Proximity mines (radius 25, damage 40) — trigger on character approach, 0.5s fuse

### AI Opponent (fallback when no second player)
- Trajectory search: 36 angle samples × 5 power levels × 4 weapons
- Scoring: +2× for enemy damage, -3× for friendly fire, +50 for kills
- 3 difficulty levels control aim noise (easy ±0.4rad, hard ±0.05rad)
- Pre-fire movement: walks away from nearby enemies
- Think delay (0.5s) + fire delay (0.33s) for natural feel

---

## What Must Change for Blindfire (3D + Multiplayer)

### Terrain: 2D Heightmap → 3D Heightfield

**Current:** `Uint8Array` binary mask (2560×720), pixel-level collision.
Air = 0, Solid = 1. Explosion carving loops over bounding box.

**Blindfire needs:** 3D heightfield mesh. The terrain is still fundamentally a
heightmap — just rendered as a displaced plane geometry in Three.js.

Key design decisions:
- Heightmap resolution: 256×256 grid is plenty for a small island
- Explosion carving: lower height values in radius around impact point
- Collision: raycast down from character position to find ground height
- Visual: vertex-colored or shader-driven (grass on top, rock on sides, dirt below)

**What carries over conceptually:**
- `generateHillyTerrain()` — summed sine waves with seeded phases/freqs/amps
- `explode()` — circle-based height reduction instead of mask clearing
- Version tracking for GPU re-upload (already designed for this)

### Characters: 2D Sprites → 3D Geometry

**Current:** AI-generated 48×48 sprites with 7 animation states, procedural
fallback (box head, suit body, blindfold).

**Blindfire needs:** Procedural 3D characters. Options:
1. **Capsule + accessories** — CapsuleGeometry body, sphere head, box limbs. Simple, fast, charming.
2. **Low-poly mesh** — hand-modeled look via code. More work, more personality.

Recommendation: Capsule characters. Zero loading time, distinctive enough with
team colors, and the "geometric character" look is a deliberate style choice that
judges will appreciate over broken model loading.

### Rendering: PixiJS Canvas → Three.js WebGL

**Current 17 render modules — mapping to 3D:**

| 2D Module        | 3D Equivalent                              |
|------------------|--------------------------------------------|
| terrain.ts       | PlaneGeometry + heightmap displacement      |
| sky.ts           | Skybox or gradient shader background        |
| water.ts         | Plane with animated shader (transparency)   |
| blindmen.ts      | Capsule/box geometry with team color mat     |
| projectiles.ts   | Small sphere + trail particles              |
| explosions.ts    | Particle burst + point light flash          |
| particles.ts     | THREE.Points or instanced small meshes      |
| objects.ts       | Cylinder (barrel) / disc (mine) geometry    |
| blindboxes.ts    | Box geometry + cone parachute               |
| aimline.ts       | Line3 + dots (InstancedMesh spheres)        |
| rope.ts          | Line geometry between anchor and character  |
| hud.ts           | HTML overlay or Canvas2D texture on quad    |
| floatingtext.ts  | HTML div overlay (CSS transform for 3D pos) |
| screenshake.ts   | Camera position perturbation                |
| parallax.ts      | Not needed — 3D depth handles this          |
| turntransition.ts| HTML overlay                                |
| debug.ts         | HTML overlay                                |

### Audio: OGG Files → Procedural Web Audio

**Current:** 16 OGG files loaded via Howler.js. This means asset downloads.

**Blindfire needs:** Zero file downloads for instant load. Go back to procedural
Web Audio API synthesis. The SoundManager architecture is fine — just swap Howler
for oscillator/noise generation.

Key sounds to synthesize:
- Explosion (3 sizes): noise burst + low sine sweep
- Weapon fire (4 types): short noise/sine with pitch variation
- UI sounds: simple sine beeps

### Multiplayer: Local → WebSocket Rooms

**Current:** Single-player with AI. Input protocol is already multiplayer-ready.

**Blindfire architecture:**
```
Client A ─┐
           ├── WebSocket ──→ Server (runs step()) ──→ broadcast state
Client B ─┘
```

- **Room system:** Create room → get 4-char code → share → opponent joins
- **Auto-match:** Queue of waiting players, server pairs them
- **Protocol:** Client sends `GameInput` on their turn, server validates + runs sim
- **Latency hiding:** 8-10s aim phase means latency is invisible
- **AI fallback:** If no second player after 15s, spawn AI opponent

**Server options (ranked by simplicity):**
1. **PartyKit** — WebSocket rooms with zero config, generous free tier
2. **Cloudflare Durable Objects** — pairs with existing CF Pages deploy
3. **Liveblocks** — managed WebSocket rooms, more features than needed

### Camera: 2D Viewport → 3D Orbit/Follow

**Current:** pixi-viewport with lerp-based follow (0.08 smoothing).

**Blindfire:**
- Fixed isometric or ~45° overhead angle
- Smooth follow active character during aim phase
- Track projectile in flight (with some lead)
- Snap to explosion impact point briefly
- No free orbit — keep it simple for the player

---

## Production Build Profile

**Current pixeltriks:**
- Bundle: ~400KB (PixiJS is heavy)
- Dependencies: pixi.js, pixi-viewport, howler
- Load time: ~1-2s on fast connection

**Blindfire target:**
- Bundle: <200KB (Three.js tree-shakes well, no Howler)
- Dependencies: three (only import what's used)
- Zero asset files — everything procedural
- Target: <1s full load on throttled 3G
- Critical: NO loading screens (Vibe Jam rule)

---

## Test Coverage to Rebuild

The sim test suite validates core mechanics. These tests should be adapted:

| Test Suite      | Tests | What It Validates                           |
|-----------------|-------|---------------------------------------------|
| determinism     | 4     | Same seed → same hash, PRNG reproducibility |
| blindman        | 19    | Movement, collision, fall damage, water death|
| projectile      | 15    | Trajectories, bouncing, explosion damage     |
| turn            | 10    | Phase transitions, win conditions, rotation  |
| game            | 8     | Full step() integration, event emission      |
| integration     | 12    | Multi-turn games, all weapons, sudden death  |
| objects         | 10    | Barrel/mine behavior, chain reactions        |
| blindboxes      | 12    | Drop, collection, power-up effects           |
| rope            | 18    | Fire, attach, swing, length, terrain collide |
| ai              | 8     | Decision quality, difficulty scaling          |

**Priority for Blindfire:** determinism, projectile, turn, game, integration.
Objects and blindboxes can come later. Rope is a stretch goal.

---

## Vibe Jam Compliance Checklist

| Requirement       | Pixeltriks Status          | Blindfire Plan                    |
|-------------------|----------------------------|-----------------------------------|
| New game (post 4/1)| Existed before ❌          | Fresh repo, all new code ✅       |
| 90%+ AI code      | Claude Code throughout ✅  | Same ✅                           |
| Web only          | CF Pages ✅                | CF Pages ✅                       |
| No login/signup   | None ✅                    | Room codes only ✅                |
| Instant load      | ~400KB + OGG files ⚠️     | <200KB, zero assets ✅            |
| No loading screen | None visible ✅            | Procedural everything ✅          |
| Widget script     | Not added ❌               | In index.html ✅                  |
| Portal/webring    | Not implemented ❌         | Exit portal with query params ✅  |
| Multiplayer       | AI only ❌                 | 2-player WebSocket ✅             |
| Three.js          | PixiJS ❌                  | Three.js vanilla ✅               |

---

## Formulas Reference (Copy-Paste Ready)

### Projectile Trajectory
```
vx += wind * WIND_MAX          // 0 if weapon not wind-affected
vy += GRAVITY * gravityMul     // weapon-specific gravity multiplier
x += vx
y += vy
```

### Explosion Damage Falloff
```
effectRadius = explosionRadius * 1.5
distance = sqrt(dx² + dy²)
falloff = 1 - (distance / effectRadius)
damage = floor(baseDamage * falloff)
knockbackForce = falloff * 8
knockbackAngle = atan2(dy, dx)
```

### Terrain Generation (Summed Sines)
```
5 octaves, each with seeded phase, frequency = (octave+1) * 1.5, amplitude = 1/(octave+1)
baseline = height * 0.55
amplitude = height * 0.22
columnHeight = baseline + sum(sin(x/width * 2π * freq + phase) * amp) * amplitude
```

### AI Trajectory Search
```
36 angle samples × 5 power levels × 4 weapons = 720 candidates per turn
For each: simulate up to 300 ticks of flight
Score: +2× enemy damage, -3× friendly damage, -5× self damage, +50 per kill
Apply difficulty noise to best candidate
```

### Fall Damage
```
if (landingVelocity > 8) damage = floor((velocity - 8) * 3)
```

---

## What NOT to Carry Over

1. **PixiJS anything** — entire client/render/ directory is PixiJS-specific
2. **Howler.js / OGG files** — violates instant load requirement
3. **2D heightmap mask** — replace with 3D heightfield
4. **Sprite assets** — no file loading at all
5. **Touch controls UI** — rebuild for 3D (different input paradigm)
6. **pixi-viewport** — Three.js has its own camera system

---

## Sprint Priority Order

For the 5-day build, implement in this order (each builds on the last):

1. **Scaffold + 3D terrain + camera** — the world exists and you can see it
2. **Characters on terrain + movement** — things walk around
3. **Projectiles + explosions + terrain destruction** — the core game loop works
4. **Turn system + HUD + win condition** — it's a playable game
5. **Multiplayer networking** — two humans can play
6. **Audio + particles + polish** — it feels good
7. **Deploy + widget + portal** — it's submitted

The sim logic (physics formulas, turn state machine, weapon configs) is the
intellectual property that transfers. Every line of rendering code is new.
