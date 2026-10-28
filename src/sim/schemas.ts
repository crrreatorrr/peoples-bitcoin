/**
 * Zod schemas for every data file in src/data. Content is validated once at
 * load time (see content.ts); the rest of the sim trusts the parsed types.
 */
import { z } from 'zod';

const Id = z.string().min(1);
const Coord = z.number().int().nonnegative();
const TileSchema = z.object({ x: Coord, y: Coord });
const Level = z.number().int().min(1).max(99);
const UsdRange = z.tuple([z.number().nonnegative(), z.number().nonnegative()]);

export const SkillReqSchema = z.object({ skill: Id, level: Level });
export const StackSchema = z.object({ item: Id, qty: z.number().int().positive().default(1) });

export const EQUIP_SLOTS = ['head', 'weapon', 'body', 'legs', 'ammo'] as const;
export const EquipSlotSchema = z.enum(EQUIP_SLOTS);

/** guns beat melee, melee beats shields, shields beat guns (DESIGN.md §8). */
export const CombatTypeSchema = z.enum(['melee', 'gun', 'shield']);

export const ItemDefSchema = z.object({
  id: Id,
  name: z.string(),
  examine: z.string(),
  stackable: z.boolean(),
  /** Asset manifest id for the icon (and ground sprite). */
  model: Id,
  /** USD the Terminal pays for one. */
  value: z.number().nonnegative(),
  /** Skill levels needed to equip or use this item. */
  requires: z.array(SkillReqSchema).default([]),
  equip: z.object({ slot: EquipSlotSchema }).optional(),
  weapon: z
    .object({
      type: z.enum(['gun', 'melee']),
      /** rounds = common ammo in the ammo slot; hash = explosive, fires mined Hash from the inventory. */
      ammo: z.enum(['none', 'rounds', 'hash']),
      speed: z.number().int().positive(),
      range: z.number().int().positive(),
      accuracy: z.number(),
      damage: z.number(),
      /** Explosions also hit enemies next to the target. */
      splash: z.boolean().default(false),
    })
    .optional(),
  armor: z.object({ defense: z.number(), accuracy: z.number().default(0) }).optional(),
  food: z.object({ heal: z.number().int().positive(), verb: z.string().default('Eat') }).optional(),
  tool: z
    .object({ skill: Id, tier: z.number().int().positive(), bonus: z.number().min(0).max(1) })
    .optional(),
  /** Damage bonus when fired from an explosive (hash) cannon. */
  shell: z.object({ damage: z.number() }).optional(),
  summon: z.object({ sproto: Id }).optional(),
});

export const BuildOptionSchema = z.object({
  id: Id,
  name: z.string(),
  examine: z.string(),
  model: Id,
  levelReq: Level,
  toolTier: z.number().int().positive(),
  materials: z.array(StackSchema),
  xp: z.number().positive(),
  /** What the built station does. */
  provides: z.enum(['bank', 'terminal', 'heal', 'respawn', 'recharge', 'produce']),
  /** For 'produce': the item made every `everyTicks`, up to `cap` waiting. */
  produce: z
    .object({
      item: Id,
      qty: z.number().int().positive(),
      everyTicks: z.number().int().positive(),
      cap: z.number().int().positive(),
    })
    .optional(),
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
  /** How the sim treats the object's first action. */
  role: z
    .enum(['scenery', 'gather', 'station', 'bank', 'terminal', 'portal', 'gate', 'hotspot'])
    .default('scenery'),
  /** For stations: which skill's recipes are made here. */
  skill: Id.optional(),
  /** For hotspots: what can be built here. */
  builds: z.array(BuildOptionSchema).default([]),
  /** How the object looks and reads while depleted (e.g. an overheated rack). */
  depleted: z.object({ name: z.string(), examine: z.string(), model: Id }).optional(),
});

export const NpcDefSchema = z.object({
  id: Id,
  name: z.string(),
  examine: z.string(),
  model: Id,
  actions: z.array(z.string()),
  /** Shown one at a time on Talk-to until node-graph dialogue lands. */
  lines: z.array(z.string()).default([]),
  /** Tiles the NPC may wander from its spawn; 0 = stands still. */
  wanderRadius: z.number().int().nonnegative().default(0),
});

