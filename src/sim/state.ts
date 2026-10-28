/**
 * The single authoritative GameState, plus the intents that drive it and the
 * events it emits. Only the tick loop mutates GameState.
 */
import { MOVEMENT, START_CURRENCIES } from '../config/balance';
import { PRESIDENT_NAME } from '../config/branding';
import type { Content } from './content';
import { createEconomy } from './economy';
import type { Grid } from './grid';
import { createInventory } from './inventory';
import { createRng, type RngState } from './rng';
import type { ZoneDef } from './schemas';
import { xpForLevel } from './xp';

export interface Tile {
  x: number;
  y: number;
}

export interface InventorySlot {
  itemId: string;
  qty: number;
}
export type Inventory = (InventorySlot | null)[];

/** A count, or every one available. */
export type Quantity = number | 'all';

/** What a client asks for. The sim validates every intent before acting on it. */
export type Intent =
  | { type: 'walk'; x: number; y: number }
  | { type: 'interact'; targetId: string; action: string }
  | { type: 'toggleRun' }
  | { type: 'dropItem'; slot: number }
  | { type: 'moveItem'; from: number; to: number }
  | { type: 'chat'; text: string }
  | { type: 'continueDialogue' }
  | { type: 'deposit'; slot: number; qty: Quantity }
  | { type: 'depositAll' }
  | { type: 'withdraw'; index: number; qty: Quantity }
  | { type: 'closeBank' };

export interface ActiveAction {
  targetId: string;
  action: string;
  /** Tick of the next skilling attempt; null until the player arrives and starts. */
  nextAttemptTick: number | null;
}

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

export interface PlayerState {
  name: string;
  pos: Tile;
  path: Tile[];
  /** Tiles visited during the last tick, starting at the previous position. Render interpolates along these. */
  stepsThisTick: Tile[];
  running: boolean;
  runEnergy: number;
  action: ActiveAction | null;
  inventory: Inventory;
  /** Bank stacks in display order. Every item stacks in the bank. */
  bank: InventorySlot[];
  bankOpen: boolean;
  dialogue: DialogueState | null;
  /** Public chat shown above the player's head. */
  overhead: Overhead | null;
  /** Skill id → total XP. */
  skills: Record<string, number>;
  currencies: Currencies;
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
  groundItems: GroundItem[];
  nextGroundItemId: number;
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
  zone: ZoneState;
  economy: EconomyState;
}

/** Static data the tick needs alongside the state. */
export interface SimContext {
  content: Content;
  grid: Grid;
}

export type MessageKind = 'game' | 'npc' | 'public' | 'levelup' | 'warning';

export type SimEvent =
  | { type: 'message'; kind: MessageKind; text: string; speaker?: string }
  | { type: 'xp'; skillId: string; amount: number }
  | { type: 'levelUp'; skillId: string; level: number }
  | { type: 'autosave' };

export type EntityRef =
  | { kind: 'object'; instance: ObjectInstance }
  | { kind: 'npc'; instance: NpcInstance }
  | { kind: 'ground'; instance: GroundItem };

export function createZoneState(zone: ZoneDef): ZoneState {
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
    groundItems: [],
    nextGroundItemId: 0,
  };
}

export function createGameState(content: Content, zoneId: string, seed: number): GameState {
  const zone = content.zones.get(zoneId);
  if (!zone) throw new Error(`Unknown zone '${zoneId}'`);
  const skills: Record<string, number> = {};
  for (const skill of content.skills.values()) skills[skill.id] = xpForLevel(skill.startLevel);
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
      action: null,
      inventory: createInventory(),
      bank: [],
      bankOpen: false,
      dialogue: null,
      overhead: null,
      skills,
      currencies: { ...START_CURRENCIES },
    },
    zone: createZoneState(zone),
    economy: createEconomy(),
  };
}

export function findEntity(state: GameState, id: string): EntityRef | null {
  const obj = state.zone.objects.find((o) => o.id === id);
  if (obj) return { kind: 'object', instance: obj };
  const npc = state.zone.npcs.find((n) => n.id === id);
  if (npc) return { kind: 'npc', instance: npc };
  const ground = state.zone.groundItems.find((g) => g.id === id);
  if (ground) return { kind: 'ground', instance: ground };
  return null;
}
