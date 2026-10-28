/**
 * Loads and validates all data-driven content. Throws ContentError with a
 * readable list of problems if any file or cross-reference is invalid.
 */
import type { z } from 'zod';
import dropsJson from '../data/droptables.json';
import enemiesJson from '../data/enemies.json';
import itemsJson from '../data/items.json';
import npcsJson from '../data/npcs.json';
import objectsJson from '../data/objects.json';
import questsJson from '../data/quests.json';
import shopsJson from '../data/shops.json';
import skillsJson from '../data/skills.json';
import sprotosJson from '../data/sprotos.json';
import zonesJson from '../data/zones.json';
import {
  DropTablesFileSchema,
  EnemiesFileSchema,
  ItemsFileSchema,
  NpcsFileSchema,
  ObjectsFileSchema,
  QuestsFileSchema,
  ShopsFileSchema,
  SkillsFileSchema,
  SprotosFileSchema,
  ZonesFileSchema,
  type DropTable,
  type EnemyDef,
  type GatherAction,
  type ItemDef,
  type NpcDef,
  type ObjectDef,
  type QuestDef,
  type Recipe,
  type Reward,
  type Shop,
  type SkillDef,
  type SprotoDef,
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
  enemies: Map<string, EnemyDef>;
  sprotos: Map<string, SprotoDef>;
  drops: Map<string, DropTable>;
  shops: Map<string, Shop>;
  quests: Map<string, QuestDef>;
  terrain: Map<string, TerrainDef>;
  zones: Map<string, ZoneDef>;
  /** Gathering node keyed by the object id it is performed on. */
  gatherByObject: Map<string, GatherNode>;
  /** Processing recipes keyed by skill id. */
  recipesBySkill: Map<string, Recipe[]>;
}

export interface RawContent {
  items: unknown;
  objects: unknown;
  npcs: unknown;
  skills: unknown;
  enemies: unknown;
  sprotos: unknown;
  drops: unknown;
  shops: unknown;
  quests: unknown;
  zones: unknown;
}

export const DEFAULT_RAW_CONTENT: RawContent = {
  items: itemsJson,
  objects: objectsJson,
  npcs: npcsJson,
  skills: skillsJson,
  enemies: enemiesJson,
  sprotos: sprotosJson,
  drops: dropsJson,
  shops: shopsJson,
  quests: questsJson,
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
  const enemies = parse('enemies.json', EnemiesFileSchema, raw.enemies, problems);
  const sprotos = parse('sprotos.json', SprotosFileSchema, raw.sprotos, problems);
  const drops = parse('droptables.json', DropTablesFileSchema, raw.drops, problems);
  const shops = parse('shops.json', ShopsFileSchema, raw.shops, problems);
  const quests = parse('quests.json', QuestsFileSchema, raw.quests, problems);
  const zones = parse('zones.json', ZonesFileSchema, raw.zones, problems);
  if (
    !items ||
    !objects ||
    !npcs ||
    !skills ||
    !enemies ||
    !sprotos ||
    !drops ||
    !shops ||
    !quests ||
    !zones
  ) {
    throw new ContentError(problems);
  }

  const content: Content = {
    items: indexById('items.json', items, problems),
    objects: indexById('objects.json', objects, problems),
    npcs: indexById('npcs.json', npcs, problems),
    skills: indexById('skills.json', skills, problems),
    enemies: indexById('enemies.json', enemies, problems),
    sprotos: indexById('sprotos.json', sprotos, problems),
    drops: indexById('droptables.json', drops, problems),
    shops: indexById('shops.json', shops, problems),
    quests: indexById('quests.json', quests, problems),
    terrain: indexById('zones.json terrain', zones.terrain, problems),
    zones: indexById('zones.json', zones.zones, problems),
    gatherByObject: new Map(),
    recipesBySkill: new Map(),
  };
  checkReferences(content, problems);
  if (problems.length > 0) throw new ContentError(problems);
  return content;
}

