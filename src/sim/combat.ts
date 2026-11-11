/**
 * Combat math (DESIGN.md §8, OSRS-style) and the player's attacks.
 * accRoll = (level + 8 + style) * (accuracy + 64); defRoll likewise with armor.
 * Hit chance uses the OSRS comparison; damage on a hit is 0..maxHit.
 */
import { COMBAT, GROUND_ITEMS, TICKETS } from '../config/balance';
import { bark, barkOnAggro, barkOnHurt } from './barks';
import { damageAfterWeakness } from './weakness';
import { effectiveLevel } from './boosts';
import { heckleScale } from './bossMechanics';
import { addStreamUsd, formatTickets, streamTickets } from './ledger';
import { attackProfile, consumeAmmo } from './equipment';
import {
  chebyshev,
  hasLineOfSight,
  interactionTiles,
  isCardinallyAdjacent,
  type Grid,
} from './grid';
import { privacyFor, spawnGroundItem } from './ground';
import { findPath } from './pathfinding';
import { countItem } from './inventory';
import { atStep, progressQuests } from './quests';
import { chance, nextFloat, nextInt, type RngState } from './rng';
import type { CombatType, EnemyDef } from './schemas';
import {
  addOwner,
  type AttackStyle,
  enemyVisible,
  gridOf,
  pidOfEntity,
  viewFor,
  type EnemyInstance,
  type GameState,
  type SimContext,
  type SimEvent,
  type Tile,
} from './state';
import { grantXp, levelForXp } from './xp';

export function hitChance(attRoll: number, defRoll: number): number {
  return attRoll > defRoll
    ? 1 - (defRoll + 2) / (2 * (attRoll + 1))
    : attRoll / (2 * (defRoll + 1));
}

export function accuracyRoll(effectiveLevel: number, bonus: number): number {
  return effectiveLevel * (bonus + COMBAT.bonusOffset);
}

export function maxHit(effectiveStrength: number, damageBonus: number): number {
  return Math.floor(
    0.5 + (effectiveStrength * (damageBonus + COMBAT.bonusOffset)) / COMBAT.maxHitDivisor,
  );
}

/** guns > melee, melee > shields, shields > guns. */
export function triangleMultiplier(attack: 'gun' | 'melee', target: CombatType): number {
  const m = COMBAT.triangleModifier;
  if (attack === 'gun') return target === 'melee' ? 1 + m : target === 'shield' ? 1 - m : 1;
  return target === 'shield' ? 1 + m : target === 'gun' ? 1 - m : 1;
}

/** Rolls one attack: 0 on a miss, otherwise 0..maxHit. */
export function rollDamage(rng: RngState, attRoll: number, defRoll: number, max: number): number {
  return chance(rng, hitChance(attRoll, defRoll)) ? nextInt(rng, 0, max) : 0;
}

/** OSRS-style combat level from Defense, Hitpoints, Summoning and the better of Melee/Shooting. */
export function combatLevel(skills: Record<string, number>): number {
  const lvl = (id: string) => levelForXp(skills[id] ?? 0);
  const base = 0.25 * (lvl('defense') + lvl('hitpoints') + Math.floor(lvl('summoning') / 2));
  const melee = 0.325 * 2 * lvl('melee');
  const ranged = 0.325 * Math.floor(lvl('shooting') * 1.5);
  return Math.floor(base + Math.max(melee, ranged));
}

/** Melee needs a shared edge; guns need range and a clear line. */
export function inAttackRange(
  grid: Grid,
  from: Tile,
  to: Tile,
  range: number,
  melee: boolean,
): boolean {
  if (melee) return isCardinallyAdjacent(from, { x: to.x, y: to.y, width: 1, height: 1 });
  return chebyshev(from, to) <= range && chebyshev(from, to) > 0 && hasLineOfSight(grid, from, to);
}

/**
 * Path toward a target until it's in range (re-planned every tick as things
 * move). Standing on the target's tile, even a gun steps off it first.
 */
export function pathToward(grid: Grid, from: Tile, to: Tile, melee: boolean): Tile[] {
  const sameTile = from.x === to.x && from.y === to.y;
  const goals =
    melee || sameTile ? interactionTiles(grid, { x: to.x, y: to.y, width: 1, height: 1 }) : [to];
  return findPath(grid, from, goals).path;
}

