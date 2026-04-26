import { GRAVITY, TERRAIN_SIZE, KNOCKBACK_MAX, CHAR_SPEED } from '@shared/constants'
import type { WorldState, GameInput, WeaponKind, Character } from '@shared/types'
import { WEAPONS } from '@shared/types'
import { getHeight } from './terrain'
import { getActiveCharacter } from './world'
import { createPRNG } from './prng'

type Difficulty = 'easy' | 'medium' | 'hard'

const NOISE: Record<Difficulty, { angle: number; power: number }> = {
  easy: { angle: 0.35, power: 25 },
  medium: { angle: 0.12, power: 8 },
  hard: { angle: 0.04, power: 2 },
}

const PROJECTILE_WEAPONS: WeaponKind[] = ['bazooka', 'grenade', 'shotgun', 'dynamite']
const POWER_SAMPLES = 5
const MAX_SIM_TICKS = 300

// Analytically solves the two launch angles needed to hit target at (dx, dy) at given speed.
// dx = horizontal distance (positive), dy = target.y - spawnY in y-down coords (positive = target below spawn).
// gravity = GRAVITY * weapon.gravityMul. Returns 0, 1, or 2 valid angles.
function solveAngles(dx: number, dy: number, speed: number, gravity: number): number[] {
  if (dx <= 0) return []
  if (gravity <= 0) {
    // No arc: aim directly at target
    return [-Math.atan2(dy, dx)]
  }
  const k = gravity * dx * dx / (2 * speed * speed)
  const discriminant = dx * dx - 4 * k * (k - dy)
  if (discriminant < 0) return []
  const sqrtD = Math.sqrt(discriminant)
  const angles: number[] = []
  for (const sign of [-1, 1] as const) {
    const u = (dx + sign * sqrtD) / (2 * k)
    const a = Math.atan(u)
    if (Number.isFinite(a)) angles.push(a)
  }
  return angles
}

interface ShotCandidate {
  weapon: WeaponKind
  angle: number
  power: number
  azimuth: number
  score: number
}

interface MoveCandidate {
  targetX: number
  score: number
  steps: number
  needsJump?: boolean
}

export function computeAIInput(
  world: WorldState,
  difficulty: Difficulty = 'medium'
): GameInput | null {
  const char = getActiveCharacter(world)
  if (!char) return null

  const prng = createPRNG(world.prngState + world.tick)
  const enemies = world.characters.filter(c => c.team !== char.team && c.alive)
  if (enemies.length === 0) return null

  const nearestEnemy = findNearest(char, enemies)
  const nearDist = dist(char, nearestEnemy)

  const bestShot = findBestShot(char, world)
  const bestAirstrike = scoreAirstrike(char, world)
  const bestMove = evaluateMovement(char, world, difficulty)

  const useAirstrike = bestAirstrike &&
    (!bestShot || bestAirstrike.score > bestShot.score * 1.2)

  if (bestMove && bestMove.score > 0 && bestMove.targetX !== char.x) {
    const shotScore = useAirstrike
      ? (bestAirstrike?.score ?? 0)
      : (bestShot?.score ?? 0)

    if (bestMove.score > shotScore * 0.15 || shotScore <= 0) {
      const dir = bestMove.targetX > char.x ? 1 : -1
      if (bestMove.needsJump && char.grounded) {
        return { jump: true }
      }
      return { moveDirection: dir as -1 | 1 }
    }
  }

  // Azimuth for airstrike: face toward nearest enemy
  const airstrikeAz = nearestEnemy.x > char.x ? 0 : Math.PI

  if (useAirstrike && bestAirstrike) {
    const noise = NOISE[difficulty]
    return {
      fire: {
        angle: 0,
        power: Math.max(10, Math.min(100,
          bestAirstrike.power + prng.nextFloat(-noise.power, noise.power)
        )),
        weapon: 'airstrike',
        azimuth: airstrikeAz,
      },
    }
  }

  if (bestShot && bestShot.score > 0) {
    const noise = NOISE[difficulty]
    return {
      fire: {
        angle: bestShot.angle + prng.nextFloat(-noise.angle, noise.angle),
        power: Math.max(10, Math.min(100,
          bestShot.power + prng.nextFloat(-noise.power, noise.power)
        )),
        weapon: bestShot.weapon,
        azimuth: bestShot.azimuth,
      },
    }
  }

  if (nearDist < 20) {
    const awayDir = char.x < nearestEnemy.x ? -1 : 1
    return { moveDirection: awayDir as -1 | 1 }
  }

  return { endTurn: true }
}

