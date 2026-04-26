export type WeaponKind = 'bazooka' | 'grenade' | 'shotgun' | 'airstrike' | 'teleport' | 'dynamite'

export interface WeaponConfig {
  speed: number
  radius: number
  damage: number
  gravityMul: number
  bounces: number
  fuseTime: number
  shots: number
}

export const WEAPONS: Record<WeaponKind, WeaponConfig> = {
  bazooka:   { speed: 12, radius: 35, damage: 45, gravityMul: 1,   bounces: 0, fuseTime: 0,   shots: 1 },
  grenade:   { speed: 10, radius: 30, damage: 40, gravityMul: 1,   bounces: 3, fuseTime: 180, shots: 1 },
  shotgun:   { speed: 20, radius: 15, damage: 25, gravityMul: 0,   bounces: 0, fuseTime: 0,   shots: 2 },
  airstrike: { speed: 14, radius: 25, damage: 30, gravityMul: 1.5, bounces: 0, fuseTime: 0,   shots: 5 },
  teleport:  { speed: 18, radius: 0,  damage: 0,  gravityMul: 1,   bounces: 0, fuseTime: 0,   shots: 1 },
  dynamite:  { speed: 2,  radius: 50, damage: 70, gravityMul: 1,   bounces: 0, fuseTime: 120, shots: 1 },
}

export type BlindboxContent = 'extraTime' | 'skipTurn' | 'doubleDamage' | 'healthPack' | 'bombTrap'

export type GamePhase = 'aiming' | 'firing' | 'resolving' | 'between_turns' | 'game_over'

export interface GameInput {
  moveDirection?: -1 | 0 | 1
  jump?: boolean
  fire?: { angle: number; power: number; weapon: WeaponKind }
  endTurn?: boolean
}

export interface Character {
  id: number
  team: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  hp: number
  alive: boolean
  grounded: boolean
  facing: number
}

export interface Projectile {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  weapon: WeaponKind
  owner: number
  bouncesLeft: number
  fuseTimer: number
  active: boolean
}

export interface Blindbox {
  x: number
  y: number
  z: number
  vy: number
  content: BlindboxContent
  grounded: boolean
  collected: boolean
}

export interface EnvObject {
  kind: 'barrel' | 'mine'
  x: number
  y: number
  z: number
  radius: number
  damage: number
  active: boolean
  fuseTimer: number
  triggered: boolean
}

export interface WorldState {
  tick: number
  phase: GamePhase
  turn: number
  activeTeam: number
  activeCharIndex: number
  phaseTimer: number
  characters: Character[]
  projectiles: Projectile[]
  blindboxes: Blindbox[]
  objects: EnvObject[]
  heightmap: Float32Array
  waterLevel: number
  seed: number
  prngState: number
  hash: number
}

export interface StepEvents {
  explosions: ExplosionEvent[]
  objectExplosions: ExplosionEvent[]
  blindboxCollected: BlindboxCollectEvent[]
  deaths: number[]
  turnAdvanced: boolean
  gameOver: boolean
  blindboxSpawned: boolean
  damageDealt: DamageEvent[]
}

export interface ExplosionEvent {
  x: number
  y: number
  z: number
  radius: number
  damage: number
}

export interface BlindboxCollectEvent {
  charId: number
  content: BlindboxContent
  x: number
  y: number
  z: number
}

export interface DamageEvent {
  charId: number
  amount: number
  source: 'projectile' | 'fall' | 'object' | 'water' | 'bombTrap'
}

export interface RoomState {
  roomCode: string
  players: { id: string; team: number; ready: boolean }[]
  worldState: WorldState | null
  status: 'waiting' | 'playing' | 'finished'
}
