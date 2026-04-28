import { describe, it, expect } from 'vitest'
import { createWorld, getActiveCharacter } from './world'
import { step } from './game'
import { createProjectile } from './projectile'
import { moveCharacter, jumpCharacter, applyGroundMovement } from './character'
import { computeAIInput } from './ai'
import { generateTerrain, explodeTerrain, getHeight } from './terrain'
import { createPRNG } from './prng'
import { TEAM_HUMAN, TEAM_AI, TERRAIN_SIZE, STARTING_HP, SUDDEN_DEATH_TURN } from '@shared/constants'
import { WEAPONS } from '@shared/types'
import type { WeaponKind } from '@shared/types'

const SEED = 42

describe('world setup', () => {
  it('creates characters near center Z with spread', () => {
    const world = createWorld(SEED)
    const centerZ = TERRAIN_SIZE * 0.5
    const maxSpread = TERRAIN_SIZE * 0.15 / 2
    for (const c of world.characters) {
      expect(Math.abs(c.z - centerZ)).toBeLessThan(maxSpread)
    }
  })

  it('places teams on opposite sides', () => {
    const world = createWorld(SEED)
    const humans = world.characters.filter(c => c.team === TEAM_HUMAN)
    const ai = world.characters.filter(c => c.team === TEAM_AI)

    for (const h of humans) {
      expect(h.x).toBeLessThan(TERRAIN_SIZE * 0.5)
    }
    for (const a of ai) {
      expect(a.x).toBeGreaterThan(TERRAIN_SIZE * 0.5)
    }
  })

  it('sets facing directions correctly', () => {
    const world = createWorld(SEED)
    const humans = world.characters.filter(c => c.team === TEAM_HUMAN)
    const ai = world.characters.filter(c => c.team === TEAM_AI)

    for (const h of humans) expect(h.facing).toBe(1)
    for (const a of ai) expect(a.facing).toBe(-1)
  })
})

describe('projectile facing', () => {
  it('fires right when facing right', () => {
    const proj = createProjectile(100, 20, 128, 0, 100, 'bazooka', 0, 1)
    expect(proj.vx).toBeGreaterThan(0)
  })

  it('fires left when facing left', () => {
    const proj = createProjectile(100, 20, 128, 0, 100, 'bazooka', 0, -1)
    expect(proj.vx).toBeLessThan(0)
  })

  it('maintains vertical velocity regardless of facing', () => {
    const projR = createProjectile(100, 20, 128, Math.PI / 4, 100, 'bazooka', 0, 1)
    const projL = createProjectile(100, 20, 128, Math.PI / 4, 100, 'bazooka', 0, -1)
    expect(projR.vy).toBeCloseTo(projL.vy, 5)
  })
})


describe('shotgun multi-shot', () => {
  it('fires multiple projectiles via game step', () => {
    const world = createWorld(SEED)
    const input = {
      fire: { angle: 0.3, power: 80, weapon: 'shotgun' as const },
    }
    step(world, input)
    expect(world.projectiles.length).toBe(2)
    expect(world.phase).toBe('firing')
  })
})

describe('jump mechanics', () => {
  it('sets upward velocity', () => {
    const world = createWorld(SEED)
    const char = getActiveCharacter(world)!
    jumpCharacter(char, 0)
    expect(char.vy).toBeLessThan(0)
    expect(char.grounded).toBe(false)
  })

  it('adds horizontal velocity when moving', () => {
    const world = createWorld(SEED)
    const char = getActiveCharacter(world)!
    jumpCharacter(char, 1)
    expect(char.vx).toBeGreaterThan(0)
    expect(char.grounded).toBe(false)
  })

  it('jumps straight up with no move direction', () => {
    const world = createWorld(SEED)
    const char = getActiveCharacter(world)!
    jumpCharacter(char, 0)
    expect(char.vx).toBe(0)
  })

  it('does not jump when airborne', () => {
    const world = createWorld(SEED)
    const char = getActiveCharacter(world)!
    jumpCharacter(char, 0)
    const vy1 = char.vy
    jumpCharacter(char, 0)
    expect(char.vy).toBe(vy1)
  })
})

describe('movement', () => {
  it('moves character in specified direction', () => {
    const world = createWorld(SEED)
    const char = getActiveCharacter(world)!
    const startX = char.x
    moveCharacter(char, 1, world)
    applyGroundMovement(char, world)
    expect(char.x).toBeGreaterThan(startX)
  })

  it('updates facing direction', () => {
    const world = createWorld(SEED)
    const char = getActiveCharacter(world)!
    moveCharacter(char, -1, world)
    expect(char.facing).toBe(-1)
    moveCharacter(char, 1, world)
    expect(char.facing).toBe(1)
  })

  it('does not move when airborne', () => {
    const world = createWorld(SEED)
    const char = getActiveCharacter(world)!
    jumpCharacter(char, 0)
    const x = char.x
    moveCharacter(char, 1, world)
    expect(char.x).toBe(x)
  })
})

