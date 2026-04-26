import { WebSocketServer, WebSocket } from 'ws'
import { createWorld } from '../sim/index'
import { step } from '../sim/game'
import type { WorldState, GameInput } from '../shared/types'
import type { ClientMessage, ServerMessage } from '../shared/net'
import { serializeWorld } from '../shared/net'
import { TICK_RATE } from '../shared/constants'

interface Player {
  ws: WebSocket
  team: number
  ready: boolean
}

interface Room {
  code: string
  players: Player[]
  world: WorldState | null
  status: 'waiting' | 'countdown' | 'playing' | 'finished'
  pendingInputs: Map<number, GameInput>
  nextTickAt: number  // wall-clock target for next tick (self-correcting loop)
}

const rooms = new Map<string, Room>()
const playerRooms = new Map<WebSocket, string>()

interface QuickplayWaiter {
  ws: WebSocket
  timer: ReturnType<typeof setTimeout>
}
let quickplayQueue: QuickplayWaiter | null = null

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return rooms.has(code) ? generateRoomCode() : code
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function broadcast(room: Room, msg: ServerMessage): void {
  for (const p of room.players) {
    send(p.ws, msg)
  }
}

function startCountdown(room: Room): void {
  room.status = 'countdown'
  let count = 3

  const tick = (): void => {
    broadcast(room, { type: 'countdown', seconds: count })
    count--
    if (count < 0) {
      startGame(room)
    } else {
      setTimeout(tick, 1000)
    }
  }
  tick()
}

const TICK_MS = 1000 / TICK_RATE

function startGame(room: Room): void {
  const seed = Date.now()
  room.world = createWorld(seed)
  room.status = 'playing'

  for (const p of room.players) {
    send(p.ws, {
      type: 'game_start',
      seed,
      yourTeam: p.team,
    })
  }

  // Self-correcting tick loop: each tick schedules the next based on when it
  // *should* have fired, not when it actually fired. Prevents cumulative drift
  // that causes the server tick count to fall behind clients using rAF.
  room.nextTickAt = Date.now() + TICK_MS
  function tick() {
    if (room.status !== 'playing') return
    gameTick(room)
    if (room.status === 'playing') {
      room.nextTickAt += TICK_MS
      const delay = Math.max(0, room.nextTickAt - Date.now())
      setTimeout(tick, delay)
    }
  }
  setTimeout(tick, TICK_MS)
}

function gameTick(room: Room): void {
  if (!room.world || room.world.phase === 'game_over') {
    room.status = 'finished'
    if (room.world) {
      broadcast(room, {
        type: 'state',
        world: serializeWorld(room.world),
        tick: room.world.tick,
      })
    }
    return
  }

  let input: GameInput | null = null
  const activeTeam = room.world.activeTeam

  if (room.world.phase === 'aiming') {
    input = room.pendingInputs.get(activeTeam) ?? null
    room.pendingInputs.delete(activeTeam)
  }

  const events = step(room.world, input)

  if (events.turnAdvanced || events.gameOver || events.explosions.length > 0 ||
      room.world.tick % 6 === 0) {
    broadcast(room, {
      type: 'state',
      world: serializeWorld(room.world),
      tick: room.world.tick,
    })
  }

  if (input) {
    for (const p of room.players) {
      if (p.team !== activeTeam) {
        send(p.ws, {
          type: 'opponent_input',
          input,
          tick: room.world.tick,
        })
      }
    }
  }
}

