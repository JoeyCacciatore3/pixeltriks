import { GRAVITY } from '@shared/constants'
import type {
  Projectile, WorldState, WeaponKind,
  ExplosionEvent, DamageEvent
} from '@shared/types'
import { WEAPONS } from '@shared/types'
import { getHeight, explodeTerrain } from './terrain'
import { applyKnockback } from './character'

export function createProjectile(
  x: number, y: number, z: number,
  angle: number, power: number,
  weapon: WeaponKind, owner: number,
  facing: number = 1
): Projectile {
  const config = WEAPONS[weapon]
  const speed = config.speed * (power / 100)
  const elevationAngle = -angle

  return {
    x, y: y - 1, z,
    vx: Math.cos(elevationAngle) * speed * facing,
    vy: Math.sin(elevationAngle) * speed,
    vz: 0,
    weapon,
    owner,
    bouncesLeft: config.bounces,
    fuseTimer: config.fuseTime,
    active: true,
  }
}

export function createAirstrikeProjectiles(
  targetX: number, targetZ: number, owner: number
): Projectile[] {
  const config = WEAPONS.airstrike
  const missiles: Projectile[] = []
  const count = 5
  const spread = config.radius / 5

  for (let i = 0; i < count; i++) {
    const offsetX = (i - (count - 1) / 2) * (spread * 0.6)
    missiles.push({
      x: targetX + offsetX,
      y: -20,
      z: targetZ,
      vx: 0,
      vy: config.speed * 0.5,
      vz: 0,
      weapon: 'airstrike',
      owner,
      bouncesLeft: 0,
      fuseTimer: 0,
      active: true,
    })
  }
  return missiles
}

export function stepProjectile(
  proj: Projectile,
  world: WorldState,
  explosions: ExplosionEvent[],
  damages: DamageEvent[]
): void {
  if (!proj.active) return

  const config = WEAPONS[proj.weapon]

  proj.vy += GRAVITY * config.gravityMul
  proj.x += proj.vx
  proj.y += proj.vy
  proj.z += proj.vz

  if (config.fuseTime > 0) {
    proj.fuseTimer--
    if (proj.fuseTimer <= 0) {
      detonateProjectile(proj, world, explosions, damages)
      return
    }
  }

  const groundH = getHeight(world.heightmap, proj.x, proj.z)

  if (proj.y >= groundH) {
    if (proj.bouncesLeft > 0) {
      proj.y = groundH
      proj.vy = -proj.vy * 0.5
      proj.vx *= 0.7
      proj.vz *= 0.7
      proj.bouncesLeft--
    } else {
      detonateProjectile(proj, world, explosions, damages)
    }
    return
  }

  const isDescending = proj.vy > 0
  if ((!isDescending && proj.y < world.waterLevel) ||
      proj.x < 0 || proj.x > 256 ||
      proj.z < 0 || proj.z > 256) {
    proj.active = false
    return
  }

  if (config.fuseTime === 0 && config.radius > 0) {
    for (const char of world.characters) {
      if (!char.alive || char.id === proj.owner) continue
      const dx = proj.x - char.x
      const dy = proj.y - char.y
      const dz = proj.z - char.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dist < 3) {
        detonateProjectile(proj, world, explosions, damages)
        return
      }
    }
  }
}

function detonateProjectile(
  proj: Projectile,
  world: WorldState,
  explosions: ExplosionEvent[],
  damages: DamageEvent[]
): void {
  proj.active = false
  const config = WEAPONS[proj.weapon]

  if (config.radius === 0) {
    handleTeleport(proj, world)
    return
  }

  const scaledRadius = config.radius / 5

  explodeTerrain(world.heightmap, proj.x, proj.z, scaledRadius, scaledRadius * 0.3)

  explosions.push({
    x: proj.x,
    y: proj.y,
    z: proj.z,
    radius: scaledRadius,
    damage: config.damage,
  })

  const effectRadius = scaledRadius * 1.5
  for (const char of world.characters) {
    if (!char.alive) continue
    const dx = char.x - proj.x
    const dy = char.y - proj.y
    const dz = char.z - proj.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

    if (dist < effectRadius) {
      const falloff = 1 - dist / effectRadius
      const dmg = Math.floor(config.damage * falloff)
      char.hp -= dmg
      damages.push({ charId: char.id, amount: dmg, source: 'projectile' })
      applyKnockback(char, proj.x, proj.y, proj.z, scaledRadius)
    }
  }
}

function handleTeleport(proj: Projectile, world: WorldState): void {
  const char = world.characters.find(c => c.id === proj.owner)
  if (!char || !char.alive) return

  const groundH = getHeight(world.heightmap, proj.x, proj.z)
  char.x = proj.x
  char.y = groundH
  char.z = proj.z
  char.vx = 0
  char.vy = 0
  char.vz = 0
  char.grounded = true
}