/** The player's reach with their current weapon and style. */
function playerReach(state: GameState, ctx: SimContext): { range: number; melee: boolean } {
  const profile = attackProfile(state.player, ctx);
  const melee = profile.type === 'melee';
  const longrange = !melee && state.player.style === 'longrange';
  return { range: profile.range + (longrange ? COMBAT.longrangeRangeBonus : 0), melee };
}

/**
 * Plans the walk toward an enemy until it's in reach. Returns false when it
 * can't be reached. Called on the click itself, so the player sets off on the
 * same tick, like OSRS, and again each tick as the enemy moves.
 */
export function approachEnemy(state: GameState, ctx: SimContext, enemy: EnemyInstance): boolean {
  const player = state.player;
  const grid = gridOf(state, ctx);
  const { range, melee } = playerReach(state, ctx);
  if (inAttackRange(grid, player.pos, enemy, range, melee)) {
    player.path = [];
    return true;
  }
  player.path = pathToward(grid, player.pos, enemy, melee);
  return player.path.length > 0;
}

/** Bosses and their adds fight in multi-way combat; everywhere else is single-way. */
export function multiCombat(ctx: SimContext, enemy: EnemyInstance): boolean {
  return enemy.temp || ctx.content.enemies.get(enemy.defId)?.boss !== undefined;
}

/**
 * Single-way combat between players: an enemy that is fighting another player
 * (or their Sproto) can't be joined (OSRS "Someone else is fighting that.").
 */
export function fightingSomeoneElse(
  state: GameState,
  ctx: SimContext,
  enemy: EnemyInstance,
): boolean {
  const target = enemy.target;
  if (target === null || multiCombat(ctx, enemy)) return false;
  if (target === state.selfId || target === state.sprotoId) return false;
  if (pidOfEntity(target) === null) return false;
  return state.tick - enemy.lastCombatTick <= COMBAT.singleWayTicks;
}

/** One tick of the player fighting `enemy`: close the distance, then shoot or swing on cooldown. */
export function tickPlayerAttack(
  state: GameState,
  ctx: SimContext,
  enemy: EnemyInstance,
  events: SimEvent[],
): void {
  const player = state.player;
  const def = ctx.content.enemies.get(enemy.defId)!;
  const profile = attackProfile(player, ctx);
  const melee = profile.type === 'melee';

  if (fightingSomeoneElse(state, ctx, enemy)) {
    events.push({ type: 'message', kind: 'game', text: 'Someone else is fighting that.' });
    player.action = null;
    player.path = [];
    return;
  }
  if (!approachEnemy(state, ctx, enemy)) {
    events.push({ type: 'message', kind: 'game', text: "I can't reach that!" });
    player.action = null;
    return;
  }
  if (player.path.length > 0) return;
  if (state.tick < player.nextAttackTick) return;

  if (profile.outOfAmmo && player.action?.nextAttemptTick === null) {
    events.push({
      type: 'message',
      kind: 'warning',
      text: profile.keptForQuest
        ? `Out of spare Hash (the rest is for your quest). You bash with your ${profile.weapon.name}.`
        : `Out of ammo! You bash with your ${profile.weapon.name}.`,
    });
  }
  if (player.action) player.action.nextAttemptTick = state.tick;

  const rapid = !melee && player.style === 'rapid';
  player.nextAttackTick =
    state.tick + Math.max(1, profile.speed - (rapid ? COMBAT.rapidSpeedBonus : 0));
  consumeAmmo(player, profile);
  if (!melee && attackProfile(player, ctx).outOfAmmo) {
    events.push({ type: 'message', kind: 'warning', text: 'That was your last shot!' });
  }

  const skillId = melee ? 'melee' : 'shooting';
  const level = effectiveLevel(player, skillId, state.tick);
  const styleBonus = player.style === 'accurate' || player.style === 'bash' ? COMBAT.styleBonus : 0;
  const effective = level + COMBAT.levelOffset + styleBonus;
  const attRoll =
    accuracyRoll(effective, profile.accuracyBonus) *
    triangleMultiplier(profile.type, def.type) *
    heckleScale(state);
  const defRoll = accuracyRoll(def.defense + COMBAT.levelOffset, def.armor);
  const rally = state.tick < player.rally.untilTick ? 1 + player.rally.pct : 1;
  const max = Math.floor(maxHit(effective, profile.damageBonus) * rally);
  const style: AttackStyle = melee
    ? 'melee'
    : profile.explosive
      ? 'explosive'
      : profile.weapon.weapon?.ammo === 'coom'
        ? 'magic'
        : 'gun';
  events.push({ type: 'attack', attackerId: state.selfId, targetId: enemy.id, style });
  // Being attacked starts the fight (and its opening line) before any reaction to the hit.
  if (enemy.target === null) enemy.target = state.selfId;
  enemy.lastCombatTick = state.tick;
  barkOnAggro(state, ctx, enemy, events);
  const damage = damageAfterWeakness(
    state,
    ctx,
    enemy,
    profile.weapon,
    style,
    rollDamage(state.rng, attRoll, defRoll, max),
    events,
  );
  awardCombatXp(state, ctx, damage, melee, events);

  if (profile.explosive) {
    const splash = state.zone.enemies.filter(
      (e) =>
        e !== enemy &&
        e.respawnAt === null &&
        enemyVisible(state, e) &&
        !fightingSomeoneElse(state, ctx, e) &&
        chebyshev(e, enemy) <= COMBAT.splashRadius,
    );
    for (const other of splash) {
      const roll = Math.floor(nextFloat(state.rng) * max * COMBAT.splashShare);
      const hit = damageAfterWeakness(state, ctx, other, profile.weapon, style, roll, events);
      if (other.target === null) other.target = state.selfId;
      damageEnemy(state, ctx, other, hit, events);
    }
  }
  damageEnemy(state, ctx, enemy, damage, events);
}

