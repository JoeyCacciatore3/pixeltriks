import type { WeaponKind } from '@shared/types'

class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private unlocked = false
  private musicGain: GainNode | null = null
  private musicOsc: OscillatorNode | null = null
  private musicLfo: OscillatorNode | null = null

  constructor() {
    const unlock = () => {
      if (this.unlocked) return
      this.unlocked = true
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.5
      this.master.connect(this.ctx.destination)
      this.startAmbientMusic()
      window.removeEventListener('keydown', unlock)
      window.removeEventListener('click', unlock)
    }
    window.addEventListener('keydown', unlock)
    window.addEventListener('click', unlock)
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
      case 'airstrike':
        this.tone(800, 0.3, 0.15, 'sine', 200)
        this.noise(0.2, 0.1, 1500)
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

  private startAmbientMusic(): void {
    if (!this.ctx || !this.master) return

    this.musicGain = this.ctx.createGain()
    this.musicGain.gain.value = 0.03

    const lfo = this.ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = 0.15
    this.musicLfo = lfo

    const lfoGain = this.ctx.createGain()
    lfoGain.gain.value = 15

    lfo.connect(lfoGain)

    const osc = this.ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = 65
    lfoGain.connect(osc.frequency)
    this.musicOsc = osc

    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 200
    filter.Q.value = 2

    osc.connect(filter)
    filter.connect(this.musicGain)
    this.musicGain.connect(this.master)

    osc.start()
    lfo.start()
  }

  dispose(): void {
    this.musicOsc?.stop()
    this.musicLfo?.stop()
    this.ctx?.close()
  }
}

export const audio = new AudioEngine()
