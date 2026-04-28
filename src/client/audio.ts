import type { WeaponKind } from '@shared/types'

class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private unlocked = false
  private musicStarted = false
  private bgMusic: HTMLAudioElement | null = null

  constructor() {
    this.bgMusic = new Audio('/bg-music.mp3')
    this.bgMusic.loop = true
    this.bgMusic.volume = 0.30
    this.bgMusic.preload = 'auto'

    // Re-register gesture listeners until music actually starts.
    // { once: true } + re-registration means we keep retrying on every gesture
    // until bgMusic.play() resolves — handles the case where the first attempt
    // fails due to autoplay policy (e.g. 15s fallback starts game with no prior gesture).
    const tryStart = () => {
      this.start()
      if (!this.musicStarted) {
        window.addEventListener('keydown', tryStart, { once: true, passive: true })
        window.addEventListener('click', tryStart, { once: true, passive: true })
        window.addEventListener('touchstart', tryStart, { once: true, passive: true })
      }
    }
    window.addEventListener('keydown', tryStart, { once: true, passive: true })
    window.addEventListener('click', tryStart, { once: true, passive: true })
    window.addEventListener('touchstart', tryStart, { once: true, passive: true })
  }

  start(): void {
    // AudioContext created once — guarded by unlocked
    if (!this.unlocked) {
      this.unlocked = true
      this.ctx = new AudioContext()
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {})
      }
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.5
      this.master.connect(this.ctx.destination)
    }

    // Music retried on every start() call until it actually plays
    if (this.bgMusic && !this.musicStarted) {
      this.bgMusic.play().then(() => {
        this.musicStarted = true
      }).catch((err) => {
        console.warn('[audio] bgMusic.play() failed — will retry on next gesture:', err)
      })
    }
  }

  private get t(): number {
    return this.ctx?.currentTime ?? 0
  }

  private noise(duration: number, gain: number, filterFreq: number, filterQ = 1): void {
    if (!this.ctx || !this.master) return
    const sampleRate = this.ctx.sampleRate
    const samples = Math.floor(sampleRate * duration)
    const buffer = this.ctx.createBuffer(1, samples, sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < samples; i++) {
      data[i] = Math.random() * 2 - 1
    }

    const source = this.ctx.createBufferSource()
    source.buffer = buffer

    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = filterFreq
    filter.Q.value = filterQ

    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, this.t)
    g.gain.exponentialRampToValueAtTime(0.001, this.t + duration)

    source.connect(filter)
    filter.connect(g)
    g.connect(this.master)
    source.start(this.t)
  }

  private tone(
    freq: number, duration: number, gain: number,
    type: OscillatorType = 'sine',
    freqEnd?: number
  ): void {
    if (!this.ctx || !this.master) return
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, this.t)
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(freqEnd, this.t + duration)
    }

    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, this.t)
    g.gain.exponentialRampToValueAtTime(0.001, this.t + duration)

    osc.connect(g)
    g.connect(this.master!)
    osc.start(this.t)
    osc.stop(this.t + duration)
  }

  explosion(radius: number): void {
    const intensity = Math.min(radius / 10, 1)
    this.noise(0.6 + intensity * 0.4, 0.4 * intensity, 800 + intensity * 400, 0.5)
    this.tone(80, 0.5, 0.3 * intensity, 'sine', 20)
    this.tone(200, 0.15, 0.15 * intensity, 'sawtooth', 60)
  }

  fire(weapon: WeaponKind): void {
    switch (weapon) {
      case 'bazooka':
        this.tone(300, 0.08, 0.2, 'sawtooth', 100)
        this.noise(0.15, 0.25, 2000)
        break
      case 'grenade':
        this.tone(500, 0.05, 0.15, 'square', 200)
        this.noise(0.08, 0.15, 3000)
        break
      case 'shotgun':
        this.noise(0.1, 0.35, 5000, 2)
        this.tone(150, 0.06, 0.2, 'sawtooth', 50)
        break
case 'teleport':
        this.tone(400, 0.3, 0.15, 'sine', 1200)
        this.tone(600, 0.3, 0.1, 'sine', 1800)
        break
      case 'dynamite':
        this.tone(200, 0.1, 0.1, 'square', 100)
        this.noise(0.06, 0.1, 1000)
        break
    }
  }

  bounce(): void {
    this.tone(200, 0.08, 0.1, 'triangle', 100)
    this.noise(0.04, 0.08, 600)
  }

  jump(): void {
    this.tone(300, 0.12, 0.1, 'sine', 500)
  }

  damage(amount: number): void {
    const intensity = Math.min(amount / 50, 1)
    this.tone(400, 0.15, 0.12 * intensity, 'sawtooth', 150)
    this.noise(0.1, 0.1 * intensity, 1200)
  }

  death(): void {
    this.tone(600, 0.4, 0.15, 'sine', 100)
    this.tone(500, 0.5, 0.1, 'triangle', 80)
  }

  waterSplash(): void {
    this.noise(0.3, 0.2, 3000, 3)
    this.tone(100, 0.2, 0.08, 'sine', 40)
  }

  weaponSwitch(): void {
    this.tone(800, 0.04, 0.08, 'square')
    this.tone(1200, 0.04, 0.06, 'square')
  }

  turnChange(): void {
    if (!this.ctx || !this.master) return
    this.tone(523, 0.1, 0.12, 'sine')
    setTimeout(() => this.tone(659, 0.1, 0.12, 'sine'), 120)
    setTimeout(() => this.tone(784, 0.15, 0.12, 'sine'), 240)
  }

  timerWarning(): void {
    this.tone(880, 0.08, 0.1, 'square')
  }

  chargeLoop(power: number): void {
    if (!this.ctx || !this.master) return
    const freq = 200 + power * 8
    const osc = this.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq
    const g = this.ctx.createGain()
    g.gain.value = 0.04
    osc.connect(g)
    g.connect(this.master)
    osc.start(this.t)
    osc.stop(this.t + 0.05)
  }

  pickup(): void {
    this.tone(880, 0.08, 0.12, 'sine')
    setTimeout(() => this.tone(1320, 0.12, 0.12, 'sine'), 80)
  }

  gameOver(humanWon: boolean): void {
    if (humanWon) {
      const notes = [523, 659, 784, 1047]
      notes.forEach((n, i) => {
        setTimeout(() => this.tone(n, 0.3, 0.15, 'sine'), i * 150)
      })
    } else {
      this.tone(400, 0.6, 0.15, 'sine', 100)
      setTimeout(() => this.tone(300, 0.8, 0.12, 'sine', 60), 400)
    }
  }

  dispose(): void {
    this.bgMusic?.pause()
    this.ctx?.close()
  }
}

export const audio = new AudioEngine()