function awardCombatXp(
  state: GameState,
  ctx: SimContext,
  damage: number,
  melee: boolean,
  events: SimEvent[],
): void {
  if (damage <= 0) return;
  const player = state.player;
  const xp = damage * COMBAT.xpPerDamage;
  const name = (id: string) => ctx.content.skills.get(id)?.name ?? id;
  const give = (id: string, amount: number) => {
    grantXp(player, id, name(id), amount, events);
    progressQuests(state, ctx, { type: 'xp', skill: id }, events);
  };
  if (melee && player.style === 'block') give('defense', xp);
  else if (melee) give('melee', xp);
  else if (player.style === 'longrange') {
    give('shooting', xp / 2);
    give('defense', xp / 2);
  } else give('shooting', xp);
  give('hitpoints', damage * COMBAT.hpXpPerDamage);
}

/** Applies damage from the player or their Sproto; kills and loots at 0 HP. */
export function damageEnemy(
  state: GameState,
  ctx: SimContext,
  enemy: EnemyInstance,
  damage: number,
  events: SimEvent[],
): void {
  if (enemy.respawnAt !== null) return;
  const dealt = Math.min(enemy.hp, damage);
  enemy.hp -= dealt;
  if (dealt > 0) {
    enemy.damageBy ??= {};
    enemy.damageBy[state.pid] = (enemy.damageBy[state.pid] ?? 0) + dealt;
  }
  events.push({ type: 'hitsplat', targetId: enemy.id, damage: dealt });
  if (enemy.hp <= 0) killEnemy(state, ctx, enemy, events);
  else barkOnHurt(state, ctx, enemy, ctx.content.enemies.get(enemy.defId)?.hp ?? enemy.hp, events);
}

function killEnemy(
  state: GameState,
  ctx: SimContext,
  enemy: EnemyInstance,
  events: SimEvent[],
): void {
  const def = ctx.content.enemies.get(enemy.defId)!;
  const player = state.player;
  events.push({ type: 'death', entityId: enemy.id });
  bark(state, ctx, enemy, 'defeat', events);
  enemy.respawnAt = state.tick + def.respawnTicks;
  enemy.target = null;
  if (player.action?.targetId === enemy.id) player.action = null;
  if (player.sproto?.target === enemy.id) player.sproto.target = null;
  if (enemy.temp) state.zone.enemies = state.zone.enemies.filter((e) => e !== enemy);

  // The top damager owns the loot (OSRS); it is their private drop for a while.
  const looter = lootOwner(state, enemy);
  dropLoot(looter, ctx, def, enemy, looter === state ? events : null);
  if (def.boss) {
    const flag = `boss:${def.id}`;
    if (!player.unlocks.includes(flag)) {
      player.unlocks.push(flag);
      // Only bosses guarding a barricade open a way forward.
      const opens = ctx.content.zones.get(state.zone.id)?.objects.some((o) => o.requires === flag);
      events.push({
        type: 'message',
        kind: 'levelup',
        text: `${def.name} is defeated!${opens ? ' The way forward is open.' : ''}`,
      });
      // Only a first win moves the market; a respawning boss can't be farmed for it.
      state.economy.recentBossWins += 1;
    }
    // Its adds lose their mother.
    const owner = addOwner(enemy);
    state.zone.enemies = state.zone.enemies.filter((e) => !e.temp || e.owner !== owner);
  }
  progressQuests(state, ctx, { type: 'kill', enemy: def.id }, events);
}

