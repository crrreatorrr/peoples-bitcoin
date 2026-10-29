/**
 * Merges two tabs' inventories. The on-disk save is the base. Each acked shop
 * spend or sell is a delta applied once. A stale tab's copy of a sold stack is
 * not written back, and a buy the other tab already acked is kept.
 */
import { INVENTORY_SIZE } from '../config/balance';
import { removeItem } from '../sim/inventory';
import type { Inventory, InventorySlot } from '../sim/state';
import type { InventoryDelta } from './ledgerStore';

export interface ShopOrderSnap {
  key: string;
  shopId: string;
  itemId: string;
  packs: number;
}

export interface SaleOrderSnap extends ShopOrderSnap {
  slot: number;
}

export function mergeInventorySnapshot(
  diskInv: readonly (InventorySlot | null)[] | null,
  diskKeys: readonly string[],
  memInv: Inventory,
  memKeys: readonly string[],
  deltas: readonly InventoryDelta[],
): { inventory: Inventory; fulfilledKeys: string[] } {
  const base = cloneInv(diskInv ?? memInv);
  const baseKeys = new Set(diskInv ? diskKeys : memKeys);
  if (!diskInv) {
    for (const key of memKeys) baseKeys.add(key);
  }
  for (const delta of deltas) {
    if (baseKeys.has(delta.key)) continue;
    applyDelta(base, delta);
    baseKeys.add(delta.key);
  }

  const memKeySet = new Set(memKeys);
  // A delta this tab has not applied yet belongs to the other tab (or a crash
  // before this snapshot). Those must win over this tab's inventory.
  const foreign = deltas.some((delta) => !memKeySet.has(delta.key));
  const memAdjusted = cloneInv(memInv);
  for (const delta of deltas) {
    if (memKeySet.has(delta.key)) continue;
    applyDelta(memAdjusted, delta);
    memKeySet.add(delta.key);
  }

  const have = counts(base);
  for (const [itemId, qty] of counts(memAdjusted)) {
    const extra = qty - (have.get(itemId) ?? 0);
    if (extra > 0) grant(base, itemId, extra, stacked(memAdjusted, itemId));
  }

  // Same items and no foreign shop change: keep this tab's slot layout.
  const inventory = !foreign && sameCounts(memInv, base) ? cloneInv(memInv) : base;
  const fulfilledKeys = [
    ...new Set([...baseKeys, ...memKeySet, ...deltas.map((delta) => delta.key)]),
  ];
  return { inventory, fulfilledKeys };
}

/** Keeps this tab's pending order, otherwise the other tab's, unless that key was acked. */
export function mergeShopOrder<T extends { key: string }>(
  memory: T | null,
  disk: T | null,
  acked: ReadonlySet<string>,
): T | null {
  if (memory && !acked.has(memory.key)) return memory;
  if (disk && !acked.has(disk.key)) return disk;
  return null;
}

export function sameCounts(a: Inventory, b: Inventory): boolean {
  const left = counts(a);
  const right = counts(b);
  if (left.size !== right.size) return false;
  for (const [itemId, qty] of left) if (right.get(itemId) !== qty) return false;
  return true;
}

function cloneInv(source: readonly (InventorySlot | null)[]): Inventory {
  return Array.from({ length: INVENTORY_SIZE }, (_, i) => {
    const slot = source[i];
    return slot ? { itemId: slot.itemId, qty: slot.qty } : null;
  });
}

function applyDelta(inv: Inventory, delta: InventoryDelta): void {
  if (delta.op === 'remove') {
    removeItem(inv, delta.itemId, delta.units);
    return;
  }
  grant(inv, delta.itemId, delta.units, delta.stackable);
}

function grant(inv: Inventory, itemId: string, units: number, stackable: boolean): void {
  if (!(units > 0)) return;
  if (stackable) {
    const stack = inv.find((slot) => slot?.itemId === itemId);
    if (stack) {
      stack.qty += units;
      return;
    }
    const idx = inv.indexOf(null);
    if (idx >= 0) inv[idx] = { itemId, qty: units };
    return;
  }
  for (let i = 0; i < units; i++) {
    const idx = inv.indexOf(null);
    if (idx < 0) return;
    inv[idx] = { itemId, qty: 1 };
  }
}

function counts(inv: Inventory): Map<string, number> {
  const map = new Map<string, number>();
  for (const slot of inv) {
    if (!slot) continue;
    map.set(slot.itemId, (map.get(slot.itemId) ?? 0) + slot.qty);
  }
  return map;
}

function stacked(inv: Inventory, itemId: string): boolean {
  for (const slot of inv) {
    if (slot?.itemId === itemId && slot.qty > 1) return true;
  }
  return false;
}
