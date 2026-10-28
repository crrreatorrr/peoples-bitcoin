/**
 * Items on the ground: dropping puts the item on the player's tile, "Take"
 * picks it up, and it despawns after a while. Stackable items merge into one
 * pile per tile. Ground items are not saved, like OSRS items vanishing on logout.
 */
import { GROUND_ITEMS } from '../config/balance';
import { addItem, canAdd, removeSlot } from './inventory';
import type { GameState, GroundItem, SimContext, SimEvent } from './state';

export function dropToGround(state: GameState, ctx: SimContext, slot: number): void {
  const player = state.player;
  const dropped = removeSlot(player.inventory, slot);
  if (!dropped) return;
  const zone = state.zone;
  const despawnTick = state.tick + GROUND_ITEMS.despawnTicks;
  const stackable = ctx.content.items.get(dropped.itemId)?.stackable ?? false;
  const pile = stackable
    ? zone.groundItems.find(
        (g) => g.itemId === dropped.itemId && g.x === player.pos.x && g.y === player.pos.y,
      )
    : undefined;
  if (pile) {
    pile.qty += dropped.qty;
    pile.despawnTick = despawnTick;
    return;
  }
  zone.groundItems.push({
    id: `g${zone.nextGroundItemId++}`,
    itemId: dropped.itemId,
    qty: dropped.qty,
    x: player.pos.x,
    y: player.pos.y,
    despawnTick,
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
  }
  zone.groundItems = zone.groundItems.filter((g) => g !== ground);
}

export function despawnGroundItems(state: GameState): void {
  const zone = state.zone;
  if (zone.groundItems.some((g) => state.tick >= g.despawnTick)) {
    zone.groundItems = zone.groundItems.filter((g) => state.tick < g.despawnTick);
  }
}
