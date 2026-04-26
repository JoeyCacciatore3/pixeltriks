import { TERRAIN_SIZE, TERRAIN_HEIGHT_SCALE } from '@shared/constants'
import type { PRNG } from './prng'

export function generateTerrain(prng: PRNG): Float32Array {
  const size = TERRAIN_SIZE
  const heightmap = new Float32Array(size * size)
  const octaves = 5

  const phases: number[] = []
  const freqs: number[] = []
  const amps: number[] = []

  for (let i = 0; i < octaves; i++) {
    phases.push(prng.next() * Math.PI * 2)
    freqs.push((i + 1) * 1.5)
    amps.push(1 / (i + 1))
  }

  const phasesZ: number[] = []
  for (let i = 0; i < octaves; i++) {
    phasesZ.push(prng.next() * Math.PI * 2)
  }

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size
      const nz = z / size
      let h = 0
      for (let i = 0; i < octaves; i++) {
        h += Math.sin(nx * Math.PI * 2 * freqs[i] + phases[i]) * amps[i]
        h += Math.sin(nz * Math.PI * 2 * freqs[i] + phasesZ[i]) * amps[i] * 0.5
      }

      const edgeFalloff = Math.min(
        nx, nz, 1 - nx, 1 - nz
      ) * 4
      const clampedFalloff = Math.min(edgeFalloff, 1)

      const baseline = TERRAIN_HEIGHT_SCALE * 0.55
      const amplitude = TERRAIN_HEIGHT_SCALE * 0.22
      heightmap[z * size + x] = (baseline + h * amplitude) * clampedFalloff
    }
  }

  return heightmap
}

export function getHeight(heightmap: Float32Array, x: number, z: number): number {
  const size = TERRAIN_SIZE
  const cx = Math.max(0, Math.min(size - 1, Math.floor(x)))
  const cz = Math.max(0, Math.min(size - 1, Math.floor(z)))
  const fx = x - cx
  const fz = z - cz

  const nx = Math.min(cx + 1, size - 1)
  const nz = Math.min(cz + 1, size - 1)

  const h00 = heightmap[cz * size + cx]
  const h10 = heightmap[cz * size + nx]
  const h01 = heightmap[nz * size + cx]
  const h11 = heightmap[nz * size + nx]

  const h0 = h00 + (h10 - h00) * fx
  const h1 = h01 + (h11 - h01) * fx
  return h0 + (h1 - h0) * fz
}

export function explodeTerrain(
  heightmap: Float32Array,
  cx: number,
  cz: number,
  radius: number,
  depth: number
): void {
  const size = TERRAIN_SIZE
  const r = Math.ceil(radius)

  const minX = Math.max(0, Math.floor(cx - r))
  const maxX = Math.min(size - 1, Math.ceil(cx + r))
  const minZ = Math.max(0, Math.floor(cz - r))
  const maxZ = Math.min(size - 1, Math.ceil(cz + r))

  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx
      const dz = z - cz
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist <= radius) {
        const falloff = 1 - dist / radius
        heightmap[z * size + x] -= depth * falloff
        if (heightmap[z * size + x] < 0) {
          heightmap[z * size + x] = 0
        }
      }
    }
  }
}
