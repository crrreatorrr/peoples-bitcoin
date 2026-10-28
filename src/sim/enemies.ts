/**
 * Enemy AI, OSRS-style: respawn, slow regen, aggro (in sight), direct-step
 * chasing that walls can block (safespots), a leash they won't cross, giving
 * up quiet fights, single-way combat outside boss fights, wandering, and boss
 * adds. Enemies fight the player or the player's Sproto with the same math.
 */
import { COMBAT, ENEMIES, SUMMONING } from '../config/balance';
import { barkOnAggro } from './barks';
import { effectiveLevel } from './boosts';
import { accuracyRoll, combatLevel, inAttackRange, maxHit, pathToward, rollDamage } from './combat';
import { armorTotals } from './equipment';
import { chebyshev, directStep, hasLineOfSight, isWalkable } from './grid';
import { atStep } from './quests';
import { chance, nextInt } from './rng';
import {
  gridOf,
  newEnemy,
  PLAYER_ID,
  SPROTO_ID,
  type EnemyInstance,
  type GameState,
  type SimContext,
  type SimEvent,
  type Tile,
} from './state';
import { grantXp } from './xp';

const CARDINALS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function stepEnemies(state: GameState, ctx: SimContext, events: SimEvent[]): void {
  const player = state.player;
  const playerLevel = combatLevel(player.skills);
  const grid = gridOf(state, ctx);
  for (const enemy of [...state.zone.enemies]) {
    enemy.from = { x: enemy.x, y: enemy.y };
    const def = ctx.content.enemies.get(enemy.defId);
    if (!def) continue;
    if (enemy.overhead && state.tick >= enemy.overhead.untilTick) enemy.overhead = null;

    // Quest-only enemies sleep until their quest step comes up, and leave after it.
    const awake = !enemy.gate || atStep(player, ctx.content, enemy.gate.quest, enemy.gate.step);
    if (!awake && enemy.respawnAt === null && enemy.target === null) enemy.respawnAt = Infinity;
    if (awake && enemy.respawnAt === Infinity) enemy.respawnAt = state.tick;
    if (enemy.respawnAt !== null) {
      if (!awake) enemy.respawnAt = Infinity;
      else if (state.tick >= enemy.respawnAt) {
        Object.assign(
          enemy,
          newEnemy(enemy.id, enemy.defId, enemy.spawn.x, enemy.spawn.y, ctx.content, false),
        );
      }
      continue;
    }
    // OSRS monsters heal slowly over time, never all at once.
    if (state.tick % COMBAT.hpRegenEveryTicks === 0 && enemy.hp < def.hp) enemy.hp += 1;

    // Choose who to fight. A taunt holds aggro on the Sproto until it wears off.
    if (enemy.target === SPROTO_ID) {
      if (!player.sproto) enemy.target = null;
      else if (enemy.tauntedUntil > 0 && state.tick >= enemy.tauntedUntil) {
        enemy.target = PLAYER_ID;
        enemy.tauntedUntil = 0;
      }
    }
    // A fight where nobody can land an attack is dropped (e.g. you're safespotting).
    if (enemy.target !== null && state.tick - enemy.lastCombatTick > ENEMIES.giveUpTicks) {
      enemy.target = null;
    }
    const tooStrong = playerLevel > def.level * COMBAT.aggroLevelMultiplier && !def.boss;
    if (
      enemy.target === null &&
      def.aggressive &&
      !tooStrong &&
      player.dyingUntil === null &&
      chebyshev(enemy, player.pos) <= def.aggroRange &&
      hasLineOfSight(grid, enemy, player.pos)
    ) {
      enemy.target = PLAYER_ID;
      enemy.lastCombatTick = state.tick;
    }

    barkOnAggro(state, ctx, enemy, events);
    const targetPos = targetTile(state, enemy);
    if (targetPos) fight(state, ctx, enemy, targetPos, events);
    else if (chebyshev(enemy, enemy.spawn) > def.wanderRadius) walkHome(state, ctx, enemy);
    else wander(state, ctx, enemy, def.wanderRadius);

    const adds = def.boss?.adds;
    if (adds && enemy.target && state.tick >= enemy.nextAddTick) {
      enemy.nextAddTick = state.tick + adds.everyTicks;
      const live = state.zone.enemies.filter((e) => e.temp && e.respawnAt === null).length;
      const spot = freeNeighbor(state, ctx, enemy);
      if (live < adds.max && spot) {
        const add = newEnemy(
          `e${state.zone.nextEnemyId++}`,
          adds.enemy,
          spot.x,
          spot.y,
          ctx.content,
          true,
        );
        add.target = PLAYER_ID;
        state.zone.enemies.push(add);
        events.push({ type: 'message', kind: 'warning', text: `${def.name} calls for backup!` });
      }
    }
  }
}

