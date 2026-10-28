/**
 * Bank: every item stacks, stacks keep their order, and empty stacks are
 * removed. Only callable while the bank interface is open (checked in tick.ts).
 */
import { BANK } from '../config/balance';
import type { Content } from './content';
import { addItem, canAdd, freeSlotCount } from './inventory';
import type { PlayerState, Quantity, SimEvent } from './state';

const BANK_FULL = 'Your bank is full.';
const NO_ROOM = "You don't have enough inventory space.";

/** Normalizes a requested quantity; null for nonsense input. */
function wanted(qty: Quantity): number | null {
  if (qty === 'all') return Infinity;
  const n = Math.floor(qty);
  return n > 0 ? n : null;
}

/**
 * Deposits up to `qty` of the item in inventory `slot`, taking from that slot
 * first and then from any other slots holding the same item.
 */
export function deposit(
  player: PlayerState,
  slot: number,
  qty: Quantity,
  events: SimEvent[],
): void {
  const first = player.inventory[slot];
  const limit = wanted(qty);
  if (!first || limit === null) return;
  const itemId = first.itemId;

  let stack = player.bank.find((s) => s.itemId === itemId);
  if (!stack) {
    if (player.bank.length >= BANK.slots) {
      events.push({ type: 'message', kind: 'game', text: BANK_FULL });
      return;
    }
    stack = { itemId, qty: 0 };
    player.bank.push(stack);
  }

  const order = [slot, ...player.inventory.keys()].filter((i, n, all) => all.indexOf(i) === n);
  let moved = 0;
  for (const i of order) {
    const s = player.inventory[i];
    if (!s || s.itemId !== itemId) continue;
    const take = Math.min(s.qty, limit - moved);
    s.qty -= take;
    moved += take;
    if (s.qty === 0) player.inventory[i] = null;
    if (moved >= limit) break;
  }
  stack.qty += moved;
}

export function depositAll(player: PlayerState, events: SimEvent[]): void {
  for (let slot = 0; slot < player.inventory.length; slot++) {
    if (!player.inventory[slot]) continue;
    const before = events.length;
    deposit(player, slot, 'all', events);
    if (events.length > before) return; // bank full: stop after one message
  }
}

/**
 * Withdraws up to `qty` from bank stack `index`, limited by inventory space.
 * With `itemId`, the stack is found by item, so quick clicks can't hit a stack
 * that shifted into that index after an earlier withdraw emptied one.
 */
export function withdraw(
  player: PlayerState,
  content: Content,
  index: number,
  qty: Quantity,
  events: SimEvent[],
  itemId?: string,
): void {
  if (itemId !== undefined && player.bank[index]?.itemId !== itemId) {
    index = player.bank.findIndex((s) => s.itemId === itemId);
  }
  const stack = player.bank[index];
  const limit = wanted(qty);
  const item = stack && content.items.get(stack.itemId);
  if (!stack || !item || limit === null) return;

  let n = Math.min(limit, stack.qty);
  if (!item.stackable) n = Math.min(n, freeSlotCount(player.inventory));
  else if (!canAdd(player.inventory, item)) n = 0;
  if (n <= 0) {
    events.push({ type: 'message', kind: 'game', text: NO_ROOM });
    return;
  }
  addItem(player.inventory, item, n);
  stack.qty -= n;
  if (stack.qty === 0) player.bank.splice(index, 1);
}
