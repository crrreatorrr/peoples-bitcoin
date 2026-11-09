import { describe, expect, it } from 'vitest';
import { GODMODE } from '../src/config/balance';
import { applyGodmode, godmodeEnabled } from '../src/game/godmode';
import { spendTickets } from '../src/sim/ledger';
import type { SimEvent } from '../src/sim/state';
import { newGame } from './helpers';

const freshState = () => newGame().state;

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('godmode flag', () => {
  it('is off by default', () => {
    expect(godmodeEnabled('', memoryStore())).toBe(false);
  });

  it('turns on with ?godmode and stays on for later visits', () => {
    const store = memoryStore();
    expect(godmodeEnabled('?godmode', store)).toBe(true);
    expect(godmodeEnabled('', store)).toBe(true);
  });

  it('turns off with ?godmode=0', () => {
    const store = memoryStore();
    godmodeEnabled('?godmode=1', store);
    expect(godmodeEnabled('?godmode=0', store)).toBe(false);
    expect(godmodeEnabled('', store)).toBe(false);
  });

  it('works for one visit when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(godmodeEnabled('?godmode', broken)).toBe(true);
    expect(godmodeEnabled('', broken)).toBe(false);
    expect(godmodeEnabled('?godmode', null)).toBe(true);
  });
});

describe('applyGodmode', () => {
  it('fills the standalone wallet to 90,000,000,000 Tickets', () => {
    const state = freshState();
    expect(GODMODE.tickets).toBe(90_000_000_000);
    expect(applyGodmode(state)).toBe(true);
    expect(state.player.currencies.tickets).toBe(90_000_000_000);
    expect(applyGodmode(state)).toBe(false);
  });

  it('tops the wallet back up after spending', () => {
    const state = freshState();
    applyGodmode(state);
    const events: SimEvent[] = [];
    expect(spendTickets(state, 1_000, 'item_any', events)).toBe(true);
    expect(state.player.currencies.tickets).toBe(GODMODE.tickets - 1_000);
    expect(applyGodmode(state)).toBe(true);
    expect(state.player.currencies.tickets).toBe(GODMODE.tickets);
  });

  it('never lowers a bigger wallet', () => {
    const state = freshState();
    state.player.currencies.tickets = GODMODE.tickets + 5;
    expect(applyGodmode(state)).toBe(false);
    expect(state.player.currencies.tickets).toBe(GODMODE.tickets + 5);
  });

  it('leaves hub sessions to the server', () => {
    const state = freshState();
    state.hubSession.mode = 'hub';
    state.player.currencies.tickets = 12;
    expect(applyGodmode(state)).toBe(false);
    expect(state.player.currencies.tickets).toBe(12);
  });
});