function targetTile(state: GameState, enemy: EnemyInstance): Tile | null {
  if (enemy.target === PLAYER_ID) return state.player.pos;
  if (enemy.target === SPROTO_ID && state.player.sproto) return state.player.sproto;
  return null;
}

function fight(
  state: GameState,
  ctx: SimContext,
  enemy: EnemyInstance,
  target: Tile,
  events: SimEvent[],
): void {
  const def = ctx.content.enemies.get(enemy.defId)!;
  const grid = gridOf(state, ctx);
  const melee = def.range <= 1;
  if (enemy.x === target.x && enemy.y === target.y) {
    // Standing on the target: step off before attacking, as in OSRS.
    const spot = freeNeighbor(state, ctx, enemy);
    if (spot) Object.assign(enemy, spot);
    return;
  }
  if (!inAttackRange(grid, enemy, target, def.range, melee)) {
    chase(state, ctx, enemy, target);
    return;
  }
  if (state.tick < enemy.nextAttackTick) return;
  if (enemy.target === PLAYER_ID && singleWayBlocked(state, ctx, enemy)) return;
  const slowed = state.tick < enemy.suppressedUntil ? 2 : 0;
  enemy.nextAttackTick = state.tick + def.speed + slowed;
  enemy.lastCombatTick = state.tick;

  const attRoll = accuracyRoll(def.attack + COMBAT.levelOffset, def.accuracy);
  const max = maxHit(def.strength + COMBAT.levelOffset, def.damage);
  events.push({
    type: 'attack',
    attackerId: enemy.id,
    targetId: enemy.target!,
    style: melee ? 'melee' : def.magic ? 'magic' : 'gun',
  });

  if (enemy.target === SPROTO_ID && state.player.sproto) {
    const sproto = state.player.sproto;
    const sdef = ctx.content.sprotos.get(sproto.defId)!;
    const defRoll = accuracyRoll(sdef.defense + COMBAT.levelOffset, sdef.armor);
    const dmg = Math.min(sproto.hp, rollDamage(state.rng, attRoll, defRoll, max));
    sproto.hp -= dmg;
    events.push({ type: 'hitsplat', targetId: SPROTO_ID, damage: dmg });
    if (sproto.hp <= 0) {
      events.push({ type: 'death', entityId: SPROTO_ID });
      events.push({
        type: 'message',
        kind: 'warning',
        text: `Your ${sdef.name} is knocked out and heads back to the barracks.`,
      });
      state.player.sproto = null;
      state.player.summoning.cooldownUntil = state.tick + SUMMONING.cooldownTicks;
      enemy.target = PLAYER_ID;
    }
    return;
  }

  const player = state.player;
  player.lastHitBy = { id: enemy.id, tick: state.tick };
  const defLevel = effectiveLevel(player, 'defense', state.tick);
  const styleBonus =
    player.style === 'block' || player.style === 'longrange' ? COMBAT.styleBonus : 0;
  const defRoll = accuracyRoll(
    defLevel + COMBAT.levelOffset + styleBonus,
    armorTotals(player, ctx).defense,
  );
  const dmg = Math.min(player.hp, rollDamage(state.rng, attRoll, defRoll, max));
  player.hp -= dmg;
  events.push({ type: 'hitsplat', targetId: PLAYER_ID, damage: dmg });
  if (dmg > 0) {
    const name = ctx.content.skills.get('defense')?.name ?? 'Defense';
    grantXp(player, 'defense', name, dmg * COMBAT.defenseXpPerDamageTaken, events);
  }
  // Auto Retaliate: fight back unless walking or already fighting; skilling and menus stop.
  if (player.autoRetaliate && player.action?.action !== 'Attack' && player.path.length === 0) {
    player.action = { targetId: enemy.id, action: 'Attack', nextAttemptTick: null };
    player.interface = null;
    player.dialogue = null;
  }
}

