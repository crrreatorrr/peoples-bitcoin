/**
 * Seeded PRNG (mulberry32). All sim randomness goes through here so tests and
 * server replays are deterministic. The state is a plain object stored inside
 * GameState, so a save/load continues the same sequence.
 */
export interface RngState {
  s: number;
}

const UINT32 = 4294967296;

export function createRng(seed: number): RngState {
  return { s: seed >>> 0 };
}

export function nextUint32(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform float in [0, 1). */
export function nextFloat(rng: RngState): number {
  return nextUint32(rng) / UINT32;
}

/** Uniform integer in [min, max] (inclusive). */
export function nextInt(rng: RngState, min: number, max: number): number {
  return min + Math.floor(nextFloat(rng) * (max - min + 1));
}

/** True with probability p. */
export function chance(rng: RngState, p: number): boolean {
  return nextFloat(rng) < p;
}

/** Standard normal sample (Box–Muller). */
export function nextGaussian(rng: RngState): number {
  const u1 = 1 - nextFloat(rng); // (0, 1], avoids log(0)
  const u2 = nextFloat(rng);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
