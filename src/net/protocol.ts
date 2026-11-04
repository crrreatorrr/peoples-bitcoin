/**
 * The wire protocol between the client and a `pb_world` match (JSON text).
 * Shared by the client and the server bundle, so it stays pure: no DOM, no
 * Node, no TextEncoder. Every client → server body is validated here.
 */
import { z } from 'zod';
import type { ChatFilter, InventorySlot, SimEvent, Tile } from '../sim/state';

export const PROTOCOL_VERSION = 1;

export const OP = {
  HELLO: 1,
  INTENTS: 2,
  CHAT: 3,
  TRADE: 4,
  SOCIAL: 5,
  PING: 7,
  WELCOME: 101,
  SNAPSHOT: 102,
  DELTA: 103,
  CHAT_OUT: 104,
  TRADE_OUT: 105,
  SOCIAL_OUT: 106,
  KICK: 107,
  PONG: 108,
} as const;

const int = z.number().int();
const slot = int.min(0).max(64);
const qty = z.union([int.min(1).max(2_147_483_647), z.literal('all')]);
const id = z.string().min(1).max(64);
const STYLES = ['accurate', 'rapid', 'longrange', 'bash', 'block'] as const;
const EQUIP = ['head', 'neck', 'weapon', 'body', 'legs', 'hands', 'feet', 'ammo'] as const;

/** Every intent a client may send. Strict: an unknown field makes it malformed. */
export const IntentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('walk'), x: int.min(0).max(1024), y: int.min(0).max(1024) }).strict(),
  z
    .object({ type: z.literal('interact'), targetId: id, action: z.string().min(1).max(32) })
    .strict(),
  z.object({ type: z.literal('toggleRun') }).strict(),
  z.object({ type: z.literal('toggleRetaliate') }).strict(),
  z.object({ type: z.literal('dropItem'), slot }).strict(),
  z.object({ type: z.literal('moveItem'), from: slot, to: slot }).strict(),
  z.object({ type: z.literal('equip'), slot }).strict(),
  z.object({ type: z.literal('unequip'), slot: z.enum(EQUIP) }).strict(),
  z.object({ type: z.literal('eat'), slot }).strict(),
  z.object({ type: z.literal('drink'), slot }).strict(),
  z.object({ type: z.literal('teleport'), slot }).strict(),
  z.object({ type: z.literal('useItem'), slot, targetId: id }).strict(),
  z.object({ type: z.literal('chooseOption'), index: int.min(0).max(9) }).strict(),
  z.object({ type: z.literal('summon'), slot }).strict(),
  z.object({ type: z.literal('dismiss') }).strict(),
  z.object({ type: z.literal('special') }).strict(),
  z.object({ type: z.literal('setStyle'), style: z.enum(STYLES) }).strict(),
  z.object({ type: z.literal('continueDialogue') }).strict(),
  z.object({ type: z.literal('deposit'), slot, qty }).strict(),
  z.object({ type: z.literal('depositAll') }).strict(),
  z
    .object({
      type: z.literal('withdraw'),
      index: int.min(0).max(1000),
      qty,
      itemId: id.optional(),
    })
    .strict(),
  z.object({ type: z.literal('buy'), itemId: id, qty: int.min(1).max(10_000) }).strict(),
  z.object({ type: z.literal('sell'), slot, qty }).strict(),
  z.object({ type: z.literal('build'), buildId: id }).strict(),
  z.object({ type: z.literal('closeInterface') }).strict(),
]);

export const HelloSchema = z.object({
  proto: int,
  sim: z.string().max(64),
  client: z.string().max(64).optional(),
});

export const IntentsSchema = z.object({ seq: int.min(0), intents: z.array(z.unknown()).max(64) });

const text = z.string().min(1).max(200);
export const ChatInSchema = z.discriminatedUnion('ch', [
  z.object({ ch: z.literal('public'), text }).strict(),
  z.object({ ch: z.literal('pm'), to: z.string().min(1).max(32), text }).strict(),
  z.object({ ch: z.literal('reply'), text }).strict(),
  z
    .object({
      ch: z.literal('quick'),
      phrase: z.string().min(1).max(48),
      pm: z.string().min(1).max(32).optional(),
    })
    .strict(),
]);
export type ChatIn = z.output<typeof ChatInSchema>;

