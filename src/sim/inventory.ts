import { INVENTORY_SIZE } from '../config/balance';
import type { ItemDef } from './schemas';
import type { Inventory, InventorySlot } from './state';

export function createInventory(size: number = INVENTORY_SIZE): Inventory {
  return Array.from({ length: size }, () => null);
}

export function freeSlotCount(inv: Inventory): number {
  return inv.filter((slot) => slot === null).length;
}

export function canAdd(inv: Inventory, item: ItemDef, qty = 1): boolean {
  if (item.stackable) return inv.some((s) => s?.itemId === item.id) || freeSlotCount(inv) > 0;
  return freeSlotCount(inv) >= qty;
}

/** Adds the item; stackables merge into one slot. Adds nothing and returns false if it won't fit. */
export function addItem(inv: Inventory, item: ItemDef, qty = 1): boolean {
  if (!canAdd(inv, item, qty)) return false;
  if (item.stackable) {
    const stack = inv.find((s) => s?.itemId === item.id);
    if (stack) stack.qty += qty;
    else inv[inv.indexOf(null)] = { itemId: item.id, qty };
    return true;
  }
  for (let i = 0; i < qty; i++) inv[inv.indexOf(null)] = { itemId: item.id, qty: 1 };
  return true;
}

export function removeSlot(inv: Inventory, slot: number): InventorySlot | null {
  const removed = inv[slot] ?? null;
  if (slot >= 0 && slot < inv.length) inv[slot] = null;
  return removed;
}

export function countItem(inv: Inventory, itemId: string): number {
  return inv.reduce((sum, s) => sum + (s?.itemId === itemId ? s.qty : 0), 0);
}

/** Swaps two inventory slots (OSRS "swap" drag mode). Out-of-range slots are ignored. */
export function swapSlots(inv: Inventory, a: number, b: number): void {
  const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < inv.length;
  if (!valid(a) || !valid(b) || a === b) return;
  [inv[a], inv[b]] = [inv[b], inv[a]];
}
