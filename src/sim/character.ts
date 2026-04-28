import {
  GRAVITY, CHAR_SPEED, JUMP_IMPULSE,
  FALL_DAMAGE_THRESHOLD, FALL_DAMAGE_MULTIPLIER,
  CLIMB_MAX, TERRAIN_SIZE, KNOCKBACK_MAX
} from '@shared/constants'
import type { Character, WorldState, DamageEvent } from '@shared/types'
import { getHeight } from './terrain'

export function moveCharacter(
  char: Character,
  direction: -1 | 0 | 1,
  _world: WorldState,
  zDir: -1 | 0 | 1 = 0
): void {
  if (!char.alive || !char.grounded) return

  const accel = CHAR_SPEED * 0.35
  if (direction !== 0) {
    char.vx += direction * accel
    char.facing = direction
  }
  if (zDir !== 0) {
    char.vz += zDir * accel
  }

  const maxSpd = CHAR_SPEED
  const spd = Math.sqrt(char.vx * char.vx + char.vz * char.vz)
  if (spd > maxSpd) {
    char.vx *= maxSpd / spd
    char.vz *= maxSpd / spd
  }
}

export function applyGroundMovement(char: Character, world: WorldState): void {
  if (!char.alive || !char.grounded) return
  if (Math.abs(char.vx) < 0.01 && Math.abs(char.vz) < 0.01) {
    char.vx = 0
    char.vz = 0
    return
  }

  const friction = 0.82
  const nx = char.x + char.vx
  const nz = char.z + char.vz

  if (nx >= 1 && nx <= TERRAIN_SIZE - 2) {
    const curH = getHeight(world.heightmap, char.x, char.z)
    const tgtH = getHeight(world.heightmap, nx, char.z)
    if (tgtH - curH <= CLIMB_MAX) {
      char.x = nx
      char.y = tgtH
    } else {
      char.vx = 0
    }
  } else {
    char.vx = 0
  }

  if (nz >= 1 && nz <= TERRAIN_SIZE - 2) {
    const curH = getHeight(world.heightmap, char.x, char.z)
    const tgtH = getHeight(world.heightmap, char.x, nz)
    if (tgtH - curH <= CLIMB_MAX) {
      char.z = nz
      char.y = tgtH
    } else {
      char.vz = 0
    }
  } else {
    char.vz = 0
  }

  char.vx *= friction
  char.vz *= friction
}

export function jumpCharacter(char: Character, moveDir: number = 0): void {
  if (!char.alive || !char.grounded) return
  char.vy = JUMP_IMPULSE
  if (moveDir !== 0) {
    char.vx = moveDir * CHAR_SPEED * 1.5
  }
  char.grounded = false
}

export function applyCharacterPhysics(
  char: Character,
  world: WorldState,
  damages: DamageEvent[]
): void {
  if (!char.alive) return

  if (!char.grounded) {
    char.vy += GRAVITY
    char.x += char.vx
    char.y += char.vy
    char.z += char.vz

    char.vx *= 0.98
    char.vz *= 0.98

    const groundH = getHeight(world.heightmap, char.x, char.z)

    if (char.y >= groundH) {
      char.y = groundH

      const landingSpeed = char.vy
      if (landingSpeed > FALL_DAMAGE_THRESHOLD) {
        const dmg = Math.floor((landingSpeed - FALL_DAMAGE_THRESHOLD) * FALL_DAMAGE_MULTIPLIER)
        char.hp -= dmg
        damages.push({ charId: char.id, amount: dmg, source: 'fall' })
      }

      char.vy = 0
      char.vx = 0
      char.vz = 0
      char.grounded = true
    }
  } else {
    const groundH = getHeight(world.heightmap, char.x, char.z)
    if (char.y < groundH - 1) {
      char.grounded = false
    } else {
      char.y = groundH
    }
  }

  if (char.x < 0 || char.x > TERRAIN_SIZE ||
      char.z < 0 || char.z > TERRAIN_SIZE) {
    const dmg = char.hp
    char.hp = 0
    damages.push({ charId: char.id, amount: dmg, source: 'water' })
  }

  if (char.y < world.waterLevel) {
    const dmg = char.hp
    char.hp = 0
    damages.push({ charId: char.id, amount: dmg, source: 'water' })
  }

  if (char.hp <= 0) {
    char.hp = 0
    char.alive = false
  }
}

export function applyKnockback(
  char: Character,
  ex: number,
  ey: number,
  ez: number,
  radius: number,
  forceMul: number = 1
): void {
  const dx = char.x - ex
  const dy = char.y - ey
  const dz = char.z - ez
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const effectRadius = radius * 1.5

  if (dist >= effectRadius || dist === 0) return

  const falloff = 1 - dist / effectRadius
  const force = falloff * KNOCKBACK_MAX * forceMul
  const angle = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz))
  const horizontalAngle = Math.atan2(dz, dx)

  char.vx = Math.cos(horizontalAngle) * force * Math.cos(angle)
  char.vy = -Math.abs(Math.sin(angle) * force) - 2
  char.vz = Math.sin(horizontalAngle) * force * Math.cos(angle)
  char.grounded = false
}
