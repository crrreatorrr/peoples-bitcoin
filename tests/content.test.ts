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
    expect(c.skills.size).toBe(14);
    expect(c.skills.get('mining')!.actions).toHaveLength(3);
    expect(c.zones.has(START_ZONE_ID)).toBe(true);
  });

  it('references only asset ids that exist in the manifest', () => {
    const c = content();
    const ids = new Set(Object.keys(manifest));
    const referenced = [
      'player_president',
      ...[...c.items.values()].map((i) => i.model),
      ...[...c.npcs.values()].map((n) => n.model),
      ...[...c.terrain.values()].map((t) => t.model),
      ...[...c.objects.values()].flatMap((o) => [o.model, o.depleted?.model ?? o.model]),
    ];
    for (const id of referenced) expect(ids, `missing asset '${id}'`).toContain(id);
  });

  it('makes every interactive entity in each zone reachable from spawn', () => {
    const c = content();
    for (const zone of c.zones.values()) {
      const grid = buildZoneGrid(zone, c);
      expect(isWalkable(grid, zone.spawn.x, zone.spawn.y)).toBe(true);
      const targets = [
        ...zone.objects
          .filter((o) => c.objects.get(o.objectId)!.actions.length > 0)
          .map((o) => ({ x: o.x, y: o.y, width: c.objects.get(o.objectId)!.width, height: 1 })),
        ...zone.npcs.map((n) => ({ x: n.x, y: n.y, width: 1, height: 1 })),
      ];
      for (const fp of targets) {
        const r = findPath(grid, zone.spawn, interactionTiles(grid, fp));
        expect(r.complete, `${zone.id}: entity at ${fp.x},${fp.y} unreachable`).toBe(true);
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
});
