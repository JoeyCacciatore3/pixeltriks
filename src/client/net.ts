import type { GameInput } from '@shared/types'
import type { ClientMessage, ServerMessage, SerializedWorld } from '@shared/net'

export type NetEvent =
  | { type: 'room_created'; roomCode: string; team: number }
  | { type: 'player_joined'; team: number }
  | { type: 'countdown'; seconds: number }
  | { type: 'game_start'; seed: number; yourTeam: number }
  | { type: 'state'; world: SerializedWorld; tick: number }
  | { type: 'opponent_input'; input: GameInput; tick: number }
  | { type: 'opponent_disconnected' }
  | { type: 'waiting' }
  | { type: 'error'; message: string }
  | { type: 'connected' }
  | { type: 'disconnected' }

type NetEventHandler = (event: NetEvent) => void

export class NetClient {
  private ws: WebSocket | null = null
  private handler: NetEventHandler
  private url: string

  constructor(url: string, handler: NetEventHandler) {
    this.url = url
    this.handler = handler
  }

  connect(): void {
    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      this.handler({ type: 'connected' })
    }

    this.ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data as string)
      this.handler(msg as NetEvent)
    }

    this.ws.onclose = () => {
      this.handler({ type: 'disconnected' })
      this.ws = null
    }

    this.ws.onerror = () => {
      this.handler({ type: 'error', message: 'Connection failed' })
    }
  }

  createRoom(): void {
    this.send({ type: 'create' })
  }

  joinRoom(code: string): void {
    this.send({ type: 'join', roomCode: code })
  }

  sendReady(): void {
    this.send({ type: 'ready' })
  }

  sendInput(input: GameInput, tick: number): void {
    this.send({ type: 'input', input, tick })
  }

  sendQuickplay(): void {
    this.send({ type: 'quickplay' })
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }
}
