import type { WorldState, GameInput, StepEvents } from '@shared/types'
import { WEAPONS } from '@shared/types'
import { emptyEvents, getActiveCharacter, hashWorld } from './world'
import { moveCharacter, jumpCharacter, applyCharacterPhysics } from './character'
import { createProjectile, createAirstrikeProjectiles, stepProjectile } from './projectile'
import { advanceTurn, isAllSettled, updatePhaseTimer } from './turn'

export function step(world: WorldState, input: GameInput | null): StepEvents {
  const events = emptyEvents()

  if (world.phase === 'game_over') return events

  world.tick++

  switch (world.phase) {
    case 'aiming':
      handleAimingPhase(world, input, events)
      break
    case 'firing':
      handleFiringPhase(world, events)
      break
    case 'resolving':
      handleResolvingPhase(world, events)
      break
    case 'between_turns':
      handleBetweenTurns(world, events)
      break
  }

  for (const char of world.characters) {
    applyCharacterPhysics(char, world, events.damageDealt)
  }

  const newDeaths = world.characters.filter(
    c => !c.alive && !events.deaths.includes(c.id)
  )
  for (const c of newDeaths) {
    if (c.hp <= 0 && c.alive === false) {
      events.deaths.push(c.id)
    }
  }

  world.hash = hashWorld(world)
  return events
}

function handleAimingPhase(
  world: WorldState,
  input: GameInput | null,
  events: StepEvents
): void {
  const char = getActiveCharacter(world)
  if (!char) {
    advanceTurn(world, events)
    return
  }

  if (input) {
    if (input.moveDirection || input.moveZDirection) {
      moveCharacter(char, input.moveDirection ?? 0, world, input.moveZDirection ?? 0)
    }
    if (input.jump) {
      jumpCharacter(char, input.moveDirection || 0)
    }
    if (input.fire) {
      if (input.fire.weapon === 'airstrike') {
        const az = input.fire.azimuth ?? (char.facing > 0 ? 0 : Math.PI)
        const targetX = char.x + Math.cos(az) * (input.fire.power / 100) * 80
        const targetZ = char.z + Math.sin(az) * (input.fire.power / 100) * 80
        const projs = createAirstrikeProjectiles(targetX, targetZ, char.id)
        world.projectiles.push(...projs)
      } else {
        const config = WEAPONS[input.fire.weapon]
        const shotCount = config.shots || 1
        const spreadStep = shotCount > 1 ? 0.06 : 0
        const baseAngle = input.fire.angle - spreadStep * (shotCount - 1) / 2

        for (let s = 0; s < shotCount; s++) {
          const shotAngle = baseAngle + s * spreadStep
          const proj = createProjectile(
            char.x, char.y, char.z,
            shotAngle,
            input.fire.power,
            input.fire.weapon,
            char.id,
            char.facing,
            input.fire.azimuth
          )
          world.projectiles.push(proj)
        }
      }
      world.phase = 'firing'
      world.phaseTimer = 0
    }
    if (input.endTurn) {
      world.phase = 'between_turns'
      world.phaseTimer = 0
    }
  }

  if (updatePhaseTimer(world)) {
    world.phase = 'between_turns'
    world.phaseTimer = 0
  }
}

function handleFiringPhase(
  world: WorldState,
  events: StepEvents
): void {
  for (const proj of world.projectiles) {
    stepProjectile(proj, world, events.explosions, events.damageDealt)
  }

  world.projectiles = world.projectiles.filter(p => p.active)

  if (world.projectiles.length === 0) {
    world.phase = 'resolving'
    world.phaseTimer = 0
  }
}

function handleResolvingPhase(
  world: WorldState,
  events: StepEvents
): void {
  if (isAllSettled(world)) {
    const team0Alive = world.characters.filter(c => c.team === 0 && c.alive).length
    const team1Alive = world.characters.filter(c => c.team === 1 && c.alive).length

    if (team0Alive === 0 || team1Alive === 0) {
      world.phase = 'game_over'
      events.gameOver = true
      return
    }

    world.phase = 'between_turns'
    world.phaseTimer = 0
  }
}

function handleBetweenTurns(
  world: WorldState,
  events: StepEvents
): void {
  if (updatePhaseTimer(world)) {
    advanceTurn(world, events)
  }
}
