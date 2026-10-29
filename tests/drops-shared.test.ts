import { describe, expect, it } from 'vitest';
import { damageEnemy } from '../src/sim/combat';
import { ContentError, DEFAULT_RAW_CONTENT, loadContent, type Content } from '../src/sim/content';
import { DropTableSchema } from '../src/sim/schemas';
import { createGameState, newEnemy, type SimEvent } from '../src/sim/state';
import { content } from './helpers';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

type Raw = {
  drops: Record<string, unknown>[];
  enemies: { id: string; drops: string }[];
};

function withDrops(extra: Record<string, unknown>[], enemyDrops?: string): Content {
  const raw = clone(DEFAULT_RAW_CONTENT) as Raw;
  raw.drops.push(...extra);
  if (enemyDrops) {
    const enemy = raw.enemies.find((row) => row.id === 'enemy_sludgeling');
    if (!enemy) throw new Error('missing sludgeling');
    enemy.drops = enemyDrops;
  }
  return loadContent(raw as never);
}

function kill(table: Content): { ground: string[]; tickets: number } {
  const state = createGameState(table, 'zone_treasury', 1);
  const enemy = newEnemy('e1', 'enemy_sludgeling', 2, 2, table, true);
  state.zone.enemies = [enemy];
  const events: SimEvent[] = [];
  damageEnemy(state, { content: table, grids: new Map() }, enemy, 10_000, events);
  return {
    ground: state.zone.groundItems.map((pile) => pile.itemId),
    tickets: state.player.currencies.tickets,
  };
}

describe('shared and tertiary drops', () => {
  it('defaults tertiary and shared to empty on the shipped tables', () => {
    const parsed = DropTableSchema.parse({ id: 'drops_bare', usd: [0, 1], table: [] });
    expect(parsed.tertiary).toEqual([]);
    expect(parsed.shared).toEqual([]);
    for (const table of content().drops.values()) {
      expect(table.tertiary, table.id).toEqual([]);
      expect(table.shared, table.id).toEqual([]);
    }
  });

  it('fails to load a missing or nested shared table', () => {
    const missing = clone(DEFAULT_RAW_CONTENT) as Raw;
    missing.drops.push({
      id: 'drops_missing_shared',
      usd: [0, 0],
      table: [{ weight: 1 }],
      shared: [{ table: 'drops_nope', oneIn: 2 }],
    });
    expect(() => loadContent(missing as never)).toThrowError(/unknown shared table 'drops_nope'/);
    expect(() => loadContent(missing as never)).toThrowError(ContentError);

    const nested = clone(DEFAULT_RAW_CONTENT) as Raw;
    nested.drops.push(
      {
        id: 'drops_nest_child',
        usd: [0, 0],
        table: [{ item: 'item_scrap_hash', weight: 1 }],
        shared: [{ table: 'drops_sludgeling', oneIn: 5 }],
      },
      {
        id: 'drops_nest_parent',
        usd: [0, 0],
        table: [{ weight: 1 }],
        shared: [{ table: 'drops_nest_child', oneIn: 5 }],
      },
    );
    expect(() => loadContent(nested as never)).toThrowError(
      /shared table 'drops_nest_child' nests another shared table/,
    );
  });

  it('rolls nothing from omitted tertiary and shared lists', () => {
    const table = withDrops(
      [
        {
          id: 'drops_empty_defaults',
          usd: [0, 0],
          always: [{ item: 'item_scrap_hash', qty: 1 }],
          table: [],
        },
      ],
      'drops_empty_defaults',
    );
    expect(table.drops.get('drops_empty_defaults')?.tertiary).toEqual([]);
    expect(table.drops.get('drops_empty_defaults')?.shared).toEqual([]);
    const loot = kill(table);
    expect(loot.ground).toEqual(['item_scrap_hash']);
    expect(loot.tickets).toBe(0);
  });

  it('rolls a tertiary and a shared table when they are present', () => {
    const table = withDrops(
      [
        {
          id: 'drops_pool',
          usd: [0, 0],
          table: [{ item: 'item_warm_hash', weight: 1, min: 1, max: 1 }],
        },
        {
          id: 'drops_extra',
          usd: [0, 0],
          table: [],
          tertiary: [{ item: 'item_rounds', qty: 3, oneIn: 1 }],
          shared: [{ table: 'drops_pool', oneIn: 1 }],
        },
      ],
      'drops_extra',
    );
    const loot = kill(table);
    expect(loot.ground).toEqual(['item_rounds', 'item_warm_hash']);
    expect(loot.tickets).toBe(0);
  });
});