function findBestShot(
  char: Character,
  world: WorldState
): ShotCandidate | null {
  let best: ShotCandidate | null = null
  const enemies = world.characters.filter(c => c.team !== char.team && c.alive)
  if (enemies.length === 0) return null
  const nearestEnemy = findNearest(char, enemies)
  const nearDist = dist(char, nearestEnemy)
  const spawnY = char.y - 4

  for (const weapon of PROJECTILE_WEAPONS) {
    if (weapon === 'dynamite' && nearDist > 12) continue
    if (weapon === 'shotgun' && nearDist > 40) continue

    const config = WEAPONS[weapon]
    const gravity = GRAVITY * config.gravityMul

    for (const target of enemies) {
      const ddx = target.x - char.x
      const ddz = target.z - char.z
      const dx = Math.sqrt(ddx * ddx + ddz * ddz)
      if (dx < 0.5) continue
      const dy = target.y - spawnY
      const az = Math.atan2(ddz, ddx)

      for (let pi = 1; pi <= POWER_SAMPLES; pi++) {
        const power = (pi / POWER_SAMPLES) * 100
        const speed = config.speed * (power / 100)
        const angles = solveAngles(dx, dy, speed, gravity)

        for (const angle of angles) {
          const score = simulateShot(char, angle, power, weapon, az, world)
          if (!best || score > best.score) {
            best = { weapon, angle, power, azimuth: az, score }
          }
        }
      }
    }
  }

  return best
}

function simulateShot(
  shooter: Character,
  angle: number,
  power: number,
  weapon: WeaponKind,
  azimuth: number,
  world: WorldState
): number {
  const config = WEAPONS[weapon]
  const speed = config.speed * (power / 100)
  const hSpeed = Math.cos(-angle) * speed

  let px = shooter.x
  let py = shooter.y - 4  // match createProjectile spawn height
  let pz = shooter.z
  let vx = Math.cos(azimuth) * hSpeed
  let vy = Math.sin(-angle) * speed
  let vz = Math.sin(azimuth) * hSpeed
  let bounces = config.bounces
  let fuse = config.fuseTime
  const gravity = GRAVITY * config.gravityMul
  let grace = 4

  for (let t = 0; t < MAX_SIM_TICKS; t++) {
    if (grace > 0) grace--
    vy += gravity
    px += vx
    py += vy
    pz += vz

    if (config.drag) {
      vx *= (1 - config.drag)
      vz *= (1 - config.drag)
    }

    if (fuse > 0) {
      fuse--
      if (fuse <= 0) {
        return scoreImpact(px, py, pz, config.damage, config.radius / 5, shooter, world)
      }
    }

    const gh = getHeight(world.heightmap, px, pz)
    if (py >= gh && grace <= 0) {
      if (bounces > 0) {
        py = gh
        vy = -vy * 0.6
        vx *= 0.8
        vz *= 0.8
        bounces--
      } else {
        return scoreImpact(px, py, pz, config.damage, config.radius / 5, shooter, world)
      }
    }

    if (px < 0 || px > TERRAIN_SIZE || pz < 0 || pz > TERRAIN_SIZE) {
      return 0
    }

    if (fuse === 0 && config.radius > 0) {
      for (const c of world.characters) {
        if (!c.alive || c.id === shooter.id) continue
        if (distPos(px, py, pz, c) < 3) {
          return scoreImpact(px, py, pz, config.damage, config.radius / 5, shooter, world)
        }
      }
    }
  }

  return 0
}

