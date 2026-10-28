/**
 * Mining: stand next to a server rack and periodically roll for hash.
 * Rack stats (level, XP, output, depletion, respawn) come from skills.json.
 */
import { MINING } from '../config/balance';
import { addItem, canAdd } from './inventory';
import { chance } from './rng';
import type { GameState, ObjectInstance, SimContext, SimEvent } from './state';
import { grantXp, levelForXp } from './xp';

export const MINING_SKILL_ID = 'mining';

export function miningSuccessChance(level: number, levelReq: number): number {
  return Math.min(
    MINING.successMax,
    MINING.successAtReq + (level - levelReq) * MINING.successPerLevel,
  );
}

/** Runs one tick of the player's Mine action on `rack`. Clears player.action when mining stops. */
export function tickMining(
  state: GameState,
  ctx: SimContext,
  rack: ObjectInstance,
  events: SimEvent[],
): void {
  const player = state.player;
  const action = player.action;
  if (!action) return;
  const stop = (text?: string) => {
    if (text) events.push({ type: 'message', kind: 'game', text });
    player.action = null;
  };

  const node = ctx.content.gatherByObject.get(rack.defId);
  if (!node || node.skillId !== MINING_SKILL_ID) return stop("You can't mine that.");
  const { action: rackStats } = node;
  const item = ctx.content.items.get(rackStats.output);
  const skill = ctx.content.skills.get(MINING_SKILL_ID);
  if (!item || !skill) return stop();
  const level = levelForXp(player.skills[MINING_SKILL_ID] ?? 0);

  if (action.nextAttemptTick === null) {
    if (level < rackStats.levelReq) {
      return stop(`You need a Mining level of ${rackStats.levelReq} to mine this rack.`);
    }
    if (rack.depletedUntil !== null) {
      return stop('This rack is overheated. Give it a moment to cool down.');
    }
    if (!canAdd(player.inventory, item)) {
      return stop('Your inventory is too full to hold any more hash.');
    }
    events.push({ type: 'message', kind: 'game', text: 'You plug in and start mining the rack.' });
    action.nextAttemptTick = state.tick + MINING.attemptIntervalTicks;
    return;
  }

  if (rack.depletedUntil !== null) return stop();
  if (state.tick < action.nextAttemptTick) return;
  action.nextAttemptTick = state.tick + MINING.attemptIntervalTicks;
  if (!chance(state.rng, miningSuccessChance(level, rackStats.levelReq))) return;

  addItem(player.inventory, item);
  events.push({ type: 'message', kind: 'game', text: `You mine some ${item.name}.` });
  grantXp(player, MINING_SKILL_ID, skill.name, rackStats.xp, events);

  if (chance(state.rng, rackStats.depleteChance)) {
    rack.depletedUntil = state.tick + rackStats.respawnTicks;
    return stop();
  }
  if (!canAdd(player.inventory, item)) stop('Your inventory is too full to hold any more hash.');
}
