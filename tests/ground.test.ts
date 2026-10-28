import { describe, expect, it } from 'vitest';
import { GROUND_ITEMS } from '../src/config/balance';
import { addItem, countItem } from '../src/sim/inventory';
import { runTick } from '../src/sim/tick';
import { content, messages, newGame, runUntil } from './helpers';

const hash = () => content().items.get('item_scrap_hash')!;

describe('ground items', () => {
  it('can be taken back after walking onto the tile', () => {
    const { state, ctx } = newGame();
    addItem(state.player.inventory, hash());
    runTick(state, ctx, [{ type: 'dropItem', slot: 0 }]);
    const dropped = state.zone.groundItems[0];
    runUntil(state, ctx, () => state.player.path.length === 0, [{ type: 'walk', x: 22, y: 33 }]);

    runUntil(state, ctx, () => state.zone.groundItems.length === 0, [
      { type: 'interact', targetId: dropped.id, action: 'Take' },
    ]);
    expect(state.player.pos).toEqual({ x: dropped.x, y: dropped.y });
    expect(countItem(state.player.inventory, 'item_scrap_hash')).toBe(1);
  });

  it('gives each non-stackable drop its own pile', () => {
    const { state, ctx } = newGame();
    addItem(state.player.inventory, hash(), 2);
    runTick(state, ctx, [
      { type: 'dropItem', slot: 0 },
      { type: 'dropItem', slot: 1 },
    ]);
    expect(state.zone.groundItems).toHaveLength(2);
    expect(new Set(state.zone.groundItems.map((g) => g.id)).size).toBe(2);
  });

  it('despawns after despawnTicks', () => {
    const { state, ctx } = newGame();
    addItem(state.player.inventory, hash());
    runTick(state, ctx, [{ type: 'dropItem', slot: 0 }]);
    for (let i = 0; i < GROUND_ITEMS.despawnTicks - 1; i++) runTick(state, ctx, []);
    expect(state.zone.groundItems).toHaveLength(1);
    runTick(state, ctx, []);
    expect(state.zone.groundItems).toHaveLength(0);
  });

  it('stays on the ground when the inventory is full', () => {
    const { state, ctx } = newGame();
    addItem(state.player.inventory, hash());
    runTick(state, ctx, [{ type: 'dropItem', slot: 0 }]);
    addItem(state.player.inventory, hash(), 28);
    const events = runTick(state, ctx, [
      { type: 'interact', targetId: state.zone.groundItems[0].id, action: 'Take' },
    ]);
    expect(messages(events)).toContain("You don't have enough inventory space to hold that.");
    expect(state.zone.groundItems).toHaveLength(1);
  });

  it('only offers Take', () => {
    const { state, ctx } = newGame();
    addItem(state.player.inventory, hash());
    runTick(state, ctx, [{ type: 'dropItem', slot: 0 }]);
    runTick(state, ctx, [
      { type: 'interact', targetId: state.zone.groundItems[0].id, action: 'Mine' },
    ]);
    expect(state.player.action).toBeNull();
  });
});
