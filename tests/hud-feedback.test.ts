import { describe, expect, it } from 'vitest';
import { UI } from '../src/config/balance';
import { LowHpWatch, isLowHp, walletFraction, walletFractionText } from '../src/game/hudFeedback';
import { addStreamUsd } from '../src/sim/ledger';
import { content, give, newGame } from './helpers';

describe('wallet fraction (HUD)', () => {
  it('is empty on a new game and shows what each source has banked', () => {
    const { state } = newGame();
    expect(walletFraction(state)).toEqual({ progress: 0, lead: null, parts: [] });
    addStreamUsd(state, 'pb_sell', 6.9); // one Scrap Hash: 0.276 Tickets
    addStreamUsd(state, 'pb_drop', 12.5); // half a Ticket of loot
    const part = walletFraction(state);
    expect(part.progress).toBeCloseTo(0.5);
    expect(part.lead).toBe('loot');
    expect(part.parts).toEqual(['loot 0.50', 'sales 0.28']);
    // A whole Ticket leaves the fraction and lands in the wallet.
    addStreamUsd(state, 'pb_drop', 12.5);
    expect(state.player.currencies.tickets).toBe(1);
    expect(walletFraction(state)).toMatchObject({ lead: 'sales', parts: ['sales 0.28'] });
  });

  it('never adds the pockets: loot 0.22 and sales 0.38 show 0.38, not 0.60', () => {
    const { state } = newGame();
    addStreamUsd(state, 'pb_drop', 5.5);
    addStreamUsd(state, 'pb_sell', 9.5);
    const part = walletFraction(state);
    expect(part.lead).toBe('sales');
    expect(walletFractionText(part.progress)).toBe('0.38');
    expect(part.parts).toEqual(['loot 0.22', 'sales 0.38']);
  });

  it('stays under 1 with no Ticket due, however full the pockets are between them', () => {
    const { state } = newGame();
    addStreamUsd(state, 'pb_drop', 24.9);
    addStreamUsd(state, 'pb_lobby', 24.9);
    addStreamUsd(state, 'pb_sell', 24.99);
    expect(state.player.currencies.tickets).toBe(0);
    const part = walletFraction(state);
    expect(part.progress).toBeLessThan(1);
    expect(part.lead).toBe('sales');
    // 0.9996 of a Ticket reads 0.99: "1.00" would claim a Ticket that has not been paid.
    expect(walletFractionText(part.progress)).toBe('0.99');
    expect(part.parts).toEqual(['loot 0.99', 'favors 0.99', 'sales 0.99']);
  });

  it('reads the stream pockets in a hub session', () => {
    const { state } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_lobby', 5);
    expect(walletFraction(state)).toMatchObject({ lead: 'favors', parts: ['favors 0.20'] });
    // Showing the fraction never moves anything between the per-stream pockets the hub is told about.
    expect(state.player.ledger.streams.pb_lobby).toMatchObject({ remainder: 0.2, pending: 0 });
    expect(state.player.ledger.streams.pb_drop.remainder).toBe(0);
    expect(state.player.ledger.streams.pb_sell.remainder).toBe(0);
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
