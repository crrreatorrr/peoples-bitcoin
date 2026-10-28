/**
 * Enemy AI: respawn, aggro, leash, chase, attack, wander, and boss adds.
 * Enemies fight the player or the player's Sproto, using the same combat math.
 */
import { COMBAT, ENEMIES, SUMMONING } from '../config/balance';
import { accuracyRoll, combatLevel, inAttackRange, maxHit, pathToward, rollDamage } from './combat';
import { armorTotals } from './equipment';
import { chebyshev, isWalkable } from './grid';
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
import { grantXp, levelForXp } from './xp';

const CARDINALS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function stepEnemies(state: GameState, ctx: SimContext, events: SimEvent[]): void {
  const player = state.player;
  const playerLevel = combatLevel(player.skills);
  for (const enemy of [...state.zone.enemies]) {
    enemy.from = { x: enemy.x, y: enemy.y };
    const def = ctx.content.enemies.get(enemy.defId);
    if (!def) continue;

    if (enemy.respawnAt !== null) {
      if (state.tick >= enemy.respawnAt) {
        Object.assign(
          enemy,
          newEnemy(enemy.id, enemy.defId, enemy.spawn.x, enemy.spawn.y, ctx.content, false),
        );
      }
      continue;
    }

    // Choose who to fight. A taunt holds aggro on the Sproto until it wears off.
    if (enemy.target === SPROTO_ID) {
      if (!player.sproto) enemy.target = null;
      else if (enemy.tauntedUntil > 0 && state.tick >= enemy.tauntedUntil) {
        enemy.target = PLAYER_ID;
        enemy.tauntedUntil = 0;
      }
    }
    const tooStrong = playerLevel > def.level * COMBAT.aggroLevelMultiplier && !def.boss;
    if (
      enemy.target === null &&
      def.aggressive &&
      !tooStrong &&
      chebyshev(enemy, player.pos) <= def.aggroRange
    ) {
      enemy.target = PLAYER_ID;
    }

    // Leash: walk home and heal if dragged too far.
    if (chebyshev(enemy, enemy.spawn) > ENEMIES.leashRange) {
      enemy.target = null;
      enemy.hp = def.hp;
      stepTo(state, ctx, enemy, enemy.spawn, false);
      continue;
    }

    const targetPos = targetTile(state, enemy);
    if (targetPos) {
      fight(state, ctx, enemy, targetPos, events);
    } else if (chance(state.rng, ENEMIES.wanderChance)) {
      wander(state, ctx, enemy, def.wanderRadius);
    }

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
  if (!inAttackRange(grid, enemy, target, def.range, melee)) {
    stepTo(state, ctx, enemy, target, melee);
    return;
  }
  if (state.tick < enemy.nextAttackTick) return;
  const slowed = state.tick < enemy.suppressedUntil ? 2 : 0;
  enemy.nextAttackTick = state.tick + def.speed + slowed;

  const attRoll = accuracyRoll(def.attack + COMBAT.levelOffset, def.accuracy);
  const max = maxHit(def.strength + COMBAT.levelOffset, def.damage);
  if (!melee)
    events.push({ type: 'projectile', fromId: enemy.id, toId: enemy.target!, explosive: false });

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
  const defLevel = levelForXp(player.skills.defense ?? 0);
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
  // Auto-retaliate when idle.
  if (!player.action && player.path.length === 0) {
    player.action = { targetId: enemy.id, action: 'Attack', nextAttemptTick: null };
  }
}

/** One step toward a goal, not onto another enemy. */
function stepTo(
  state: GameState,
  ctx: SimContext,
  enemy: EnemyInstance,
  goal: Tile,
  melee: boolean,
): void {
  const grid = gridOf(state, ctx);
  const next = pathToward(grid, enemy, goal, melee)[0];
  if (!next) return;
  const blocked = state.zone.enemies.some(
    (e) => e !== enemy && e.respawnAt === null && e.x === next.x && e.y === next.y,
  );
  if (blocked) return;
  enemy.x = next.x;
  enemy.y = next.y;
}

function wander(state: GameState, ctx: SimContext, enemy: EnemyInstance, radius: number): void {
  const [dx, dy] = CARDINALS[nextInt(state.rng, 0, CARDINALS.length - 1)];
  const x = enemy.x + dx;
  const y = enemy.y + dy;
  if (Math.abs(x - enemy.spawn.x) > radius || Math.abs(y - enemy.spawn.y) > radius) return;
  if (!isWalkable(gridOf(state, ctx), x, y)) return;
  if (state.zone.enemies.some((e) => e !== enemy && e.respawnAt === null && e.x === x && e.y === y))
    return;
  enemy.x = x;
  enemy.y = y;
}

function freeNeighbor(state: GameState, ctx: SimContext, at: Tile): Tile | null {
  const grid = gridOf(state, ctx);
  for (const [dx, dy] of CARDINALS) {
    const t = { x: at.x + dx, y: at.y + dy };
    const taken = state.zone.enemies.some(
      (e) => e.respawnAt === null && e.x === t.x && e.y === t.y,
    );
    if (isWalkable(grid, t.x, t.y) && !taken) return t;
  }
  return null;
}
