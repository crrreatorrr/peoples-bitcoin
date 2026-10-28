/**
 * $BITCOIN price model (DESIGN.md §6): a multiplicative random walk with drift,
 * updated every few ticks, clamped to a floor, with a fixed-length history for
 * the ticker sparkline.
 */
import { ECONOMY } from '../config/balance';
import { nextGaussian, type RngState } from './rng';
import type { EconomyState } from './state';

export function createEconomy(): EconomyState {
  return {
    priceUsd: ECONOMY.startPriceUsd,
    history: [ECONOMY.startPriceUsd],
    hopium: ECONOMY.startHopium,
    recentBossWins: 0,
    recentDumps: 0,
  };
}

/** drift = k1*(hopium-50) + k2*recentBossWins - k3*recentDumps, as a log-return per update. */
export function priceDrift(econ: EconomyState): number {
  return (
    ECONOMY.k1Hopium * (econ.hopium - ECONOMY.hopiumNeutral) +
    ECONOMY.k2BossWins * econ.recentBossWins -
    ECONOMY.k3Dumps * econ.recentDumps
  );
}

export function updatePrice(econ: EconomyState, rng: RngState): void {
  const logReturn = priceDrift(econ) + ECONOMY.volatility * nextGaussian(rng);
  econ.priceUsd = Math.max(ECONOMY.priceFloorUsd, econ.priceUsd * Math.exp(logReturn));
  econ.history.push(econ.priceUsd);
  if (econ.history.length > ECONOMY.historyLength) {
    econ.history.splice(0, econ.history.length - ECONOMY.historyLength);
  }
  econ.recentBossWins *= ECONOMY.recentDecay;
  econ.recentDumps *= ECONOMY.recentDecay;
}

export function stepEconomy(econ: EconomyState, rng: RngState, tick: number): void {
  if (tick % ECONOMY.priceUpdateEveryTicks === 0) updatePrice(econ, rng);
}

export function marketCapUsd(econ: EconomyState): number {
  return econ.priceUsd * ECONOMY.supply;
}
