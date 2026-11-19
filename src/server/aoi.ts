/**
 * Interest management: what each player sees, and the deltas that keep their
 * replica current. Entities are serialized once per zone per tick; each
 * recipient gets only the ones whose text changed since it last saw them.
 * Players, Sprotos, enemies and ground items are AOI-limited (Chebyshev, with
 * hysteresis); NPCs are zone-wide (a zone has a few dozen). Pure.
 */
import { NET } from '../config/balance';
import { combatLevel } from '../sim/combat';
import type { Content } from '../sim/content';
import {
  groundVisible,
  maxHp,
  npcVisible,
  type GameState,
  type PlayerState,
  type SimEvent,
  type ZoneState,
} from '../sim/state';
import { pairs, type WireEntity } from '../net/protocol';

/** One serialized entity, with what visibility needs. */
export interface CachedEntity {
  readonly wire: WireEntity;
  /** The whole entity as JSON (built on first read). */
  readonly text: string;
  /** Only its moving parts (no d, name, cl, look, mhp), for updates. */
  readonly dyn: string;
  /** Its static parts, to tell whether an update must be a full one. */
  readonly stat: string;
  readonly x: number;
  readonly y: number;
  /** Visible only to this pid (private enemies). */
  owner?: string;
  /** Zone-wide (NPCs). */
  global?: boolean;
  /** Visibility needs the recipient's view (NPC requires, private loot). */
  check?: (viewer: GameState) => boolean;
  /** The owning pid of a player or Sproto entity (never sent to that pid). */
  self?: string;
}

/** Per recipient: what it has, so the next delta carries only changes. */
export interface AoiState {
  zoneKey: string | null;
  /** Entity id → the static and moving parts last sent. */
  lastSent: Map<string, { stat: string; dyn: string; at?: number }>;
  lastSelf: Map<string, string>;
  lastObj: Map<string, number>;
}

export function newAoi(): AoiState {
  return { zoneKey: null, lastSent: new Map(), lastSelf: new Map(), lastObj: new Map() };
}

/** Player keys a client never needs (server bookkeeping), or gets elsewhere. */
const PRIVATE_KEYS = new Set(['ledger', 'social']);

/** Look: head|body|legs|weapon item ids, which dress the shared President model. */
export function lookOf(p: PlayerState): string {
  const e = p.equipment;
  return [e.head, e.body, e.legs, e.weapon].map((s) => s?.itemId ?? '').join('|');
}

/** Fields that rarely change; an update without them keeps the client's copy. */
export const STATIC_KEYS = ['k', 'd', 'name', 'cl', 'look', 'mhp'] as const;
const STATIC = new Set<string>(STATIC_KEYS);

/**
 * One entity's wire forms. `dyn` and `stat` are built every tick (they decide what changed);
 * the whole-entity `text` only when a recipient needs it (new to it, or its static part changed),
 * which on a busy world is a small share of entities. Built field by field rather than with
 * object spread: the server bundle runs in an interpreter where spread is a slow helper call.
 */
class Cached implements CachedEntity {
  readonly dyn: string;
  readonly stat: string;
  private full: string | null = null;
  owner?: string;
  global?: boolean;
  check?: (viewer: GameState) => boolean;
  self?: string;

  constructor(
    readonly wire: WireEntity,
    readonly x: number,
    readonly y: number,
  ) {
    const dynamic: Record<string, unknown> = {};
    const fixed: Record<string, unknown> = {};
    const fields = wire as unknown as Record<string, unknown>;
    for (const k in fields) {
      if (STATIC.has(k)) fixed[k] = fields[k];
      else dynamic[k] = fields[k];
    }
    this.dyn = JSON.stringify(dynamic);
    this.stat = JSON.stringify(fixed);
  }

  get text(): string {
    this.full ??= JSON.stringify(this.wire);
    return this.full;
  }
}

/** Every entity of one zone instance, serialized once for this tick. */
export function zoneEntities(
  zone: ZoneState,
  players: readonly GameState[],
  content: Content,
): CachedEntity[] {
  const out: CachedEntity[] = [];
  for (const v of players) {
    const p = v.player;
    const e: WireEntity = {
      id: v.selfId,
      k: 'p',
      d: 'player_president',
      x: p.pos.x,
      y: p.pos.y,
      st: pairs(p.stepsThisTick),
      hp: p.hp,
      mhp: maxHp(p),
      name: p.displayName ?? p.name,
      cl: combatLevel(p.skills),
      look: lookOf(p),
    };
    if (p.overhead) e.oh = p.overhead.text;
    if (p.action?.action === 'Attack') e.tgt = p.action.targetId;
    if (p.dyingUntil !== null) e.dy = 1;
    const pe = new Cached(e, p.pos.x, p.pos.y);
    pe.self = v.pid;
    out.push(pe);
    const s = p.sproto;
    if (s) {
      const se: WireEntity = {
        id: v.sprotoId,
        k: 's',
        d: s.defId,
        x: s.x,
        y: s.y,
        f: [s.from.x, s.from.y],
        hp: s.hp,
        mhp: content.sprotos.get(s.defId)?.hp ?? s.hp,
      };
      if (s.target) se.tgt = s.target;
      const ce = new Cached(se, s.x, s.y);
      ce.self = v.pid;
      out.push(ce);
    }
  }
  for (const en of zone.enemies) {
    if (en.respawnAt !== null) continue;
    const e: WireEntity = {
      id: en.id,
      k: 'e',
      d: en.defId,
      x: en.x,
      y: en.y,
      f: [en.from.x, en.from.y],
      hp: en.hp,
      mhp: content.enemies.get(en.defId)?.hp ?? en.hp,
    };
    if (en.overhead) e.oh = en.overhead.text;
    if (en.target) e.tgt = en.target;
    const ee = new Cached(e, en.x, en.y);
    if (en.owner !== undefined) ee.owner = en.owner;
    out.push(ee);
  }
  for (const n of zone.npcs) {
    const e: WireEntity = { id: n.id, k: 'n', d: n.defId, x: n.x, y: n.y, f: [n.from.x, n.from.y] };
    const ne = new Cached(e, n.x, n.y);
    ne.global = true;
    if (n.requires) ne.check = (viewer) => npcVisible(viewer, n);
    out.push(ne);
  }
  for (const g of zone.groundItems) {
    const e: WireEntity = { id: g.id, k: 'g', d: g.itemId, x: g.x, y: g.y, q: g.qty };
    const ge = new Cached(e, g.x, g.y);
    if (g.owner !== undefined) ge.check = (viewer) => groundVisible(viewer, g);
    out.push(ge);
  }
  return out;
}

