export type WeaponKind = 'bazooka' | 'grenade' | 'shotgun' | 'airstrike' | 'teleport' | 'dynamite'

export interface WeaponConfig {
  speed: number
  radius: number      // damage falloff radius (sim units, divided by 5 = scaled)
  damage: number
  gravityMul: number
  bounces: number
  fuseTime: number
  shots: number
  craterMul: number    // terrain crater = (radius/5) * craterMul; 0 = no terrain damage
  knockbackMul: number // scales KNOCKBACK_MAX force on hit chars
  drag?: number        // velocity damping per tick (0–1), limits effective range
}

export const WEAPONS: Record<WeaponKind, WeaponConfig> = {
  //                          spd  rad  dmg  grav  bnc  fuse  sht  crater  kbk
  bazooka:   { speed: 12, radius: 35, damage: 45, gravityMul: 1,   bounces: 0, fuseTime: 0,   shots: 1, craterMul: 1.0, knockbackMul: 1.0 },
  grenade:   { speed: 10, radius: 30, damage: 40, gravityMul: 1,   bounces: 3, fuseTime: 180, shots: 1, craterMul: 0.7, knockbackMul: 1.3 },
  shotgun:   { speed: 20, radius: 14, damage: 30, gravityMul: 0,   bounces: 0, fuseTime: 0,   shots: 2, craterMul: 0.0, knockbackMul: 0.4, drag: 0.04 },
  airstrike: { speed: 14, radius: 40, damage: 55, gravityMul: 1.5, bounces: 0, fuseTime: 0,   shots: 5, craterMul: 1.3, knockbackMul: 0.7 },
  teleport:  { speed: 18, radius: 0,  damage: 0,  gravityMul: 1,   bounces: 0, fuseTime: 0,   shots: 1, craterMul: 0.0, knockbackMul: 0.0 },
  dynamite:  { speed: 2,  radius: 50, damage: 70, gravityMul: 1,   bounces: 0, fuseTime: 120, shots: 1, craterMul: 2.0, knockbackMul: 1.8 },
}

export type BlindboxContent = 'extraTime' | 'skipTurn' | 'doubleDamage' | 'healthPack' | 'bombTrap'

export type GamePhase = 'aiming' | 'firing' | 'resolving' | 'between_turns' | 'game_over'

export interface GameInput {
  moveDirection?: -1 | 0 | 1
  moveZDirection?: -1 | 0 | 1
  jump?: boolean
  fire?: { angle: number; power: number; weapon: WeaponKind; azimuth?: number }
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
  graceTimer: number  // ticks before terrain collision is checked (prevents clip on steep slopes at spawn)
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
  turnAdvanced: boolean
  gameOver: boolean
  damageDealt: DamageEvent[]
}

export interface ExplosionEvent {
  x: number
  y: number
  z: number
  radius: number
  damage: number
}

export interface DamageEvent {
  charId: number
  amount: number
  source: 'projectile' | 'fall' | 'object' | 'water' | 'bombTrap'
}
