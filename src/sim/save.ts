/**
 * Save format: a versioned, Zod-validated snapshot of the persistent parts of
 * GameState. Transient data (paths, current action, open interfaces, ground
 * items, NPC positions) is not saved.
 *
 * To change the format: bump SAVE_VERSION, update the schema to the new
 * version and register a step in MIGRATIONS that upgrades the previous
 * version by one.
 */
import { z } from 'zod';
import { ECONOMY, INVENTORY_SIZE, MOVEMENT } from '../config/balance';
import type { Content } from './content';
import { buildZoneGrid, isWalkable } from './grid';
import { createGameState, type GameState, type Inventory, type InventorySlot } from './state';

export const SAVE_VERSION = 2;

const StackSchema = z.object({ itemId: z.string(), qty: z.number().int().positive() });

const SaveSchema = z.object({
  version: z.literal(SAVE_VERSION),
  savedAt: z.number(),
  tick: z.number().int().nonnegative(),
  rngState: z.number().int(),
  zoneId: z.string(),
  player: z.object({
    pos: z.object({ x: z.number().int(), y: z.number().int() }),
    running: z.boolean(),
    runEnergy: z.number(),
    inventory: z.array(StackSchema.nullable()),
    bank: z.array(StackSchema),
    skills: z.record(z.string(), z.number().nonnegative()),
    currencies: z.object({ bitcoin: z.number(), btc: z.number() }),
  }),
  economy: z.object({
    priceUsd: z.number().positive(),
    history: z.array(z.number().positive()),
    hopium: z.number(),
    recentBossWins: z.number(),
    recentDumps: z.number(),
  }),
  objects: z.array(z.object({ id: z.string(), depletedUntil: z.number().int().nullable() })),
});

export type SaveData = z.output<typeof SaveSchema>;

type RawSave = Record<string, unknown> & { version: number };

/** Each entry upgrades a save from version N to N + 1. */
const MIGRATIONS: Record<number, (save: RawSave) => RawSave> = {
  // v2 added the bank.
  1: (save) => {
    const player = typeof save.player === 'object' && save.player !== null ? save.player : {};
    return { ...save, version: 2, player: { ...player, bank: [] } };
  },
};

export function serialize(state: GameState, now: number): SaveData {
  const p = state.player;
  return {
    version: SAVE_VERSION,
    savedAt: now,
    tick: state.tick,
    rngState: state.rng.s,
    zoneId: state.zone.id,
    player: {
      pos: { ...p.pos },
      running: p.running,
      runEnergy: p.runEnergy,
      inventory: p.inventory.map((s) => (s ? { ...s } : null)),
      bank: p.bank.map((s) => ({ ...s })),
      skills: { ...p.skills },
      currencies: { ...p.currencies },
    },
    economy: { ...state.economy, history: [...state.economy.history] },
    objects: state.zone.objects.map((o) => ({ id: o.id, depletedUntil: o.depletedUntil })),
  };
}

/** Upgrades any older save to SAVE_VERSION. Returns null if it can't. */
export function migrate(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return null;
  let save = raw as RawSave;
  if (typeof save.version !== 'number') return null;
  while (save.version < SAVE_VERSION) {
    const step = MIGRATIONS[save.version];
    if (!step) return null;
    save = step(save);
  }
  return save.version === SAVE_VERSION ? save : null;
}

/**
 * Rebuilds a GameState from saved data. Returns null for unreadable saves.
 * Unknown items and skills are dropped; new skills start at their start level;
 * a position that is no longer walkable falls back to the zone spawn.
 */
export function deserialize(raw: unknown, content: Content): GameState | null {
  const parsed = SaveSchema.safeParse(migrate(raw));
  if (!parsed.success) return null;
  const save = parsed.data;
  const zone = content.zones.get(save.zoneId);
  if (!zone) return null;

  const state = createGameState(content, save.zoneId, save.rngState);
  state.tick = save.tick;

  const p = state.player;
  const grid = buildZoneGrid(zone, content);
  if (isWalkable(grid, save.player.pos.x, save.player.pos.y)) p.pos = { ...save.player.pos };
  p.stepsThisTick = [{ ...p.pos }];
  p.running = save.player.running;
  p.runEnergy = clamp(save.player.runEnergy, 0, MOVEMENT.runEnergyMax);
  p.inventory = restoreInventory(save.player.inventory, content);
  p.bank = save.player.bank.filter((s) => content.items.has(s.itemId)).map((s) => ({ ...s }));
  for (const skillId of Object.keys(p.skills)) {
    const xp = save.player.skills[skillId];
    if (xp !== undefined) p.skills[skillId] = xp;
  }
  p.currencies = { ...save.player.currencies };

  state.economy = {
    ...save.economy,
    hopium: clamp(save.economy.hopium, 0, 100),
    history: save.economy.history.slice(-ECONOMY.historyLength),
  };
  if (state.economy.history.length === 0) state.economy.history = [state.economy.priceUsd];

  const savedObjects = new Map(save.objects.map((o) => [o.id, o.depletedUntil]));
  for (const obj of state.zone.objects) obj.depletedUntil = savedObjects.get(obj.id) ?? null;

  return state;
}

function restoreInventory(saved: (InventorySlot | null)[], content: Content): Inventory {
  return Array.from({ length: INVENTORY_SIZE }, (_, i) => {
    const slot = saved[i];
    return slot && content.items.has(slot.itemId) ? { ...slot } : null;
  });
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
