/**
 * A pending hub sale (`ledger.sale`) holds the units it will take: packs × the
 * pack size, counted across every slot of that item, not just the clicked one.
 * The hub credits every pack when the sale settles (on the first try or on a
 * retry), so nothing may leave the inventory while that would leave fewer units
 * than the sale needs. Surplus units stay free. `takeUnits` in
 * src/hub/client.ts removes the held units once the hub answers.
 */
import type { Content } from './content';
import { countItem } from './inventory';
import type { PlayerState, SimEvent } from './state';

export const SALE_HOLD_MESSAGE = 'That item is waiting on a sale.';

/** Units of `itemId` the pending sale will take, or 0 when no sale is pending for it. */
export function saleHeldUnits(player: PlayerState, content: Content, itemId: string): number {
  const sale = player.ledger.sale;
  if (!sale || sale.itemId !== itemId) return 0;
  const row = content.ticketPrices.find((r) => r.shopId === sale.shopId && r.itemId === itemId);
  // A pack size this build doesn't know: hold every unit until the sale settles.
  if (!row) return Infinity;
  return sale.packs * row.packSize;
}

/** Units of `itemId` that may leave the inventory without starving the pending sale. */
export function spareUnits(player: PlayerState, content: Content, itemId: string): number {
  const held = saleHeldUnits(player, content, itemId);
  return Math.max(0, countItem(player.inventory, itemId) - held);
}

/**
 * True, with the "waiting on a sale" message, when taking `qty` of `itemId`
 * would leave fewer units than the pending sale needs.
 */
export function saleBlocks(
  player: PlayerState,
  content: Content,
  itemId: string,
  qty: number,
  events: SimEvent[],
): boolean {
  if (saleHeldUnits(player, content, itemId) === 0) return false;
  if (qty <= spareUnits(player, content, itemId)) return false;
  events.push({ type: 'message', kind: 'game', text: SALE_HOLD_MESSAGE });
  return true;
}
