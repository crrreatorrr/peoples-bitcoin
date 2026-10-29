/**
 * M8 adds Blue Sproto Coffee, the Leaked Memo, and the Sproto Pup as content.
 * Quest rewards, shop stock, drop tables, and boss repoints are held back.
 */
import { describe, expect, it } from 'vitest';
import dropsJson from '../src/data/droptables.json';
import enemiesJson from '../src/data/enemies.json';
import npcsJson from '../src/data/npcs.json';
import objectsJson from '../src/data/objects.json';
import pricesJson from '../src/data/shop_prices.tickets.json';
import questsJson from '../src/data/quests.json';
import shopsJson from '../src/data/shops.json';
import sprotosJson from '../src/data/sprotos.json';
import usesJson from '../src/data/uses.json';
import zonesJson from '../src/data/zones.json';
import { TICKETS } from '../src/config/balance';
import { damageEnemy } from '../src/sim/combat';
import { countItem } from '../src/sim/inventory';
import { deserialize, serialize } from '../src/sim/save';
import { newEnemy } from '../src/sim/state';
import { sellPrice } from '../src/sim/terminal';
import { runTick } from '../src/sim/tick';
import { content, give, messages, newGame } from './helpers';

const COFFEE = 'item_blue_sproto_coffee';
const MEMO = 'item_leaked_memo';
const PUP = 'pet_sproto_pup';
const HELD = [COFFEE, MEMO, PUP] as const;

/** Bosses and the new M8 enemies, and the tables they already used. */
const ROLLS: readonly [string, string][] = [
  ['enemy_sludge_mother', 'drops_sludge_mother'],
  ['enemy_wrongnamer_chief', 'drops_wrongnamer_chief'],
  ['enemy_captain_motion', 'drops_captain_motion'],
  ['enemy_rogue_process', 'drops_rogue_process'],
  ['enemy_rugmancer', 'drops_rugmancer'],
  ['enemy_building_inspector', 'drops_building_inspector'],
  ['enemy_gatecrasher', 'drops_gatecrasher'],
  ['enemy_corporate_raider', 'drops_corporate_raider'],
  ['enemy_pundit', 'drops_pundit'],
  ['enemy_lockdown_warden', 'drops_lockdown_warden'],
  ['enemy_grizz', 'drops_bear_raider'],
  ['enemy_extractor', 'drops_corporate_raider'],
];

function mentions(value: unknown): string[] {
  const hits: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      if ((HELD as readonly string[]).includes(node)) hits.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (node && typeof node === 'object') {
      for (const child of Object.values(node)) walk(child);
    }
  };
  walk(value);
  return hits;
}

function tableItems(tableId: string): string[] {
  const table = content().drops.get(tableId);
  if (!table) return [];
  return [
    ...table.always.map((row) => row.item),
    ...table.table.flatMap((row) => (row.item ? [row.item] : [])),
    ...table.tertiary.map((row) => row.item),
    ...table.questDrops.map((row) => row.item),
  ];
}

describe('M8 items stay off every grant path', () => {
  it('lists no shop, drop, quest, use, or zone grant for the three items', () => {
    const sources = {
      shops: shopsJson,
      drops: dropsJson,
      quests: questsJson,
      uses: usesJson,
      objects: objectsJson,
      enemies: enemiesJson,
      npcs: npcsJson,
      zones: zonesJson,
      sprotos: sprotosJson,
    };
    for (const [name, file] of Object.entries(sources)) {
      expect(mentions(file), name).toEqual([]);
    }
    expect(mentions(pricesJson)).toEqual([COFFEE]);
    for (const shop of content().shops.values()) {
      for (const id of HELD)
        expect(
          shop.stock.some((line) => line.item === id),
          shop.id,
        ).toBe(false);
    }
  });

  it('reloads one Memo or Pup as one copy, and a second tab does not grow it', () => {
    for (const id of [MEMO, PUP]) {
      const { state } = newGame();
      give(state, id);
      expect(countItem(state.player.inventory, id)).toBe(1);
      const snap = serialize(state, 1);
      const loaded = deserialize(snap, content())!;
      const other = deserialize(JSON.parse(JSON.stringify(snap)), content())!;
      expect(countItem(loaded.player.inventory, id), id).toBe(1);
      expect(countItem(other.player.inventory, id), id).toBe(1);
      expect(loaded.player.currencies.tickets).toBe(0);
      expect(other.player.currencies.tickets).toBe(0);
    }
  });
});

