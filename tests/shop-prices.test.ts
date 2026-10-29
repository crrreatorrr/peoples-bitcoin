import { describe, expect, it } from 'vitest';
import csvText from '../tools/pb_shop_prices.csv?raw';
import { giveItem } from '../src/sim/ground';
import { countItem } from '../src/sim/inventory';
import { runTick } from '../src/sim/tick';
import { content, messages, newGame } from './helpers';

interface CsvRow {
  shop_id: string;
  item_id: string;
  pack_size: string;
  pb_price: string;
  ticket_price: string;
  sell_price: string;
}

function gameplayRows(): CsvRow[] {
  const [header, ...lines] = csvText.trim().split(/\n/);
  const cols = header.split(',').map((name) => name.trim());
  return lines.map((line) => {
    const cells = line.split(',').map((cell) => cell.trim());
    const row = Object.fromEntries(cols.map((name, i) => [name, cells[i] ?? '']));
    return row as unknown as CsvRow;
  });
}

describe('Gameplay v3 shop prices', () => {
  it('matches pb_shop_prices.csv row for row', () => {
    const rows = gameplayRows();
    expect(rows).toHaveLength(100);
    const prices = content().ticketPrices;
    expect(prices).toHaveLength(rows.length);
    rows.forEach((row, i) => {
      expect(prices[i], `${row.shop_id}:${row.item_id}`).toEqual({
        shopId: row.shop_id,
        itemId: row.item_id,
        packSize: Number(row.pack_size),
        price: Number(row.ticket_price),
        sellPrice: Number(row.sell_price),
      });
    });
  });

  it('prices Hopium Soda at 4 Tickets with nothing paid on a sale', () => {
    for (const shopId of ['shop_terminal', 'shop_staffwright'] as const) {
      expect(
        content().ticketPrices.find(
          (row) => row.shopId === shopId && row.itemId === 'item_hopium_soda',
        ),
      ).toEqual({ shopId, itemId: 'item_hopium_soda', packSize: 1, price: 4, sellPrice: 0 });
      expect(
        content()
          .shops.get(shopId)!
          .stock.find((line) => line.item === 'item_hopium_soda')?.priceUsd,
      ).toBe(1.69);
    }

    const { state, ctx } = newGame();
    state.player.interface = { kind: 'terminal', shopId: 'shop_terminal' };
    state.player.currencies.tickets = 4;
    runTick(state, ctx, [{ type: 'buy', itemId: 'item_hopium_soda', qty: 1 }]);
    expect(countItem(state.player.inventory, 'item_hopium_soda')).toBe(1);
    expect(state.player.currencies.tickets).toBe(0);
    const events = runTick(state, ctx, [{ type: 'sell', slot: 0, qty: 1 }]);
    expect(messages(events)).toContain('Worth 0 Tickets');
    expect(countItem(state.player.inventory, 'item_hopium_soda')).toBe(1);
    expect(state.player.currencies.tickets).toBe(0);
  });

  it('keeps the Coffee row but cannot buy, sell, or grant it', () => {
    const coffee = 'item_blue_sproto_coffee';
    expect(content().items.has(coffee)).toBe(false);
    expect(content().ticketPrices.find((row) => row.itemId === coffee)).toEqual({
      shopId: 'shop_terminal',
      itemId: coffee,
      packSize: 1,
      price: 9,
      sellPrice: 0,
    });
    for (const shop of content().shops.values()) {
      expect(shop.stock.some((line) => line.item === coffee)).toBe(false);
    }

    const { state, ctx } = newGame();
    state.player.interface = { kind: 'terminal', shopId: 'shop_terminal' };
    state.player.currencies.tickets = 100;
    runTick(state, ctx, [{ type: 'buy', itemId: coffee, qty: 1 }]);
    expect(state.player.currencies.tickets).toBe(100);
    expect(countItem(state.player.inventory, coffee)).toBe(0);
    expect(state.zone.groundItems.some((pile) => pile.itemId === coffee)).toBe(false);

    giveItem(state, ctx, coffee, 1, []);
    expect(countItem(state.player.inventory, coffee)).toBe(0);
    expect(state.zone.groundItems.some((pile) => pile.itemId === coffee)).toBe(false);

    state.player.inventory[0] = { itemId: coffee, qty: 1 };
    runTick(state, ctx, [{ type: 'sell', slot: 0, qty: 1 }]);
    expect(state.player.currencies.tickets).toBe(100);
    expect(countItem(state.player.inventory, coffee)).toBe(1);
  });
});
