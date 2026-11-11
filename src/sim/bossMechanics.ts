/**
 * Boss fight mechanics beyond adds (EnemyDef.boss.mechanic). Each gives the fight a decision
 * other than eating, sized for 600 ms click-to-move play. Numbers are in BOSSES (balance.ts).
 *
 * - `sludge` (Sludge Mother): below half HP she marks the tiles around her target; a few
 *   ticks later sludge lands there. Step off the marked tiles.
 * - `heckle` (Wrong-Namer Chief): he shouts the wrong ticker. Say the right one in chat (or
 *   the quick-chat line) in time, or be Heckled: accuracy down for a while.
 * - `flee` (Captain Motion): nearly beaten, he rage-quits and runs for the north barricade.
 *   Finish him before he gets his wind back, or he returns with half his HP.
 *
 * Nothing here uses the RNG except the sludge damage roll, so the mechanics never change
 * ordinary combat rolls.
 */
import { BOSSES, CHAT } from '../config/balance';
import { COIN_SYMBOL, COIN_SYMBOL_WRONG } from '../config/branding';
import { directStep, isWalkable } from './grid';
import { nextInt } from './rng';
import type { EnemyDef } from './schemas';
import {
  gridOf,
  type EnemyInstance,
  type GameState,
  type SimContext,
  type SimEvent,
  type Tile,
} from './state';

function say(enemy: EnemyInstance, def: EnemyDef, tick: number, text: string, events: SimEvent[]) {
  enemy.overhead = { text, untilTick: tick + CHAT.overheadTicks };
  events.push({ type: 'message', kind: 'npc', speaker: def.name, text });
}

const warn = (events: SimEvent[], text: string) =>
  events.push({ type: 'message', kind: 'warning', text });

/**
 * Runs the boss's mechanic for this tick. `view` is the player it is fighting (the owner of
 * its Sproto target, if it is on the Sproto), or null when it has no target. Returns true
 * when the boss is busy (running away) and must not fight this tick.
 */
export function stepBossMechanic(
  view: GameState | null,
  ctx: SimContext,
  enemy: EnemyInstance,
  def: EnemyDef,
  events: SimEvent[],
): boolean {
  switch (def.boss?.mechanic) {
    case 'sludge':
      stepSludge(view, ctx, enemy, def, events);
      return false;
    case 'heckle':
      stepHeckle(view, enemy, def, events);
      return false;
    case 'flee':
      return stepFlee(view, ctx, enemy, def, events);
    default:
      return false;
  }
}

// ── Sludge Mother ────────────────────────────────────────────────────────────

function stepSludge(
  view: GameState | null,
  ctx: SimContext,
  enemy: EnemyInstance,
  def: EnemyDef,
  events: SimEvent[],
): void {
  const cfg = BOSSES.sludge;
  if (!view) {
    enemy.sludge = undefined;
    return;
  }
  const tick = view.tick;
  const player = view.player;

  if (enemy.sludge && tick >= enemy.sludge.landsAt) {
    const hit = enemy.sludge.tiles.some((t) => t.x === player.pos.x && t.y === player.pos.y);
    enemy.sludge = undefined;
    if (hit && player.dyingUntil === null && player.hp > 0) {
      const dmg = Math.min(player.hp, nextInt(view.rng, 1, cfg.maxDamage));
      player.hp -= dmg;
      player.lastHitBy = { id: enemy.id, tick };
      events.push({ type: 'hitsplat', targetId: view.selfId, damage: dmg });
      warn(events, 'Sludge rains down on you! Step off the marked ground next time.');
    }
  }

  if (enemy.sludge || enemy.hp > def.hp * cfg.belowHpShare) return;
  if (tick < (enemy.nextMechanicTick ?? 0)) return;
  enemy.nextMechanicTick = tick + cfg.everyTicks;
  const grid = gridOf(view, ctx);
  const tiles: Tile[] = [];
  for (let dy = -cfg.radius; dy <= cfg.radius; dy++) {
    for (let dx = -cfg.radius; dx <= cfg.radius; dx++) {
      const t = { x: player.pos.x + dx, y: player.pos.y + dy };
      if (isWalkable(grid, t.x, t.y)) tiles.push(t);
    }
  }
  enemy.sludge = { tiles, landsAt: tick + cfg.landAfterTicks };
  events.push({
    type: 'telegraph',
    kind: 'sludge',
    tiles: tiles.map((t) => [t.x, t.y] as [number, number]),
    landsAtTick: enemy.sludge.landsAt,
  });
  say(enemy, def, tick, 'Hold still, little President. Mother is pouring.', events);
  warn(events, `${def.name} heaves sludge at the ground around you. Move off the marked tiles!`);
}

// ── Wrong-Namer Chief ────────────────────────────────────────────────────────