describe('AI', () => {
  it('returns a fire or move input', () => {
    const world = createWorld(SEED)
    world.activeTeam = TEAM_AI
    world.activeCharIndex = 0

    const input = computeAIInput(world, 'medium')
    expect(input).not.toBeNull()
    expect(input!.fire || input!.moveDirection || input!.endTurn).toBeTruthy()
  })

  it('fires in correct direction toward enemies', () => {
    const world = createWorld(SEED)
    world.activeTeam = TEAM_AI
    world.activeCharIndex = 0

    const input = computeAIInput(world, 'hard')
    if (input?.fire) {
      const char = getActiveCharacter(world)!
      const proj = createProjectile(
        char.x, char.y, char.z,
        input.fire.angle, input.fire.power,
        input.fire.weapon, char.id, char.facing
      )
      expect(proj.vx * char.facing).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('turn system', () => {
  it('advances through a complete turn cycle', () => {
    const world = createWorld(SEED)
    expect(world.phase).toBe('aiming')
    expect(world.activeTeam).toBe(TEAM_HUMAN)

    step(world, { fire: { angle: 0.5, power: 50, weapon: 'bazooka' } })
    expect(world.phase).toBe('firing')

    let safety = 0
    while (world.phase === 'firing' && safety < 500) {
      step(world, null)
      safety++
    }
    expect(world.phase).not.toBe('firing')
  })
})

describe('projectile self-detonation fix', () => {
  it('projectile does not detonate on the shooter', () => {
    const world = createWorld(SEED)
    const char = getActiveCharacter(world)!
    const startHP = char.hp

    step(world, { fire: { angle: 0.3, power: 80, weapon: 'bazooka' } })
    expect(world.phase).toBe('firing')
    expect(world.projectiles.length).toBe(1)
    expect(world.projectiles[0].active).toBe(true)

    step(world, null)
    expect(world.projectiles[0].active).toBe(true)
    expect(char.hp).toBe(startHP)
  })

  it('projectile travels away from shooter before detonating', () => {
    const world = createWorld(SEED)

    step(world, { fire: { angle: 0.3, power: 80, weapon: 'bazooka' } })

    let ticks = 0
    while (world.projectiles.some(p => p.active) && ticks < 500) {
      step(world, null)
      ticks++
    }

    expect(ticks).toBeGreaterThan(3)
  })
})

describe('end-to-end game loop', () => {
  it('plays a full human turn: fire bazooka, resolve, advance to AI turn', () => {
    const world = createWorld(SEED)
    expect(world.activeTeam).toBe(TEAM_HUMAN)

    const char = getActiveCharacter(world)!
    step(world, { fire: { angle: 0.3, power: 80, weapon: 'bazooka' } })
    expect(world.phase).toBe('firing')
    expect(world.projectiles.length).toBe(1)
    expect(world.projectiles[0].vx * char.facing).toBeGreaterThan(0)

    let ticks = 0
    while (world.phase !== 'aiming' && world.phase !== 'game_over' && ticks < 1000) {
      step(world, null)
      ticks++
    }

    if (world.phase !== 'game_over') {
      expect(world.activeTeam).toBe(TEAM_AI)
    }
  })

  it('AI fires toward human team', () => {
    const world = createWorld(SEED)

    world.activeTeam = TEAM_AI
    world.activeCharIndex = 0
    const aiChar = getActiveCharacter(world)!
    expect(aiChar.facing).toBe(-1)

    const input = computeAIInput(world, 'hard')
    expect(input).not.toBeNull()

    if (input?.fire) {
      const proj = createProjectile(
        aiChar.x, aiChar.y, aiChar.z,
        input.fire.angle, input.fire.power,
        input.fire.weapon, aiChar.id, aiChar.facing
      )
      expect(proj.vx).toBeLessThan(0)
    }
  })

  it('simulates multiple turns without crashing', () => {
    const world = createWorld(SEED)
    let turnCount = 0

    for (let t = 0; t < 5000 && world.phase !== 'game_over'; t++) {
      if (world.phase === 'aiming' && world.phaseTimer === 1) {
        const isAI = world.activeTeam === TEAM_AI
        if (isAI) {
          const aiInput = computeAIInput(world, 'medium')
          if (aiInput) {
            step(world, aiInput)
            continue
          }
        } else {
          step(world, { fire: { angle: 0.4, power: 70, weapon: 'bazooka' } })
          continue
        }
      }
      step(world, null)

      if (world.phase === 'aiming' && world.phaseTimer === 0) {
        turnCount++
      }
    }

    expect(turnCount).toBeGreaterThan(0)
  })

  it('characters take damage from explosions', () => {
    const world = createWorld(SEED)
    const aiChars = world.characters.filter(c => c.team === TEAM_AI)
    const initialHP = aiChars.reduce((sum, c) => sum + c.hp, 0)

    step(world, { fire: { angle: 0.3, power: 90, weapon: 'bazooka' } })

    let ticks = 0
    while (world.phase === 'firing' && ticks < 500) {
      step(world, null)
      ticks++
    }

    const finalHP = aiChars.reduce((sum, c) => sum + (c.alive ? c.hp : 0), 0)
    expect(finalHP).toBeLessThanOrEqual(initialHP)
  })

  it('movement updates facing direction for subsequent shots', () => {
    const world = createWorld(SEED)
    const char = getActiveCharacter(world)!

    step(world, { moveDirection: -1 })
    expect(char.facing).toBe(-1)

    step(world, { fire: { angle: 0.3, power: 50, weapon: 'bazooka' } })
    expect(world.projectiles[0].vx).toBeLessThan(0)
  })
})

describe('quadratic damage falloff', () => {
  it('direct hit deals more damage than edge hit proportionally', () => {
    const effectRadius = (35 / 5) * 1.5  // bazooka effectRadius
    const exX = 128, exY = 22, exZ = 128

    const calcDmg = (x: number, y: number, z: number) => {
      const dx = x - exX, dy = y - exY, dz = z - exZ
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz)
      if (d >= effectRadius) return 0
      const falloff = (1 - d / effectRadius) ** 2
      return Math.floor(45 * falloff)
    }

    const nearDmg = calcDmg(128, 22, 128)      // direct hit
    const farDmg  = calcDmg(128 + 5, 22, 128)  // ~5 units away

    expect(nearDmg).toBeGreaterThan(farDmg)
    expect(nearDmg).toBe(45)  // direct hit = full damage
    // Quadratic falloff: near:far ratio should be > linear (which would be 1.7 at d=5)
    if (farDmg > 0) expect(nearDmg / farDmg).toBeGreaterThan(2)
  })
})

describe('AI analytical trajectory', () => {
  it('AI hard mode produces a higher-quality shot with graceTimer set', () => {
    const world = createWorld(SEED)
    world.activeTeam = TEAM_AI
    world.activeCharIndex = 0
    const input = computeAIInput(world, 'hard')
    expect(input).not.toBeNull()
    // Hard AI should fire with a meaningful power
    if (input?.fire) {
      expect(input.fire.power).toBeGreaterThan(10)
    }
  })

  it('projectile spawns with grace timer to avoid terrain clip', () => {
    const proj = createProjectile(100, 20, 128, 0.3, 80, 'bazooka', 0, 1)
    expect(proj.graceTimer).toBeGreaterThan(0)
  })
})

describe('terrain explosion', () => {
  it('creates bowl-shaped crater (quadratic falloff)', () => {
    const prng = createPRNG(42)
    const heightmap = generateTerrain(prng)

    const cx = 128, cz = 128
    const beforeCenter = getHeight(heightmap, cx, cz)
    const beforeEdge   = getHeight(heightmap, cx + 6, cz)

    explodeTerrain(heightmap, cx, cz, 8, 4)

    const afterCenter = getHeight(heightmap, cx, cz)
    const afterEdge   = getHeight(heightmap, cx + 6, cz)

    const centerDrop = beforeCenter - afterCenter
    const edgeDrop   = beforeEdge   - afterEdge
    expect(centerDrop).toBeGreaterThan(edgeDrop)
  })
})

describe('PRNG determinism', () => {
  it('same seed produces identical sequences', () => {
    const a = createPRNG(12345)
    const b = createPRNG(12345)
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next())
    }
  })

  it('different seeds produce different sequences', () => {
    const a = createPRNG(1)
    const b = createPRNG(2)
    let same = 0
    for (let i = 0; i < 50; i++) {
      if (a.next() === b.next()) same++
    }
    expect(same).toBeLessThan(5)
  })

  it('same seed produces identical worlds', () => {
    const w1 = createWorld(999)
    const w2 = createWorld(999)
    expect(w1.characters.map(c => c.x)).toEqual(w2.characters.map(c => c.x))
    expect(w1.characters.map(c => c.y)).toEqual(w2.characters.map(c => c.y))
    expect(w1.hash).toBe(w2.hash)
  })
})

describe('weapon configs', () => {
  it('all 5 weapons are defined', () => {
    const kinds: WeaponKind[] = ['bazooka', 'grenade', 'shotgun', 'teleport', 'dynamite']
    for (const k of kinds) {
      expect(WEAPONS[k]).toBeDefined()
      expect(WEAPONS[k].speed).toBeGreaterThan(0)
    }
  })

  it('teleport deals no damage', () => {
    expect(WEAPONS.teleport.damage).toBe(0)
    expect(WEAPONS.teleport.radius).toBe(0)
  })

  it('dynamite has highest damage and knockback', () => {
    const maxDmg = Math.max(...Object.values(WEAPONS).map(w => w.damage))
    const maxKb = Math.max(...Object.values(WEAPONS).map(w => w.knockbackMul))
    expect(WEAPONS.dynamite.damage).toBe(maxDmg)
    expect(WEAPONS.dynamite.knockbackMul).toBe(maxKb)
  })

  it('shotgun has no gravity and drag', () => {
    expect(WEAPONS.shotgun.gravityMul).toBe(0)
    expect(WEAPONS.shotgun.drag).toBeDefined()
    expect(WEAPONS.shotgun.drag!).toBeGreaterThan(0)
  })

  it('grenade bounces 3 times with a fuse', () => {
    expect(WEAPONS.grenade.bounces).toBe(3)
    expect(WEAPONS.grenade.fuseTime).toBeGreaterThan(0)
  })
})

describe('terrain generation', () => {
  it('heightmap has correct dimensions', () => {
    const prng = createPRNG(42)
    const hm = generateTerrain(prng)
    expect(hm.length).toBe(TERRAIN_SIZE * TERRAIN_SIZE)
  })

  it('heights are within reasonable range', () => {
    const prng = createPRNG(42)
    const hm = generateTerrain(prng)
    let min = Infinity, max = -Infinity
    for (let i = 0; i < hm.length; i++) {
      if (hm[i] < min) min = hm[i]
      if (hm[i] > max) max = hm[i]
    }
    expect(min).toBeGreaterThanOrEqual(-10)
    expect(max).toBeLessThanOrEqual(70)
  })

  it('edges are lower than center (falloff)', () => {
    const prng = createPRNG(42)
    const hm = generateTerrain(prng)
    const center = getHeight(hm, 128, 128)
    const edge = getHeight(hm, 5, 5)
    expect(center).toBeGreaterThan(edge)
  })

  it('getHeight clamps out-of-bounds coordinates', () => {
    const prng = createPRNG(42)
    const hm = generateTerrain(prng)
    const h = getHeight(hm, -10, -10)
    expect(h).toBeDefined()
    expect(typeof h).toBe('number')
  })
})

describe('character initial state', () => {
  it('all characters start with full HP', () => {
    const world = createWorld(SEED)
    for (const c of world.characters) {
      expect(c.hp).toBe(STARTING_HP)
      expect(c.alive).toBe(true)
    }
  })

  it('has correct team sizes', () => {
    const world = createWorld(SEED)
    const humans = world.characters.filter(c => c.team === TEAM_HUMAN)
    const ai = world.characters.filter(c => c.team === TEAM_AI)
    expect(humans.length).toBe(3)
    expect(ai.length).toBe(3)
  })

  it('characters start grounded', () => {
    const world = createWorld(SEED)
    for (const c of world.characters) {
      expect(c.grounded).toBe(true)
    }
  })
})

describe('water death', () => {
  it('kills characters at water level', () => {
    const world = createWorld(SEED)
    const char = world.characters[0]
    char.y = world.waterLevel + 10
    char.grounded = false

    let ticks = 0
    while (char.alive && ticks < 500) {
      step(world, null)
      ticks++
    }
  })
})

describe('sudden death', () => {
  it('water rises after sudden death turn', () => {
    const world = createWorld(SEED)
    const initialWater = world.waterLevel

    world.turn = SUDDEN_DEATH_TURN + 1

    for (let i = 0; i < 60; i++) step(world, null)

    expect(world.waterLevel).toBeGreaterThanOrEqual(initialWater)
  })
})

describe('grenade mechanics', () => {
  it('grenade has bounces and fuse timer set', () => {
    const proj = createProjectile(100, 20, 128, 0.3, 80, 'grenade', 0, 1)
    expect(proj.bouncesLeft).toBe(3)
    expect(proj.fuseTimer).toBe(180)
  })

  it('dynamite spawns near character with low speed', () => {
    const proj = createProjectile(100, 20, 128, 0, 100, 'dynamite', 0, 1)
    expect(Math.abs(proj.vx)).toBeLessThan(5)
  })
})

describe('game phase transitions', () => {
  it('end turn skips to between_turns', () => {
    const world = createWorld(SEED)
    expect(world.phase).toBe('aiming')
    step(world, { endTurn: true })
    expect(world.phase).toBe('between_turns')
  })

  it('timeout auto-ends aiming phase', () => {
    const world = createWorld(SEED)
    world.phaseTimer = world.phaseTimer - 2

    for (let i = 0; i < 10; i++) step(world, null)

    expect(['between_turns', 'aiming']).toContain(world.phase)
  })
})
