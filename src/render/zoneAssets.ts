/**
 * Which manifest ids a zone can show, so the loader fetches that zone's GLBs before the first
 * frame and the rest in the background.
 *
 * The walk is deliberately generous: every string in the zone's data, and in the enemy, NPC and
 * object definitions it names (and those they name in turn: boss adds, depleted models, built
 * upgrades), counts. Anything it misses still loads in the background and the view is rebuilt
 * once it lands (src/main.ts), so a miss costs a placeholder for a moment, never a broken model.
 */
import type { Content } from '../sim/content';
import { PLAYER_MODEL } from './actors';

/** Ids every zone can show: the President (you and other players) and the Sprotos. */
export function globalModelIds(content: Content): Set<string> {
  const ids = new Set<string>([PLAYER_MODEL]);
  for (const sproto of content.sprotos.values()) collectStrings(sproto, ids, 0);
  return ids;
}

/** Ids the zone `zoneId` can show, its own and the global ones. */
export function zoneModelIds(content: Content, zoneId: string): Set<string> {
  const ids = globalModelIds(content);
  const zone = content.zones.get(zoneId);
  if (!zone) return ids;
  const seen = new Set<string>();
  const queue: unknown[] = [zone];
  while (queue.length > 0) {
    const strings = new Set<string>();
    collectStrings(queue.pop(), strings, 0);
    for (const s of strings) {
      ids.add(s);
      if (seen.has(s)) continue;
      seen.add(s);
      const def = content.enemies.get(s) ?? content.npcs.get(s) ?? content.objects.get(s);
      if (def) queue.push(def);
    }
  }
  return ids;
}

function collectStrings(value: unknown, out: Set<string>, depth: number): void {
  if (depth > 8) return;
  if (typeof value === 'string') {
    // Tile rows and prose are long; ids are short and have no spaces.
    if (value.length <= 64 && !value.includes(' ')) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
  }
}
