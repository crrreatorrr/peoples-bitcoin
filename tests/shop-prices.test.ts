import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHubSdk, HubSdkError, memoryKeyValue, mintMockTicket } from '@metaverse/hub-sdk';
import csvText from '../tools/pb_shop_prices.csv?raw';
import { giveItem } from '../src/sim/ground';
import { countItem } from '../src/sim/inventory';
import { deserialize, serialize } from '../src/sim/save';
import { runTick } from '../src/sim/tick';
import { content, messages, newGame } from './helpers';

/**
 * Hub per-game shop_price list from hub #12, commit 262c809.
 * The hub repo is not readable from this checkout, so the rows live in this
 * fixture once that seed is copied in. CSV (shop_id, item_id) or JSON.
 */
const HUB_SHOP_FIXTURE = 'tests/fixtures/hub-pb-shop-262c809.csv';
const COFFEE = 'item_blue_sproto_coffee';

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
    expect(rows).toHaveLength(99);
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

  it("Coffee is held back: no item, no row, can't buy", () => {
    expect(content().items.has(COFFEE)).toBe(false);
    expect(content().ticketPrices.some((row) => row.itemId === COFFEE)).toBe(false);
    for (const shop of content().shops.values()) {
      expect(
        shop.stock.some((line) => line.item === COFFEE),
        shop.id,
      ).toBe(false);
    }
    for (const file of [
      'src/data/items.json',
      'src/data/shop_prices.tickets.json',
      'src/data/shops.json',
      'src/data/droptables.json',
      'src/data/quests.json',
      'tools/pb_shop_prices.csv',
    ]) {
      const text = new TextDecoder().decode(readFileSync(file));
      expect(text.includes(COFFEE), file).toBe(false);
    }

    const { state, ctx } = newGame();
    state.player.interface = { kind: 'terminal', shopId: 'shop_terminal' };
    state.player.currencies.tickets = 100;
    runTick(state, ctx, [{ type: 'buy', itemId: COFFEE, qty: 1 }]);
    expect(state.player.currencies.tickets).toBe(100);
    expect(countItem(state.player.inventory, COFFEE)).toBe(0);
    expect(state.zone.groundItems.some((pile) => pile.itemId === COFFEE)).toBe(false);

    state.player.inventory[0] = { itemId: COFFEE, qty: 1 };
    runTick(state, ctx, [{ type: 'sell', slot: 0, qty: 1 }]);
    expect(state.player.currencies.tickets).toBe(100);
    expect(countItem(state.player.inventory, COFFEE)).toBe(1);
    expect(state.player.ledger.offlineRemainder.pb_sell).toBe(0);

    giveItem(state, ctx, COFFEE, 1, []);
    expect(countItem(state.player.inventory, COFFEE)).toBe(1);
    expect(state.zone.groundItems.some((pile) => pile.itemId === COFFEE)).toBe(false);
  });

  it('drops Coffee from a save and does not grant its value', () => {
    const { state } = newGame();
    state.player.currencies.tickets = 40;
    const saved = serialize(state, 1);
    saved.player.inventory[0] = { itemId: COFFEE, qty: 4 };
    saved.player.bank = [{ itemId: COFFEE, qty: 2 }];
    saved.player.equipment.weapon = { itemId: COFFEE, qty: 1 };
    saved.player.ledger.purchase = {
      key: '018f3b2e-7c4a-7b11-8d2e-6a5b4c3d2e1f',
      shopId: 'shop_terminal',
      itemId: COFFEE,
      packs: 1,
    };

    const loaded = deserialize(saved, content());
    expect(loaded).not.toBeNull();
    expect(countItem(loaded!.player.inventory, COFFEE)).toBe(0);
    expect(loaded!.player.bank.some((stack) => stack.itemId === COFFEE)).toBe(false);
    expect(loaded!.player.equipment.weapon).toBeNull();
    expect(loaded!.player.currencies.tickets).toBe(40);
    expect(loaded!.player.ledger.offlineRemainder.pb_sell).toBe(0);
    // Load does not grant the item. A pending shop order is kept and not paid here.
    expect(loaded!.player.ledger.purchase).toMatchObject({ itemId: COFFEE, packs: 1 });
  });

  it('returns unknown_item when spending an item with no price row', async () => {
    const missing = 'item_not_on_the_price_table';
    expect(content().ticketPrices.some((row) => row.itemId === missing)).toBe(false);
    expect(gameplayRows().some((row) => row.item_id === missing)).toBe(false);

    const now = 1_700_000_000_000;
    const ticket = await mintMockTicket({
      game: 'peoples-bitcoin',
      playerId: 'qa-no-row',
      now,
      jti: 'qa-no-row-jti',
    });
    const sdk = createHubSdk({
      useMock: true,
      local: memoryKeyValue(),
      session: memoryKeyValue(),
      now: () => now,
      serverNow: () => now,
      readHash: () => `#t=${ticket}`,
      writeHash: () => {},
    });
    await sdk.init('peoples-bitcoin');
    const earned = await sdk.earnTickets(20, 'qa', '018f3b2e-7c4a-7b11-8d2e-6a5b4c3d2e10');
    expect(earned.balance).toBe(20);

    let caught: unknown;
    try {
      await sdk.spendTickets('shop_terminal', missing, 1, '018f3b2e-7c4a-7b11-8d2e-6a5b4c3d2e11');
      caught = null;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HubSdkError);
    expect(caught).toMatchObject({ code: 'unknown_item' });
    expect((await sdk.getTicketBalance()).balance).toBe(20);
  });

  it('matches client shop stock to hub shop_price 262c809 both ways', () => {
    const server = hubShopKeys(readHubShopFixture());
    const client = new Set<string>();
    for (const shop of content().shops.values()) {
      for (const line of shop.stock) client.add(`${shop.id}:${line.item}`);
    }
    const stockWithoutServerRow = [...client].filter((key) => !server.has(key)).sort();
    const serverRowNotStocked = [...server].filter((key) => !client.has(key)).sort();
    expect(stockWithoutServerRow, 'client stock with no hub shop_price row').toEqual([]);
    expect(serverRowNotStocked, 'hub shop_price row missing from client stock').toEqual([]);
  });
});

