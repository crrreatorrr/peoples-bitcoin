import { INVENTORY_SIZE } from '../config/balance';
import type { Content } from './content';
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

/** Removes up to `qty` of an item across slots; returns how many were removed. */
export function removeItem(inv: Inventory, itemId: string, qty: number): number {
  let removed = 0;
  for (let i = 0; i < inv.length && removed < qty; i++) {
    const s = inv[i];
    if (!s || s.itemId !== itemId) continue;
    const take = Math.min(s.qty, qty - removed);
    s.qty -= take;
    removed += take;
    if (s.qty === 0) inv[i] = null;
  }
  return removed;
}

/** The best tool for a skill in the inventory that the player can use, or null. */
export function bestTool(
  inv: Inventory,
  content: Content,
  skillId: string,
  level: number,
): ItemDef | null {
  let best: ItemDef | null = null;
  for (const slot of inv) {
    const def = slot && content.items.get(slot.itemId);
    if (!def?.tool || def.tool.skill !== skillId) continue;
    if (def.requires.some((r) => r.skill === skillId && r.level > level)) continue;
    if (!best || def.tool.tier > best.tool!.tier) best = def;
  }
  return best;
}
