/**
 * localStorage adapter for the sim's save format. All storage access is wrapped:
 * storage can be unavailable (private mode, blocked site data) and the game
 * must still run. An unreadable save is kept under a backup key, not deleted.
 *
 * Every key belongs to one owner (src/hub/saveOwner.ts): the device keeps the plain keys, a
 * hub account adds `@<playerId>`, and a pending owner has no storage at all.
 */
import type { Content } from './sim/content';
import { deserialize, serialize } from './sim/save';
import type { GameState } from './sim/state';
import { DEVICE, ownedKey, type SaveOwner } from './hub/saveOwner';

const SAVE_KEY = 'peoples-bitcoin.save';
const BACKUP_KEY = 'peoples-bitcoin.save.unreadable';

export type LoadResult =
  { status: 'loaded'; state: GameState } | { status: 'none' | 'unreadable'; state: null };

export function loadSavedGame(content: Content, owner: SaveOwner = DEVICE): LoadResult {
  const saveKey = ownedKey(SAVE_KEY, owner);
  const backupKey = ownedKey(BACKUP_KEY, owner);
  if (!saveKey || !backupKey) return { status: 'none', state: null };
  let raw: string | null;
  try {
    raw = localStorage.getItem(saveKey);
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
    const kept = localStorage.getItem(backupKey);
    if (!kept || ticksPlayed(raw) >= ticksPlayed(kept)) localStorage.setItem(backupKey, raw);
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

/** False when nothing was written: storage blocked, or a pending owner (not saved by design). */
export function saveGame(state: GameState, owner: SaveOwner = DEVICE): boolean {
  const saveKey = ownedKey(SAVE_KEY, owner);
  if (!saveKey) return false;
  try {
    localStorage.setItem(saveKey, JSON.stringify(serialize(state, Date.now())));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedGame(owner: SaveOwner = DEVICE): void {
  const saveKey = ownedKey(SAVE_KEY, owner);
  if (!saveKey) return;
  try {
    localStorage.removeItem(saveKey);
  } catch {
    // Storage unavailable: there is nothing to clear.
  }
}
