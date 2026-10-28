/**
 * "Use X -> Y": using an inventory item on an object or NPC. What works is
 * listed in uses.json (some only during a quest step); anything else gets the
 * OSRS classic, "Nothing interesting happens."
 */
import { giveItem } from './ground';
import { countItem, removeItem } from './inventory';
import { atStep, progressQuests } from './quests';
import type { EntityRef, GameState, SimContext, SimEvent } from './state';
import { grantXp } from './xp';

export function useItemOn(
  state: GameState,
  ctx: SimContext,
  itemId: string,
  target: EntityRef,
  events: SimEvent[],
): void {
  const player = state.player;
  const say = (text: string): void => {
    events.push({ type: 'message', kind: 'game', text });
  };
  const targetDef =
    target.kind === 'object' || target.kind === 'npc' ? target.instance.defId : null;
  const use = ctx.content.uses.find(
    (u) =>
      u.item === itemId &&
      u.target === targetDef &&
      (!u.quest || atStep(player, ctx.content, u.quest.quest, u.quest.step)),
  );
  if (!use || !targetDef) return say('Nothing interesting happens.');
  if (countItem(player.inventory, itemId) < Math.max(1, use.consume)) {
    const name = ctx.content.items.get(itemId)?.name ?? itemId;
    return say(`You need ${use.consume} ${name} for that.`);
  }
  if (use.consume > 0) removeItem(player.inventory, itemId, use.consume);
  say(use.message);
  for (const s of use.give) giveItem(state, ctx, s.item, s.qty, events);
  for (const [skillId, xp] of Object.entries(use.xp)) {
    grantXp(player, skillId, ctx.content.skills.get(skillId)?.name ?? skillId, xp, events);
  }
  progressQuests(state, ctx, { type: 'use', item: itemId, target: targetDef }, events);
}
