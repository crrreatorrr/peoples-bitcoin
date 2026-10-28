/**
 * The single authoritative GameState, plus the intents that drive it and the
 * events it emits. Only the tick loop mutates GameState.
 */
import { MOVEMENT, START_CURRENCIES, SUMMONING } from '../config/balance';
import { PRESIDENT_NAME } from '../config/branding';
import type { Content } from './content';
import { createEconomy } from './economy';
import type { Grid } from './grid';
import { createInventory } from './inventory';
import { createRng, type RngState } from './rng';
import type { EquipSlot, ZoneDef } from './schemas';
import { levelForXp, xpForLevel } from './xp';

export type { EquipSlot };

export interface Tile {
  x: number;
  y: number;
}

export interface InventorySlot {
  itemId: string;
  qty: number;
}
export type Inventory = (InventorySlot | null)[];
export type Equipment = Record<EquipSlot, InventorySlot | null>;

/** A count, or every one available. */
export type Quantity = number | 'all';

/** Guns: accurate / rapid / longrange. Gavel and melee weapons: bash / block. */
export type CombatStyle = 'accurate' | 'rapid' | 'longrange' | 'bash' | 'block';

/** What a client asks for. The sim validates every intent before acting on it. */
export type Intent =
  | { type: 'walk'; x: number; y: number }
  | { type: 'interact'; targetId: string; action: string }
  | { type: 'toggleRun' }
  | { type: 'dropItem'; slot: number }
  | { type: 'moveItem'; from: number; to: number }
  | { type: 'equip'; slot: number }
  | { type: 'unequip'; slot: EquipSlot }
  | { type: 'eat'; slot: number }
  | { type: 'summon'; slot: number }
  | { type: 'dismiss' }
  | { type: 'special' }
  | { type: 'setStyle'; style: CombatStyle }
  | { type: 'chat'; text: string }
  | { type: 'continueDialogue' }
  | { type: 'deposit'; slot: number; qty: Quantity }
  | { type: 'depositAll' }
  | { type: 'withdraw'; index: number; qty: Quantity }
  | { type: 'buy'; itemId: string; qty: number }
  | { type: 'sell'; slot: number; qty: Quantity }
  | { type: 'build'; buildId: string }
  | { type: 'closeInterface' };

export interface ActiveAction {
  targetId: string;
  action: string;
  /** Tick of the next skilling attempt; null until the player arrives and starts. */
  nextAttemptTick: number | null;
}

export type OpenInterface =
  { kind: 'bank' } | { kind: 'terminal' } | { kind: 'build'; targetId: string };

export interface Currencies {
  bitcoin: number;
  btc: number;
}

export interface DialogueState {
  /** NPC instance id. */
  npcId: string;
  /** Index into the NPC's lines. */
  line: number;
}

export interface Overhead {
  text: string;
  untilTick: number;
}

export interface QuestProgress {
  /** Completed step ids. */
  done: string[];
  complete: boolean;
}

export interface SprotoInstance {
  defId: string;
  x: number;
  y: number;
  from: Tile;
  hp: number;
  expiresAt: number;
  nextAttackTick: number;
  /** Enemy instance id it is fighting. */
  target: string | null;
  nextHealTick: number;
  /** Next attack is a guaranteed max hit (Headshot). */
  headshot: boolean;
}