describe('sub-Ticket Coffee', () => {
  it('sells many Coffees for nothing and does not bank a fraction', () => {
    const { state, ctx } = newGame();
    state.player.interface = { kind: 'terminal', shopId: 'shop_terminal' };
    const copies = 20;
    give(state, COFFEE, copies);
    expect(content().items.get(COFFEE)?.value).toBe(3.69);
    expect((3.69 * copies) / TICKETS.usdPerTicket).toBeGreaterThan(2);
    expect(sellPrice(state, ctx, COFFEE, copies)).toBe(0);

    const events = runTick(state, ctx, [{ type: 'sell', slot: 0, qty: 'all' }]);
    expect(messages(events)).toContain('Worth 0 Tickets');
    expect(countItem(state.player.inventory, COFFEE)).toBe(copies);
    expect(state.player.currencies.tickets).toBe(0);
    expect(state.player.ledger.offlineRemainder.pb_sell).toBe(0);
    expect(state.player.ledger.streams.pb_sell.pending).toBe(0);
    expect(state.player.ledger.streams.pb_sell.remainder).toBe(0);
  });

  it('refuses the Memo and the Pup and mints nothing', () => {
    const { state, ctx } = newGame();
    state.player.interface = { kind: 'terminal', shopId: 'shop_terminal' };
    give(state, MEMO);
    give(state, PUP);
    expect(sellPrice(state, ctx, MEMO, 10)).toBe(0);
    expect(sellPrice(state, ctx, PUP, 10)).toBe(0);
    const memo = runTick(state, ctx, [{ type: 'sell', slot: 0, qty: 'all' }]);
    const pup = runTick(state, ctx, [{ type: 'sell', slot: 1, qty: 'all' }]);
    expect(messages(memo)).toContain("The Terminal won't take that.");
    expect(messages(pup)).toContain("The Terminal won't take that.");
    expect(countItem(state.player.inventory, MEMO)).toBe(1);
    expect(countItem(state.player.inventory, PUP)).toBe(1);
    expect(state.player.currencies.tickets).toBe(0);
    expect(state.player.ledger.offlineRemainder.pb_sell).toBe(0);
    expect(state.player.ledger.streams.pb_sell.pending).toBe(0);
  });
});

describe('bosses still roll the existing tables', () => {
  it('keeps each boss on its old table, with none of the new items in any table', () => {
    for (const [enemyId, tableId] of ROLLS) {
      expect(content().enemies.get(enemyId)?.drops, enemyId).toBe(tableId);
      expect(content().drops.has(tableId), tableId).toBe(true);
      for (const id of HELD) expect(tableItems(tableId), `${enemyId} ${id}`).not.toContain(id);
    }
    for (const table of content().drops.values()) {
      for (const id of HELD) expect(tableItems(table.id), table.id).not.toContain(id);
    }
  });

  it('drops none of the new items when those enemies die', () => {
    for (const [enemyId] of ROLLS) {
      const { state, ctx } = newGame(enemyId.length);
      const enemy = newEnemy('e1', enemyId, 2, 2, ctx.content, true);
      state.zone.enemies = [enemy];
      const before = state.player.currencies.tickets;
      damageEnemy(state, ctx, enemy, 1_000_000, []);
      const ground = state.zone.groundItems.map((pile) => pile.itemId);
      for (const id of HELD) expect(ground, enemyId).not.toContain(id);
      const tableId = content().enemies.get(enemyId)!.drops;
      const allowed = new Set(tableItems(tableId));
      for (const id of ground) expect(allowed.has(id), `${enemyId} dropped ${id}`).toBe(true);
      // Tickets, if any, come from that table's existing usd range. The new items add none.
      expect(state.player.currencies.tickets).toBeGreaterThanOrEqual(before);
      expect(countItem(state.player.inventory, COFFEE)).toBe(0);
      expect(countItem(state.player.inventory, MEMO)).toBe(0);
      expect(countItem(state.player.inventory, PUP)).toBe(0);
    }
  });
});
