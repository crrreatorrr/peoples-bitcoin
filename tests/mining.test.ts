import { describe, expect, it } from 'vitest';
import { MINING } from '../src/config/balance';
import { addItem } from '../src/sim/inventory';
import { miningSuccessChance } from '../src/sim/mining';
import type { GameState, ObjectInstance } from '../src/sim/state';
import { runTick } from '../src/sim/tick';
import { xpForLevel } from '../src/sim/xp';
import { content, messages, newGame, runUntil } from './helpers';

function rackAt(state: GameState, x: number, y: number): ObjectInstance {
  const rack = state.zone.objects.find((o) => o.x === x && o.y === y);
  if (!rack) throw new Error(`no object at ${x},${y}`);
  return rack;
}

const mine = (rack: ObjectInstance) => [{ type: 'interact' as const, targetId: rack.id, action: 'Mine' }];

describe('mining', () => {
  it('scales success chance with level and caps it', () => {
    expect(miningSuccessChance(1, 1)).toBeCloseTo(MINING.successAtReq);
    expect(miningSuccessChance(11, 1)).toBeCloseTo(MINING.successAtReq + 10 * MINING.successPerLevel);
    expect(miningSuccessChance(99, 1)).toBe(MINING.successMax);
  });

  it('mines a dusty rack: item + XP', () => {
    const { state, ctx } = newGame();
    const rack = rackAt(state, 27, 27);
    state.player.pos = { x: 26, y: 27 };

    const events = runUntil(state, ctx, (ev) => ev.some((e) => e.type === 'xp'), mine(rack));

    expect(messages(events)).toContain('You plug in and start mining the rack.');
    expect(messages(events)).toContain('You mine some Scrap Hash.');
    expect(state.player.inventory[0]).toEqual({ itemId: 'item_scrap_hash', qty: 1 });
    expect(state.player.skills.mining).toBe(17.5);
  });

  it('walks to a distant rack before mining', () => {
    const { state, ctx } = newGame();
    const rack = rackAt(state, 27, 27);
    runUntil(state, ctx, (ev) => ev.some((e) => e.type === 'xp'), mine(rack));
    const { x, y } = state.player.pos;
    expect(Math.abs(x - 27) + Math.abs(y - 27)).toBe(1);
  });

  it('only attempts every attemptIntervalTicks ticks', () => {
    const { state, ctx } = newGame();
    const rack = rackAt(state, 27, 27);
    state.player.pos = { x: 26, y: 27 };
    runTick(state, ctx, mine(rack));
    const firstAttempt = state.player.action!.nextAttemptTick!;
    expect(firstAttempt).toBe(state.tick + MINING.attemptIntervalTicks);
  });

  it('refuses racks above the player level', () => {
    const { state, ctx } = newGame();
    const rack = rackAt(state, 8, 6); // liquid-cooled, level 30
    state.player.pos = { x: 8, y: 7 };
    const events = runTick(state, ctx, mine(rack));
    expect(messages(events)).toContain('You need a Mining level of 30 to mine this rack.');
    expect(state.player.action).toBeNull();
  });

  it('stops when the inventory is full', () => {
    const { state, ctx } = newGame();
    const hash = content().items.get('item_scrap_hash')!;
    for (let i = 0; i < 28; i++) addItem(state.player.inventory, hash);
    const rack = rackAt(state, 27, 27);
    state.player.pos = { x: 26, y: 27 };
    const events = runTick(state, ctx, mine(rack));
    expect(messages(events)).toContain('Your inventory is too full to hold any more hash.');
    expect(state.player.action).toBeNull();
  });

  it('depletes a rack, stops mining, and respawns it after respawnTicks', () => {
    const { state, ctx } = newGame();
    state.player.skills.mining = xpForLevel(15);
    const rack = rackAt(state, 29, 15); // humming: always depletes, respawns in 9 ticks
    state.player.pos = { x: 28, y: 15 };

    runUntil(state, ctx, (ev) => ev.some((e) => e.type === 'xp'), mine(rack));
    expect(rack.depletedUntil).toBe(state.tick + 9);
    expect(state.player.action).toBeNull();

    // Clicking it again while overheated is refused.
    const again = runTick(state, ctx, mine(rack));
    expect(messages(again)).toContain('This rack is overheated. Give it a moment to cool down.');

    for (let i = 0; i < 8; i++) runTick(state, ctx, []);
    expect(rack.depletedUntil).toBeNull();
  });

  it('levels up with a message', () => {
    const { state, ctx } = newGame();
    state.player.skills.mining = 80;
    const rack = rackAt(state, 27, 27);
    state.player.pos = { x: 26, y: 27 };
    const events = runUntil(state, ctx, (ev) => ev.some((e) => e.type === 'xp'), mine(rack));
    expect(events).toContainEqual({ type: 'levelUp', skillId: 'mining', level: 2 });
    expect(messages(events)).toContain('ATTENTION ATTENTION: Your Mining level is now 2.');
  });

  it('keeps mining across many attempts until stopped', () => {
    const { state, ctx } = newGame(77);
    state.player.pos = { x: 26, y: 27 };
    const racks = [rackAt(state, 27, 27), rackAt(state, 29, 27), rackAt(state, 31, 27)];
    // Mine whichever rack is available for a while; XP should keep climbing.
    for (let i = 0; i < 400; i++) {
      const intents = state.player.action
        ? []
        : mine(racks.find((r) => r.depletedUntil === null) ?? racks[0]);
      runTick(state, ctx, intents);
    }
    expect(state.player.skills.mining).toBeGreaterThan(200);
  });
});