/** Does `viewer` see `e` this tick? `seen` is whether it saw it last tick (hysteresis). */
export function seesEntity(viewer: GameState, e: CachedEntity, seen: boolean): boolean {
  if (e.self === viewer.pid) return false;
  if (e.owner !== undefined && e.owner !== viewer.pid) return false;
  if (e.check && !e.check(viewer)) return false;
  if (e.global) return true;
  // Chebyshev distance, inlined (hot: every recipient against every entity).
  const pos = viewer.player.pos;
  const dx = pos.x > e.x ? pos.x - e.x : e.x - pos.x;
  const dy = pos.y > e.y ? pos.y - e.y : e.y - pos.y;
  const d = dx > dy ? dx : dy;
  return d <= NET.aoiRadius || (seen && d <= NET.aoiExitRadius);
}

/** Ids `viewer` sees this tick, with hysteresis against what it saw last tick. */
export function visibleTo(
  viewer: GameState,
  entities: readonly CachedEntity[],
  previously: ReadonlyMap<string, unknown>,
): CachedEntity[] {
  const out: CachedEntity[] = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (seesEntity(viewer, e, previously.has(e.wire.id))) out.push(e);
  }
  return out;
}

/**
 * What changed in a zone since the last tick: entities whose text differs (or
 * are new), and ids that are gone. Private loot that turns public this tick
 * counts as changed, since who may see it changes.
 */
export function zoneChanges(
  entities: readonly CachedEntity[],
  previous: Map<string, string> | undefined,
  tick: number,
  zone: ZoneState,
): { changed: CachedEntity[]; removed: string[]; now: Map<string, string> } {
  const now = new Map<string, string>();
  const changed: CachedEntity[] = [];
  const publicNow = new Set(zone.groundItems.filter((g) => g.publicAt === tick).map((g) => g.id));
  for (const e of entities) {
    // Same entity, same parts: the static and moving parts decide it exactly as the whole text.
    const key = e.stat + e.dyn;
    now.set(e.wire.id, key);
    if (!previous || previous.get(e.wire.id) !== key || publicNow.has(e.wire.id)) changed.push(e);
  }
  const removed: string[] = [];
  if (previous) for (const id of previous.keys()) if (!now.has(id)) removed.push(id);
  return { changed, removed, now };
}

/**
 * Keys that change only when the player does something (or something happens
 * to them). They are compared only on ticks with intents, events, an action
 * or an open interface, and on keyframes; on a busy world this skips most of
 * the per-player serializing.
 */
const COLD_KEYS = new Set([
  'name',
  'displayName',
  'inventory',
  'equipment',
  'bank',
  'skills',
  'quests',
  'unlocks',
  'bunker',
  'collected',
  'cooldowns',
  'currencies',
  'style',
  'autoRetaliate',
]);

/** Changed top-level player keys since the last patch (all of them when `full`). */
export function selfPatch(
  player: PlayerState,
  aoi: AoiState,
  full: boolean,
  busy = true,
): Record<string, unknown> | undefined {
  const patch: Record<string, unknown> = {};
  let any = false;
  for (const key in player) {
    const value = (player as unknown as Record<string, unknown>)[key];
    if (PRIVATE_KEYS.has(key)) continue;
    if (!full && !busy && COLD_KEYS.has(key)) continue;
    const text = JSON.stringify(value ?? null);
    if (!full && aoi.lastSelf.get(key) === text) continue;
    aoi.lastSelf.set(key, text);
    patch[key] = value ?? null;
    any = true;
  }
  return any ? patch : undefined;
}

/** Depleted objects that changed since the last delta (all depleted ones when `full`). */
export function objectChanges(
  zone: ZoneState,
  aoi: AoiState,
  full: boolean,
): [string, number | null][] {
  const out: [string, number | null][] = [];
  if (full) aoi.lastObj.clear();
  for (const o of zone.objects) {
    const before = aoi.lastObj.get(o.id) ?? null;
    if (o.depletedUntil === before) continue;
    out.push([o.id, o.depletedUntil]);
    if (o.depletedUntil === null) aoi.lastObj.delete(o.id);
    else aoi.lastObj.set(o.id, o.depletedUntil);
  }
  return out;
}

/** Visual events other players see when they can see who is involved. */
const AREA_EVENTS = new Set<SimEvent['type']>(['attack', 'hitsplat', 'death']);

export function isAreaEvent(e: SimEvent): boolean {
  return AREA_EVENTS.has(e.type);
}

/** Entity ids an area event is about. */
export function eventEntities(e: SimEvent): string[] {
  if (e.type === 'attack') return [e.attackerId, e.targetId];
  if (e.type === 'hitsplat') return [e.targetId];
  if (e.type === 'death') return [e.entityId];
  return [];
}
