import type { WorldState, GameInput } from '@shared/types'
import { computeAIInput } from '@sim/ai'
import { getActiveCharacter } from '@sim/world'

type AIPhase = 'thinking' | 'moving' | 'aiming' | 'firing' | 'done'

export class AIController {
  private phase: AIPhase = 'done'
  private timer = 0
  private plan: GameInput | null = null
  private moveTarget: number | null = null
  private moveDir: -1 | 1 = 1
  private difficulty: 'easy' | 'medium' | 'hard' = 'medium'
  private lastCharX = 0
  private stuckTicks = 0

  reset(): void {
    this.phase = 'done'
    this.timer = 0
    this.plan = null
    this.moveTarget = null
    this.stuckTicks = 0
  }

  startTurn(): void {
    this.phase = 'thinking'
    this.timer = 0
    this.plan = null
    this.moveTarget = null
  }

  isDone(): boolean {
    return this.phase === 'done'
  }

  tick(world: WorldState): GameInput | null {
    const char = getActiveCharacter(world)
    if (!char) {
      this.phase = 'done'
      return null
    }

    this.timer++

    switch (this.phase) {
      case 'thinking': {
        if (this.timer >= 30) {
          this.plan = computeAIInput(world, this.difficulty)

          if (this.plan?.moveDirection) {
            this.moveDir = this.plan.moveDirection
            this.moveTarget = char.x + this.moveDir * 15
            this.phase = 'moving'
            this.timer = 0
            this.plan = null
          } else if (this.plan?.fire) {
            this.phase = 'aiming'
            this.timer = 0
          } else {
            this.phase = 'firing'
            this.timer = 0
            this.plan = { endTurn: true }
          }
        }
        return null
      }

      case 'moving': {
        if (this.timer > 90 || !this.moveTarget) {
          this.phase = 'thinking'
          this.timer = 0
          return null
        }

        const atTarget = Math.abs(char.x - this.moveTarget) < 2
        if (atTarget) {
          this.plan = computeAIInput(world, this.difficulty)
          if (this.plan?.fire) {
            this.phase = 'aiming'
            this.timer = 0
          } else {
            this.phase = 'firing'
            this.timer = 0
            this.plan = { endTurn: true }
          }
          return null
        }

        // Stuck detection: if position hasn't changed in 4 ticks, jump
        if (char.grounded) {
          if (Math.abs(char.x - this.lastCharX) < 0.1) {
            this.stuckTicks++
            if (this.stuckTicks >= 4) {
              this.stuckTicks = 0
              return { jump: true }
            }
          } else {
            this.stuckTicks = 0
          }
          this.lastCharX = char.x
        }

        return { moveDirection: this.moveDir }
      }

      case 'aiming': {
        if (this.timer >= 20) {
          this.phase = 'firing'
          this.timer = 0
        }
        return null
      }

      case 'firing': {
        if (this.plan) {
          const result = this.plan
          this.plan = null
          this.phase = 'done'
          return result
        }
        this.phase = 'done'
        return { endTurn: true }
      }

      case 'done':
        return null
    }
  }
}