function handleMessage(ws: WebSocket, data: string): void {
  let msg: ClientMessage
  try {
    msg = JSON.parse(data)
  } catch {
    send(ws, { type: 'error', message: 'Invalid JSON' })
    return
  }

  switch (msg.type) {
    case 'create': {
      const code = generateRoomCode()
      const room: Room = {
        code,
        players: [{ ws, team: 0, ready: false }],
        world: null,
        status: 'waiting',

        pendingInputs: new Map(),
        nextTickAt: 0,
      }
      rooms.set(code, room)
      playerRooms.set(ws, code)
      send(ws, { type: 'room_created', roomCode: code, team: 0 })
      break
    }

    case 'join': {
      const room = rooms.get(msg.roomCode.toUpperCase())
      if (!room) {
        send(ws, { type: 'error', message: 'Room not found' })
        return
      }
      if (room.players.length >= 2) {
        send(ws, { type: 'error', message: 'Room full' })
        return
      }
      if (room.status !== 'waiting') {
        send(ws, { type: 'error', message: 'Game already in progress' })
        return
      }

      room.players.push({ ws, team: 1, ready: false })
      playerRooms.set(ws, room.code)
      send(ws, { type: 'room_created', roomCode: room.code, team: 1 })
      broadcast(room, { type: 'player_joined', team: 1 })
      break
    }

    case 'ready': {
      const roomCode = playerRooms.get(ws)
      if (!roomCode) return
      const room = rooms.get(roomCode)
      if (!room) return

      const player = room.players.find(p => p.ws === ws)
      if (player) player.ready = true

      if (room.players.length === 2 && room.players.every(p => p.ready)) {
        startCountdown(room)
      }
      break
    }

    case 'quickplay': {
      if (quickplayQueue && quickplayQueue.ws.readyState === WebSocket.OPEN) {
        const opponent = quickplayQueue.ws
        clearTimeout(quickplayQueue.timer)
        quickplayQueue = null

        const code = generateRoomCode()
        const room: Room = {
          code,
          players: [
            { ws: opponent, team: 0, ready: true },
            { ws, team: 1, ready: true },
          ],
          world: null,
          status: 'waiting',
  
          pendingInputs: new Map(),
        nextTickAt: 0,
        }
        rooms.set(code, room)
        playerRooms.set(opponent, code)
        playerRooms.set(ws, code)
        startCountdown(room)
      } else {
        if (quickplayQueue) clearTimeout(quickplayQueue.timer)
        const timer = setTimeout(() => {
          if (quickplayQueue?.ws === ws) {
            quickplayQueue = null
            // fall back: create a solo room so client can start vs AI
            const code = generateRoomCode()
            const room: Room = {
              code,
              players: [{ ws, team: 0, ready: true }],
              world: null,
              status: 'waiting',
      
              pendingInputs: new Map(),
        nextTickAt: 0,
            }
            rooms.set(code, room)
            playerRooms.set(ws, code)
            send(ws, { type: 'room_created', roomCode: code, team: 0 })
          }
        }, 15000)
        quickplayQueue = { ws, timer }
        send(ws, { type: 'waiting' })
      }
      break
    }

    case 'input': {
      const roomCode = playerRooms.get(ws)
      if (!roomCode) return
      const room = rooms.get(roomCode)
      if (!room || room.status !== 'playing' || !room.world) return

      const player = room.players.find(p => p.ws === ws)
      if (!player) return

      if (room.world.activeTeam === player.team && room.world.phase === 'aiming') {
        room.pendingInputs.set(player.team, msg.input)
        send(ws, { type: 'input_ack', tick: msg.tick })
      }
      break
    }
  }
}

function handleDisconnect(ws: WebSocket): void {
  if (quickplayQueue?.ws === ws) {
    clearTimeout(quickplayQueue.timer)
    quickplayQueue = null
  }

  const roomCode = playerRooms.get(ws)
  if (!roomCode) return

  const room = rooms.get(roomCode)
  if (room) {
    room.players = room.players.filter(p => p.ws !== ws)

    if (room.players.length > 0) {
      broadcast(room, { type: 'opponent_disconnected' })
    }

    if (room.players.length === 0) {
      room.status = 'finished'  // stops the self-correcting tick loop
      rooms.delete(roomCode)
    }
  }

  playerRooms.delete(ws)
}

const PORT = parseInt(process.env.PORT ?? '8080')
const wss = new WebSocketServer({ port: PORT })

wss.on('connection', (ws) => {
  ws.on('message', (data) => handleMessage(ws, data.toString()))
  ws.on('close', () => handleDisconnect(ws))
  ws.on('error', () => handleDisconnect(ws))
})

console.log(`Pixeltriks: Humans vs AI server running on ws://localhost:${PORT}`)
