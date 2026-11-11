/**
 * Ticket ledger. Streams keep a fractional remainder and bank whole Tickets.
 * Quest rewards are separate earns. Standalone play never fills the hub pockets,
 * so those Tickets cannot be uploaded later.
 */
import { TICKETS } from '../config/balance';
import type { EarnBatch, GameState, SimEvent, StreamReason } from './state';

/**
 * One name per reward, always under `pb:quest:<questId>`. A step or a choice
 * adds its id so that reward is its own earn. The wire key is UUIDv5 of this
 * string (`questEarnWireKey` in src/hub/uuid.ts).
 */
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

/** Tickets (with their fraction) that `usd` from a repeatable source is worth. */
export function streamTickets(usd: number): number {
  return usd > 0 ? usd / TICKETS.usdPerTicket : 0;
}

/**
 * "1 Ticket", "12 Tickets", "0.28 Tickets". Fractions show two decimals; a
 * positive amount too small for that reads "less than 0.01 Tickets".
 */
export function formatTickets(amount: number): string {
  if (!(amount > 0)) return '0 Tickets';
  if (Number.isInteger(amount)) {
    return `${amount.toLocaleString('en-US')} ${amount === 1 ? 'Ticket' : 'Tickets'}`;
  }
  const rounded = Math.round(amount * 100) / 100;
  if (rounded <= 0) return 'less than 0.01 Tickets';
  if (Number.isInteger(rounded)) {
    return `${rounded.toLocaleString('en-US')} ${rounded === 1 ? 'Ticket' : 'Tickets'}`;
  }
  return `${rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Tickets`;
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
  if (state.hubSession.mode === 'hub') {
    const name = questEarnName(questId, stepId, choiceId);
    if (state.player.ledger.questEarns.some((row) => row.name === name)) return amount;
    state.player.currencies.tickets += amount;
    events.push({
      type: 'message',
      kind: 'quest',
      text: `You receive ${formatTickets(amount)}.`,
    });
    state.player.ledger.questEarns.push({
      name,
      amount,
      key: null,
      status: 'pending',
      cappedSessionId: null,
    });
    events.push({ type: 'questEarn', name, amount });
    return amount;
  }
  state.player.currencies.tickets += amount;
  events.push({
    type: 'message',
    kind: 'quest',
    text: `You receive ${amount.toLocaleString('en-US')} Tickets.`,
  });
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
  const rooms = [
    TICKETS.batchMax,
    state.hubSession.sessionCapLeft,
    state.hubSession.dailyCapLeft,
  ].filter((n): n is number => typeof n === 'number');
  const cap = Math.min(...rooms);
  if (cap <= 0) return null;
  const amount = Math.min(cap, pocket.pending);
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
