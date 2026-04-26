import { GRAVITY, TERRAIN_SIZE, KNOCKBACK_MAX } from '@shared/constants'
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
const ANGLE_SAMPLES = 36
const POWER_SAMPLES = 5
const MAX_SIM_TICKS = 300

interface ShotCandidate {
  weapon: WeaponKind
  angle: number
  power: number
  score: number
}

interface MoveCandidate {
  targetX: number
  score: number
  steps: number
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

    if (bestMove.score > shotScore * 0.5 || shotScore <= 0) {
      const dir = bestMove.targetX > char.x ? 1 : -1
      return { moveDirection: dir as -1 | 1 }
    }
  }

  const azimuth = nearestEnemy.x > char.x ? 0 : Math.PI

  if (useAirstrike && bestAirstrike) {
    const noise = NOISE[difficulty]
    return {
      fire: {
        angle: 0,
        power: Math.max(10, Math.min(100,
          bestAirstrike.power + prng.nextFloat(-noise.power, noise.power)
        )),
        weapon: 'airstrike',
        azimuth,
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
        azimuth,
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
  const nearDist = dist(char, findNearest(char, enemies))

  for (const weapon of PROJECTILE_WEAPONS) {
    if (weapon === 'dynamite' && nearDist > 12) continue
    if (weapon === 'shotgun' && nearDist > 40) continue

    for (let ai = 0; ai < ANGLE_SAMPLES; ai++) {
      const angle = (ai / ANGLE_SAMPLES) * Math.PI - Math.PI / 2

      for (let pi = 1; pi <= POWER_SAMPLES; pi++) {
        const power = (pi / POWER_SAMPLES) * 100
        const score = simulateShot(char, angle, power, weapon, world)

        if (!best || score > best.score) {
          best = { weapon, angle, power, score }
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
  world: WorldState
): number {
  const config = WEAPONS[weapon]
  const speed = config.speed * (power / 100)
  const enemies = world.characters.filter(c => c.team !== shooter.team && c.alive)
  const nearest = enemies.length > 0 ? findNearest(shooter, enemies) : null
  const az = nearest && nearest.x > shooter.x ? 0 : Math.PI
  const hSpeed = Math.cos(-angle) * speed

  let px = shooter.x
  let py = shooter.y - 1
  let pz = shooter.z
  let vx = Math.cos(az) * hSpeed
  let vy = Math.sin(-angle) * speed
  let vz = Math.sin(az) * hSpeed
  let bounces = config.bounces
  let fuse = config.fuseTime

  for (let t = 0; t < MAX_SIM_TICKS; t++) {
    vy += GRAVITY * config.gravityMul
    px += vx
    py += vy
    pz += vz

    if (fuse > 0) {
      fuse--
      if (fuse <= 0) {
        return scoreImpact(px, py, pz, config.damage, config.radius / 5, shooter, world)
      }
    }

    const gh = getHeight(world.heightmap, px, pz)
    if (py >= gh) {
      if (bounces > 0) {
        py = gh
        vy = -vy * 0.5
        vx *= 0.7
        vz *= 0.7
        bounces--
      } else {
        return scoreImpact(px, py, pz, config.damage, config.radius / 5, shooter, world)
      }
    }

    if (px < 0 || px > TERRAIN_SIZE || pz < 0 || pz > TERRAIN_SIZE || py < world.waterLevel) {
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
      best = { weapon: 'airstrike', angle: 0, power, score: totalScore }
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
  ]

  for (const tx of candidates) {
    if (tx < 5 || tx > TERRAIN_SIZE - 5) continue

    const th = getHeight(world.heightmap, tx, char.z)
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
    if (myH < enemyH) score += 15

    if (tx !== char.x) score -= 5

    const steps = Math.abs(tx - char.x)
    if (!best || score > best.score) {
      best = { targetX: tx, score, steps }
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

    const falloff = 1 - d / effectRadius
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
