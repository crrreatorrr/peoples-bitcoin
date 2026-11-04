/**
 * Interest management: what each player sees, and the deltas that keep their
 * replica current. Entities are serialized once per zone per tick; each
 * recipient gets only the ones whose text changed since it last saw them.
 * Players, Sprotos, enemies and ground items are AOI-limited (Chebyshev, with
 * hysteresis); NPCs are zone-wide (a zone has a few dozen). Pure.
 */
import { NET } from '../config/balance';
import { combatLevel } from '../sim/combat';
import { chebyshev } from '../sim/grid';
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
  wire: WireEntity;
  /** The whole entity as JSON. */
  text: string;
  /** Only its moving parts (no d, name, cl, look, mhp), for updates. */
  dyn: string;
  /** Its static parts, to tell whether an update must be a full one. */
  stat: string;
  x: number;
  y: number;
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
  lastSent: Map<string, { stat: string; dyn: string }>;
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

function wire(e: WireEntity): { wire: WireEntity; text: string; dyn: string; stat: string } {
  const dynamic: Record<string, unknown> = {};
  const fixed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if ((STATIC_KEYS as readonly string[]).includes(k)) fixed[k] = v;
    else dynamic[k] = v;
  }
  return {
    wire: e,
    text: JSON.stringify(e),
    dyn: JSON.stringify(dynamic),
    stat: JSON.stringify(fixed),
  };
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
    out.push({ ...wire(e), x: p.pos.x, y: p.pos.y, self: v.pid });
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
      out.push({ ...wire(se), x: s.x, y: s.y, self: v.pid });
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
    out.push({ ...wire(e), x: en.x, y: en.y, owner: en.owner });
  }
  for (const n of zone.npcs) {
    const e: WireEntity = { id: n.id, k: 'n', d: n.defId, x: n.x, y: n.y, f: [n.from.x, n.from.y] };
    out.push({
      ...wire(e),
      x: n.x,
      y: n.y,
      global: true,
      check: n.requires ? (viewer) => npcVisible(viewer, n) : undefined,
    });
  }
  for (const g of zone.groundItems) {
    const e: WireEntity = { id: g.id, k: 'g', d: g.itemId, x: g.x, y: g.y, q: g.qty };
    out.push({
      ...wire(e),
      x: g.x,
      y: g.y,
      check: g.owner !== undefined ? (viewer) => groundVisible(viewer, g) : undefined,
    });
  }
  return out;
}

/** Ids `viewer` sees this tick, with hysteresis against what it saw last tick. */
export function visibleTo(
  viewer: GameState,
  entities: readonly CachedEntity[],
  previously: ReadonlyMap<string, unknown>,
): CachedEntity[] {
  const pos = viewer.player.pos;
  return entities.filter((e) => {
    if (e.self === viewer.pid) return false;
    if (e.owner !== undefined && e.owner !== viewer.pid) return false;
    if (e.check && !e.check(viewer)) return false;
    if (e.global) return true;
    const d = chebyshev(pos, e);
    return d <= NET.aoiRadius || (previously.has(e.wire.id) && d <= NET.aoiExitRadius);
  });
}

/** Changed top-level player keys since the last patch (all of them when `full`). */
export function selfPatch(
  player: PlayerState,
  aoi: AoiState,
  full: boolean,
): Record<string, unknown> | undefined {
  const patch: Record<string, unknown> = {};
  let any = false;
  for (const [key, value] of Object.entries(player)) {
    if (PRIVATE_KEYS.has(key)) continue;
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
