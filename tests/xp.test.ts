import { describe, expect, it } from 'vitest';
import { XP_CURVE } from '../src/config/balance';
import type { SimEvent } from '../src/sim/state';
import { grantXp, levelForXp, xpForLevel } from '../src/sim/xp';
import { newGame } from './helpers';

describe('OSRS XP curve', () => {
  it('matches known OSRS table values', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(83);
    expect(xpForLevel(10)).toBe(1154);
    expect(xpForLevel(50)).toBe(101333);
    expect(xpForLevel(92)).toBe(6517253);
    expect(xpForLevel(99)).toBe(13034431);
  });

  it('maps XP to levels at the boundaries', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(82.9)).toBe(1);
    expect(levelForXp(83)).toBe(2);
    expect(levelForXp(13034430)).toBe(98);
    expect(levelForXp(13034431)).toBe(99);
    expect(levelForXp(XP_CURVE.maxXp)).toBe(99);
  });

  it('round-trips every level', () => {
    for (let level = 1; level <= 99; level++) expect(levelForXp(xpForLevel(level))).toBe(level);
  });
});

describe('grantXp', () => {
  it('emits an xp drop and a level-up message when crossing a level', () => {
    const { state } = newGame();
    state.player.skills.mining = 80;
    const events: SimEvent[] = [];
    grantXp(state.player, 'mining', 'Mining', 17.5, events);
    expect(state.player.skills.mining).toBe(97.5);
    expect(events).toContainEqual({ type: 'xp', skillId: 'mining', amount: 17.5 });
    expect(events).toContainEqual({ type: 'levelUp', skillId: 'mining', level: 2 });
    expect(
      events.some((e) => e.type === 'message' && e.text.includes('Mining level is now 2')),
    ).toBe(true);
  });

  it('does not emit a level-up without crossing a level', () => {
    const { state } = newGame();
    const events: SimEvent[] = [];
    grantXp(state.player, 'mining', 'Mining', 10, events);
    expect(events.filter((e) => e.type === 'levelUp')).toHaveLength(0);
  });

  it('caps XP at the maximum', () => {
    const { state } = newGame();
    state.player.skills.mining = XP_CURVE.maxXp - 1;
    grantXp(state.player, 'mining', 'Mining', 50, []);
    expect(state.player.skills.mining).toBe(XP_CURVE.maxXp);
  });
});
