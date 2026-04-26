import {
  AIM_PHASE_DURATION, BETWEEN_TURNS_DURATION,
  SUDDEN_DEATH_TURN
} from '@shared/constants'
import type { WorldState, StepEvents } from '@shared/types'
export function advanceTurn(world: WorldState, events: StepEvents): void {
  const otherTeam = world.activeTeam === 0 ? 1 : 0
  const otherAlive = world.characters.filter(c => c.team === otherTeam && c.alive)
  const currentAlive = world.characters.filter(c => c.team === world.activeTeam && c.alive)

  if (otherAlive.length === 0 || currentAlive.length === 0) {
    world.phase = 'game_over'
    events.gameOver = true
    return
  }

  world.activeTeam = otherTeam
  const teamAlive = world.characters.filter(c => c.team === otherTeam && c.alive)
  world.activeCharIndex = (world.turn >> 1) % teamAlive.length
  world.turn++
  world.phase = 'aiming'
  world.phaseTimer = 0

  if (world.turn >= SUDDEN_DEATH_TURN * 2) {
    world.waterLevel += 0.3
  }

  events.turnAdvanced = true
}

export function isAllSettled(world: WorldState): boolean {
  for (const p of world.projectiles) {
    if (p.active) return false
  }
  for (const c of world.characters) {
    if (c.alive && !c.grounded) return false
  }
  return true
}

export function updatePhaseTimer(world: WorldState): boolean {
  world.phaseTimer++

  switch (world.phase) {
    case 'aiming':
      return world.phaseTimer >= AIM_PHASE_DURATION
    case 'between_turns':
      return world.phaseTimer >= BETWEEN_TURNS_DURATION
    default:
      return false
  }
}
