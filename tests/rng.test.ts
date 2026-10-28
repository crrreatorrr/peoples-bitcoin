import { describe, expect, it } from 'vitest';
import { chance, createRng, nextFloat, nextGaussian, nextInt } from '../src/sim/rng';

describe('seeded rng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => nextFloat(a));
    const seqB = Array.from({ length: 20 }, () => nextFloat(b));
    expect(seqA).toEqual(seqB);
  });

  it('differs between seeds', () => {
    expect(nextFloat(createRng(1))).not.toBe(nextFloat(createRng(2)));
  });

  it('stays in range', () => {
    const rng = createRng(7);
    for (let i = 0; i < 5000; i++) {
      const f = nextFloat(rng);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = nextInt(rng, 3, 6);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
  });

  it('honours probability extremes', () => {
    const rng = createRng(9);
    for (let i = 0; i < 1000; i++) {
      expect(chance(rng, 1)).toBe(true);
      expect(chance(rng, 0)).toBe(false);
    }
  });

  it('produces roughly standard normal samples', () => {
    const rng = createRng(99);
    const n = 20000;
    const xs = Array.from({ length: n }, () => nextGaussian(rng));
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
  });
});
