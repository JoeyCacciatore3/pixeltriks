import {
  GRAVITY, BLINDBOX_INTERVAL, BLINDBOX_MAX, TERRAIN_SIZE
} from '@shared/constants'
import type {
  WorldState, Blindbox, BlindboxContent, StepEvents
} from '@shared/types'
import { getHeight, explodeTerrain } from './terrain'
import { applyKnockback } from './character'
import { createPRNG } from './prng'

const CONTENT_WEIGHTS: [BlindboxContent, number][] = [
  ['healthPack',   25],
  ['extraTime',    20],
  ['skipTurn',     15],
  ['doubleDamage', 20],
  ['bombTrap',     20],
]

function pickContent(rng01: number): BlindboxContent {
  const total = CONTENT_WEIGHTS.reduce((s, [, w]) => s + w, 0)
  let roll = rng01 * total
  for (const [content, weight] of CONTENT_WEIGHTS) {
    roll -= weight
    if (roll <= 0) return content
  }
  return 'healthPack'
}

function spawnBlindbox(world: WorldState): void {
  const prng = createPRNG(world.prngState)
  const x = 20 + prng.next() * (TERRAIN_SIZE - 40)
  const z = TERRAIN_SIZE * 0.35 + prng.next() * TERRAIN_SIZE * 0.3
  const content = pickContent(prng.next())
  world.prngState = prng.getState()

  world.blindboxes.push({
    x,
    y: -40,  // starts above the terrain (y-down: negative = sky)
    z,
    vy: 0,
    content,
    grounded: false,
    collected: false,
  })
}

export function stepBlindboxes(world: WorldState, events: StepEvents): void {
  const active = world.blindboxes.filter(b => !b.collected)

  if (
    world.tick > 0 &&
    world.tick % BLINDBOX_INTERVAL === 0 &&
    active.length < BLINDBOX_MAX
  ) {
    spawnBlindbox(world)
  }

  // Parachute fall — slower than regular gravity
  for (const box of world.blindboxes) {
    if (box.collected || box.grounded) continue
    box.vy += GRAVITY * 0.3
    box.y += box.vy
    const groundH = getHeight(world.heightmap, box.x, box.z)
    if (box.y >= groundH) {
      box.y = groundH
      box.vy = 0
      box.grounded = true
    }
  }

  // Collection: any living character within 5 sim units picks it up
  for (const box of world.blindboxes) {
    if (box.collected || !box.grounded) continue
    for (const char of world.characters) {
      if (!char.alive) continue
      const dx = char.x - box.x
      const dz = char.z - box.z
      if (Math.sqrt(dx * dx + dz * dz) < 5) {
        box.collected = true
        events.blindboxPicked = box.content
        applyEffect(box, char, world, events)
        break
      }
    }
  }

  // Remove collected boxes
  world.blindboxes = world.blindboxes.filter(b => !b.collected)
}

function applyEffect(
  box: Blindbox,
  char: { id: number; hp: number; x: number; y: number; z: number; team: number },
  world: WorldState,
  events: StepEvents
): void {
  switch (box.content) {
    case 'healthPack': {
      const before = char.hp
      char.hp = Math.min(100, char.hp + 30)
      const healed = char.hp - before
      if (healed > 0) {
        events.damageDealt.push({ charId: char.id, amount: healed, source: 'heal' })
      }
      break
    }

    case 'extraTime': {
      if (world.phase === 'aiming') {
        world.phaseTimer = Math.max(0, world.phaseTimer - 10 * 60)
      }
      break
    }

    case 'skipTurn': {
      if (world.phase === 'aiming') {
        world.phase = 'between_turns'
        world.phaseTimer = 0
      }
      break
    }

    case 'doubleDamage': {
      const radius = 20
      const craterR = Math.floor(radius / 5)
      events.explosions.push({ x: box.x, y: box.y, z: box.z, radius, damage: 25 })
      explodeTerrain(world.heightmap, box.x, box.z, craterR, craterR * 0.3)
      for (const target of world.characters) {
        if (!target.alive) continue
        const dx = target.x - box.x
        const dz = target.z - box.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        const effectR = radius * 1.5
        if (dist < effectR) {
          const falloff = 1 - dist / effectR
          const dmg = Math.floor(25 * falloff * falloff)
          if (dmg > 0) {
            target.hp -= dmg
            if (target.hp <= 0) { target.hp = 0; target.alive = false }
            events.damageDealt.push({ charId: target.id, amount: dmg, source: 'object' })
          }
          applyKnockback(target, box.x, box.y, box.z, radius, 0.8)
        }
      }
      break
    }

    case 'bombTrap': {
      const radius = 30
      const craterR = Math.floor((radius / 5) * 1.2)
      events.explosions.push({ x: char.x, y: char.y, z: char.z, radius, damage: 40 })
      explodeTerrain(world.heightmap, char.x, char.z, craterR, craterR * 0.35)
      for (const target of world.characters) {
        if (!target.alive) continue
        const dx = target.x - char.x
        const dz = target.z - char.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        const effectR = radius * 1.5
        if (dist < effectR) {
          const falloff = 1 - dist / effectR
          const dmg = Math.floor(40 * falloff * falloff)
          if (dmg > 0) {
            target.hp -= dmg
            if (target.hp <= 0) { target.hp = 0; target.alive = false }
            events.damageDealt.push({ charId: target.id, amount: dmg, source: 'bombTrap' })
          }
          applyKnockback(target, char.x, char.y, char.z, radius, 1.5)
        }
      }
      break
    }
  }
}
