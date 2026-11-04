/**
 * Enemy AI, OSRS-style: respawn, slow regen, aggro (in sight), direct-step
 * chasing that walls can block (safespots), a leash they won't cross, giving
 * up quiet fights, single-way combat outside boss fights, wandering, and boss
 * adds. Enemies fight the player or the player's Sproto with the same math.
 */
import { COMBAT, ENEMIES, SUMMONING } from '../config/balance';
import { barkOnAggro } from './barks';
import { effectiveLevel } from './boosts';
import {
  accuracyRoll,
  combatLevel,
  inAttackRange,
  maxHit,
  multiCombat,
  pathToward,
  rollDamage,
} from './combat';
import { armorTotals } from './equipment';
import { chebyshev, directStep, hasLineOfSight, isWalkable } from './grid';
import { atStep } from './quests';
import { chance, nextInt } from './rng';
import {
  addOwner,
  gridOf,
  newEnemy,
  PLAYER_ID,
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

/** Who an enemy is fighting: a player's view, and whether it's their Sproto. */
interface Foe {
  view: GameState;
  sproto: boolean;
}

/**
 * One tick of every enemy in a zone instance. `views` are the players in it
 * (all share the same `zone`); `eventsOf` is where each player's events go.
 */
export function stepEnemies(
  views: readonly GameState[],
  ctx: SimContext,
  eventsOf: (pid: string) => SimEvent[],
): void {
  const first = views[0];
  if (!first) return;
  const zone = first.zone;
  const tick = first.tick;
  const byPid = new Map(views.map((v) => [v.pid, v]));
  spawnPrivateCopies(views, ctx);
  for (const enemy of [...zone.enemies]) {
    enemy.from = { x: enemy.x, y: enemy.y };
    const def = ctx.content.enemies.get(enemy.defId);
    if (!def) continue;
    if (enemy.overhead && tick >= enemy.overhead.untilTick) enemy.overhead = null;
    const owner = enemy.owner === undefined ? null : (byPid.get(enemy.owner) ?? null);
    if (enemy.owner !== undefined && !owner) {
      // A private copy whose owner left: copies go, the offline template sleeps.
      if (enemy.owner === PLAYER_ID && !enemy.temp) {
        enemy.target = null;
        if (enemy.gate && enemy.respawnAt === null) enemy.respawnAt = Infinity;
      } else zone.enemies = zone.enemies.filter((e) => e !== enemy);
      continue;
    }

    // Quest-only enemies sleep until their owner's quest step comes up, and leave after it.
    const awake =
      !enemy.gate ||
      (owner !== null && atStep(owner.player, ctx.content, enemy.gate.quest, enemy.gate.step));
    if (!awake && enemy.respawnAt === null && enemy.target === null) enemy.respawnAt = Infinity;
    if (awake && enemy.respawnAt === Infinity) enemy.respawnAt = tick;
    if (enemy.respawnAt !== null) {
      if (!awake) {
        enemy.respawnAt = Infinity;
        if (enemy.owner !== undefined && enemy.owner !== PLAYER_ID) {
          zone.enemies = zone.enemies.filter((e) => e !== enemy);
        }
      } else if (tick >= enemy.respawnAt) {
        const keep = { gate: enemy.gate, owner: enemy.owner };
        Object.assign(
          enemy,
          newEnemy(enemy.id, enemy.defId, enemy.spawn.x, enemy.spawn.y, ctx.content, false),
        );
        if (keep.gate) enemy.gate = keep.gate;
        if (keep.owner !== undefined) enemy.owner = keep.owner;
      }
      continue;
    }
    // OSRS monsters heal slowly over time, never all at once.
    if (tick % COMBAT.hpRegenEveryTicks === 0 && enemy.hp < def.hp) enemy.hp += 1;

    // Choose who to fight. A taunt holds aggro on the Sproto until it wears off.
    let foe = resolveFoe(views, enemy.target);
    if (enemy.target !== null && !foe) enemy.target = null;
    if (foe?.sproto && enemy.tauntedUntil > 0 && tick >= enemy.tauntedUntil) {
      enemy.target = foe.view.selfId;
      enemy.tauntedUntil = 0;
      foe = { view: foe.view, sproto: false };
    }
    // A fight where nobody can land an attack is dropped (e.g. you're safespotting).
    if (enemy.target !== null && tick - enemy.lastCombatTick > ENEMIES.giveUpTicks) {
      enemy.target = null;
      foe = null;
    }
    if (enemy.target === null && def.aggressive) {
      const prey = nearestPrey(views, ctx, enemy, owner);
      if (prey) {
        enemy.target = prey.selfId;
        enemy.lastCombatTick = tick;
        foe = { view: prey, sproto: false };
      }
    }

    const view = foe?.view ?? owner ?? first;
    const events = eventsOf(view.pid);
    barkOnAggro(view, ctx, enemy, events);
    const targetPos = foe ? (foe.sproto ? foe.view.player.sproto : foe.view.player.pos) : null;
    if (foe && targetPos) fight(foe, ctx, enemy, targetPos, events, views);
    else if (chebyshev(enemy, enemy.spawn) > def.wanderRadius) walkHome(first, ctx, enemy, views);
    else wander(first, ctx, enemy, def.wanderRadius, views);

    const adds = def.boss?.adds;
    if (adds && enemy.target && tick >= enemy.nextAddTick) {
      enemy.nextAddTick = tick + adds.everyTicks;
      const live = zone.enemies.filter(
        (e) => e.temp && e.respawnAt === null && e.owner === addOwner(enemy),
      ).length;
      const spot = freeNeighbor(first, ctx, enemy, views);
      if (live < adds.max && spot) {
        const add = newEnemy(
          `e${zone.nextEnemyId++}`,
          adds.enemy,
          spot.x,
          spot.y,
          ctx.content,
          true,
        );
        add.target = (foe?.view ?? view).selfId;
        // Adds of a private boss are private too (the offline template's adds stay public).
        const owner = addOwner(enemy);
        if (owner !== undefined) add.owner = owner;
        zone.enemies.push(add);
        events.push({ type: 'message', kind: 'warning', text: `${def.name} calls for backup!` });
      }
    }
  }
}

/**
 * Online players each get their own copy of every quest-gated enemy while
 * their step is up (`e<i>@<pid>`), next to the offline template `e<i>`.
 */
function spawnPrivateCopies(views: readonly GameState[], ctx: SimContext): void {
  const zone = views[0].zone;
  const templates = zone.enemies.filter((e) => e.gate && e.owner === PLAYER_ID);
  if (templates.length === 0) return;
  for (const view of views) {
    if (view.pid === PLAYER_ID) continue;
    for (const t of templates) {
      const id = `${t.id}@${view.pid}`;
      if (zone.enemies.some((e) => e.id === id)) continue;
      if (!atStep(view.player, ctx.content, t.gate!.quest, t.gate!.step)) continue;
      const copy = newEnemy(id, t.defId, t.spawn.x, t.spawn.y, ctx.content, false);
      copy.gate = { ...t.gate! };
      copy.owner = view.pid;
      zone.enemies.push(copy);
    }
  }
}

function resolveFoe(views: readonly GameState[], target: string | null): Foe | null {
  if (target === null) return null;
  for (const view of views) {
    if (target === view.selfId)
      return view.player.dyingUntil === null ? { view, sproto: false } : null;
    if (target === view.sprotoId) return view.player.sproto ? { view, sproto: true } : null;
  }
  return null;
}

/** The nearest player this enemy would pick a fight with (in sight, not too strong), if any. */
function nearestPrey(
  views: readonly GameState[],
  ctx: SimContext,
  enemy: EnemyInstance,
  owner: GameState | null,
): GameState | null {
  const def = ctx.content.enemies.get(enemy.defId)!;
  let best: GameState | null = null;
  let bestDist = Infinity;
  for (const view of owner ? [owner] : views) {
    const player = view.player;
    if (player.dyingUntil !== null) continue;
    // Cheapest checks first: a busy world runs this for every enemy and player.
    const d = chebyshev(enemy, player.pos);
    if (d > def.aggroRange || d >= bestDist) continue;
    const tooStrong =
      combatLevel(player.skills) > def.level * COMBAT.aggroLevelMultiplier && !def.boss;
    if (tooStrong) continue;
    if (!hasLineOfSight(gridOf(view, ctx), enemy, player.pos)) continue;
    best = view;
    bestDist = d;
  }
  return best;
}

function fight(
  foe: Foe,
  ctx: SimContext,
  enemy: EnemyInstance,
  target: Tile,
  events: SimEvent[],
  views: readonly GameState[],
): void {
  const state = foe.view;
  const def = ctx.content.enemies.get(enemy.defId)!;
  const grid = gridOf(state, ctx);
  const melee = def.range <= 1;
  if (enemy.x === target.x && enemy.y === target.y) {
    // Standing on the target: step off before attacking, as in OSRS.
    const spot = freeNeighbor(state, ctx, enemy, views);
    if (spot) Object.assign(enemy, spot);
    return;
  }
  if (!inAttackRange(grid, enemy, target, def.range, melee)) {
    chase(state, ctx, enemy, target);
    return;
  }
  if (state.tick < enemy.nextAttackTick) return;
  if (!foe.sproto && singleWayBlocked(state, ctx, enemy)) return;
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

  if (foe.sproto && state.player.sproto) {
    const sproto = state.player.sproto;
    const sdef = ctx.content.sprotos.get(sproto.defId)!;
    const defRoll = accuracyRoll(sdef.defense + COMBAT.levelOffset, sdef.armor);
    const dmg = Math.min(sproto.hp, rollDamage(state.rng, attRoll, defRoll, max));
    sproto.hp -= dmg;
    events.push({ type: 'hitsplat', targetId: state.sprotoId, damage: dmg });
    if (sproto.hp <= 0) {
      events.push({ type: 'death', entityId: state.sprotoId });
      events.push({
        type: 'message',
        kind: 'warning',
        text: `Your ${sdef.name} is knocked out and heads back to the barracks.`,
      });
      state.player.sproto = null;
      state.player.summoning.cooldownUntil = state.tick + SUMMONING.cooldownTicks;
      enemy.target = state.selfId;
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
  events.push({ type: 'hitsplat', targetId: state.selfId, damage: dmg });
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

function onPlayer(views: readonly GameState[], x: number, y: number): boolean {
  return views.some((v) => v.player.pos.x === x && v.player.pos.y === y);
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
function walkHome(
  state: GameState,
  ctx: SimContext,
  enemy: EnemyInstance,
  views: readonly GameState[],
): void {
  void views;
  enemy.goal = null;
  const next = pathToward(gridOf(state, ctx), enemy, enemy.spawn, false)[0];
  if (next && !occupied(state, enemy, next.x, next.y)) Object.assign(enemy, next);
}

/** Now and then picks a spot within its wander radius and walks there. */
function wander(
  state: GameState,
  ctx: SimContext,
  enemy: EnemyInstance,
  radius: number,
  views: readonly GameState[],
): void {
  if (radius === 0) return;
  if (!enemy.goal) {
    if (!chance(state.rng, ENEMIES.wanderChance)) return;
    enemy.goal = {
      x: enemy.spawn.x + nextInt(state.rng, -radius, radius),
      y: enemy.spawn.y + nextInt(state.rng, -radius, radius),
    };
  }
  const next = directStep(
    gridOf(state, ctx),
    enemy,
    enemy.goal,
    (x, y) => occupied(state, enemy, x, y) || onPlayer(views, x, y),
  );
  if (next) Object.assign(enemy, next);
  if (!next || (enemy.x === enemy.goal.x && enemy.y === enemy.goal.y)) enemy.goal = null;
}

function freeNeighbor(
  state: GameState,
  ctx: SimContext,
  at: Tile,
  views: readonly GameState[],
): Tile | null {
  const grid = gridOf(state, ctx);
  for (const [dx, dy] of CARDINALS) {
    const t = { x: at.x + dx, y: at.y + dy };
    const taken =
      state.zone.enemies.some((e) => e.respawnAt === null && e.x === t.x && e.y === t.y) ||
      onPlayer(views, t.x, t.y);
    if (isWalkable(grid, t.x, t.y) && !taken) return t;
  }
  return null;
}
