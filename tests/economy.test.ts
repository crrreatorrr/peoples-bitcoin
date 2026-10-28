import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../src/config/balance';
import { createEconomy, marketCapUsd, priceDrift, stepEconomy, updatePrice } from '../src/sim/economy';
import { createRng } from '../src/sim/rng';

describe('price model', () => {
  it('only updates every priceUpdateEveryTicks ticks', () => {
    const econ = createEconomy();
    const rng = createRng(1);
    for (let tick = 1; tick < ECONOMY.priceUpdateEveryTicks; tick++) stepEconomy(econ, rng, tick);
    expect(econ.history).toHaveLength(1);
    stepEconomy(econ, rng, ECONOMY.priceUpdateEveryTicks);
    expect(econ.history).toHaveLength(2);
    expect(econ.history.at(-1)).toBe(econ.priceUsd);
  });

  it('is deterministic for a seed', () => {
    const a = createEconomy();
    const b = createEconomy();
    const ra = createRng(5);
    const rb = createRng(5);
    for (let i = 0; i < 50; i++) {
      updatePrice(a, ra);
      updatePrice(b, rb);
    }
    expect(a.history).toEqual(b.history);
  });

  it('caps history at historyLength points', () => {
    const econ = createEconomy();
    const rng = createRng(3);
    for (let i = 0; i < ECONOMY.historyLength + 50; i++) updatePrice(econ, rng);
    expect(econ.history).toHaveLength(ECONOMY.historyLength);
  });

  it('never drops below the floor', () => {
    const econ = createEconomy();
    econ.recentDumps = 1e6; // enormous negative drift
    const rng = createRng(4);
    for (let i = 0; i < 100; i++) updatePrice(econ, rng);
    expect(econ.priceUsd).toBe(ECONOMY.priceFloorUsd);
    expect(Math.min(...econ.history)).toBeGreaterThanOrEqual(ECONOMY.priceFloorUsd);
  });

  it('has zero drift at neutral hopium with no wins or dumps', () => {
    expect(priceDrift(createEconomy())).toBe(0);
  });

  it('drifts up with high hopium and boss wins, down with dumps', () => {
    const run = (setup: (e: ReturnType<typeof createEconomy>) => void) => {
      const econ = createEconomy();
      setup(econ);
      const rng = createRng(11); // same noise for every scenario
      for (let i = 0; i < 100; i++) updatePrice(econ, rng);
      return econ.priceUsd;
    };
    const neutral = run(() => {});
    expect(run((e) => (e.hopium = 100))).toBeGreaterThan(neutral);
    expect(run((e) => (e.hopium = 0))).toBeLessThan(neutral);
    expect(run((e) => (e.recentBossWins = 5))).toBeGreaterThan(neutral);
    expect(run((e) => (e.recentDumps = 5))).toBeLessThan(neutral);
  });

  it('computes market cap from supply', () => {
    const econ = createEconomy();
    expect(marketCapUsd(econ)).toBeCloseTo(ECONOMY.startPriceUsd * ECONOMY.supply);
  });
});
