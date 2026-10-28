/**
 * Gathering skills (Mining, Fundraising, Lobbying) share one model: stand at a
 * node with the right tool and roll for success every few ticks. A success can
 * give an item, money (USD paid in $BITCOIN at the live price) or both, plus a
 * rare bonus. Lobbying favors sometimes go unpaid (blackmail). Nodes deplete
 * and respawn. Node stats come from skills.json.
 */
import { GATHERING } from '../config/balance';
import { effectiveLevel } from './boosts';
import type { GatherNode } from './content';
import { payUsd } from './economy';
import { xpMultiplier } from './equipment';
import { giveItem } from './ground';
import { bestTool, canAdd } from './inventory';
import { progressQuests } from './quests';
import { chance, nextFloat } from './rng';
import type { GameState, ObjectInstance, SimContext, SimEvent } from './state';
import { grantXp } from './xp';

export function successChance(level: number, levelReq: number, toolBonus: number): number {
  return Math.min(
    GATHERING.successMax,
    GATHERING.successAtReq + (level - levelReq) * GATHERING.successPerLevel + toolBonus,
  );
}

function rollUsd([min, max]: readonly [number, number], r: number): number {
  return min + (max - min) * r;
}

/** Runs one tick of gathering on `obj`. Clears player.action when gathering stops. */
export function tickGathering(
  state: GameState,
  ctx: SimContext,
  obj: ObjectInstance,
  node: GatherNode,
  events: SimEvent[],
): void {
  const player = state.player;
  const action = player.action;
  if (!action) return;
  const stop = (text?: string) => {
    if (text) events.push({ type: 'message', kind: 'game', text });
    player.action = null;
  };

  const skill = ctx.content.skills.get(node.skillId);
  if (!skill) return stop();
  const stats = node.action;
  const output = stats.output ? ctx.content.items.get(stats.output) : undefined;
  const level = effectiveLevel(player, node.skillId, state.tick);
  const tool = bestTool(player.inventory, ctx.content, node.skillId, level);

  if (action.nextAttemptTick === null) {
    if (level < stats.levelReq) {
      return stop(`You need a ${skill.name} level of ${stats.levelReq} to do that.`);
    }
    if (!tool) return stop(`You need ${skill.toolName ?? 'a tool'} for that.`);
    if (obj.depletedUntil !== null)
      return stop('There is nothing left here for now. Try again soon.');
    if (output && !canAdd(player.inventory, output)) {
      return stop('Your inventory is too full to carry any more.');
    }
    action.nextAttemptTick = state.tick + GATHERING.attemptIntervalTicks;
    if (skill.startMessage)
      events.push({ type: 'message', kind: 'game', text: skill.startMessage });
    return;
  }

  if (obj.depletedUntil !== null || !tool) return stop();
  if (state.tick < action.nextAttemptTick) return;
  action.nextAttemptTick = state.tick + GATHERING.attemptIntervalTicks;
  if (!chance(state.rng, successChance(level, stats.levelReq, tool.tool!.bonus))) return;

  let amount = 0;
  if (output) giveItem(state, ctx, output.id, 1, events);
  if (stats.payUsd) {
    const roll = nextFloat(state.rng);
    if (stats.unpaid && chance(state.rng, stats.unpaid.chance)) {
      events.push({ type: 'message', kind: 'warning', text: stats.unpaid.message });
    } else {
      amount = payUsd(state, rollUsd(stats.payUsd, roll));
    }
  }
  const text = stats.message
    .replace('{item}', output?.name ?? '')
    .replace('{amount}', amount.toLocaleString('en-US'));
  if (!stats.payUsd || amount > 0) events.push({ type: 'message', kind: 'game', text });

  if (stats.rare && chance(state.rng, stats.rare.chance)) {
    events.push({ type: 'message', kind: 'levelup', text: stats.rare.message });
    if (stats.rare.item) giveItem(state, ctx, stats.rare.item, 1, events);
    if (stats.rare.usd) payUsd(state, rollUsd(stats.rare.usd, nextFloat(state.rng)));
  }

  grantXp(
    player,
    node.skillId,
    skill.name,
    stats.xp * xpMultiplier(player, ctx, node.skillId),
    events,
  );
  progressQuests(state, ctx, { type: 'xp', skill: node.skillId }, events);

  if (chance(state.rng, stats.depleteChance)) {
    obj.depletedUntil = state.tick + stats.respawnTicks;
    return stop();
  }
  if (output && !canAdd(player.inventory, output))
    stop('Your inventory is too full to carry any more.');
}

/** Runs one tick of processing at a station (Spin): each attempt turns one input into an output or fails. */
export function tickProcessing(
  state: GameState,
  ctx: SimContext,
  skillId: string,
  intervalTicks: number,
  events: SimEvent[],
): void {
  const player = state.player;
  const action = player.action;
  const skill = ctx.content.skills.get(skillId);
  if (!action || !skill) return;
  const level = effectiveLevel(player, skillId, state.tick);
  const recipes = ctx.content.recipesBySkill.get(skillId) ?? [];
  const slot = player.inventory.findIndex((s) =>
    recipes.some((r) => r.input === s?.itemId && r.levelReq <= level),
  );
  if (slot === -1) {
    const anyInput = player.inventory.some((s) => recipes.some((r) => r.input === s?.itemId));
    events.push({
      type: 'message',
      kind: 'game',
      text: anyInput
        ? `You need a higher ${skill.name} level to work with what you're carrying.`
        : `You have nothing to ${skill.name.toLowerCase()} here.`,
    });
    player.action = null;
    return;
  }

  if (action.nextAttemptTick === null) {
    action.nextAttemptTick = state.tick + intervalTicks;
    if (skill.startMessage)
      events.push({ type: 'message', kind: 'game', text: skill.startMessage });
    return;
  }
  if (state.tick < action.nextAttemptTick) return;
  action.nextAttemptTick = state.tick + intervalTicks;

  const input = player.inventory[slot]!;
  const recipe = recipes.find((r) => r.input === input.itemId)!;
  input.qty -= 1;
  if (input.qty === 0) player.inventory[slot] = null;

  const span = Math.max(1, recipe.safeLevel - recipe.levelReq);
  const failChance = recipe.failAtReq * Math.max(0, (recipe.safeLevel - level) / span);
  if (chance(state.rng, failChance)) {
    events.push({
      type: 'message',
      kind: 'game',
      text: 'The story blows up in your face. It is lost.',
    });
    return;
  }
  const out = ctx.content.items.get(recipe.output)!;
  giveItem(state, ctx, out.id, 1, events);
  events.push({ type: 'message', kind: 'game', text: `You spin it into ${out.name}.` });
  grantXp(player, skillId, skill.name, recipe.xp * xpMultiplier(player, ctx, skillId), events);
  progressQuests(state, ctx, { type: 'xp', skill: skillId }, events);
}
