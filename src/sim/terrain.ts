import { TERRAIN_SIZE, TERRAIN_HEIGHT_SCALE } from '@shared/constants'
import type { PRNG } from './prng'

function gauss(x: number, mu: number, sigma: number): number {
  return Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma))
}

export function generateFixedTerrain(): Float32Array {
  const size = TERRAIN_SIZE
  const map = new Float32Array(size * size)

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size
      const nz = z / size

      // Two raised base platforms where teams spawn
      const leftBase  = gauss(nx, 0.20, 0.11) * gauss(nz, 0.50, 0.22) * 0.42
      const rightBase = gauss(nx, 0.80, 0.11) * gauss(nz, 0.50, 0.22) * 0.42

      // Central tactical hills — offset from each other for asymmetric cover
      const hillL = gauss(nx, 0.41, 0.065) * gauss(nz, 0.44, 0.10) * 0.30
      const hillR = gauss(nx, 0.59, 0.065) * gauss(nz, 0.56, 0.10) * 0.30

      // North/south cover bumps off the main battle line
      const coverN = gauss(nx, 0.50, 0.09) * gauss(nz, 0.33, 0.09) * 0.22
      const coverS = gauss(nx, 0.50, 0.09) * gauss(nz, 0.67, 0.09) * 0.22

      // Base shape: consistent floor, gentle dip at absolute center
      const baseShape = 0.50 - gauss(nx, 0.50, 0.18) * 0.08

      // Z-axis rolling for depth variety
      const zWave = Math.sin(nz * Math.PI * 2.8) * 0.032 + Math.sin(nz * Math.PI * 6.1) * 0.016

      const h = baseShape + leftBase + rightBase + hillL + hillR + coverN + coverS + zWave

      // Island edge falloff
      const ex = Math.min(nx, 1 - nx) * 3.5
      const ez = Math.min(nz, 1 - nz) * 3.5
      const edgeFalloff = Math.pow(Math.min(1, ex) * Math.min(1, ez), 1.5)

      map[z * size + x] = Math.max(0, h * TERRAIN_HEIGHT_SCALE * edgeFalloff)
    }
  }

  return map
}

export function generateTerrain(prng: PRNG): Float32Array {
  const size = TERRAIN_SIZE
  const heightmap = new Float32Array(size * size)

  // Low-frequency base shape (broad hills/valleys) — 5 octaves
  const basePhases = Array.from({ length: 5 }, () => prng.next() * Math.PI * 2)
  const basePhasesZ = Array.from({ length: 5 }, () => prng.next() * Math.PI * 2)
  const baseFreqs = [0.8, 1.5, 2.4, 3.2, 4.8]
  const baseAmps = [1.2, 0.6, 0.35, 0.18, 0.09]

  // Ridge noise — sharp peaks via abs(sin)
  const ridgePhases = Array.from({ length: 4 }, () => prng.next() * Math.PI * 2)
  const ridgePhasesZ = Array.from({ length: 4 }, () => prng.next() * Math.PI * 2)
  const ridgeFreqs = [3.0, 5.5, 8.0, 12.0]
  const ridgeAmps = [0.28, 0.15, 0.08, 0.04]

  // Erosion channels — carve valleys using diagonal sin waves
  const erosionPhase1 = prng.next() * Math.PI * 2
  const erosionPhase2 = prng.next() * Math.PI * 2

  // Central valley for tactical gameplay
  const valleyCenter = 0.35 + prng.next() * 0.30
  const valleyWidth = 0.08 + prng.next() * 0.06

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size
      const nz = z / size

      // Base rolling hills (fBm)
      let h = 0
      for (let i = 0; i < 5; i++) {
        h += Math.sin(nx * Math.PI * 2 * baseFreqs[i] + basePhases[i]) * baseAmps[i]
        h += Math.sin(nz * Math.PI * 2 * baseFreqs[i] + basePhasesZ[i]) * baseAmps[i] * 0.7
      }

      // Ridges — V-shaped peaks
      let ridge = 0
      for (let i = 0; i < 4; i++) {
        ridge += (1 - Math.abs(Math.sin(nx * Math.PI * ridgeFreqs[i] + ridgePhases[i]))) * ridgeAmps[i]
        ridge += (1 - Math.abs(Math.sin(nz * Math.PI * ridgeFreqs[i] + ridgePhasesZ[i]))) * ridgeAmps[i] * 0.6
      }

      // Erosion channels — diagonal grooves that carve into the terrain
      const erosion1 = Math.abs(Math.sin((nx + nz) * Math.PI * 6 + erosionPhase1))
      const erosion2 = Math.abs(Math.sin((nx - nz) * Math.PI * 4.5 + erosionPhase2))
      const erosionCarve = Math.min(erosion1, erosion2) * 0.12

      // Valley — a gentle dip across the map for tactical positioning
      const valleyDist = Math.abs(nz - valleyCenter) / valleyWidth
      const valleyDepth = valleyDist < 1 ? (1 - valleyDist * valleyDist) * 0.25 : 0

      // Spawn plateaus — flatter areas where teams start
      const leftPlateau = gauss(nx, 0.18, 0.08) * gauss(nz, 0.50, 0.18) * 0.15
      const rightPlateau = gauss(nx, 0.82, 0.08) * gauss(nz, 0.50, 0.18) * 0.15

      const combinedH = h + ridge - erosionCarve - valleyDepth + leftPlateau + rightPlateau

      // Island edge falloff — steep cliff edges
      const ex = Math.min(nx, 1 - nx) * 4.0
      const ez = Math.min(nz, 1 - nz) * 4.0
      const edgeFalloff = Math.min(1, ex) * Math.min(1, ez)
      const steepEdge = edgeFalloff * edgeFalloff

      const baseline = TERRAIN_HEIGHT_SCALE * 0.48
      const amplitude = TERRAIN_HEIGHT_SCALE * 0.38
      heightmap[z * size + x] = Math.max(0, (baseline + combinedH * amplitude) * steepEdge)
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
