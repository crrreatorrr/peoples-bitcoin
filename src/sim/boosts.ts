/**
 * Drinks, OSRS-potion style: a boost of `levels + pct × base level` to some
 * skills for a while (drinking again re-applies it, it doesn't stack), and/or
 * run energy back.
 */
import { MOVEMENT } from '../config/balance';
import type { GameState, PlayerState, SimContext, SimEvent } from './state';
import { levelForXp } from './xp';

/** Level used for rolls and requirements: the base level plus any active boost. */
export function effectiveLevel(player: PlayerState, skillId: string, tick: number): number {
  const base = levelForXp(player.skills[skillId] ?? 0);
  const boost = player.boosts[skillId];
  return boost && tick < boost.until ? base + boost.amount : base;
}

export function drink(state: GameState, ctx: SimContext, slot: number, events: SimEvent[]): void {
  const player = state.player;
  const item = player.inventory[slot];
  const def = item && ctx.content.items.get(item.itemId);
  const d = def?.drink;
  if (!item || !def || !d) return;
  item.qty -= 1;
  if (item.qty === 0) player.inventory[slot] = null;

  const parts: string[] = [];
  if (d.boost) {
    for (const skillId of d.boost.skills) {
      const base = levelForXp(player.skills[skillId] ?? 0);
      const amount = d.boost.levels + Math.floor(d.boost.pct * base);
      player.boosts[skillId] = { amount, until: state.tick + d.ticks };
    }
    const names = d.boost.skills.map((id) => ctx.content.skills.get(id)?.name ?? id);
    parts.push(`${names.join(', ')} boosted`);
  }
  if (d.restoreRun > 0) {
    player.runEnergy = Math.min(MOVEMENT.runEnergyMax, player.runEnergy + d.restoreRun);
    parts.push('Motion restored');
  }
  events.push({
    type: 'message',
    kind: 'game',
    text: `You ${d.verb.toLowerCase()} the ${def.name}.${parts.length ? ` (${parts.join('; ')})` : ''}`,
  });
}

/** Drops finished boosts, telling the player. */
export function expireBoosts(state: GameState, ctx: SimContext, events: SimEvent[]): void {
  const player = state.player;
  for (const [skillId, boost] of Object.entries(player.boosts)) {
    if (state.tick < boost.until) continue;
    delete player.boosts[skillId];
    const name = ctx.content.skills.get(skillId)?.name ?? skillId;
    events.push({ type: 'message', kind: 'game', text: `Your ${name} boost has worn off.` });
  }
}
