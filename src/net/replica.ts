/**
 * The client's copy of what the server shows it, shaped as a GameState so the
 * existing UI and renderer read it unchanged: `player` is you, `zone` holds
 * the NPCs, enemies and ground items in view, and `others` the other players
 * and their Sprotos. Your own entity ids ('p:<you>', 's:<you>') become
 * 'player' and 'sproto' everywhere.
 */
import type { Content } from '../sim/content';
import {
  createGameState,
  createZoneState,
  newEnemy,
  PLAYER_ID,
  SPROTO_ID,
  type EnemyInstance,
  type GameState,
  type GroundItem,
  type NpcInstance,
  type PlayerState,
  type SimEvent,
  type Tile,
} from '../sim/state';
import type { Delta, Snapshot, WireEntity } from './protocol';

/** Another player or their Sproto, as the renderer needs it. */
export interface RemoteActor {
  id: string;
  kind: 'p' | 's';
  defId: string;
  x: number;
  y: number;
  /** Tiles stepped this tick, starting where it stood (render interpolation). */
  steps: Tile[];
  hp: number;
  maxHp: number;
  name: string;
  combatLevel: number;
  /** head|body|legs|weapon item ids. */
  look: string;
  overhead: string | null;
  target: string | null;
  dying: boolean;
}

/** Keys the server never sends in a self patch, kept from the local blank state. */
const LOCAL_KEYS = new Set(['ledger', 'social']);
const STATIC = ['k', 'd', 'name', 'cl', 'look', 'mhp'] as const;

export class Replica {
  readonly state: GameState;
  readonly others = new Map<string, RemoteActor>();
  /** This client's server entity ids. */
  selfId = '';
  sprotoId = '';
  tick = 0;
  private readonly wires = new Map<string, WireEntity>();

  constructor(
    private readonly content: Content,
    zoneId: string,
  ) {
    this.state = createGameState(content, zoneId, 1);
  }

  setSelf(selfId: string): void {
    this.selfId = selfId;
    this.sprotoId = selfId.startsWith('p:') ? `s:${selfId.slice(2)}` : SPROTO_ID;
  }

  /** Maps this client's server ids to the local 'player' / 'sproto'. */
  local(id: string): string {
    if (id === this.selfId) return PLAYER_ID;
    if (id === this.sprotoId) return SPROTO_ID;
    return id;
  }

  /** Applies a full view. Returns the events to show (a zone change first, if any). */
  applySnapshot(snap: Snapshot & { ev?: SimEvent[] }): SimEvent[] {
    const out: SimEvent[] = [];
    const world = this.state.world;
    if (snap.zone !== this.state.zone.id && this.content.zones.has(snap.zone)) {
      const def = this.content.zones.get(snap.zone)!;
      world.zones[snap.zone] = createZoneState(def, this.content);
      world.playerZone[PLAYER_ID] = snap.zone;
      out.push({ type: 'zoneChanged', zoneId: snap.zone });
    }
    this.tick = snap.tick;
    world.tick = snap.tick;
    const zone = this.state.zone;
    zone.npcs = [];
    zone.enemies = [];
    zone.groundItems = [];
    this.others.clear();
    this.wires.clear();
    for (const o of zone.objects) o.depletedUntil = null;
    this.patchSelf(snap.self);
    for (const e of snap.ent) this.upsert(e);
    this.applyObjects(snap.obj);
    out.push(...this.mapEvents(snap.ev ?? []));
    return out;
  }

  applyDelta(d: Delta): SimEvent[] {
    this.tick = d.tick;
    this.state.world.tick = d.tick;
    if (d.self) this.patchSelf(d.self);
    for (const e of d.ent) this.upsert(e);
    for (const id of d.del) this.remove(id);
    if (d.obj) this.applyObjects(d.obj);
    return this.mapEvents(d.ev);
  }

