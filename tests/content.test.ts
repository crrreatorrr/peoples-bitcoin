import { describe, expect, it } from 'vitest';
import manifest from '../src/config/assets.manifest.json';
import { START_ZONE_ID } from '../src/config/balance';
import { ContentError, DEFAULT_RAW_CONTENT, loadContent } from '../src/sim/content';
import { buildZoneGrid, interactionTiles, isWalkable } from '../src/sim/grid';
import { findPath } from '../src/sim/pathfinding';
import { content } from './helpers';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('content', () => {
  it('loads and validates the shipped data files', () => {
    const c = content();
    expect([...c.skills.keys()]).toEqual([
      'shooting',
      'melee',
      'defense',
      'hitpoints',
      'summoning',
      'mining',
      'fundraising',
      'lobbying',
      'spin',
      'construction',
    ]);
    expect(c.zones.has(START_ZONE_ID)).toBe(true);
    expect(c.zones.has('zone_trenches')).toBe(true);
    expect(c.zones.has('zone_bunker')).toBe(true);
  });

  it('references only asset ids that exist in the manifest', () => {
    const c = content();
    const ids = new Set(Object.keys(manifest));
    const referenced = [
      'player_president',
      ...[...c.items.values()].map((i) => i.model),
      ...[...c.npcs.values()].map((n) => n.model),
      ...[...c.enemies.values()].map((e) => e.model),
      ...[...c.sprotos.values()].map((s) => s.model),
      ...[...c.terrain.values()].map((t) => t.model),
      ...[...c.objects.values()].flatMap((o) => [
        o.model,
        o.depleted?.model ?? o.model,
        ...o.builds.map((b) => b.model),
      ]),
      ...[...c.skills.keys()].map((id) => `skill_${id}`),
      ...[...c.zones.values()].flatMap((z) => z.mapIcons.map((i) => i.icon)),
    ];
    for (const id of referenced) expect(ids, `missing asset '${id}'`).toContain(id);
  });

  it('guns fire Rounds, explosive cannons fire Hash, and staffs fire COOM', () => {
    for (const item of content().items.values()) {
      if (item.weapon?.type !== 'gun') continue;
      expect(item.weapon.ammo === 'hash', item.id).toBe(item.weapon.splash);
      if (item.weapon.ammo === 'hash') continue;
      const expected = item.id.startsWith('staff_') ? 'coom' : 'rounds';
      expect(item.weapon.ammo, item.id).toBe(expected);
    }
    expect(content().items.get('item_coom')?.ammoType).toBe('coom');
  });

  it('everything every shop sells has a price ending in 69', () => {
    for (const shop of content().shops.values()) {
      for (const s of shop.stock) {
        const shown = Number.isInteger(s.priceUsd) ? String(s.priceUsd) : s.priceUsd.toFixed(2);
        expect(shown, `${shop.id}: ${s.item}`).toMatch(/69$/);
      }
    }
  });

  it('makes every interactive entity reachable from spawn (with boss gates open)', () => {
    const c = content();
    for (const zone of c.zones.values()) {
      const grid = buildZoneGrid(zone, c);
      for (const o of zone.objects) {
        if (c.objects.get(o.objectId)?.role === 'gate') grid.blocked[o.y * grid.width + o.x] = 0;
      }
      expect(isWalkable(grid, zone.spawn.x, zone.spawn.y), zone.id).toBe(true);
      const targets = [
        ...zone.objects
          .filter((o) => {
            const def = c.objects.get(o.objectId)!;
            return def.actions.length > 0 || def.role === 'hotspot';
          })
          .filter((o) => c.objects.get(o.objectId)!.role !== 'gate')
          .map((o) => ({ x: o.x, y: o.y, width: c.objects.get(o.objectId)!.width, height: 1 })),
        ...zone.npcs.map((n) => ({ x: n.x, y: n.y, width: 1, height: 1 })),
      ];
      for (const fp of targets) {
        const r = findPath(grid, zone.spawn, interactionTiles(grid, fp));
        expect(r.complete, `${zone.id}: entity at ${fp.x},${fp.y} unreachable`).toBe(true);
      }
      for (const e of zone.enemies) {
        expect(isWalkable(grid, e.x, e.y), `${zone.id}: enemy at ${e.x},${e.y}`).toBe(true);
        const r = findPath(grid, zone.spawn, [{ x: e.x, y: e.y }]);
        expect(r.complete, `${zone.id}: enemy at ${e.x},${e.y} unreachable`).toBe(true);
      }
    }
  });

  it('reports unknown references', () => {
    const raw = clone(DEFAULT_RAW_CONTENT) as { zones: { zones: { objects: unknown[] }[] } };
    raw.zones.zones[0].objects.push({ objectId: 'obj_missing', x: 1, y: 1 });
    expect(() => loadContent(raw as never)).toThrowError(/unknown object 'obj_missing'/);
  });

  it('reports malformed zone rows', () => {
    const raw = clone(DEFAULT_RAW_CONTENT) as { zones: { zones: { tiles: string[] }[] } };
    raw.zones.zones[0].tiles[5] = '...';
    expect(() => loadContent(raw as never)).toThrowError(ContentError);
  });

  it('reports duplicate ids', () => {
    const raw = clone(DEFAULT_RAW_CONTENT) as { items: unknown[] };
    raw.items.push(raw.items[0]);
    expect(() => loadContent(raw as never)).toThrowError(/duplicate id 'item_scrap_hash'/);
  });

  it('reports schema errors with the file name', () => {
    const raw = clone(DEFAULT_RAW_CONTENT) as { items: { stackable: unknown }[] };
    raw.items[0].stackable = 'yes';
    expect(() => loadContent(raw as never)).toThrowError(/items\.json/);
  });

  it('reports quest steps that point at unknown things', () => {
    const raw = clone(DEFAULT_RAW_CONTENT) as {
      quests: { steps: { trigger: Record<string, unknown> }[] }[];
    };
    raw.quests[0].steps[0].trigger = { type: 'talk', npc: 'npc_nobody' };
    expect(() => loadContent(raw as never)).toThrowError(/unknown npc 'npc_nobody'/);
  });
});
