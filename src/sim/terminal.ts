/**
 * The Trading Terminal: sell anything with a value, buy the Terminal's stock.
 * Everything is priced in USD and paid in $BITCOIN at the live price, so
 * selling while the coin is low and buying while it's high stretches a wallet.
 */
import { TERMINAL_SHOP_ID } from '../config/balance';
import { usdToBitcoin } from './economy';
import { addItem, canAdd, removeItem } from './inventory';
import { progressQuests } from './quests';
import type { GameState, Quantity, SimContext, SimEvent } from './state';

const MAX_BUY = 10_000;

/** $BITCOIN the Terminal charges for `qty` of an item right now, or null if it isn't sold. */
export function buyPrice(
  state: GameState,
  ctx: SimContext,
  itemId: string,
  qty: number,
): number | null {
  const entry = ctx.content.shops.get(TERMINAL_SHOP_ID)?.stock.find((s) => s.item === itemId);
  return entry ? Math.ceil(usdToBitcoin(state.economy, entry.priceUsd * qty)) : null;
}

/** $BITCOIN the Terminal pays for `qty` of an item right now. */
export function sellPrice(state: GameState, ctx: SimContext, itemId: string, qty: number): number {
  const value = ctx.content.items.get(itemId)?.value ?? 0;
  return Math.floor(usdToBitcoin(state.economy, value * qty));
}

export function buy(
  state: GameState,
  ctx: SimContext,
  itemId: string,
  qty: number,
  events: SimEvent[],
): void {
  const n = Math.floor(qty);
  const item = ctx.content.items.get(itemId);
  const cost = buyPrice(state, ctx, itemId, n);
  if (!item || cost === null || n < 1 || n > MAX_BUY) return;
  const say = (text: string) => events.push({ type: 'message', kind: 'game', text });
  const wallet = state.player.currencies;
  if (wallet.bitcoin < cost) {
    say(`You need ${cost.toLocaleString('en-US')} $BITCOIN for that.`);
    return;
  }
  if (!canAdd(state.player.inventory, item, item.stackable ? 1 : n)) {
    say("You don't have enough inventory space.");
    return;
  }
  wallet.bitcoin -= cost;
  addItem(state.player.inventory, item, n);
  say(`You buy ${n} × ${item.name} for ${cost.toLocaleString('en-US')} $BITCOIN.`);
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
  const stack = player.inventory[slot];
  const item = stack && ctx.content.items.get(stack.itemId);
  if (!stack || !item) return;
  if (item.value <= 0) {
    events.push({ type: 'message', kind: 'game', text: "The Terminal won't take that." });
    return;
  }
  const wanted = qty === 'all' ? Infinity : Math.floor(qty);
  if (!(wanted > 0)) return;
  // The clicked slot first, then other slots of the same item.
  const fromSlot = Math.min(stack.qty, wanted);
  stack.qty -= fromSlot;
  if (stack.qty === 0) player.inventory[slot] = null;
  const sold =
    fromSlot + (wanted > fromSlot ? removeItem(player.inventory, item.id, wanted - fromSlot) : 0);
  const paid = sellPrice(state, ctx, item.id, sold);
  player.currencies.bitcoin += paid;
  events.push({
    type: 'message',
    kind: 'game',
    text: `You sell ${sold} × ${item.name} for ${paid.toLocaleString('en-US')} $BITCOIN.`,
  });
  progressQuests(state, ctx, { type: 'sell' }, events);
}
