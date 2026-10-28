/**
 * Loads and validates all data-driven content. Throws ContentError with a
 * readable list of problems if any file or cross-reference is invalid.
 */
import type { z } from 'zod';
import itemsJson from '../data/items.json';
import npcsJson from '../data/npcs.json';
import objectsJson from '../data/objects.json';
import skillsJson from '../data/skills.json';
import zonesJson from '../data/zones.json';
import {
  ItemsFileSchema,
  NpcsFileSchema,
  ObjectsFileSchema,
  SkillsFileSchema,
  ZonesFileSchema,
  type GatherAction,
  type ItemDef,
  type NpcDef,
  type ObjectDef,
  type SkillDef,
  type TerrainDef,
  type ZoneDef,
} from './schemas';

export interface GatherNode {
  skillId: string;
  action: GatherAction;
}

export interface Content {
  items: Map<string, ItemDef>;
  objects: Map<string, ObjectDef>;
  npcs: Map<string, NpcDef>;
  /** Insertion order is the display order in the Skills tab. */
  skills: Map<string, SkillDef>;
  terrain: Map<string, TerrainDef>;
  zones: Map<string, ZoneDef>;
  /** Gathering node keyed by the object id it is performed on. */
  gatherByObject: Map<string, GatherNode>;
}

export interface RawContent {
  items: unknown;
  objects: unknown;
  npcs: unknown;
  skills: unknown;
  zones: unknown;
}

export const DEFAULT_RAW_CONTENT: RawContent = {
  items: itemsJson,
  objects: objectsJson,
  npcs: npcsJson,
  skills: skillsJson,
  zones: zonesJson,
};

export class ContentError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid game content:\n- ${problems.join('\n- ')}`);
    this.name = 'ContentError';
  }
}

export function loadContent(raw: RawContent = DEFAULT_RAW_CONTENT): Content {
  const problems: string[] = [];
  const items = parse('items.json', ItemsFileSchema, raw.items, problems);
  const objects = parse('objects.json', ObjectsFileSchema, raw.objects, problems);
  const npcs = parse('npcs.json', NpcsFileSchema, raw.npcs, problems);
  const skills = parse('skills.json', SkillsFileSchema, raw.skills, problems);
  const zones = parse('zones.json', ZonesFileSchema, raw.zones, problems);
  if (!items || !objects || !npcs || !skills || !zones) throw new ContentError(problems);

  const content: Content = {
    items: indexById('items.json', items, problems),
    objects: indexById('objects.json', objects, problems),
    npcs: indexById('npcs.json', npcs, problems),
    skills: indexById('skills.json', skills, problems),
    terrain: indexById('zones.json terrain', zones.terrain, problems),
    zones: indexById('zones.json', zones.zones, problems),
    gatherByObject: new Map(),
  };

  for (const skill of content.skills.values()) {
    for (const action of skill.actions) {
      const where = `skills.json ${skill.id}.${action.id}`;
      if (!content.objects.has(action.objectId)) {
        problems.push(`${where}: unknown object '${action.objectId}'`);
      }
      if (!content.items.has(action.output)) {
        problems.push(`${where}: unknown output item '${action.output}'`);
      }
      if (content.gatherByObject.has(action.objectId)) {
        problems.push(`${where}: object '${action.objectId}' already has a gathering action`);
      }
      content.gatherByObject.set(action.objectId, { skillId: skill.id, action });
    }
  }

  for (const zone of content.zones.values()) checkZone(zone, content, problems);

  if (problems.length > 0) throw new ContentError(problems);
  return content;
}

function checkZone(zone: ZoneDef, content: Content, problems: string[]): void {
  const where = `zones.json ${zone.id}`;
  for (const [ch, terrainId] of Object.entries(zone.legend)) {
    if (!content.terrain.has(terrainId)) {
      problems.push(`${where}: legend '${ch}' → unknown terrain '${terrainId}'`);
    }
  }
  const inBounds = (x: number, y: number) => x < zone.width && y < zone.height;
  for (const o of zone.objects) {
    const def = content.objects.get(o.objectId);
    if (!def) problems.push(`${where}: unknown object '${o.objectId}'`);
    else if (!inBounds(o.x + def.width - 1, o.y + def.height - 1)) {
      problems.push(`${where}: object '${o.objectId}' at ${o.x},${o.y} is out of bounds`);
    }
  }
  for (const n of zone.npcs) {
    if (!content.npcs.has(n.npcId)) problems.push(`${where}: unknown npc '${n.npcId}'`);
    else if (!inBounds(n.x, n.y)) problems.push(`${where}: npc '${n.npcId}' is out of bounds`);
  }
  if (!inBounds(zone.spawn.x, zone.spawn.y)) problems.push(`${where}: spawn is out of bounds`);
}

function parse<S extends z.ZodType>(
  file: string,
  schema: S,
  data: unknown,
  problems: string[],
): z.output<S> | null {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    problems.push(`${file} ${issue.path.join('.')}: ${issue.message}`);
  }
  return null;
}

function indexById<T extends { id: string }>(
  file: string,
  list: T[],
  problems: string[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const entry of list) {
    if (map.has(entry.id)) problems.push(`${file}: duplicate id '${entry.id}'`);
    map.set(entry.id, entry);
  }
  return map;
}
