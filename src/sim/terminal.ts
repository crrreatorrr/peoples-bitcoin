/**
 * Shops. Standalone play debits and credits Tickets locally from the price
 * table. A hub session buys and sells shop goods through the client instead,
 * so this module refuses those. Sell-only goods (not in any shop) always bank
 * as a pb_sell stream, including the fractional remainder.
 */
import { TICKETS, TERMINAL_SHOP_ID } from '../config/balance';
import { addStreamUsd, saleSlot, spendTickets } from './ledger';
import { addItem, canAdd, countItem, removeItem } from './inventory';
import { buyCost, sellCredit, sellListing } from './prices';
import { progressQuests } from './quests';
import type { GameState, Quantity, SimContext, SimEvent } from './state';

const MAX_PACKS = 10_000;

function openShop(state: GameState): string {
  const ui = state.player.interface;
  return ui?.kind === 'terminal' ? ui.shopId : TERMINAL_SHOP_ID;
}

/** Tickets one pack costs at the open shop, or null if it isn't sold there. */
export function buyPrice(
  state: GameState,
  ctx: SimContext,
  itemId: string,
  packs = 1,
): number | null {
  const row = ctx.content.ticketPrices.find(
    (r) => r.shopId === openShop(state) && r.itemId === itemId,
  );
  return row ? buyCost(row, packs) : null;
}

/** Whole Tickets the open counter would pay for `units` of an item. */
export function sellPrice(state: GameState, ctx: SimContext, itemId: string, units = 1): number {
  const row = sellListing(ctx.content, openShop(state), itemId);
  if (row) return sellCredit(row, Math.floor(units / row.packSize));
  const value = ctx.content.items.get(itemId)?.value ?? 0;
  return Math.floor((value * units) / TICKETS.usdPerTicket);
}

export function buy(
  state: GameState,
  ctx: SimContext,
  itemId: string,
  packs: number,
  events: SimEvent[],
): void {
  const n = Math.floor(packs);
  const row = ctx.content.ticketPrices.find(
    (r) => r.shopId === openShop(state) && r.itemId === itemId,
  );
  const item = ctx.content.items.get(itemId);
  if (!item || !row || n < 1 || n > MAX_PACKS) return;
  if (state.hubSession.mode === 'hub') return;
  const say = (text: string) => events.push({ type: 'message', kind: 'game', text });
  const units = row.packSize * n;
  const cost = buyCost(row, n);
  if (!canAdd(state.player.inventory, item, item.stackable ? 1 : units)) {
    say("You don't have enough inventory space.");
    return;
  }
  if (!spendTickets(state, cost, itemId, events)) return;
  addItem(state.player.inventory, item, units);
  say(
    `You buy ${units.toLocaleString('en-US')} × ${item.name} for ${cost.toLocaleString('en-US')} Tickets.`,
  );
  progressQuests(state, ctx, { type: 'buy', item: itemId }, events);
  progressQuests(state, ctx, { type: 'obtain', item: itemId }, events);
}

export function sell(
  state: GameState,
  ctx: SimContext,
  slot: number,
  qty: Quantity,
  events: SimEvent[],
): void {
  const player = state.player;
  if (saleSlot(state) === slot) {
    events.push({ type: 'message', kind: 'game', text: 'That item is waiting on a sale.' });
    return;
  }
  const stack = player.inventory[slot];
  const item = stack && ctx.content.items.get(stack.itemId);
  if (!stack || !item) return;
  const wanted = qty === 'all' ? countItem(player.inventory, item.id) : Math.floor(qty);
  if (!(wanted > 0)) return;
  const say = (text: string) => events.push({ type: 'message', kind: 'game', text });
  const row = sellListing(ctx.content, openShop(state), item.id);

  if (row) {
    if (state.hubSession.mode === 'hub') return;
    const packs = Math.floor(Math.min(wanted, countItem(player.inventory, item.id)) / row.packSize);
    if (packs < 1) {
      say(`You need a full pack of ${row.packSize}.`);
      return;
    }
    const credit = sellCredit(row, packs);
    if (credit === 0) {
      say('Worth 0 Tickets');
      return;
    }
    const units = packs * row.packSize;
    removeFromSlot(state, item.id, units, slot);
    player.currencies.tickets += credit;
    say(
      `You sell ${units.toLocaleString('en-US')} × ${item.name} for ${credit.toLocaleString('en-US')} Tickets.`,
    );
    progressQuests(state, ctx, { type: 'sell' }, events);
    return;
  }

  if (item.value <= 0) {
    say("The Terminal won't take that.");
    return;
  }
  const units = Math.min(wanted, countItem(player.inventory, item.id));
  removeFromSlot(state, item.id, units, slot);
  const whole = addStreamUsd(state, 'pb_sell', item.value * units);
  if (whole > 0) {
    say(
      `You sell ${units.toLocaleString('en-US')} × ${item.name} for ${whole.toLocaleString('en-US')} Tickets.`,
    );
  }
  progressQuests(state, ctx, { type: 'sell' }, events);
}

function removeFromSlot(state: GameState, itemId: string, units: number, slot: number): void {
  let left = units;
  const stack = state.player.inventory[slot];
  if (stack?.itemId === itemId) {
    const take = Math.min(stack.qty, left);
    stack.qty -= take;
    left -= take;
    if (stack.qty === 0) state.player.inventory[slot] = null;
  }
  if (left > 0) removeItem(state.player.inventory, itemId, left);
}
