import { describe, expect, it } from 'vitest';
import { START_ZONE_ID, TICK_MS } from '../src/config/balance';
import { buildFeedbackContext, newQuestSteps } from '../src/game/feedbackContext';
import { CrashGuard } from '../src/game/crash';
import { recentErrors } from '../src/game/feedback';
import { createGameState, type GameState } from '../src/sim/state';
import { xpForLevel } from '../src/sim/xp';
import { content } from './helpers';

function fresh(): GameState {
  return createGameState(content(), START_ZONE_ID, 7);
}

describe('feedback context', () => {
  it('reports area, mode, position, time and build for an offline game', () => {
    const state = fresh();
    state.tick = 50;
    const ctx = buildFeedbackContext({ state, mode: 'offline', world: null, simVersion: 'abc' });
    expect(ctx.level).toBe(START_ZONE_ID);
    expect(ctx.mode).toBe('offline');
    expect(ctx.position).toEqual({ x: state.player.pos.x, y: state.player.pos.y });
    expect(ctx.gameTime).toBe((50 * TICK_MS) / 1000);
    expect(ctx.extra).toMatchObject({
      simVersion: 'abc',
      world: null,
      role: 'local',
      tick: 50,
      playerId: state.pid,
      hub: 'standalone',
    });
  });

  it('summarises the player: health, levels, inventory, action and target', () => {
    const state = fresh();
    const p = state.player;
    p.skills.mining = xpForLevel(12);
    p.inventory[0] = { itemId: 'x', qty: 1 };
    p.inventory[3] = { itemId: 'y', qty: 5 };
    const enemy = state.zone.enemies[0];
    if (enemy) p.action = { targetId: enemy.id, action: 'Attack', nextAttemptTick: null };
    const player = buildFeedbackContext({ state, mode: 'online', world: 2, simVersion: 's' })
      .player as Record<string, unknown>;
    expect(player.hp).toBe(p.hp);
    expect((player.skills as Record<string, number>).mining).toBe(12);
    expect(player.inventoryCount).toBe(
      state.player.inventory.filter((slot) => slot !== null).length,
    );
    if (enemy) {
      expect(player.action).toEqual({ action: 'Attack', targetId: enemy.id });
      expect(player.combatTarget).toEqual({ id: enemy.id, def: enemy.defId, hp: enemy.hp });
    } else {
      expect(player.combatTarget).toBeNull();
    }
  });

  it('marks online play with its world', () => {
    const ctx = buildFeedbackContext({ state: fresh(), mode: 'online', world: 3, simVersion: 's' });
    expect(ctx.mode).toBe('online');
    expect(ctx.extra).toMatchObject({ world: 3, role: 'client' });
  });

  it('never throws: no state yet, or a broken one', () => {
    const none = buildFeedbackContext({
      state: null,
      mode: 'offline',
      world: null,
      simVersion: 's',
    });
    expect(none.level).toBe('world-select');
    expect(none.position).toBeUndefined();
    const broken = { zone: { id: 'z' }, player: null } as unknown as GameState;
    const ctx = buildFeedbackContext({
      state: broken,
      mode: 'offline',
      world: null,
      simVersion: 's',
    });
    expect(ctx.level).toBe('z');
    expect(typeof ctx.extra?.contextError).toBe('string');
  });

  it('stays small enough for the note', () => {
    const ctx = buildFeedbackContext({
      state: fresh(),
      mode: 'offline',
      world: null,
      simVersion: 's',
    });
    expect(JSON.stringify(ctx).length).toBeLessThan(3000);
  });
});

describe('quest step breadcrumbs', () => {
  it('reports only steps finished after the first look', () => {
    const quests = { q1: { done: ['a'], complete: false, choices: [] } };
    const seen = new Map<string, number>();
    expect(newQuestSteps(seen, quests, true)).toEqual([]);
    expect(newQuestSteps(seen, quests)).toEqual([]);
    quests.q1.done.push('b');
    expect(newQuestSteps(seen, quests)).toEqual([{ quest: 'q1', step: 'b', complete: false }]);
    expect(newQuestSteps(seen, quests)).toEqual([]);
  });
});

describe('recent errors for a note', () => {
  it('keeps the newest crash-guard errors, once each', () => {
    const guard = new CrashGuard({ log: () => {}, surface: null, threshold: 2 });
    const errors = recentErrors(guard, 2);
    guard.report(new Error('one'), 'frame');
    guard.report(new Error('two'), 'frame'); // also the fatal report, which is not listed twice
    guard.report(new Error('three'), 'error');
    expect(errors().map((e) => (e as { message: string }).message)).toEqual(['two', 'three']);
  });
});