function checkReferences(c: Content, problems: string[]): void {
  const item = (where: string, id: string | undefined) => {
    if (id !== undefined && !c.items.has(id)) problems.push(`${where}: unknown item '${id}'`);
  };
  const skill = (where: string, id: string) => {
    if (!c.skills.has(id)) problems.push(`${where}: unknown skill '${id}'`);
  };
  const reward = (where: string, r: Reward | undefined) => {
    for (const s of r?.items ?? []) item(where, s.item);
    for (const id of Object.keys(r?.xp ?? {})) skill(where, id);
  };

  for (const def of c.items.values()) {
    for (const req of def.requires) skill(`items.json ${def.id}`, req.skill);
    if (def.tool) skill(`items.json ${def.id}`, def.tool.skill);
    if (def.summon && !c.sprotos.has(def.summon.sproto)) {
      problems.push(`items.json ${def.id}: unknown sproto '${def.summon.sproto}'`);
    }
    if (def.weapon && def.equip?.slot !== 'weapon') {
      problems.push(`items.json ${def.id}: weapons must equip to the weapon slot`);
    }
  }

  for (const s of c.skills.values()) {
    for (const action of s.actions) {
      const where = `skills.json ${s.id}.${action.id}`;
      if (!c.objects.has(action.objectId))
        problems.push(`${where}: unknown object '${action.objectId}'`);
      item(where, action.output);
      item(where, action.rare?.item);
      if (c.gatherByObject.has(action.objectId)) {
        problems.push(`${where}: object '${action.objectId}' already has a gathering action`);
      }
      c.gatherByObject.set(action.objectId, { skillId: s.id, action });
    }
    for (const r of s.recipes) {
      item(`skills.json ${s.id}.${r.id}`, r.input);
      item(`skills.json ${s.id}.${r.id}`, r.output);
    }
    if (s.recipes.length > 0) c.recipesBySkill.set(s.id, s.recipes);
  }

  for (const o of c.objects.values()) {
    if (o.role === 'station' && (!o.skill || !c.recipesBySkill.has(o.skill))) {
      problems.push(`objects.json ${o.id}: station needs a skill with recipes`);
    }
    for (const b of o.builds) {
      for (const m of b.materials) item(`objects.json ${o.id}.${b.id}`, m.item);
      item(`objects.json ${o.id}.${b.id}`, b.produce?.item);
    }
  }

  for (const e of c.enemies.values()) {
    if (!c.drops.has(e.drops))
      problems.push(`enemies.json ${e.id}: unknown drop table '${e.drops}'`);
    const add = e.boss?.adds?.enemy;
    if (add && !c.enemies.has(add)) problems.push(`enemies.json ${e.id}: unknown add '${add}'`);
  }
  for (const d of c.drops.values()) {
    for (const s of d.always) item(`droptables.json ${d.id}`, s.item);
    for (const row of d.table) item(`droptables.json ${d.id}`, row.item);
  }
  for (const shop of c.shops.values()) {
    for (const s of shop.stock) item(`shops.json ${shop.id}`, s.item);
  }
  for (const q of c.quests.values()) {
    if (q.startNpc && !c.npcs.has(q.startNpc))
      problems.push(`quests.json ${q.id}: unknown npc '${q.startNpc}'`);
    reward(`quests.json ${q.id}`, q.reward);
    for (const step of q.steps) {
      const where = `quests.json ${q.id}.${step.id}`;
      reward(where, step.reward);
      const t = step.trigger;
      if ((t.type === 'talk' || t.type === 'deliver') && !c.npcs.has(t.npc)) {
        problems.push(`${where}: unknown npc '${t.npc}'`);
      }
      if (t.type === 'deliver') for (const s of t.items) item(where, s.item);
      if (t.type === 'obtain') item(where, t.item);
      if (t.type === 'buy') item(where, t.item);
      if (t.type === 'xp') skill(where, t.skill);
      if (t.type === 'kill' && t.enemy && !c.enemies.has(t.enemy))
        problems.push(`${where}: unknown enemy '${t.enemy}'`);
      if (t.type === 'enterZone' && !c.zones.has(t.zone))
        problems.push(`${where}: unknown zone '${t.zone}'`);
      if (step.hint.npc && !c.npcs.has(step.hint.npc)) problems.push(`${where}: unknown hint npc`);
      if (step.hint.object && !c.objects.has(step.hint.object))
        problems.push(`${where}: unknown hint object`);
      if (step.hint.enemy && !c.enemies.has(step.hint.enemy))
        problems.push(`${where}: unknown hint enemy`);
    }
  }

  for (const q of c.quests.values()) {
    for (const id of q.requires) {
      if (!c.quests.has(id)) problems.push(`quests.json ${q.id}: requires unknown quest '${id}'`);
    }
  }
  for (const n of c.npcs.values()) {
    for (const d of n.dialogue) {
      const quest = c.quests.get(d.quest);
      if (!quest) problems.push(`npcs.json ${n.id}: unknown quest '${d.quest}'`);
      for (const step of d.step ?? []) {
        if (quest && !quest.steps.some((s) => s.id === step))
          problems.push(`npcs.json ${n.id}: quest '${d.quest}' has no step '${step}'`);
      }
    }
  }

  for (const zone of c.zones.values()) checkZone(zone, c, problems);
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
    if (def?.role === 'portal' && !o.to)
      problems.push(`${where}: portal at ${o.x},${o.y} has no 'to'`);
    if (o.to && !content.zones.has(o.to.zone))
      problems.push(`${where}: portal to unknown zone '${o.to.zone}'`);
  }
  for (const n of zone.npcs) {
    if (!content.npcs.has(n.npcId)) problems.push(`${where}: unknown npc '${n.npcId}'`);
    else if (!inBounds(n.x, n.y)) problems.push(`${where}: npc '${n.npcId}' is out of bounds`);
  }
  for (const e of zone.enemies) {
    if (!content.enemies.has(e.enemyId)) problems.push(`${where}: unknown enemy '${e.enemyId}'`);
    else if (!inBounds(e.x, e.y)) problems.push(`${where}: enemy '${e.enemyId}' is out of bounds`);
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
