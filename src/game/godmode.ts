/**
 * Owner godmode: keeps the standalone Ticket wallet topped up to GODMODE.tickets.
 *
 * `?godmode` (or `?godmode=1`) turns it on and remembers it in localStorage, so later
 * visits stay on without the flag. `?godmode=0` turns it off. Hub sessions are left
 * alone: there the server owns the wallet and caps earns, and standalone Tickets are
 * never uploaded (src/sim/ledger.ts), so this cannot reach the hub.
 */
import { GODMODE } from '../config/balance';
import type { GameState } from '../sim/state';

const STORAGE_KEY = 'peoples-bitcoin.godmode';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Reads `?godmode` from `search`, remembers it, and says whether godmode is on. */
export function godmodeEnabled(search: string, storage: Store | null): boolean {
  const flag = new URLSearchParams(search).get('godmode');
  try {
    if (flag !== null) {
      const on = flag !== '0' && flag.toLowerCase() !== 'false' && flag.toLowerCase() !== 'off';
      if (on) storage?.setItem(STORAGE_KEY, '1');
      else storage?.removeItem(STORAGE_KEY);
      return on;
    }
    return storage?.getItem(STORAGE_KEY) === '1';
  } catch {
    // Storage blocked: the URL flag still works for this visit.
    return flag !== null && flag !== '0';
  }
}

/**
 * Raises the wallet to GODMODE.tickets in standalone play. Returns true when it
 * changed the wallet.
 */
export function applyGodmode(state: GameState): boolean {
  if (state.hubSession.mode === 'hub') return false;
  if (state.player.currencies.tickets >= GODMODE.tickets) return false;
  state.player.currencies.tickets = GODMODE.tickets;
  return true;
}

/** The page's localStorage, or null where the browser blocks it. */
export function browserStorage(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