  private patchSelf(patch: Record<string, unknown>): void {
    const p = this.state.player as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (LOCAL_KEYS.has(key)) continue;
      p[key] = value;
    }
    const player = this.state.player as PlayerState;
    if (player.action)
      player.action = { ...player.action, targetId: this.local(player.action.targetId) };
    if (player.sproto?.target) player.sproto.target = this.local(player.sproto.target);
  }

  private applyObjects(list: [string, number | null][]): void {
    for (const [id, until] of list) {
      const o = this.state.zone.objects.find((obj) => obj.id === id);
      if (o) o.depletedUntil = until;
    }
  }

  private upsert(raw: WireEntity): void {
    const prev = this.wires.get(raw.id);
    let e = raw;
    if (prev && raw.d === undefined) {
      // A moving-parts update: keep the static parts we already have.
      const merged: Record<string, unknown> = { ...raw };
      for (const k of STATIC) if (prev[k] !== undefined) merged[k] = prev[k];
      e = merged as unknown as WireEntity;
    }
    this.wires.set(e.id, e);
    const zone = this.state.zone;
    switch (e.k) {
      case 'e': {
        let enemy = zone.enemies.find((x) => x.id === e.id);
        if (!enemy) {
          enemy = newEnemy(e.id, e.d, e.x, e.y, this.content, false);
          zone.enemies.push(enemy);
        }
        updateEnemy(enemy, e, (id) => this.local(id));
        return;
      }
      case 'n': {
        const npc: NpcInstance = {
          id: e.id,
          defId: e.d,
          x: e.x,
          y: e.y,
          spawn: { x: e.x, y: e.y },
          from: e.f ? { x: e.f[0], y: e.f[1] } : { x: e.x, y: e.y },
          goal: null,
        };
        const i = zone.npcs.findIndex((x) => x.id === e.id);
        if (i >= 0) Object.assign(zone.npcs[i], { x: npc.x, y: npc.y, from: npc.from });
        else zone.npcs.push(npc);
        return;
      }
      case 'g': {
        const item: GroundItem = {
          id: e.id,
          itemId: e.d,
          qty: e.q ?? 1,
          x: e.x,
          y: e.y,
          despawnTick: Infinity,
        };
        const i = zone.groundItems.findIndex((x) => x.id === e.id);
        if (i >= 0) zone.groundItems[i] = item;
        else zone.groundItems.push(item);
        return;
      }
      case 'p':
      case 's': {
        const steps = e.st
          ? e.st.map(([x, y]) => ({ x, y }))
          : e.f
            ? [
                { x: e.f[0], y: e.f[1] },
                { x: e.x, y: e.y },
              ]
            : [{ x: e.x, y: e.y }];
        this.others.set(e.id, {
          id: e.id,
          kind: e.k,
          defId: e.d,
          x: e.x,
          y: e.y,
          steps,
          hp: e.hp ?? 1,
          maxHp: e.mhp ?? 1,
          name: e.name ?? '',
          combatLevel: e.cl ?? 3,
          look: e.look ?? '|||',
          overhead: e.oh ?? null,
          target: e.tgt ? this.local(e.tgt) : null,
          dying: e.dy === 1,
        });
        return;
      }
    }
  }

  private remove(id: string): void {
    this.wires.delete(id);
    const zone = this.state.zone;
    zone.enemies = zone.enemies.filter((e) => e.id !== id);
    zone.npcs = zone.npcs.filter((n) => n.id !== id);
    zone.groundItems = zone.groundItems.filter((g) => g.id !== id);
    this.others.delete(id);
  }

  private mapEvents(events: SimEvent[]): SimEvent[] {
    const l = (id: string) => this.local(id);
    return events.map((e) => {
      switch (e.type) {
        case 'attack':
          return { ...e, attackerId: l(e.attackerId), targetId: l(e.targetId) };
        case 'hitsplat':
          return { ...e, targetId: l(e.targetId) };
        case 'death':
          return { ...e, entityId: l(e.entityId) };
        default:
          return e;
      }
    });
  }
}

function updateEnemy(enemy: EnemyInstance, e: WireEntity, local: (id: string) => string): void {
  enemy.x = e.x;
  enemy.y = e.y;
  enemy.from = e.f ? { x: e.f[0], y: e.f[1] } : { x: e.x, y: e.y };
  if (e.hp !== undefined) enemy.hp = e.hp;
  enemy.respawnAt = null;
  enemy.overhead = e.oh ? { text: e.oh, untilTick: Infinity } : null;
  enemy.target = e.tgt ? local(e.tgt) : null;
}
