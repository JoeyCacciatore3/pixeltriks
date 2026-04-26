import {
  TERRAIN_SIZE, STARTING_HP, TEAM_SIZE,
  TEAM_HUMAN
} from '@shared/constants'
import type { WorldState, Character, StepEvents } from '@shared/types'
import { createPRNG } from './prng'
import { generateTerrain, getHeight } from './terrain'

function fnv1a(data: Uint8Array): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i]
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function hashWorld(world: WorldState): number {
  const chars = world.characters
  const buf = new ArrayBuffer(4 + 4 + chars.length * 20)
  const view = new DataView(buf)

  view.setInt32(0, world.tick, true)
  view.setInt32(4, world.prngState, true)

  for (let i = 0; i < chars.length; i++) {
    const off = 8 + i * 20
    view.setFloat32(off, chars[i].x, true)
    view.setFloat32(off + 4, chars[i].y, true)
    view.setFloat32(off + 8, chars[i].z, true)
    view.setInt32(off + 12, chars[i].hp, true)
    view.setInt32(off + 16, chars[i].alive ? 1 : 0, true)
  }

  return fnv1a(new Uint8Array(buf))
}

export function createWorld(seed: number): WorldState {
  const prng = createPRNG(seed)
  const heightmap = generateTerrain(prng)

  const characters: Character[] = []
  const size = TERRAIN_SIZE

  const battleZ = size * 0.5

  for (let team = 0; team < 2; team++) {
    for (let i = 0; i < TEAM_SIZE; i++) {
      const xZone = team === TEAM_HUMAN
        ? size * 0.15 + prng.next() * size * 0.2
        : size * 0.65 + prng.next() * size * 0.2
      const zPos = battleZ
      const y = getHeight(heightmap, xZone, zPos)

      characters.push({
        id: team * TEAM_SIZE + i,
        team,
        x: xZone,
        y,
        z: zPos,
        vx: 0,
        vy: 0,
        vz: 0,
        hp: STARTING_HP,
        alive: true,
        grounded: true,
        facing: team === TEAM_HUMAN ? 1 : -1,
      })
    }
  }

  const world: WorldState = {
    tick: 0,
    phase: 'aiming',
    turn: 0,
    activeTeam: TEAM_HUMAN,
    activeCharIndex: 0,
    phaseTimer: 0,
    characters,
    projectiles: [],
    blindboxes: [],
    objects: [],
    heightmap,
    waterLevel: -2,
    seed,
    prngState: prng.getState(),
    hash: 0,
  }

  world.hash = hashWorld(world)
  return world
}

export function emptyEvents(): StepEvents {
  return {
    explosions: [],
    turnAdvanced: false,
    gameOver: false,
    damageDealt: [],
    blindboxPicked: null,
  }
}

export function getActiveCharacter(world: WorldState): Character | null {
  const team = world.activeTeam
  const alive = world.characters.filter(c => c.team === team && c.alive)
  if (alive.length === 0) return null
  return alive[world.activeCharIndex % alive.length]
}
