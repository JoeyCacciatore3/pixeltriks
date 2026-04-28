import type * as THREE from 'three'

const IS_DEV = import.meta.env.DEV

export class PerfMonitor {
  private el: HTMLElement | null = null
  private frames = 0
  private lastTime = performance.now()
  private fps = 0
  private enabled = false
  private renderer: THREE.WebGLRenderer | null = null

  constructor() {
    if (!IS_DEV) return

    this.el = document.getElementById('perf-overlay')

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote' && e.shiftKey) {
        this.enabled = !this.enabled
        document.body.classList.toggle('show-perf', this.enabled)
      }
    })
  }

  setRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer
  }

  tick(): void {
    if (!this.enabled) return

    this.frames++
    const now = performance.now()
    const elapsed = now - this.lastTime

    if (elapsed >= 1000) {
      this.fps = Math.round((this.frames * 1000) / elapsed)
      this.frames = 0
      this.lastTime = now
      this.updateOverlay()
    }
  }

  private updateOverlay(): void {
    if (!this.el) return
    const info = this.renderer?.info
    const calls = info?.render?.calls ?? 0
    const triangles = info?.render?.triangles ?? 0
    const textures = info?.memory?.textures ?? 0
    const geometries = info?.memory?.geometries ?? 0

    this.el.textContent = [
      `FPS: ${this.fps}`,
      `Draw: ${calls}`,
      `Tri: ${(triangles / 1000).toFixed(1)}k`,
      `Tex: ${textures} Geo: ${geometries}`,
    ].join(' | ')
  }

  log(event: string, data?: Record<string, unknown>): void {
    console.info(`[pixeltriks] ${event}`, data ?? '')
  }
}

export const perfMonitor = new PerfMonitor()
