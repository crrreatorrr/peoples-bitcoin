/**
 * Bank: every item stacks, stacks keep their order, and empty stacks are
 * removed. Only callable while the bank interface is open (checked in tick.ts).
 */
import { BANK } from '../config/balance';
import type { Content } from './content';
import { addItem, canAdd, freeSlotCount } from './inventory';
import { SALE_HOLD_MESSAGE, saleHeldUnits, spareUnits } from './saleHold';
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
 * first and then from any other slots holding the same item. Units a pending
 * hub sale is waiting for stay in the inventory; only the surplus goes in.
 */
export function deposit(
  player: PlayerState,
  content: Content,
  slot: number,
  qty: Quantity,
  events: SimEvent[],
): void {
  const first = player.inventory[slot];
  const asked = wanted(qty);
  if (!first || asked === null) return;
  const itemId = first.itemId;
  const limit = Math.min(asked, spareUnits(player, content, itemId));
  if (limit <= 0) {
    events.push({ type: 'message', kind: 'game', text: SALE_HOLD_MESSAGE });
    return;
  }

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

export function depositAll(player: PlayerState, content: Content, events: SimEvent[]): void {
  let held = false;
  for (let slot = 0; slot < player.inventory.length; slot++) {
    const stack = player.inventory[slot];
    if (!stack) continue;
    if (spareUnits(player, content, stack.itemId) === 0) {
      held ||= saleHeldUnits(player, content, stack.itemId) > 0;
      continue;
    }
    const before = events.length;
    deposit(player, content, slot, 'all', events);
    if (events.length > before) return; // bank full: stop after one message
  }
  if (held) events.push({ type: 'message', kind: 'game', text: SALE_HOLD_MESSAGE });
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
