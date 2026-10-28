/**
 * localStorage adapter for the sim's save format. All storage access is wrapped:
 * storage can be unavailable (private mode, blocked site data) and the game
 * must still run. An unreadable save is kept under a backup key, not deleted.
 */
import type { Content } from './sim/content';
import { deserialize, serialize } from './sim/save';
import type { GameState } from './sim/state';

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
    localStorage.setItem(BACKUP_KEY, raw);
  } catch {
    // Nothing else we can do; the game still starts fresh.
  }
  return { status: 'unreadable', state: null };
}

export function saveGame(state: GameState): boolean {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(state, Date.now())));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedGame(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage unavailable: there is nothing to clear.
  }
}
