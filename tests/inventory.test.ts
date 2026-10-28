import { describe, expect, it } from 'vitest';
import { INVENTORY_SIZE } from '../src/config/balance';
import { addItem, canAdd, countItem, createInventory, freeSlotCount, removeSlot } from '../src/sim/inventory';
import type { ItemDef } from '../src/sim/schemas';

const ore: ItemDef = { id: 'ore', name: 'Ore', examine: '', stackable: false, model: 'm' };
const coins: ItemDef = { id: 'coins', name: 'Coins', examine: '', stackable: true, model: 'm' };

describe('inventory', () => {
  it('starts empty with 28 slots', () => {
    const inv = createInventory();
    expect(inv).toHaveLength(INVENTORY_SIZE);
    expect(freeSlotCount(inv)).toBe(INVENTORY_SIZE);
  });

  it('puts non-stackables in separate slots', () => {
    const inv = createInventory();
    addItem(inv, ore);
    addItem(inv, ore);
    expect(inv[0]).toEqual({ itemId: 'ore', qty: 1 });
    expect(inv[1]).toEqual({ itemId: 'ore', qty: 1 });
    expect(countItem(inv, 'ore')).toBe(2);
  });

  it('merges stackables into one slot', () => {
    const inv = createInventory();
    addItem(inv, coins, 10);
    addItem(inv, coins, 59);
    expect(inv[0]).toEqual({ itemId: 'coins', qty: 69 });
    expect(freeSlotCount(inv)).toBe(INVENTORY_SIZE - 1);
  });

  it('rejects items when full, but still stacks onto an existing stack', () => {
    const inv = createInventory(2);
    addItem(inv, coins, 1);
    addItem(inv, ore);
    expect(canAdd(inv, ore)).toBe(false);
    expect(addItem(inv, ore)).toBe(false);
    expect(addItem(inv, coins, 5)).toBe(true);
    expect(countItem(inv, 'coins')).toBe(6);
  });

  it('adds nothing if a multi-quantity non-stackable add does not fit', () => {
    const inv = createInventory(2);
    expect(addItem(inv, ore, 3)).toBe(false);
    expect(freeSlotCount(inv)).toBe(2);
  });

  it('removes a slot and ignores out-of-range slots', () => {
    const inv = createInventory();
    addItem(inv, ore);
    expect(removeSlot(inv, 0)).toEqual({ itemId: 'ore', qty: 1 });
    expect(inv[0]).toBeNull();
    expect(removeSlot(inv, 99)).toBeNull();
    expect(inv).toHaveLength(INVENTORY_SIZE);
  });
});
