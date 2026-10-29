/**
 * Shop prices read from shop_prices.tickets.json. Display and the standalone
 * shop use this table. The hub is authoritative once a session exists, and the
 * client never sends a price.
 */
import type { Content, TicketPriceRow } from './content';

export type TicketListing = TicketPriceRow;

export function listing(
  content: Content,
  shopId: string,
  itemId: string,
): TicketListing | undefined {
  return content.ticketPrices.find((row) => row.shopId === shopId && row.itemId === itemId);
}

/** True when this shop's stock list includes the item. A price row alone does not sell it. */
export function shopStocks(content: Content, shopId: string, itemId: string): boolean {
  return content.shops.get(shopId)?.stock.some((line) => line.item === itemId) ?? false;
}

export function shopsStocking(content: Content, itemId: string): TicketListing[] {
  return content.ticketPrices.filter((row) => row.itemId === itemId);
}

/**
 * Shop a sell should use. The counter the player has open wins; otherwise any
 * shop that stocks the item (sell prices do not vary by shop).
 */
export function sellListing(
  content: Content,
  openShopId: string,
  itemId: string,
): TicketListing | undefined {
  return listing(content, openShopId, itemId) ?? shopsStocking(content, itemId)[0];
}

export function buyCost(row: TicketListing, packs: number): number {
  return row.price * packs;
}

/** Tickets a shop sale would credit. Zero is intentional for some goods. */
export function sellCredit(row: TicketListing, packs: number): number {
  return row.sellPrice * packs;
}
