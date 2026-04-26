export function mulberry32(state: number): [number, number] {
  let t = (state + 0x6D2B79F5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return [value, (state + 0x6D2B79F5) | 0]
}

export function createPRNG(seed: number) {
  let state = seed | 0

  function next(): number {
    let t = (state += 0x6D2B79F5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  function nextInt(min: number, max: number): number {
    return min + Math.floor(next() * (max - min + 1))
  }

  function nextFloat(min: number, max: number): number {
    return min + next() * (max - min)
  }

  function getState(): number {
    return state
  }

  return { next, nextInt, nextFloat, getState }
}

export type PRNG = ReturnType<typeof createPRNG>