function scoreAirstrike(
  char: Character,
  world: WorldState
): ShotCandidate | null {
  const config = WEAPONS.airstrike
  let best: ShotCandidate | null = null

  for (let pi = 1; pi <= 10; pi++) {
    const power = (pi / 10) * 100
    const targetX = char.x + char.facing * (power / 100) * 80
    if (targetX < 5 || targetX > TERRAIN_SIZE - 5) continue

    const spread = config.radius / 5
    let totalScore = 0
    const missileCount = 5

    for (let m = 0; m < missileCount; m++) {
      const offsetX = (m - (missileCount - 1) / 2) * (spread * 0.6)
      const mx = targetX + offsetX
      const mz = char.z
      const gh = getHeight(world.heightmap, mx, mz)

      totalScore += scoreImpact(
        mx, gh, mz, config.damage, spread, char, world
      )
    }

    if (!best || totalScore > best.score) {
      best = { weapon: 'airstrike', angle: 0, power, azimuth: 0, score: totalScore }
    }
  }

  return best
}

function evaluateMovement(
  char: Character,
  world: WorldState,
  difficulty: Difficulty
): MoveCandidate | null {
  if (difficulty === 'easy') return null

  const enemies = world.characters.filter(c => c.team !== char.team && c.alive)
  const nearestEnemy = findNearest(char, enemies)

  let best: MoveCandidate | null = null

  const candidates = [
    char.x,
    char.x - 10,
    char.x + 10,
    char.x - 20,
    char.x + 20,
    char.x - 30,
    char.x + 30,
    char.x - 50,
    char.x + 50,
  ]

  for (const tx of candidates) {
    if (tx < 5 || tx > TERRAIN_SIZE - 5) continue

    const th = getHeight(world.heightmap, tx, char.z)
    const currentH = getHeight(world.heightmap, char.x, char.z)
    // Check if first step toward this target is blocked by terrain
    const stepX = char.x + Math.sign(tx - char.x) * CHAR_SPEED
    const stepH = getHeight(world.heightmap, stepX, char.z)
    const needsJump = stepH - currentH > 4  // CLIMB_MAX analog

    let score = 0

    score += th * 0.3

    const edgeDist = Math.min(tx, TERRAIN_SIZE - tx)
    if (edgeDist < 15) score -= (15 - edgeDist) * 2

    if (th < world.waterLevel + 5) score -= 30

    const enemyDist = Math.abs(tx - nearestEnemy.x)
    if (enemyDist < 8) score -= 20
    else if (enemyDist > 15 && enemyDist < 50) score += 10

    const myH = getHeight(world.heightmap, tx, char.z)
    const enemyH = getHeight(world.heightmap, nearestEnemy.x, nearestEnemy.z)
    if (myH > enemyH) score += 15

    if (tx !== char.x) score -= 5

    const steps = Math.abs(tx - char.x)
    if (!best || score > best.score) {
      best = { targetX: tx, score, steps, needsJump }
    }
  }

  return best
}

function scoreImpact(
  x: number, y: number, z: number,
  baseDamage: number, radius: number,
  shooter: Character, world: WorldState
): number {
  let score = 0
  const effectRadius = radius * 1.5

  for (const c of world.characters) {
    if (!c.alive) continue
    const d = distPos(x, y, z, c)
    if (d >= effectRadius) continue

    const falloff = (1 - d / effectRadius) ** 2
    const dmg = Math.floor(baseDamage * falloff)

    if (c.team !== shooter.team) {
      score += dmg * 2
      if (c.hp - dmg <= 0) score += 50

      const knockForce = falloff * KNOCKBACK_MAX
      const knockDir = c.x > x ? 1 : -1
      const newX = c.x + knockDir * knockForce * 3
      if (newX < 2 || newX > TERRAIN_SIZE - 2) score += 80
      const newGround = getHeight(world.heightmap, newX, c.z)
      if (newGround < world.waterLevel + 2) score += 80
    } else if (c.id === shooter.id) {
      score -= dmg * 5
    } else {
      score -= dmg * 3
    }
  }

  return score
}

function findNearest(char: Character, others: Character[]): Character {
  return others.reduce((closest, e) => {
    return dist(char, e) < dist(char, closest) ? e : closest
  })
}

function dist(a: Character, b: Character): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
}

function distPos(x: number, y: number, z: number, c: Character): number {
  return Math.sqrt((x - c.x) ** 2 + (y - c.y) ** 2 + (z - c.z) ** 2)
}
