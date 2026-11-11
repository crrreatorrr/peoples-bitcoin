/**
 * What a feedback note says about "right now" (hub SDK `FeedbackContext`), built from the game
 * state. No DOM and no SDK calls, so it is unit tested; src/game/feedback.ts hands it to the SDK.
 */
import type { FeedbackContext } from '@metaverse/hub-sdk';
import { TICK_MS } from '../config/balance';
import { combatLevel } from '../sim/combat';
import type { GameState, QuestProgress } from '../sim/state';
import { levelForXp } from '../sim/xp';

export interface FeedbackSource {
  /** Null until the game has a character (world select, a failed boot). */
  state: GameState | null;
  mode: 'offline' | 'online';
  /** The online world number; null offline. */
  world: number | null;
  simVersion: string;
}

function playerSummary(state: GameState): Record<string, unknown> {
  const p = state.player;
  const levels: Record<string, number> = {};
  let total = 0;
  for (const [id, xp] of Object.entries(p.skills)) {
    const level = levelForXp(xp);
    levels[id] = level;
    total += level;
  }
  const targetId = p.action?.targetId ?? null;
  const enemy = targetId
    ? state.zone.enemies.find((e) => e.id === targetId && e.respawnAt === null)
    : undefined;
  return {
    hp: p.hp,
    maxHp: levelForXp(p.skills.hitpoints ?? 0),
    combatLevel: combatLevel(p.skills),
    totalLevel: total,
    skills: levels,
    inventoryCount: p.inventory.filter((slot) => slot !== null).length,
    tickets: p.currencies.tickets,
    action: p.action ? { action: p.action.action, targetId: p.action.targetId } : null,
    combatTarget: enemy ? { id: enemy.id, def: enemy.defId, hp: enemy.hp } : null,
    lastHitBy: p.lastHitBy?.id ?? null,
    style: p.style,
    running: p.running,
    runEnergy: Math.round(p.runEnergy),
    walking: p.path.length > 0,
    interface: p.interface?.kind ?? null,
    inDialogue: p.dialogue !== null,
    dying: p.dyingUntil !== null,
    sproto: p.sproto?.defId ?? null,
  };
}

/** Quests in progress, as `questId: steps done`. */
function questSummary(quests: Record<string, QuestProgress>): Record<string, number | 'done'> {
  const out: Record<string, number | 'done'> = {};
  for (const [id, q] of Object.entries(quests)) {
    if (q.complete) out[id] = 'done';
    else if (q.done.length > 0) out[id] = q.done.length;
  }
  return out;
}

/** Never throws: a half-built state yields the fields that could be read. */
export function buildFeedbackContext(src: FeedbackSource): FeedbackContext {
  const extra: Record<string, unknown> = {
    simVersion: src.simVersion,
    world: src.world,
    role: src.mode === 'online' ? 'client' : 'local',
  };
  const context: FeedbackContext = { mode: src.mode, extra };
  const state = src.state;
  if (!state) {
    context.level = 'world-select';
    return context;
  }
  try {
    context.level = state.zone.id;
    context.position = { x: state.player.pos.x, y: state.player.pos.y };
    context.gameTime = (state.tick * TICK_MS) / 1000;
    extra.tick = state.tick;
    extra.playerId = state.pid;
    extra.hub = state.hubSession.mode;
    context.player = playerSummary(state);
    extra.quests = questSummary(state.player.quests);
  } catch (err) {
    extra.contextError = err instanceof Error ? err.message : String(err);
  }
  return context;
}

/**
 * Quest steps finished since the last call, for breadcrumbs. `seen` is updated in place; the
 * first call only records where each quest stands.
 */
export function newQuestSteps(
  seen: Map<string, number>,
  quests: Record<string, QuestProgress>,
  first = false,
): { quest: string; step: string; complete: boolean }[] {
  const out: { quest: string; step: string; complete: boolean }[] = [];
  for (const [id, q] of Object.entries(quests)) {
    const before = seen.get(id) ?? 0;
    if (q.done.length === before) continue;
    seen.set(id, q.done.length);
    if (first || q.done.length < before) continue;
    const step = q.done[q.done.length - 1];
    if (step !== undefined) out.push({ quest: id, step, complete: q.complete });
  }
  return out;
}