export interface PlayerState {
  name: string;
  pos: Tile;
  path: Tile[];
  /** Tiles visited during the last tick, starting at the previous position. Render interpolates along these. */
  stepsThisTick: Tile[];
  running: boolean;
  runEnergy: number;
  hp: number;
  action: ActiveAction | null;
  nextAttackTick: number;
  style: CombatStyle;
  inventory: Inventory;
  equipment: Equipment;
  /** Bank stacks in display order. Every item stacks in the bank. */
  bank: InventorySlot[];
  interface: OpenInterface | null;
  dialogue: DialogueState | null;
  /** Public chat shown above the player's head. */
  overhead: Overhead | null;
  /** Skill id → total XP. */
  skills: Record<string, number>;
  currencies: Currencies;
  quests: Record<string, QuestProgress>;
  /** Earned flags: boss kills ("boss:<enemyId>") and quest unlocks ("bunker"). */
  unlocks: string[];
  /** Bunker hotspot key → built option id. */
  bunker: Record<string, string>;
  /** Bunker hotspot key → tick its production was last collected. */
  collected: Record<string, number>;
  sproto: SprotoInstance | null;
  summoning: { points: number; cooldownUntil: number };
  /** Rally: +pct damage until the given tick. */
  rally: { untilTick: number; pct: number };
}

export interface ObjectInstance {
  id: string;
  defId: string;
  x: number;
  y: number;
  /** Tick at which a depleted object respawns; null while available. */
  depletedUntil: number | null;
}

export interface NpcInstance {
  id: string;
  defId: string;
  x: number;
  y: number;
  /** Wander radius is measured from here. */
  spawn: Tile;
  /** Position at the start of the last tick, for render interpolation. */
  from: Tile;
}

export interface EnemyInstance {
  id: string;
  defId: string;
  x: number;
  y: number;
  spawn: Tile;
  from: Tile;
  hp: number;
  /** Tick it comes back after dying; null while alive. */
  respawnAt: number | null;
  /** 'player', 'sproto' or null. */
  target: string | null;
  nextAttackTick: number;
  tauntedUntil: number;
  suppressedUntil: number;
  /** Boss adds don't respawn. */
  temp: boolean;
  nextAddTick: number;
}

export interface GroundItem {
  id: string;
  itemId: string;
  qty: number;
  x: number;
  y: number;
  despawnTick: number;
}

export interface ZoneState {
  id: string;
  objects: ObjectInstance[];
  npcs: NpcInstance[];
  enemies: EnemyInstance[];
  groundItems: GroundItem[];
  nextGroundItemId: number;
  nextEnemyId: number;
}

export interface EconomyState {
  priceUsd: number;
  /** Most recent price last. */
  history: number[];
  /** Server-wide sentiment, 0–100. */
  hopium: number;
  recentBossWins: number;
  recentDumps: number;
}

export interface GameState {
  tick: number;
  rng: RngState;
  player: PlayerState;
  /** The zone the player is in. */
  zone: ZoneState;
  /** Zones visited this session, kept so ground items and kills persist while away. */
  otherZones: Record<string, ZoneState>;
  economy: EconomyState;
}

/** Static data the tick needs alongside the state. */
export interface SimContext {
  content: Content;
  /** Collision grid per zone id. */
  grids: Map<string, Grid>;
}

export type MessageKind = 'game' | 'npc' | 'public' | 'levelup' | 'warning' | 'quest';

export type SimEvent =
  | { type: 'message'; kind: MessageKind; text: string; speaker?: string }
  | { type: 'xp'; skillId: string; amount: number }
  | { type: 'levelUp'; skillId: string; level: number }
  | { type: 'hitsplat'; targetId: string; damage: number }
  | { type: 'projectile'; fromId: string; toId: string; explosive: boolean }
  | { type: 'death'; entityId: string }
  | { type: 'zoneChanged'; zoneId: string }
  | { type: 'autosave' };

export type EntityRef =
  | { kind: 'object'; instance: ObjectInstance }
  | { kind: 'npc'; instance: NpcInstance }
  | { kind: 'ground'; instance: GroundItem }
  | { kind: 'enemy'; instance: EnemyInstance };

export const PLAYER_ID = 'player';
export const SPROTO_ID = 'sproto';

export function emptyEquipment(): Equipment {
  return { head: null, weapon: null, body: null, legs: null, ammo: null };
}

