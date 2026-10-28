/**
 * Zod schemas for every data file in src/data. Content is validated once at
 * load time (see content.ts); the rest of the sim trusts the parsed types.
 */
import { z } from 'zod';

const Id = z.string().min(1);
const Coord = z.number().int().nonnegative();
const TileSchema = z.object({ x: Coord, y: Coord });

export const ItemDefSchema = z.object({
  id: Id,
  name: z.string(),
  examine: z.string(),
  stackable: z.boolean(),
  /** Asset manifest id for the inventory icon. */
  model: Id,
});

export const ObjectDefSchema = z.object({
  id: Id,
  name: z.string(),
  examine: z.string(),
  model: Id,
  /** Right-click actions; the first one is the left-click default. */
  actions: z.array(z.string()),
  blocks: z.boolean(),
  width: z.number().int().positive().default(1),
  height: z.number().int().positive().default(1),
  /** How the object looks and reads while depleted (e.g. an overheated rack). */
  depleted: z.object({ name: z.string(), examine: z.string(), model: Id }).optional(),
});

export const NpcDefSchema = z.object({
  id: Id,
  name: z.string(),
  examine: z.string(),
  model: Id,
  actions: z.array(z.string()),
  /** Shown one at a time on Talk-to until node-graph dialogue lands (phase 3). */
  lines: z.array(z.string()).default([]),
  /** Tiles the NPC may wander from its spawn; 0 = stands still. */
  wanderRadius: z.number().int().nonnegative().default(0),
});

/** A gathering node: perform the skill on an object to receive an item. */
export const GatherActionSchema = z.object({
  id: Id,
  objectId: Id,
  levelReq: z.number().int().min(1).max(99),
  xp: z.number().positive(),
  output: Id,
  depleteChance: z.number().min(0).max(1),
  respawnTicks: z.number().int().nonnegative(),
});

export const SkillDefSchema = z.object({
  id: Id,
  name: z.string(),
  replaces: z.string().optional(),
  startLevel: z.number().int().min(1).max(99).default(1),
  actions: z.array(GatherActionSchema).default([]),
});

export const TerrainDefSchema = z.object({
  id: Id,
  walkable: z.boolean(),
  model: Id,
});

export const ZoneDefSchema = z
  .object({
    id: Id,
    name: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    spawn: TileSchema,
    /** Map character → terrain id. */
    legend: z.record(z.string().length(1), Id),
    /** One string per row (y), one character per tile (x). */
    tiles: z.array(z.string()),
    objects: z.array(z.object({ objectId: Id, x: Coord, y: Coord })),
    npcs: z.array(z.object({ npcId: Id, x: Coord, y: Coord })),
    portals: z
      .array(z.object({ x: Coord, y: Coord, toZone: Id, toX: Coord, toY: Coord }))
      .default([]),
    /** Minimap icons (asset ids), e.g. a bank or mining-site marker. */
    mapIcons: z.array(z.object({ icon: Id, x: Coord, y: Coord })).default([]),
  })
  .superRefine((zone, ctx) => {
    if (zone.tiles.length !== zone.height) {
      ctx.addIssue({
        code: 'custom',
        path: ['tiles'],
        message: `expected ${zone.height} rows, got ${zone.tiles.length}`,
      });
    }
    const unknown = new Set<string>();
    zone.tiles.forEach((row, y) => {
      if (row.length !== zone.width) {
        ctx.addIssue({
          code: 'custom',
          path: ['tiles', y],
          message: `row ${y} has ${row.length} tiles, expected ${zone.width}`,
        });
      }
      for (const ch of row) if (!(ch in zone.legend)) unknown.add(ch);
    });
    for (const ch of unknown) {
      ctx.addIssue({ code: 'custom', path: ['legend'], message: `no legend entry for '${ch}'` });
    }
  });

export const ItemsFileSchema = z.array(ItemDefSchema);
export const ObjectsFileSchema = z.array(ObjectDefSchema);
export const NpcsFileSchema = z.array(NpcDefSchema);
export const SkillsFileSchema = z.array(SkillDefSchema);
export const ZonesFileSchema = z.object({
  terrain: z.array(TerrainDefSchema),
  zones: z.array(ZoneDefSchema),
});

export type ItemDef = z.output<typeof ItemDefSchema>;
export type ObjectDef = z.output<typeof ObjectDefSchema>;
export type NpcDef = z.output<typeof NpcDefSchema>;
export type GatherAction = z.output<typeof GatherActionSchema>;
export type SkillDef = z.output<typeof SkillDefSchema>;
export type TerrainDef = z.output<typeof TerrainDefSchema>;
export type ZoneDef = z.output<typeof ZoneDefSchema>;
