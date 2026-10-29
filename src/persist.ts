/**
 * localStorage adapter for the sim's save format. All storage access is wrapped:
 * storage can be unavailable (private mode, blocked site data) and the game
 * must still run. An unreadable save is kept under a backup key, not deleted.
 */
import {
  mergeInventorySnapshot,
  mergeShopOrder,
  sameCounts,
  type SaleOrderSnap,
  type ShopOrderSnap,
} from './hub/inventoryMerge';
import { HUB_LEDGER_KEY, readInventoryDeltas, withHubLock } from './hub/ledgerStore';
import type { Content } from './sim/content';
import { SAVE_VERSION, deserialize, serialize } from './sim/save';
import type { GameState, Inventory } from './sim/state';

/** One owner per tab, so two tabs cannot both hold the save lock. */
const SAVE_OWNER = `save-${Math.random().toString(36).slice(2)}`;

const SAVE_KEY = 'peoples-bitcoin.save';
const BACKUP_KEY = 'peoples-bitcoin.save.unreadable';

export type LoadResult =
  { status: 'loaded'; state: GameState } | { status: 'none' | 'unreadable'; state: null };

export function loadSavedGame(content: Content): LoadResult {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    return { status: 'none', state: null };
  }
  if (!raw) return { status: 'none', state: null };

  let state: GameState | null;
  try {
    state = deserialize(JSON.parse(raw), content);
  } catch {
    state = null;
  }
  if (state) return { status: 'loaded', state };

  try {
    // Keep whichever unreadable save got further: a second failure in a row is usually the
    // fresh game that replaced the first, and must not overwrite the real one.
    const kept = localStorage.getItem(BACKUP_KEY);
    if (!kept || ticksPlayed(raw) >= ticksPlayed(kept)) localStorage.setItem(BACKUP_KEY, raw);
  } catch {
    // Nothing else we can do; the game still starts fresh.
  }
  return { status: 'unreadable', state: null };
}

/** How far a raw save got (its tick), or 0 if it can't be read at all. */
function ticksPlayed(raw: string): number {
  try {
    const tick: unknown = (JSON.parse(raw) as { tick?: unknown }).tick;
    return typeof tick === 'number' ? tick : 0;
  } catch {
    return 0;
  }
}

export function saveGame(state: GameState): boolean {
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const outcome = withHubLock(SAVE_OWNER, () => writeMergedSave(state));
      if (outcome === 'ok') return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Re-reads the save under the hub lock and merges shop deltas into it.
 * The in-memory inventory is not written over a newer disk copy.
 */
function writeMergedSave(state: GameState): 'ok' | 'retry' {
  const beforeSave = localStorage.getItem(SAVE_KEY);
  const beforeStore = localStorage.getItem(HUB_LEDGER_KEY);
  const deltas = readInventoryDeltas();
  const next = serialize(state, Date.now());
  if (deltas.length > 0) {
    const disk = beforeSave ? readDiskShop(beforeSave) : null;
    const merged = mergeInventorySnapshot(
      disk?.inventory ?? null,
      disk?.fulfilledKeys ?? [],
      state.player.inventory,
      state.player.ledger.fulfilledKeys,
      deltas,
    );
    next.player.inventory = merged.inventory.map((slot) => (slot ? { ...slot } : null));
    next.player.ledger.fulfilledKeys = merged.fulfilledKeys;
    const acked = new Set(deltas.map((delta) => delta.key));
    next.player.ledger.purchase = mergeShopOrder(
      next.player.ledger.purchase,
      disk?.purchase ?? null,
      acked,
    );
    next.player.ledger.sale = mergeShopOrder(next.player.ledger.sale, disk?.sale ?? null, acked);
    if (localStorage.getItem(SAVE_KEY) !== beforeSave) return 'retry';
    if (localStorage.getItem(HUB_LEDGER_KEY) !== beforeStore) return 'retry';
    localStorage.setItem(SAVE_KEY, JSON.stringify(next));
    if (!sameCounts(state.player.inventory, merged.inventory)) {
      copyInventory(state.player.inventory, merged.inventory);
    }
    state.player.ledger.fulfilledKeys = [...merged.fulfilledKeys];
    state.player.ledger.purchase = next.player.ledger.purchase
      ? { ...next.player.ledger.purchase }
      : null;
    state.player.ledger.sale = next.player.ledger.sale ? { ...next.player.ledger.sale } : null;
    return 'ok';
  }
  if (localStorage.getItem(SAVE_KEY) !== beforeSave) return 'retry';
  if (localStorage.getItem(HUB_LEDGER_KEY) !== beforeStore) return 'retry';
  localStorage.setItem(SAVE_KEY, JSON.stringify(next));
  return 'ok';
}

function copyInventory(target: Inventory, source: Inventory): void {
  for (let i = 0; i < target.length; i++) {
    const slot = source[i];
    target[i] = slot ? { itemId: slot.itemId, qty: slot.qty } : null;
  }
}

interface DiskShop {
  inventory: Inventory;
  fulfilledKeys: string[];
  purchase: ShopOrderSnap | null;
  sale: SaleOrderSnap | null;
}

function readDiskShop(raw: string): DiskShop | null {
  try {
    const save = JSON.parse(raw) as {
      version?: unknown;
      player?: {
        inventory?: unknown;
        ledger?: {
          fulfilledKeys?: unknown;
          purchase?: unknown;
          sale?: unknown;
        };
      };
    };
    if (save.version !== SAVE_VERSION || !save.player) return null;
    const inventory = readSlots(save.player.inventory);
    if (!inventory) return null;
    const ledger = save.player.ledger;
    return {
      inventory,
      fulfilledKeys: readKeys(ledger?.fulfilledKeys),
      purchase: readPurchase(ledger?.purchase),
      sale: readSale(ledger?.sale),
    };
  } catch {
    return null;
  }
}

function readSlots(raw: unknown): Inventory | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((slot) => {
    if (!slot || typeof slot !== 'object') return null;
    const itemId = (slot as { itemId?: unknown }).itemId;
    const qty = (slot as { qty?: unknown }).qty;
    if (typeof itemId !== 'string' || typeof qty !== 'number' || !(qty > 0)) return null;
    return { itemId, qty };
  });
}

function readKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((key): key is string => typeof key === 'string');
}

function readPurchase(raw: unknown): ShopOrderSnap | null {
  if (!raw || typeof raw !== 'object') return null;
  const order = raw as Partial<ShopOrderSnap>;
  if (
    typeof order.key !== 'string' ||
    typeof order.shopId !== 'string' ||
    typeof order.itemId !== 'string' ||
    typeof order.packs !== 'number' ||
    !(order.packs > 0)
  ) {
    return null;
  }
  return { key: order.key, shopId: order.shopId, itemId: order.itemId, packs: order.packs };
}

function readSale(raw: unknown): SaleOrderSnap | null {
  const order = readPurchase(raw);
  if (!order || !raw || typeof raw !== 'object') return null;
  const slot = (raw as { slot?: unknown }).slot;
  if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0) return null;
  return { ...order, slot };
}

export function clearSavedGame(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage unavailable: there is nothing to clear.
  }
}