/** Bosses and their adds fight in multi-way combat; everywhere else is single-way. */
function multiCombat(ctx: SimContext, enemy: EnemyInstance): boolean {
  return enemy.temp || ctx.content.enemies.get(enemy.defId)?.boss !== undefined;
}

/** Single-way combat: another enemy hit the player too recently for this one to join in. */
function singleWayBlocked(state: GameState, ctx: SimContext, enemy: EnemyInstance): boolean {
  const last = state.player.lastHitBy;
  if (!last || last.id === enemy.id || multiCombat(ctx, enemy)) return false;
  if (state.tick - last.tick >= COMBAT.singleWayTicks) return false;
  const other = state.zone.enemies.find((e) => e.id === last.id && e.respawnAt === null);
  return other !== undefined && !multiCombat(ctx, other);
}

/** Someone other than `enemy` stands on (x, y). */
function occupied(state: GameState, enemy: EnemyInstance, x: number, y: number): boolean {
  return state.zone.enemies.some(
    (e) => e !== enemy && e.respawnAt === null && e.x === x && e.y === y,
  );
}

/** Chases with OSRS-style direct steps, never past the leash. */
function chase(state: GameState, ctx: SimContext, enemy: EnemyInstance, target: Tile): void {
  const next = directStep(
    gridOf(state, ctx),
    enemy,
    target,
    (x, y) => occupied(state, enemy, x, y) || (x === target.x && y === target.y),
  );
  if (!next || chebyshev(next, enemy.spawn) > ENEMIES.leashRange) return;
  enemy.x = next.x;
  enemy.y = next.y;
}

/** Walks back to spawn after a fight, around walls. */
function walkHome(state: GameState, ctx: SimContext, enemy: EnemyInstance): void {
  enemy.goal = null;
  const next = pathToward(gridOf(state, ctx), enemy, enemy.spawn, false)[0];
  if (next && !occupied(state, enemy, next.x, next.y)) Object.assign(enemy, next);
}

/** Now and then picks a spot within its wander radius and walks there. */
function wander(state: GameState, ctx: SimContext, enemy: EnemyInstance, radius: number): void {
  if (radius === 0) return;
  if (!enemy.goal) {
    if (!chance(state.rng, ENEMIES.wanderChance)) return;
    enemy.goal = {
      x: enemy.spawn.x + nextInt(state.rng, -radius, radius),
      y: enemy.spawn.y + nextInt(state.rng, -radius, radius),
    };
  }
  const { pos } = state.player;
  const next = directStep(
    gridOf(state, ctx),
    enemy,
    enemy.goal,
    (x, y) => occupied(state, enemy, x, y) || (x === pos.x && y === pos.y),
  );
  if (next) Object.assign(enemy, next);
  if (!next || (enemy.x === enemy.goal.x && enemy.y === enemy.goal.y)) enemy.goal = null;
}

function freeNeighbor(state: GameState, ctx: SimContext, at: Tile): Tile | null {
  const grid = gridOf(state, ctx);
  for (const [dx, dy] of CARDINALS) {
    const t = { x: at.x + dx, y: at.y + dy };
    const taken =
      state.zone.enemies.some((e) => e.respawnAt === null && e.x === t.x && e.y === t.y) ||
      (state.player.pos.x === t.x && state.player.pos.y === t.y);
    if (isWalkable(grid, t.x, t.y) && !taken) return t;
  }
  return null;
}