function stepHeckle(
  view: GameState | null,
  enemy: EnemyInstance,
  def: EnemyDef,
  events: SimEvent[],
): void {
  const cfg = BOSSES.heckle;
  if (!view) {
    enemy.shout = undefined;
    return;
  }
  const tick = view.tick;
  const shout = enemy.shout;
  if (shout && tick >= shout.until) {
    enemy.shout = undefined;
    if (!shout.answered && shout.pid === view.pid && view.player.dyingUntil === null) {
      view.player.heckledUntil = tick + cfg.heckledTicks;
      warn(events, 'You let the wrong name stand. You are Heckled: your aim wavers!');
    }
  }
  if (enemy.shout) return;
  // The first shout comes a full interval into the fight, not on the opening swing.
  enemy.nextMechanicTick ??= tick + cfg.everyTicks;
  if (tick < enemy.nextMechanicTick) return;
  enemy.nextMechanicTick = tick + cfg.everyTicks;
  enemy.shout = { until: tick + cfg.answerTicks, pid: view.pid, answered: false };
  say(enemy, def, tick, `SAY IT WITH ME: ${COIN_SYMBOL_WRONG}! ${COIN_SYMBOL_WRONG}!`, events);
  warn(
    events,
    `${def.name} shouts the wrong name! Say the right one in chat (${COIN_SYMBOL}), or use quick-chat.`,
  );
}

/** Whether a chat line names the coin correctly (or flatly denies the wrong name). */
export function namesTheCoin(text: string): boolean {
  const right = COIN_SYMBOL.replace('$', '').toLowerCase();
  const wrong = COIN_SYMBOL_WRONG.replace('$', '').toLowerCase();
  const lower = text.toLowerCase();
  if (lower.includes(right)) return true;
  return new RegExp(`\\bnot \\$?${wrong}\\b`).test(lower);
}

/**
 * The player said something in public chat. If a Wrong-Namer shout aimed at them is open and
 * the line names the coin correctly, the shout is answered. Returns whether it was.
 */
export function answerShout(state: GameState, text: string, events: SimEvent[]): boolean {
  if (!namesTheCoin(text)) return false;
  let answered = false;
  for (const enemy of state.zone.enemies) {
    const shout = enemy.shout;
    if (!shout || shout.answered || shout.pid !== state.pid || enemy.respawnAt !== null) continue;
    shout.answered = true;
    answered = true;
  }
  if (answered) {
    events.push({
      type: 'message',
      kind: 'game',
      text: `You call it by its name. The room comes to order: you keep your nerve.`,
    });
  }
  return answered;
}

/** The accuracy multiplier on the player's attacks right now (Heckled). */
export function heckleScale(state: GameState): number {
  return (state.player.heckledUntil ?? 0) > state.tick ? BOSSES.heckle.accuracyScale : 1;
}

// ── Captain Motion ───────────────────────────────────────────────────────────

/** The barricade north of the boss's spawn that he runs for, or his spawn if there is none. */
function fleeGoal(view: GameState, ctx: SimContext, enemy: EnemyInstance): Tile {
  let best: Tile | null = null;
  for (const obj of view.zone.objects) {
    if (ctx.content.objects.get(obj.defId)?.role !== 'gate') continue;
    if (obj.y >= enemy.spawn.y) continue;
    if (!best || enemy.spawn.y - obj.y < enemy.spawn.y - best.y) best = { x: obj.x, y: obj.y };
  }
  // He stops on the near side of it.
  return best ? { x: best.x, y: best.y + 1 } : { ...enemy.spawn };
}

function stepFlee(
  view: GameState | null,
  ctx: SimContext,
  enemy: EnemyInstance,
  def: EnemyDef,
  events: SimEvent[],
): boolean {
  const cfg = BOSSES.flee;
  if (!view) {
    // The fight was dropped mid-run: he is simply back.
    enemy.flee = undefined;
    return false;
  }
  const tick = view.tick;
  if (!enemy.flee) {
    if (enemy.hp > def.hp * cfg.atHpShare) return false;
    enemy.flee = { until: tick + cfg.ticks };
    say(enemy, def, tick, "That's IT! I quit! You'll hear from my lawyers!", events);
    warn(
      events,
      `${def.name} rage-quits and runs for the north barricade! Finish him before he gets his wind back.`,
    );
  }
  if (tick >= enemy.flee.until) {
    enemy.flee = undefined;
    enemy.hp = Math.max(enemy.hp, Math.ceil(def.hp * cfg.returnHpShare));
    say(enemy, def, tick, 'Second wind! Back in MOTION!', events);
    warn(events, `${def.name} got his wind back.`);
    return false;
  }
  // Running: no attacks, one tile a tick toward the barricade. Being chased keeps the fight on.
  enemy.lastCombatTick = tick;
  const goal = fleeGoal(view, ctx, enemy);
  if (enemy.x !== goal.x || enemy.y !== goal.y) {
    const player = view.player.pos;
    const next = directStep(
      gridOf(view, ctx),
      enemy,
      goal,
      (x, y) =>
        (x === player.x && y === player.y) ||
        view.zone.enemies.some(
          (e) => e !== enemy && e.respawnAt === null && e.x === x && e.y === y,
        ),
    );
    if (next) {
      enemy.x = next.x;
      enemy.y = next.y;
    }
  }
  return true;
}
