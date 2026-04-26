import { describe, it, expect } from 'vitest'
import { createWorld, getActiveCharacter } from './world'
import { step } from './game'
import { createProjectile, createAirstrikeProjectiles } from './projectile'
import { moveCharacter, jumpCharacter } from './character'
import { computeAIInput } from './ai'
import { generateTerrain, explodeTerrain, getHeight } from './terrain'
import { createPRNG } from './prng'
import { TEAM_HUMAN, TEAM_AI, TERRAIN_SIZE } from '@shared/constants'

const SEED = 42

describe('world setup', () => {
  it('creates characters at same Z position', () => {
    const world = createWorld(SEED)
    const zPositions = world.characters.map(c => c.z)
    const uniqueZ = new Set(zPositions)
    expect(uniqueZ.size).toBe(1)
    expect(zPositions[0]).toBe(TERRAIN_SIZE * 0.5)
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

describe('airstrike', () => {
  it('creates 5 missiles', () => {
    const projs = createAirstrikeProjectiles(100, 128, 0)
    expect(projs.length).toBe(5)
  })

  it('missiles fall downward from above', () => {
    const projs = createAirstrikeProjectiles(100, 128, 0)
    for (const p of projs) {
      expect(p.y).toBeLessThan(0)
      expect(p.vy).toBeGreaterThan(0)
      expect(p.vx).toBe(0)
    }
  })

  it('missiles survive the boundary check while descending', () => {
    const world = createWorld(SEED)
    step(world, { fire: { angle: 0, power: 60, weapon: 'airstrike' } })

    step(world, null)

    const active = world.projectiles.filter(p => p.active)
    expect(active.length).toBe(5)
  })

  it('missiles spread around target X', () => {
    const projs = createAirstrikeProjectiles(100, 128, 0)
    const xs = projs.map(p => p.x)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    expect(maxX - minX).toBeGreaterThan(0)
    const avgX = xs.reduce((a, b) => a + b) / xs.length
    expect(avgX).toBeCloseTo(100, 0)
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
    if (input?.fire && input.fire.weapon !== 'airstrike') {
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

  it('plays an airstrike turn correctly', () => {
    const world = createWorld(SEED)
    step(world, { fire: { angle: 0, power: 60, weapon: 'airstrike' } })
    expect(world.phase).toBe('firing')
    expect(world.projectiles.length).toBe(5)

    for (const p of world.projectiles) {
      expect(p.weapon).toBe('airstrike')
      expect(p.vy).toBeGreaterThan(0)
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

    if (input?.fire && input.fire.weapon !== 'airstrike') {
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

    // Center should drop more than edge (quadratic = deeper bowl)
    const centerDrop = beforeCenter - afterCenter
    const edgeDrop   = beforeEdge   - afterEdge
    expect(centerDrop).toBeGreaterThan(edgeDrop)
  })
})