const filter = z.enum(['on', 'friends', 'off']);
export const SocialInSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('addFriend'), name: z.string().min(1).max(32) }).strict(),
  z.object({ op: z.literal('delFriend'), name: z.string().min(1).max(32) }).strict(),
  z.object({ op: z.literal('addIgnore'), name: z.string().min(1).max(32) }).strict(),
  z.object({ op: z.literal('delIgnore'), name: z.string().min(1).max(32) }).strict(),
  z.object({ op: z.literal('filters'), public: filter, private: filter, trade: filter }).strict(),
]);
export type SocialIn = z.output<typeof SocialInSchema>;

export const TradeInSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('request'), to: id }).strict(),
  z.object({ op: z.literal('offer'), slot, qty }).strict(),
  z.object({ op: z.literal('remove'), index: int.min(0).max(64), qty }).strict(),
  z.object({ op: z.literal('accept') }).strict(),
  z.object({ op: z.literal('decline') }).strict(),
]);
export type TradeIn = z.output<typeof TradeInSchema>;

export const PingSchema = z.object({ t: z.number() });

// ── Server → client ──────────────────────────────────────────────────────────

/**
 * One visible entity. k: p player, s Sproto, e enemy, n NPC, g ground item.
 * `f` is where it stood at the start of the tick and `st` the tiles a player
 * stepped (render interpolation).
 */
export interface WireEntity {
  id: string;
  k: 'p' | 's' | 'e' | 'n' | 'g';
  d: string;
  x: number;
  y: number;
  f?: [number, number];
  st?: [number, number][];
  hp?: number;
  mhp?: number;
  /** Players: nameplate and combat level. */
  name?: string;
  cl?: number;
  /** Players: head|body|legs item ids, then weapon id. */
  look?: string;
  oh?: string;
  tgt?: string;
  /** Ground items: quantity. */
  q?: number;
  /** Players: dying. */
  dy?: 1;
}

export interface Welcome {
  you: string;
  world: number;
  tick: number;
  sim: string;
  name: string;
  needsCharacter: boolean;
  canImport: boolean;
}

/** Top-level PlayerState keys that changed, by value. */
export type SelfPatch = Record<string, unknown>;

export interface Snapshot {
  tick: number;
  zone: string;
  self: SelfPatch;
  ent: WireEntity[];
  /** Depleted objects: [id, depletedUntil]. */
  obj: [string, number][];
  economy?: unknown;
}

export interface Delta {
  tick: number;
  ack: number;
  self?: SelfPatch;
  ent: WireEntity[];
  del: string[];
  /** Objects whose depletion changed: [id, depletedUntil or null]. */
  obj?: [string, number | null][];
  ev: SimEvent[];
}

export type ChatOut =
  | { ch: 'public'; from: string; text: string; quick?: boolean; id: string }
  | { ch: 'pm_in'; from: string; text: string; quick?: boolean; world?: number }
  | { ch: 'pm_out'; to: string; text: string; quick?: boolean }
  | { ch: 'trade'; from: string; text: string }
  | { ch: 'system'; text: string };

export interface TradeOfferRow extends InventorySlot {
  name: string;
}
export interface TradeOut {
  stage: 'request' | 'offer' | 'confirm' | 'closed';
  with: string;
  withId?: string;
  mine: TradeOfferRow[];
  theirs: TradeOfferRow[];
  accepted: { me: boolean; them: boolean };
  /** Free inventory slots on the other side. */
  theirFree?: number;
  /** Terminal value in Tickets of each side, on the confirm screen. */
  value?: { mine: number; theirs: number };
  lockedUntil?: number;
  modified?: boolean;
  reason?: string;
}

export interface SocialOut {
  friends: { name: string; world: number | null }[];
  ignores: string[];
  filters: { public: ChatFilter; private: ChatFilter; trade: ChatFilter };
}

export type KickReason =
  | 'sim_mismatch'
  | 'flood'
  | 'superseded'
  | 'world_full'
  | 'shutdown'
  | 'session_expired'
  | 'already_online';

export interface Kick {
  reason: KickReason;
}

export interface Pong {
  t: number;
  serverTick: number;
}

/** Parses JSON text; null for anything that isn't JSON. */
export function decode(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function encode(body: unknown): string {
  return JSON.stringify(body);
}

/** Tiles as compact pairs. */
export function pairs(tiles: readonly Tile[]): [number, number][] {
  return tiles.map((t) => [t.x, t.y]);
}
