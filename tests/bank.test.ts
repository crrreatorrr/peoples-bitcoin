import { describe, expect, it } from 'vitest';
import { BANK } from '../src/config/balance';
import { deposit, depositAll, withdraw } from '../src/sim/bank';
import { addItem, countItem, freeSlotCount } from '../src/sim/inventory';
import type { ItemDef } from '../src/sim/schemas';
import type { SimEvent } from '../src/sim/state';
import { runTick } from '../src/sim/tick';
import { content, messages, newGame, runUntil } from './helpers';

const hash = () => content().items.get('item_scrap_hash')!;
const coins: ItemDef = {
  id: 'coins',
  name: 'Coins',
  examine: '',
  stackable: true,
  model: 'm',
  value: 0,
  requires: [],
};

function playerWith(n: number) {
  const { state, ctx } = newGame();
  for (let i = 0; i < n; i++) addItem(state.player.inventory, hash());
  return { state, ctx, player: state.player };
}

describe('bank', () => {
  it('opens from a bank booth and closes when the player walks', () => {
    const { state, ctx } = newGame();
    const booth = state.zone.objects.find((o) => o.defId === 'obj_bank_booth')!;
    runUntil(state, ctx, () => state.player.interface?.kind === 'bank', [
      { type: 'interact', targetId: booth.id, action: 'Bank' },
    ]);
    expect(state.player.interface).toEqual({ kind: 'bank' });
    runTick(state, ctx, [{ type: 'walk', x: 27, y: 15 }]);
    expect(state.player.interface).toBeNull();
  });

  it('ignores bank intents while the bank is closed', () => {
    const { state, ctx, player } = playerWith(3);
    runTick(state, ctx, [{ type: 'depositAll' }]);
    expect(player.bank).toEqual([]);
    expect(countItem(player.inventory, 'item_scrap_hash')).toBe(3);
  });

  it('deposits a quantity across slots into one stack', () => {
    const { player } = playerWith(5);
    deposit(player, 2, 3, []);
    expect(player.bank).toEqual([{ itemId: 'item_scrap_hash', qty: 3 }]);
    expect(player.inventory[2]).toBeNull(); // the clicked slot goes first
    expect(countItem(player.inventory, 'item_scrap_hash')).toBe(2);
    deposit(player, player.inventory.findIndex(Boolean), 'all', []);
    expect(player.bank).toEqual([{ itemId: 'item_scrap_hash', qty: 5 }]);
    expect(freeSlotCount(player.inventory)).toBe(28);
  });

  it('deposits the whole inventory', () => {
    const { player } = playerWith(4);
    addItem(player.inventory, content().items.get('item_warm_hash')!);
    depositAll(player, []);
    expect(freeSlotCount(player.inventory)).toBe(28);
    expect(player.bank).toEqual([
      { itemId: 'item_scrap_hash', qty: 4 },
      { itemId: 'item_warm_hash', qty: 1 },
    ]);
  });

  it('withdraws non-stackables one slot each, limited by free space', () => {
    const { player } = playerWith(0);
    player.bank = [{ itemId: 'item_scrap_hash', qty: 40 }];
    withdraw(player, content(), 0, 10, []);
    expect(countItem(player.inventory, 'item_scrap_hash')).toBe(10);
    withdraw(player, content(), 0, 'all', []);
    expect(countItem(player.inventory, 'item_scrap_hash')).toBe(28);
    expect(player.bank).toEqual([{ itemId: 'item_scrap_hash', qty: 12 }]);

    const events: SimEvent[] = [];
    withdraw(player, content(), 0, 1, events);
    expect(messages(events)).toContain("You don't have enough inventory space.");
  });

  it('removes a bank stack once it is empty', () => {
    const { player } = playerWith(0);
    player.bank = [{ itemId: 'item_scrap_hash', qty: 2 }];
    withdraw(player, content(), 0, 5, []);
    expect(player.bank).toEqual([]);
  });

  it('withdraws stackables into a single slot', () => {
    const { player } = playerWith(0);
    const c = content();
    c.items.set(coins.id, coins);
    try {
      player.bank = [{ itemId: 'coins', qty: 1000 }];
      withdraw(player, c, 0, 'all', []);
      expect(player.inventory[0]).toEqual({ itemId: 'coins', qty: 1000 });
      expect(player.bank).toEqual([]);
    } finally {
      c.items.delete(coins.id);
    }
  });

  it('refuses new stacks when the bank is full', () => {
    const { player } = playerWith(1);
    player.bank = Array.from({ length: BANK.slots }, (_, i) => ({ itemId: `x${i}`, qty: 1 }));
    const events: SimEvent[] = [];
    deposit(player, 0, 1, events);
    expect(messages(events)).toContain('Your bank is full.');
    expect(countItem(player.inventory, 'item_scrap_hash')).toBe(1);
  });

  it('ignores invalid quantities and slots', () => {
    const { state, player } = playerWith(2);
    deposit(player, 0, 0, []);
    deposit(player, 0, -3, []);
    deposit(player, 27, 1, []);
    withdraw(player, content(), 5, 1, []);
    expect(player.bank).toEqual([]);
    expect(state.player.inventory.filter(Boolean)).toHaveLength(2);
  });
});
