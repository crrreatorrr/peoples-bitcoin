/**
 * Client-side feedback helpers that only read the sim state: the Ticket fraction shown
 * beside the wallet, and the one-shot low-health warning. Pure, so they are unit tested.
 */
import { UI } from '../config/balance';
import type { Content } from '../sim/content';
import { maxHp, STREAM_REASONS, type GameState, type StreamReason } from '../sim/state';

const POCKET_LABEL: Record<StreamReason, string> = {
  pb_drop: 'loot',
  pb_lobby: 'favors',
  pb_sell: 'sales',
};

export interface WalletFraction {
  /** Fractions of a Ticket earned but not yet a whole Ticket, all sources added up. */
  total: number;
  /** The fullest pocket's progress to its next whole Ticket, 0..1. */
  progress: number;
  /** One line per pocket that holds something, e.g. "loot 0.36". */
  parts: string[];
}

/**
 * Each repeatable source (loot, favors, sales) keeps its own fraction and pays a Ticket when
 * it fills. Standalone play keeps them in `offlineRemainder`; a hub session in the stream pockets.
 */
export function walletFraction(state: GameState): WalletFraction {
  const ledger = state.player.ledger;
  const hub = state.hubSession.mode === 'hub';
  let total = 0;
  let progress = 0;
  const parts: string[] = [];
  for (const reason of STREAM_REASONS) {
    const raw = hub ? ledger.streams[reason].remainder : ledger.offlineRemainder[reason];
    const value = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999) : 0;
    if (value < 0.005) continue;
    total += value;
    progress = Math.max(progress, value);
    parts.push(`${POCKET_LABEL[reason]} ${value.toFixed(2)}`);
  }
  return { total, progress, parts };
}

/** Whether HP is at or under the warning line (UI.lowHpWarnPct of the maximum) and above 0. */
export function isLowHp(state: GameState): boolean {
  const hp = state.player.hp;
  return hp > 0 && hp <= maxHp(state.player) * UI.lowHpWarnPct;
}

export function hasFood(state: GameState, content: Content): boolean {
  return state.player.inventory.some((s) => s !== null && !!content.items.get(s.itemId)?.food);
}

/**
 * Warns once each time HP first drops to the warning line with food in the pack; it re-arms
 * when HP climbs back above the line (or the player wakes up after a death).
 */
export class LowHpWatch {
  private armed = true;

  /** Call after each tick. Returns the warning text when it should be shown now. */
  check(state: GameState, content: Content): string | null {
    if (!isLowHp(state)) {
      this.armed = true;
      return null;
    }
    if (!this.armed || !hasFood(state, content)) return null;
    this.armed = false;
    const food = state.player.inventory.find((s) => s && content.items.get(s.itemId)?.food);
    const def = food ? content.items.get(food.itemId) : undefined;
    const verb = def?.food?.verb ?? 'Eat';
    return `ATTENTION ATTENTION: your health is low! ${verb} a ${def?.name ?? 'Talking Point'} from your inventory.`;
  }
}
