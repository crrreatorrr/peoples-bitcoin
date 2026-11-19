import { describe, expect, it } from 'vitest';
import manifest from '../src/config/assets.manifest.json';
import { PLAYER_MODEL } from '../src/render/actors';
import { globalModelIds, zoneModelIds } from '../src/render/zoneAssets';
import { content as loadTestContent } from './helpers';

const content = loadTestContent();

const glbIds = (ids: Set<string>) =>
  [...ids].filter((id) => (manifest as Record<string, { path?: string }>)[id]?.path).sort();

describe('zone model sets', () => {
  it('covers every enemy, NPC and object model a zone places, plus the global ones', () => {
    for (const zone of content.zones.values()) {
      const ids = zoneModelIds(content, zone.id);
      for (const id of globalModelIds(content)) expect(ids.has(id)).toBe(true);
      for (const e of zone.enemies)
        expect(ids.has(content.enemies.get(e.enemyId)!.model)).toBe(true);
      for (const n of zone.npcs) expect(ids.has(content.npcs.get(n.npcId)!.model)).toBe(true);
      for (const o of zone.objects)
        expect(ids.has(content.objects.get(o.objectId)!.model)).toBe(true);
    }
  });

  it('keeps the starting zone to a fraction of the GLBs', () => {
    const all = glbIds(new Set(Object.keys(manifest)));
    const start = glbIds(zoneModelIds(content, 'zone_treasury'));
    expect(start).toContain(PLAYER_MODEL);
    expect(start.length).toBeLessThan(all.length);
  });
});
