/**
 * Items on the ground: drops, loot and death piles. "Take" picks them up and
 * they despawn after a while. Stackable items merge into one pile per tile.
 * Ground items are not saved, like OSRS items vanishing on logout.
 */
import { GROUND_ITEMS } from '../config/balance';
import { addItem, canAdd, removeSlot } from './inventory';
import { progressQuests } from './quests';
import { LOOT } from '../config/balance';
import {
  PLAYER_ID,
  type GameState,
  type GroundItem,
  type SimContext,
  type SimEvent,
  type ZoneState,
} from './state';

/**
 * Online, what a player drops or loots is theirs for LOOT.privateTicks, then
 * anyone's. Untradeables (value 0) never turn public. Offline: no owner.
 */
export function privacyFor(
  state: GameState,
  ctx: SimContext,
  itemId: string,
  ownerPid = state.pid,
): { owner: string; publicAt?: number } | undefined {
  if (ownerPid === PLAYER_ID) return undefined;
  const tradeable = (ctx.content.items.get(itemId)?.value ?? 0) > 0;
  return tradeable
    ? { owner: ownerPid, publicAt: state.tick + LOOT.privateTicks }
    : { owner: ownerPid };
}

export function spawnGroundItem(
  zone: ZoneState,
  itemId: string,
  qty: number,
  x: number,
  y: number,
  despawnTick: number,
  stackable: boolean,
  privacy?: { owner: string; publicAt?: number },
): void {
  const pile = stackable
    ? zone.groundItems.find(
        (g) =>
          g.itemId === itemId &&
          g.x === x &&
          g.y === y &&
          g.owner === privacy?.owner &&
          g.publicAt === privacy?.publicAt,
      )
    : undefined;
  if (pile) {
    pile.qty += qty;
    pile.despawnTick = Math.max(pile.despawnTick, despawnTick);
    return;
  }
  const piles = stackable ? 1 : qty;
  for (let i = 0; i < piles; i++) {
    zone.groundItems.push({
      id: `g${zone.nextGroundItemId++}`,
      itemId,
      qty: stackable ? qty : 1,
      x,
      y,
      despawnTick,
      ...(privacy ? { owner: privacy.owner } : {}),
      ...(privacy?.publicAt !== undefined ? { publicAt: privacy.publicAt } : {}),
    });
  }
}

export function dropToGround(state: GameState, ctx: SimContext, slot: number): void {
  const player = state.player;
  const dropped = removeSlot(player.inventory, slot);
  if (!dropped) return;
  const stackable = ctx.content.items.get(dropped.itemId)?.stackable ?? false;
  spawnGroundItem(
    state.zone,
    dropped.itemId,
    dropped.qty,
    player.pos.x,
    player.pos.y,
    state.tick + GROUND_ITEMS.despawnTicks,
    stackable,
    privacyFor(state, ctx, dropped.itemId),
  );
}

/** Puts an item in the inventory, or on the ground under the player if it won't fit. */
export function giveItem(
  state: GameState,
  ctx: SimContext,
  itemId: string,
  qty: number,
  events: SimEvent[],
): void {
  const item = ctx.content.items.get(itemId);
  if (!item) return;
  if (addItem(state.player.inventory, item, qty)) {
    progressQuests(state, ctx, { type: 'obtain', item: itemId }, events);
    return;
  }
  const { x, y } = state.player.pos;
  spawnGroundItem(
    state.zone,
    itemId,
    qty,
    x,
    y,
    state.tick + GROUND_ITEMS.despawnTicks,
    item.stackable,
    privacyFor(state, ctx, itemId),
  );
  events.push({
    type: 'message',
    kind: 'warning',
    text: `Your inventory is full, so the ${item.name} lands at your feet.`,
  });
}

export function takeGroundItem(
  state: GameState,
  ctx: SimContext,
  ground: GroundItem,
  events: SimEvent[],
): void {
  const zone = state.zone;
  const item = ctx.content.items.get(ground.itemId);
  if (item) {
    if (!canAdd(state.player.inventory, item, item.stackable ? 1 : ground.qty)) {
      events.push({
        type: 'message',
        kind: 'game',
        text: "You don't have enough inventory space to hold that.",
      });
      return;
    }
    addItem(state.player.inventory, item, ground.qty);
    progressQuests(state, ctx, { type: 'obtain', item: ground.itemId }, events);
  }
  zone.groundItems = zone.groundItems.filter((g) => g !== ground);
}

export function despawnGroundItems(state: GameState): void {
  const zone = state.zone;
  if (zone.groundItems.some((g) => state.tick >= g.despawnTick)) {
    zone.groundItems = zone.groundItems.filter((g) => state.tick < g.despawnTick);
  }
}
