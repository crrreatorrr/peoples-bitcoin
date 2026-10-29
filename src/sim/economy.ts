/**
 * Unused price walk kept so the existing economy tests still load.
 * The game no longer steps it, shows it, or charges it. Tickets come from
 * streams, quest rewards, and the shop table.
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

/**
 * drift = k1*(hopium-50) + k2*recentBossWins - k3*recentDumps - k4*ln(price/anchor), as a
 * log-return per update. The last term pulls the price back so it can't wander off for good.
 */
export function priceDrift(econ: EconomyState): number {
  return (
    ECONOMY.k1Hopium * (econ.hopium - ECONOMY.hopiumNeutral) +
    ECONOMY.k2BossWins * econ.recentBossWins -
    ECONOMY.k3Dumps * econ.recentDumps -
    ECONOMY.k4Revert * Math.log(econ.priceUsd / ECONOMY.anchorPriceUsd)
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
