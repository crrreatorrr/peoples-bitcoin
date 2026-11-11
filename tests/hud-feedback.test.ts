import { describe, expect, it } from 'vitest';
import { UI } from '../src/config/balance';
import { LowHpWatch, isLowHp, walletFraction } from '../src/game/hudFeedback';
import { addStreamUsd } from '../src/sim/ledger';
import { content, give, newGame } from './helpers';

describe('wallet fraction (HUD)', () => {
  it('is empty on a new game and shows what each source has banked', () => {
    const { state } = newGame();
    expect(walletFraction(state)).toEqual({ total: 0, progress: 0, parts: [] });
    addStreamUsd(state, 'pb_sell', 6.9); // one Scrap Hash: 0.276 Tickets
    addStreamUsd(state, 'pb_drop', 12.5); // half a Ticket of loot
    const part = walletFraction(state);
    expect(part.total).toBeCloseTo(0.776);
    expect(part.progress).toBeCloseTo(0.5);
    expect(part.parts).toEqual(['loot 0.50', 'sales 0.28']);
    // A whole Ticket leaves the fraction and lands in the wallet.
    addStreamUsd(state, 'pb_drop', 12.5);
    expect(state.player.currencies.tickets).toBe(1);
    expect(walletFraction(state).parts).toEqual(['sales 0.28']);
  });

  it('reads the stream pockets in a hub session', () => {
    const { state } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_lobby', 5);
    expect(walletFraction(state).parts).toEqual(['favors 0.20']);
  });
});

describe('low-health prompt', () => {
  it('warns once when HP first drops to the line with food in the pack, then re-arms', () => {
    const { state } = newGame();
    const watch = new LowHpWatch();
    give(state, 'item_tp_soundbite', 1);
    state.player.hp = 10;
    expect(watch.check(state, content())).toBeNull();
    state.player.hp = Math.floor(10 * UI.lowHpWarnPct);
    expect(isLowHp(state)).toBe(true);
    const text = watch.check(state, content());
    expect(text).toMatch(/health is low/);
    expect(text).toMatch(/Recite a Soundbite/);
    // Not again while it stays low.
    state.player.hp = 1;
    expect(watch.check(state, content())).toBeNull();
    // Back above the line, then down again: it warns again.
    state.player.hp = 9;
    expect(watch.check(state, content())).toBeNull();
    state.player.hp = 2;
    expect(watch.check(state, content())).not.toBeNull();
  });

  it('stays quiet without food, and at 0 HP', () => {
    const { state } = newGame();
    const watch = new LowHpWatch();
    state.player.hp = 2;
    expect(watch.check(state, content())).toBeNull();
    // Food picked up while still low: the warning is still owed.
    give(state, 'item_tp_soundbite', 1);
    expect(watch.check(state, content())).not.toBeNull();
    state.player.hp = 0;
    expect(isLowHp(state)).toBe(false);
  });
});