/** A gathering node: use the skill on an object to get an item and/or money. */
export const GatherActionSchema = z.object({
  id: Id,
  objectId: Id,
  levelReq: Level,
  xp: z.number().positive(),
  output: Id.optional(),
  /** Money paid per success, in USD (converted to $BITCOIN at the live price). */
  payUsd: UsdRange.optional(),
  /** Chance a success pays nothing (Lobbying blackmail), and what you're told. */
  unpaid: z.object({ chance: z.number().min(0).max(1), message: z.string() }).optional(),
  rare: z
    .object({
      chance: z.number().min(0).max(1),
      item: Id.optional(),
      usd: UsdRange.optional(),
      message: z.string(),
    })
    .optional(),
  /** Chat text on success; {item} and {amount} are filled in. */
  message: z.string(),
  depleteChance: z.number().min(0).max(1),
  respawnTicks: z.number().int().nonnegative(),
});

/** Processing at a station (Spin): one input becomes one output, or fails. */
export const RecipeSchema = z.object({
  id: Id,
  input: Id,
  output: Id,
  levelReq: Level,
  xp: z.number().positive(),
  /** Failure chance at the required level, falling to 0 at `safeLevel`. */
  failAtReq: z.number().min(0).max(1),
  safeLevel: Level,
});

export const SkillDefSchema = z.object({
  id: Id,
  name: z.string(),
  replaces: z.string().optional(),
  startLevel: Level.default(1),
  /** Item-tool name shown when the player has none ("a Hash Pick"). */
  toolName: z.string().optional(),
  actions: z.array(GatherActionSchema).default([]),
  recipes: z.array(RecipeSchema).default([]),
  /** Gaining XP needs this unlock (Construction is quest-locked). */
  locked: z.string().optional(),
});

const CombatStats = {
  hp: z.number().int().positive(),
  attack: Level,
  strength: Level,
  defense: Level,
  accuracy: z.number(),
  damage: z.number(),
  armor: z.number(),
  speed: z.number().int().positive(),
  range: z.number().int().positive(),
  type: CombatTypeSchema,
};

export const EnemyDefSchema = z.object({
  id: Id,
  name: z.string(),
  examine: z.string(),
  model: Id,
  /** Combat level shown in menus. */
  level: z.number().int().positive(),
  ...CombatStats,
  aggressive: z.boolean(),
  aggroRange: z.number().int().nonnegative().default(0),
  wanderRadius: z.number().int().nonnegative().default(2),
  respawnTicks: z.number().int().positive(),
  drops: Id,
  boss: z
    .object({
      adds: z
        .object({
          enemy: Id,
          everyTicks: z.number().int().positive(),
          max: z.number().int().positive(),
        })
        .optional(),
    })
    .optional(),
});

export const SprotoDefSchema = z.object({
  id: Id,
  name: z.string(),
  examine: z.string(),
  model: Id,
  levelReq: Level,
  xp: z.number().positive(),
  ...CombatStats,
  /** Healers don't attack; they patch the player up. */
  heals: z
    .object({
      amount: z.number().int().positive(),
      everyTicks: z.number().int().positive(),
      belowPct: z.number(),
    })
    .optional(),
  special: z.object({
    name: z.string(),
    cost: z.number().positive(),
    kind: z.enum(['rally', 'heal', 'taunt', 'headshot', 'suppress']),
    value: z.number(),
    ticks: z.number().int().nonnegative(),
  }),
});

export const DropTableSchema = z.object({
  id: Id,
  usd: UsdRange,
  always: z.array(StackSchema).default([]),
  rolls: z.number().int().nonnegative().default(1),
  table: z.array(
    z.object({
      item: Id.optional(),
      min: z.number().int().positive().default(1),
      max: z.number().int().positive().default(1),
      weight: z.number().positive(),
    }),
  ),
});

export const ShopSchema = z.object({
  id: Id,
  name: z.string(),
  stock: z.array(z.object({ item: Id, priceUsd: z.number().positive() })),
});

