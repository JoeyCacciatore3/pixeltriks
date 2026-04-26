import type { GameInput, WorldState } from './types'

export type ClientMessage =
  | { type: 'create' }
  | { type: 'join'; roomCode: string }
  | { type: 'input'; input: GameInput; tick: number }
  | { type: 'ready' }
  | { type: 'quickplay' }

export type ServerMessage =
  | { type: 'room_created'; roomCode: string; team: number }
  | { type: 'player_joined'; team: number }
  | { type: 'countdown'; seconds: number }
  | { type: 'game_start'; seed: number; yourTeam: number }
  | { type: 'state'; world: SerializedWorld; tick: number }
  | { type: 'input_ack'; tick: number }
  | { type: 'opponent_input'; input: GameInput; tick: number }
  | { type: 'error'; message: string }
  | { type: 'opponent_disconnected' }
  | { type: 'waiting' }

export interface SerializedWorld {
  tick: number
  phase: string
  turn: number
  activeTeam: number
  activeCharIndex: number
  phaseTimer: number
  characters: WorldState['characters']
  projectiles: WorldState['projectiles']
  blindboxes: WorldState['blindboxes']
  waterLevel: number
  seed: number
  prngState: number
  hash: number
}

export function serializeWorld(w: WorldState): SerializedWorld {
  return {
    tick: w.tick,
    phase: w.phase,
    turn: w.turn,
    activeTeam: w.activeTeam,
    activeCharIndex: w.activeCharIndex,
    phaseTimer: w.phaseTimer,
    characters: w.characters.map(c => ({ ...c })),
    projectiles: w.projectiles.map(p => ({ ...p })),
    blindboxes: w.blindboxes.map(b => ({ ...b })),
    waterLevel: w.waterLevel,
    seed: w.seed,
    prngState: w.prngState,
    hash: w.hash,
  }
}
