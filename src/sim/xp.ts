import { XP_CURVE } from '../config/balance';
import type { PlayerState, SimEvent } from './state';

/** XP_TABLE[level] = total XP needed to reach that level (index 0 unused). */
const XP_TABLE: readonly number[] = buildXpTable();

function buildXpTable(): number[] {
  const table = [0, 0];
  let points = 0;
  for (let level = 1; level < XP_CURVE.maxLevel; level++) {
    points += Math.floor(level + XP_CURVE.base * 2 ** (level / XP_CURVE.growth));
    table[level + 1] = Math.floor(points / XP_CURVE.divisor);
  }
  return table;
}

export function xpForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(XP_CURVE.maxLevel, Math.floor(level)));
  return XP_TABLE[clamped];
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < XP_CURVE.maxLevel && xp >= XP_TABLE[level + 1]) level++;
  return level;
}

/**
 * Adds XP to a skill, emitting an xp drop and (if it happened) a level-up.
 * XP is kept to one decimal place, like OSRS.
 */
export function grantXp(
  player: PlayerState,
  skillId: string,
  skillName: string,
  amount: number,
  events: SimEvent[],
): void {
  const before = player.skills[skillId] ?? 0;
  const after = Math.min(XP_CURVE.maxXp, Math.round((before + amount) * 10) / 10);
  player.skills[skillId] = after;
  events.push({ type: 'xp', skillId, amount });

  const oldLevel = levelForXp(before);
  const newLevel = levelForXp(after);
  if (newLevel > oldLevel) {
    events.push({ type: 'levelUp', skillId, level: newLevel });
    events.push({
      type: 'message',
      kind: 'levelup',
      text: `ATTENTION ATTENTION: Your ${skillName} level is now ${newLevel}.`,
    });
  }
}
