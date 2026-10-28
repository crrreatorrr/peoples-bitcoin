/**
 * Enemies that talk: a line as a fight starts, one below half HP and one when
 * beaten (EnemyDef.barks). Each shows in the chatbox and over the enemy's
 * head, like OSRS boss shouts. Lines are picked without the RNG so barks never
 * change combat rolls.
 */
import { CHAT } from '../config/balance';
import type { EnemyInstance, GameState, SimContext, SimEvent } from './state';

export type BarkKind = 'aggro' | 'hurt' | 'defeat' | 'resist';

export function bark(
  state: GameState,
  ctx: SimContext,
  enemy: EnemyInstance,
  kind: BarkKind,
  events: SimEvent[],
): void {
  const def = ctx.content.enemies.get(enemy.defId);
  const lines = def?.barks?.[kind];
  if (!def || !lines || lines.length === 0) return;
  const text = lines[(state.tick + enemy.id.length) % lines.length];
  enemy.overhead = { text, untilTick: state.tick + CHAT.overheadTicks };
  events.push({ type: 'message', kind: 'npc', speaker: def.name, text });
}

/** Says the fight-start line once per life, when the enemy first has a target. */
export function barkOnAggro(
  state: GameState,
  ctx: SimContext,
  enemy: EnemyInstance,
  events: SimEvent[],
): void {
  if (enemy.target === null || enemy.said.aggro) return;
  enemy.said.aggro = true;
  bark(state, ctx, enemy, 'aggro', events);
}

/** Says the hurt line once per life, the first time it drops to half HP. */
export function barkOnHurt(
  state: GameState,
  ctx: SimContext,
  enemy: EnemyInstance,
  maxHp: number,
  events: SimEvent[],
): void {
  if (enemy.said.hurt || enemy.hp <= 0 || enemy.hp > maxHp / 2) return;
  enemy.said.hurt = true;
  bark(state, ctx, enemy, 'hurt', events);
}