export function createZoneState(zone: ZoneDef, content: Content): ZoneState {
  return {
    id: zone.id,
    objects: zone.objects.map((o, i) => ({
      id: `o${i}`,
      defId: o.objectId,
      x: o.x,
      y: o.y,
      depletedUntil: null,
    })),
    npcs: zone.npcs.map((n, i) => ({
      id: `n${i}`,
      defId: n.npcId,
      x: n.x,
      y: n.y,
      spawn: { x: n.x, y: n.y },
      from: { x: n.x, y: n.y },
    })),
    enemies: zone.enemies.map((e, i) => newEnemy(`e${i}`, e.enemyId, e.x, e.y, content, false)),
    groundItems: [],
    nextGroundItemId: 0,
    nextEnemyId: zone.enemies.length,
  };
}

export function newEnemy(
  id: string,
  defId: string,
  x: number,
  y: number,
  content: Content,
  temp: boolean,
): EnemyInstance {
  return {
    id,
    defId,
    x,
    y,
    spawn: { x, y },
    from: { x, y },
    hp: content.enemies.get(defId)?.hp ?? 1,
    respawnAt: null,
    target: null,
    nextAttackTick: 0,
    tauntedUntil: 0,
    suppressedUntil: 0,
    temp,
    nextAddTick: 0,
  };
}

export function createGameState(content: Content, zoneId: string, seed: number): GameState {
  const zone = content.zones.get(zoneId);
  if (!zone) throw new Error(`Unknown zone '${zoneId}'`);
  const skills: Record<string, number> = {};
  for (const skill of content.skills.values()) skills[skill.id] = xpForLevel(skill.startLevel);
  const quests: Record<string, QuestProgress> = {};
  for (const q of content.quests.values())
    if (q.autoStart) quests[q.id] = { done: [], complete: false };
  return {
    tick: 0,
    rng: createRng(seed),
    player: {
      name: PRESIDENT_NAME,
      pos: { ...zone.spawn },
      path: [],
      stepsThisTick: [{ ...zone.spawn }],
      running: false,
      runEnergy: MOVEMENT.runEnergyMax,
      hp: levelForXp(skills.hitpoints ?? 0),
      action: null,
      nextAttackTick: 0,
      style: 'accurate',
      inventory: createInventory(),
      equipment: emptyEquipment(),
      bank: [],
      interface: null,
      dialogue: null,
      overhead: null,
      skills,
      currencies: { ...START_CURRENCIES },
      quests,
      unlocks: [],
      bunker: {},
      collected: {},
      sproto: null,
      summoning: { points: SUMMONING.pointsMax, cooldownUntil: 0 },
      rally: { untilTick: 0, pct: 0 },
    },
    zone: createZoneState(zone, content),
    otherZones: {},
    economy: createEconomy(),
  };
}

export function findEntity(state: GameState, id: string): EntityRef | null {
  const z = state.zone;
  const obj = z.objects.find((o) => o.id === id);
  if (obj) return { kind: 'object', instance: obj };
  const npc = z.npcs.find((n) => n.id === id);
  if (npc) return { kind: 'npc', instance: npc };
  const ground = z.groundItems.find((g) => g.id === id);
  if (ground) return { kind: 'ground', instance: ground };
  const enemy = z.enemies.find((e) => e.id === id && e.respawnAt === null);
  if (enemy) return { kind: 'enemy', instance: enemy };
  return null;
}

export function gridOf(state: GameState, ctx: SimContext): Grid {
  const grid = ctx.grids.get(state.zone.id);
  if (!grid) throw new Error(`No grid for zone '${state.zone.id}'`);
  return grid;
}

export function maxHp(player: PlayerState): number {
  return levelForXp(player.skills.hitpoints ?? 0);
}

export function hasUnlock(player: PlayerState, flag: string): boolean {
  return player.unlocks.includes(flag);
}

export function message(events: SimEvent[], text: string, kind: MessageKind = 'game'): void {
  events.push({ type: 'message', kind, text });
}
