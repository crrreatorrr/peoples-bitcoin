/**
 * Ticket ledger. Streams keep a fractional remainder and bank whole Tickets.
 * Quest rewards are separate earns. Standalone play never fills the hub pockets,
 * so those Tickets cannot be uploaded later.
 */
import { TICKETS } from '../config/balance';
import type { EarnBatch, GameState, SimEvent, StreamReason } from './state';

/** Stable earn name. The UUIDv5 of this string is derived in one hub helper. */
export function questEarnName(questId: string, stepId?: string, choiceId?: string): string {
  const parts = ['pb:quest', questId];
  if (stepId) parts.push(stepId);
  if (choiceId) parts.push(choiceId);
  return parts.join(':');
}

/** round(sqrt(usd)) Tickets for a quest or step reward. */
export function questTicketAmount(usd: number): number {
  if (!(usd > 0)) return 0;
  return Math.round(Math.sqrt(usd));
}

/**
 * Adds USD-equivalent from a repeatable source. Returns whole Tickets credited
 * to the local wallet (the rest stays in the remainder).
 */
export function addStreamUsd(state: GameState, reason: StreamReason, usd: number): number {
  if (!(usd > 0)) return 0;
  const gained = usd / TICKETS.usdPerTicket;
  if (state.hubSession.mode !== 'hub') {
    const bag = state.player.ledger.offlineRemainder;
    bag[reason] += gained;
    const whole = Math.floor(bag[reason]);
    bag[reason] -= whole;
    if (whole > 0) state.player.currencies.tickets += whole;
    return whole;
  }
  const pocket = state.player.ledger.streams[reason];
  pocket.remainder += gained;
  const whole = Math.floor(pocket.remainder);
  pocket.remainder -= whole;
  if (whole > 0) {
    pocket.pending += whole;
    state.player.currencies.tickets += whole;
  }
  return whole;
}

/**
 * Local shop debit. Hub purchases do not call this; they wait for the server.
 * `itemId` is the choke point a later tickets.spend RPC can use.
 */
export function spendTickets(
  state: GameState,
  amount: number,
  itemId: string,
  events: SimEvent[],
): boolean {
  if (itemId.length === 0 || state.hubSession.mode === 'hub') return false;
  if (state.player.currencies.tickets < amount) {
    events.push({ type: 'message', kind: 'game', text: 'Not enough Tickets.' });
    return false;
  }
  state.player.currencies.tickets -= amount;
  return true;
}

export function grantQuestTickets(
  state: GameState,
  questId: string,
  usd: number,
  events: SimEvent[],
  stepId?: string,
  choiceId?: string,
): number {
  const amount = questTicketAmount(usd);
  if (amount <= 0) return 0;
  state.player.currencies.tickets += amount;
  events.push({
    type: 'message',
    kind: 'quest',
    text: `You receive ${amount.toLocaleString('en-US')} Tickets.`,
  });
  if (state.hubSession.mode !== 'hub') return amount;
  const name = questEarnName(questId, stepId, choiceId);
  if (state.player.ledger.questEarns.some((row) => row.name === name)) return amount;
  state.player.ledger.questEarns.push({ name, amount, key: null, status: 'pending' });
  events.push({ type: 'questEarn', name, amount });
  return amount;
}

/** Seals up to one batch for `reason`. An open batch is left unchanged. */
export function openStreamBatch(
  state: GameState,
  reason: StreamReason,
  id: string,
): EarnBatch | null {
  if (state.hubSession.mode !== 'hub') return null;
  if (state.player.ledger.batches[reason]) return null;
  const pocket = state.player.ledger.streams[reason];
  if (pocket.pending <= 0) return null;
  const amount = Math.min(TICKETS.batchMax, pocket.pending);
  pocket.pending -= amount;
  const batch: EarnBatch = { id, amount };
  state.player.ledger.batches[reason] = batch;
  return batch;
}

export function undoStreamBatch(state: GameState, reason: StreamReason, id: string): void {
  const batch = state.player.ledger.batches[reason];
  if (!batch || batch.id !== id) return;
  delete state.player.ledger.batches[reason];
  state.player.ledger.streams[reason].pending += batch.amount;
}

export function ackStreamBatch(
  state: GameState,
  reason: StreamReason,
  id: string,
  balance: number | null,
): void {
  const batch = state.player.ledger.batches[reason];
  if (!batch || batch.id !== id) return;
  delete state.player.ledger.batches[reason];
  if (balance != null) state.player.currencies.tickets = balance;
}

/** A terminal earn error. The batch is not resent. */
export function dropStreamBatch(
  state: GameState,
  reason: StreamReason,
  id: string,
  balance: number | null,
): void {
  const batch = state.player.ledger.batches[reason];
  if (!batch || batch.id !== id) return;
  delete state.player.ledger.batches[reason];
  if (balance != null) state.player.currencies.tickets = balance;
  else
    state.player.currencies.tickets = Math.max(0, state.player.currencies.tickets - batch.amount);
}

export function setTicketBalance(state: GameState, balance: number): void {
  if (!Number.isFinite(balance) || balance < 0) return;
  state.player.currencies.tickets = balance;
  state.hubSession.serverBalance = balance;
}

export function saleSlot(state: GameState): number | null {
  return state.player.ledger.sale?.slot ?? null;
}
