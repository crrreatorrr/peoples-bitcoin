/**
 * Moving between zones (portals), boss gates, and death/respawn.
 */
import { DEATH, MOVEMENT, START_ZONE_ID } from '../config/balance';
import { BUNKER_ZONE_ID, hasRespawnBed } from './bunker';
import { isWalkable } from './grid';
import { spawnGroundItem } from './ground';
import { progressQuests } from './quests';
import {
  createZoneState,
  gridOf,
  hasUnlock,
  maxHp,
  npcInstance,
  PLAYER_ID,
  type GameState,
  type ObjectInstance,
  type SimContext,
  type SimEvent,
  type Tile,
} from './state';
import type { Content } from './content';
import { besidePlayer } from './sprotos';

/** The zone-file placement an object instance came from. */
export function placementOf(state: GameState, ctx: SimContext, obj: ObjectInstance) {
  return ctx.content.zones.get(state.zone.id)?.objects[Number(obj.id.slice(1))];
}

export function changeZone(
  state: GameState,
  ctx: SimContext,
  zoneId: string,
  at: Tile,
  events: SimEvent[],
): void {
  const player = state.player;
  if (zoneId !== state.zone.id) {
    const def = ctx.content.zones.get(zoneId);
    if (!def) return;
    // Enemies left behind forget you.
    for (const e of state.zone.enemies) e.target = null;
    state.otherZones[state.zone.id] = state.zone;
    state.zone = state.otherZones[zoneId] ?? createZoneState(def, ctx.content);
    delete state.otherZones[zoneId];
    events.push({ type: 'zoneChanged', zoneId });
  }
  player.pos = { x: at.x, y: at.y };
  player.stepsThisTick = [{ x: at.x, y: at.y }];
  player.path = [];
  player.action = null;
  player.interface = null;
  player.dialogue = null;
  if (player.sproto) {
    const spot = besidePlayer(state, ctx);
    Object.assign(player.sproto, spot, { from: { ...spot }, target: null });
  }
  showUnlockedNpcs(state, ctx.content);
  progressQuests(state, ctx, { type: 'enterZone', zone: zoneId }, events);
}

/** Adds the zone's NPCs whose `requires` the player now has; they turn up the next time you arrive. */
export function showUnlockedNpcs(state: GameState, content: Content): void {
  const def = content.zones.get(state.zone.id);
  if (!def) return;
  def.npcs.forEach((n, i) => {
    if (!n.requires || !hasUnlock(state.player, n.requires)) return;
    if (state.zone.npcs.some((npc) => npc.id === `n${i}`)) return;
    state.zone.npcs.push(npcInstance(def, i));
  });
}

function locked(state: GameState, requires: string | undefined): boolean {
  return requires !== undefined && !hasUnlock(state.player, requires);
}

export function usePortal(
  state: GameState,
  ctx: SimContext,
  obj: ObjectInstance,
  events: SimEvent[],
): void {
  const placement = placementOf(state, ctx, obj);
  if (!placement?.to) return;
  if (locked(state, placement.requires)) {
    events.push({
      type: 'message',
      kind: 'game',
      text: placement.lockedMessage ?? "It won't open.",
    });
    return;
  }
  changeZone(state, ctx, placement.to.zone, placement.to, events);
}

/** Gates sit in a wall; passing puts you on the opposite side. */
export function passGate(
  state: GameState,
  ctx: SimContext,
  obj: ObjectInstance,
  events: SimEvent[],
): void {
  const placement = placementOf(state, ctx, obj);
  if (locked(state, placement?.requires)) {
    events.push({
      type: 'message',
      kind: 'game',
      text: placement?.lockedMessage ?? "It won't budge.",
    });
    return;
  }
  const player = state.player;
  const dest = { x: 2 * obj.x - player.pos.x, y: 2 * obj.y - player.pos.y };
  if (!isWalkable(gridOf(state, ctx), dest.x, dest.y)) return;
  player.stepsThisTick = [{ ...player.pos }, { x: obj.x, y: obj.y }, dest];
  player.pos = dest;
  player.path = [];
  player.action = null;
  events.push({ type: 'message', kind: 'game', text: 'You squeeze through the barricade.' });
}

/** At 0 HP the player falls; enemies lose interest while the death plays out (OSRS). */
export function startDying(state: GameState, events: SimEvent[]): void {
  const player = state.player;
  player.dyingUntil = state.tick + DEATH.respawnDelayTicks;
  player.path = [];
  player.action = null;
  player.interface = null;
  player.dialogue = null;
  for (const e of state.zone.enemies) if (e.target !== null) e.target = null;
  events.push({ type: 'death', entityId: PLAYER_ID });
  events.push({ type: 'message', kind: 'warning', text: 'Oh dear, you are dead!' });
}

/** After the fall: drop the inventory where you fell, then wake up in the bunker bed or the Treasury. */
export function handleDeath(state: GameState, ctx: SimContext, events: SimEvent[]): void {
  const player = state.player;
  player.dyingUntil = null;
  events.push({
    type: 'message',
    kind: 'warning',
    text: 'The Secret Service drags you back to safety.',
  });
  if (DEATH.dropInventory) {
    const until = state.tick + DEATH.pileDespawnTicks;
    player.inventory.forEach((s, i) => {
      if (!s) return;
      const def = ctx.content.items.get(s.itemId);
      if (def?.value === 0) return; // untradeables (quest items) stay with you, as in OSRS
      const stackable = def?.stackable ?? false;
      spawnGroundItem(state.zone, s.itemId, s.qty, player.pos.x, player.pos.y, until, stackable);
      player.inventory[i] = null;
    });
    events.push({
      type: 'message',
      kind: 'warning',
      text: 'Your inventory was left where you fell. Hurry back for it!',
    });
  }
  for (const e of state.zone.enemies) if (e.target !== null) e.target = null;
  player.sproto = null;
  player.hp = maxHp(player);
  player.runEnergy = MOVEMENT.runEnergyMax;
  const home = hasRespawnBed(state, ctx) ? BUNKER_ZONE_ID : START_ZONE_ID;
  const spawn = ctx.content.zones.get(home)!.spawn;
  changeZone(state, ctx, home, spawn, events);
}
