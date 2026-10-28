/**
 * Teleport items: tickets are used up; reusable ones (quest rewards) recharge.
 * Teleporting takes a few ticks, during which the player can't act, then
 * lands them at the item's destination.
 */
import { TELEPORT } from '../config/balance';
import { hasUnlock, type GameState, type SimContext, type SimEvent } from './state';
import { changeZone } from './zones';

export function startTeleport(
  state: GameState,
  ctx: SimContext,
  slot: number,
  events: SimEvent[],
): void {
  const player = state.player;
  const item = player.inventory[slot];
  const def = item && ctx.content.items.get(item.itemId);
  const t = def?.teleport;
  if (!item || !def || !t || player.teleport) return;
  const say = (text: string): void => {
    events.push({ type: 'message', kind: 'game', text });
  };
  if (t.requires && !hasUnlock(player, t.requires)) {
    return say(`The ${def.name} fizzles. You haven't unlocked that place yet.`);
  }
  const ready = player.cooldowns[def.id] ?? 0;
  if (state.tick < ready) {
    const secs = Math.ceil(((ready - state.tick) * 600) / 1000);
    return say(`The ${def.name} is recharging (${secs}s).`);
  }
  if (t.reusable) player.cooldowns[def.id] = state.tick + t.cooldownTicks;
  else {
    item.qty -= 1;
    if (item.qty === 0) player.inventory[slot] = null;
  }
  player.path = [];
  player.action = null;
  player.interface = null;
  player.dialogue = null;
  player.teleport = { at: state.tick + TELEPORT.delayTicks, zone: t.zone, x: t.x, y: t.y };
  events.push({ type: 'teleport' });
  say(`You ${t.verb.toLowerCase()} the ${def.name}...`);
}

/** Lands a teleport that's due. */
export function tickTeleport(state: GameState, ctx: SimContext, events: SimEvent[]): void {
  const t = state.player.teleport;
  if (!t || state.tick < t.at) return;
  state.player.teleport = null;
  changeZone(state, ctx, t.zone, { x: t.x, y: t.y }, events);
}