function readHubShopFixture(): string {
  try {
    return new TextDecoder().decode(readFileSync(HUB_SHOP_FIXTURE));
  } catch {
    throw new Error(
      `Missing ${HUB_SHOP_FIXTURE}. That file is the peoples-bitcoin shop_price seed from hub #12 commit 262c809.`,
    );
  }
}

/** Rows from the hub seed: CSV with shop_id and item_id, or JSON rows / PB_SHOP map. */
function hubShopKeys(text: string): Set<string> {
  const trimmed = text.trim();
  const keys = new Set<string>();
  const add = (shopId: unknown, itemId: unknown) => {
    if (typeof shopId === 'string' && typeof itemId === 'string') keys.add(`${shopId}:${itemId}`);
  };
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    const rows = Array.isArray(parsed) ? parsed : Object.values(parsed as Record<string, unknown>);
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      add(record.shopId ?? record.shop_id, record.itemId ?? record.item_id);
    }
    return keys;
  }
  const [header, ...lines] = trimmed.split(/\n/);
  const cols = header.split(',').map((name) => name.trim());
  const shopCol = cols.indexOf('shop_id');
  const itemCol = cols.indexOf('item_id');
  const gameCol = cols.indexOf('game');
  if (shopCol < 0 || itemCol < 0) throw new Error(`${HUB_SHOP_FIXTURE} needs shop_id and item_id`);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = line.split(',').map((cell) => cell.trim());
    if (gameCol >= 0 && cells[gameCol] && cells[gameCol] !== 'peoples-bitcoin') continue;
    add(cells[shopCol], cells[itemCol]);
  }
  return keys;
}