export const QuestTriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('talk'), npc: Id }),
  z.object({ type: z.literal('deliver'), npc: Id, items: z.array(StackSchema) }),
  z.object({ type: z.literal('obtain'), item: Id }),
  z.object({ type: z.literal('xp'), skill: Id }),
  z.object({ type: z.literal('sell') }),
  z.object({ type: z.literal('buy'), item: Id.optional() }),
  z.object({ type: z.literal('equip'), slot: EquipSlotSchema.optional() }),
  z.object({ type: z.literal('kill'), enemy: Id.optional() }),
  z.object({ type: z.literal('eat') }),
  z.object({ type: z.literal('summon') }),
  z.object({ type: z.literal('deposit') }),
  z.object({ type: z.literal('enterZone'), zone: Id }),
  z.object({ type: z.literal('build') }),
]);

export const RewardSchema = z.object({
  items: z.array(StackSchema).default([]),
  usd: z.number().nonnegative().default(0),
  xp: z.record(z.string(), z.number().positive()).default({}),
  unlock: z.string().optional(),
});

export const QuestDefSchema = z.object({
  id: Id,
  name: z.string(),
  /** Tutorial steps can be done in any order; quest steps go in order. */
  ordered: z.boolean(),
  /** Active from the start (tutorial), or begun by talking to `startNpc`. */
  autoStart: z.boolean().default(false),
  startNpc: Id.optional(),
  steps: z.array(
    z.object({
      id: Id,
      text: z.string(),
      trigger: QuestTriggerSchema,
      /** What the hint arrow points at. */
      hint: z
        .object({ npc: Id.optional(), object: Id.optional(), enemy: Id.optional() })
        .default({}),
      reward: RewardSchema.optional(),
    }),
  ),
  reward: RewardSchema.optional(),
  completeMessage: z.string(),
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
    objects: z.array(
      z.object({
        objectId: Id,
        x: Coord,
        y: Coord,
        /** Portals: where "Enter" takes you. */
        to: z.object({ zone: Id, x: Coord, y: Coord }).optional(),
        /** Gates and portals: unlock needed to pass (e.g. "boss:enemy_sludge_mother"). */
        requires: z.string().optional(),
        /** Message when the requirement isn't met. */
        lockedMessage: z.string().optional(),
      }),
    ),
    npcs: z.array(z.object({ npcId: Id, x: Coord, y: Coord })),
    enemies: z.array(z.object({ enemyId: Id, x: Coord, y: Coord })).default([]),
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
export const EnemiesFileSchema = z.array(EnemyDefSchema);
export const SprotosFileSchema = z.array(SprotoDefSchema);
export const DropTablesFileSchema = z.array(DropTableSchema);
export const ShopsFileSchema = z.array(ShopSchema);
export const QuestsFileSchema = z.array(QuestDefSchema);
export const ZonesFileSchema = z.object({
  terrain: z.array(TerrainDefSchema),
  zones: z.array(ZoneDefSchema),
});

export type ItemDef = z.output<typeof ItemDefSchema>;
export type ObjectDef = z.output<typeof ObjectDefSchema>;
export type BuildOption = z.output<typeof BuildOptionSchema>;
export type NpcDef = z.output<typeof NpcDefSchema>;
export type GatherAction = z.output<typeof GatherActionSchema>;
export type Recipe = z.output<typeof RecipeSchema>;
export type SkillDef = z.output<typeof SkillDefSchema>;
export type EnemyDef = z.output<typeof EnemyDefSchema>;
export type SprotoDef = z.output<typeof SprotoDefSchema>;
export type DropTable = z.output<typeof DropTableSchema>;
export type Shop = z.output<typeof ShopSchema>;
export type QuestDef = z.output<typeof QuestDefSchema>;
export type QuestTrigger = z.output<typeof QuestTriggerSchema>;
export type Reward = z.output<typeof RewardSchema>;
export type TerrainDef = z.output<typeof TerrainDefSchema>;
export type ZoneDef = z.output<typeof ZoneDefSchema>;
export type EquipSlot = z.output<typeof EquipSlotSchema>;
export type CombatType = z.output<typeof CombatTypeSchema>;