/** The view of whoever did the most damage and is still in this zone, else the killer. */
function lootOwner(state: GameState, enemy: EnemyInstance): GameState {
  const by = enemy.damageBy;
  enemy.damageBy = undefined;
  if (!by) return state;
  let best: string | null = null;
  for (const pid of state.world.joinSeq) {
    if ((by[pid] ?? 0) > (best === null ? 0 : by[best])) best = pid;
  }
  if (best === null || best === state.pid) return state;
  const view = viewFor(state.world, best);
  return view.player && view.zone === state.zone ? view : state;
}

/** Messages for a looter other than the killer go to the world's `pending` mailbox. */
function dropLoot(
  state: GameState,
  ctx: SimContext,
  def: EnemyDef,
  at: Tile,
  maybeEvents: SimEvent[] | null,
): void {
  const table = ctx.content.drops.get(def.drops);
  if (!table) return;
  const events = maybeEvents ?? mailbox(state);
  const [min, max] = table.usd;
  // Fighting pays TICKETS.dropUsdMultiplier times the table's roll. Every coin drop says
  // what it was worth, even when it banks only a fraction of a Ticket.
  const usd = (min + (max - min) * nextFloat(state.rng)) * TICKETS.dropUsdMultiplier;
  addStreamUsd(state, 'pb_drop', usd);
  if (usd > 0) {
    events.push({
      type: 'message',
      kind: 'game',
      text: `You loot ${formatTickets(streamTickets(usd))}.`,
    });
  }
  const despawn = state.tick + GROUND_ITEMS.despawnTicks;
  const drop = (itemId: string, qty: number) => {
    const item = ctx.content.items.get(itemId);
    if (item) {
      const privacy = privacyFor(state, ctx, itemId);
      spawnGroundItem(state.zone, itemId, qty, at.x, at.y, despawn, item.stackable, privacy);
    }
  };
  for (const s of table.always) drop(s.item, s.qty);
  // Quest items only drop while the quest needs them, and not if you already have one.
  for (const q of table.questDrops) {
    if (!atStep(state.player, ctx.content, q.quest, q.step)) continue;
    if (countItem(state.player.inventory, q.item) > 0) continue;
    if (chance(state.rng, q.chance)) drop(q.item, q.qty);
  }
  const total = table.table.reduce((sum, row) => sum + row.weight, 0);
  for (let r = 0; r < table.rolls && total > 0; r++) {
    let pick = nextFloat(state.rng) * total;
    const row = table.table.find((candidate) => (pick -= candidate.weight) < 0);
    if (row?.item) drop(row.item, nextInt(state.rng, row.min, row.max));
  }
  for (const t of table.tertiary) {
    if (chance(state.rng, 1 / t.oneIn)) drop(t.item, t.qty);
  }
  for (const s of table.shared) {
    if (!chance(state.rng, 1 / s.oneIn)) continue;
    const sub = ctx.content.drops.get(s.table);
    const subTotal = sub ? sub.table.reduce((sum, row) => sum + row.weight, 0) : 0;
    if (!sub || subTotal <= 0) continue;
    let pick = nextFloat(state.rng) * subTotal;
    const row = sub.table.find((candidate) => (pick -= candidate.weight) < 0);
    if (row?.item) drop(row.item, nextInt(state.rng, row.min, row.max));
  }
}

const MAILBOXES = new WeakMap<GameState, SimEvent[]>();

/**
 * Events for a player that happen during someone else's turn (their loot from a
 * kill another player landed). The world tick drains it into that player's list.
 */
export function mailbox(state: GameState): SimEvent[] {
  let box = MAILBOXES.get(state);
  if (!box) {
    box = [];
    MAILBOXES.set(state, box);
  }
  return box;
}

/** Takes and clears the player's mailbox. */
export function drainMailbox(state: GameState): SimEvent[] {
  const box = MAILBOXES.get(state);
  if (!box || box.length === 0) return [];
  MAILBOXES.delete(state);
  return box;
}
