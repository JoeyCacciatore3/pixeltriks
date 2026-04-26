import { TERRAIN_SIZE, TERRAIN_HEIGHT_SCALE } from '@shared/constants'
import type { PRNG } from './prng'

export function generateTerrain(prng: PRNG): Float32Array {
  const size = TERRAIN_SIZE
  const heightmap = new Float32Array(size * size)

  // Low-frequency base shape (broad hills/valleys)
  const basePhases = Array.from({ length: 4 }, () => prng.next() * Math.PI * 2)
  const basePhasesZ = Array.from({ length: 4 }, () => prng.next() * Math.PI * 2)
  const baseFreqs = [1.0, 1.8, 2.6, 3.4]
  const baseAmps = [1.0, 0.5, 0.28, 0.15]

  // High-frequency ridges (sharp peaks using abs(sin))
  const ridgePhases = Array.from({ length: 3 }, () => prng.next() * Math.PI * 2)
  const ridgePhasesZ = Array.from({ length: 3 }, () => prng.next() * Math.PI * 2)
  const ridgeFreqs = [4.0, 6.5, 9.0]
  const ridgeAmps = [0.22, 0.12, 0.06]

  // Plateau mask — random flat areas mixed with the noise
  const plateauPhase = prng.next() * Math.PI * 2

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size
      const nz = z / size

      // Base rolling hills (fBm)
      let h = 0
      for (let i = 0; i < 4; i++) {
        h += Math.sin(nx * Math.PI * 2 * baseFreqs[i] + basePhases[i]) * baseAmps[i]
        h += Math.sin(nz * Math.PI * 2 * baseFreqs[i] + basePhasesZ[i]) * baseAmps[i] * 0.6
      }

      // Sharp ridges (abs(sin) creates V-shaped peaks and flat valleys)
      let ridge = 0
      for (let i = 0; i < 3; i++) {
        ridge += (1 - Math.abs(Math.sin(nx * Math.PI * ridgeFreqs[i] + ridgePhases[i]))) * ridgeAmps[i]
        ridge += (1 - Math.abs(Math.sin(nz * Math.PI * ridgeFreqs[i] + ridgePhasesZ[i]))) * ridgeAmps[i] * 0.5
      }

      // Plateau effect: smooth out some areas using a low-freq mask
      const plateauMask = (Math.sin(nx * Math.PI * 2.5 + plateauPhase) + 1) * 0.5
      const combinedH = h + ridge * (0.6 + plateauMask * 0.4)

      // Island edge falloff — steeper curve for dramatic cliff edges
      const ex = Math.min(nx, 1 - nx) * 3.5
      const ez = Math.min(nz, 1 - nz) * 3.5
      const edgeFalloff = Math.min(1, ex) * Math.min(1, ez)
      const steepEdge = edgeFalloff * edgeFalloff  // steeper cliffs at map edge

      const baseline = TERRAIN_HEIGHT_SCALE * 0.50
      const amplitude = TERRAIN_HEIGHT_SCALE * 0.32
      heightmap[z * size + x] = (baseline + combinedH * amplitude) * steepEdge
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
        const falloff = (1 - dist / radius) ** 2
        heightmap[z * size + x] -= depth * falloff
        if (heightmap[z * size + x] < 0) {
          heightmap[z * size + x] = 0
        }
      }
    }
  }
}
