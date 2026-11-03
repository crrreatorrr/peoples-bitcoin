/**
 * Summoning: Sproto allies (DESIGN.md §9). One at a time, summoned with a
 * contract, for a limited time. AI priority: ASSIST (the player's target) >
 * DEFEND (whatever is attacking the player) > FOLLOW. Medics heal instead of
 * fighting. Each Sproto has one special that costs Summoning points.
 *
 * Relic Sprotos (SprotoDef.relic) need no contract: they are summoned for free
 * while the hub reports their relic as owned (state.hubSession, never saved).
 * Throwers (SprotoDef.throws) lob rocks with SUMMONING.rockThrow's numbers.
 */
import { COMBAT, SUMMONING } from '../config/balance';
import { accuracyRoll, damageEnemy, inAttackRange, maxHit, pathToward, rollDamage } from './combat';
import { damageAfterWeakness } from './weakness';
import { chebyshev, isWalkable } from './grid';
import { progressQuests } from './quests';
import {
  gridOf,
  maxHp,
  PLAYER_ID,
  SPROTO_ID,
  type AttackStyle,
  type EnemyInstance,
  type GameState,
  type SimContext,
  type SimEvent,
  type Tile,
} from './state';
import type { Content } from './content';
import type { SprotoDef } from './schemas';
import { grantXp, levelForXp } from './xp';

/** Beyond this distance the Sproto catches up instantly (e.g. after a teleport). */
const CATCH_UP_DISTANCE = 12;
const TAUNT_RANGE = 8;

export function summonFromInventory(
  state: GameState,
  ctx: SimContext,
  slot: number,
  events: SimEvent[],
): void {
  const player = state.player;
  const item = player.inventory[slot];
  const def = item && ctx.content.items.get(item.itemId);
  const sdef = def?.summon && ctx.content.sprotos.get(def.summon.sproto);
  if (!item || !sdef) return;
  if (!canSummon(state, sdef, events)) return;
  item.qty -= 1;
  if (item.qty === 0) player.inventory[slot] = null;
  spawnSproto(state, ctx, sdef, events, true);
}

/**
 * Relic Sprotos the hub says this player owns: the relic id, or the hub item id
 * itself, is in the init relics, or the hub resolved it as the equipped summon.
 */
export function ownedRelicSprotos(state: GameState, content: Content): SprotoDef[] {
  const hub = state.hubSession;
  return [...content.sprotos.values()].filter(
    (s) =>
      s.relic !== undefined &&
      (hub.relics.includes(s.relic.id) ||
        hub.relics.includes(s.relic.hubItem) ||
        hub.effects.summon === s.relic.hubItem),
  );
}

/**
 * Summons a relic Sproto: no contract is used up, no Summoning XP is given, and it
 * doesn't tick off quest steps that teach contracts.
 */
export function summonRelic(
  state: GameState,
  ctx: SimContext,
  sprotoId: string,
  events: SimEvent[],
): void {
  const sdef = ctx.content.sprotos.get(sprotoId);
  if (!sdef?.relic) return;
  if (!ownedRelicSprotos(state, ctx.content).includes(sdef)) {
    events.push({
      type: 'message',
      kind: 'game',
      text: `Only the holder of the ${sdef.relic.name} can summon a ${sdef.name}.`,
    });
    return;
  }
  if (!canSummon(state, sdef, events)) return;
  spawnSproto(state, ctx, sdef, events, false);
}

function canSummon(state: GameState, sdef: SprotoDef, events: SimEvent[]): boolean {
  const player = state.player;
  const say = (text: string): false => {
    events.push({ type: 'message', kind: 'game', text });
    return false;
  };
  if (player.sproto) return say('You already have a Sproto with you. Dismiss it first.');
  if (state.tick < player.summoning.cooldownUntil)
    return say('Your last Sproto is still recovering.');
  if (levelForXp(player.skills.summoning ?? 0) < sdef.levelReq) {
    return say(`You need a Summoning level of ${sdef.levelReq} to summon a ${sdef.name}.`);
  }
  return true;
}

/** `contract`: summoned from a contract. Only those count for quest "summon" steps. */
function spawnSproto(
  state: GameState,
  ctx: SimContext,
  sdef: SprotoDef,
  events: SimEvent[],
  contract: boolean,
): void {
  const player = state.player;
  const spot = besidePlayer(state, ctx);
  player.sproto = {
    defId: sdef.id,
    x: spot.x,
    y: spot.y,
    from: { ...spot },
    hp: sdef.hp,
    expiresAt: state.tick + SUMMONING.durationTicks,
    nextAttackTick: 0,
    target: null,
    nextHealTick: 0,
    headshot: false,
  };
  events.push({ type: 'message', kind: 'game', text: `A ${sdef.name} reports for duty!` });
  if (sdef.xp > 0) {
    grantXp(
      player,
      'summoning',
      ctx.content.skills.get('summoning')?.name ?? 'Summoning',
      sdef.xp,
      events,
    );
  }
  if (contract) progressQuests(state, ctx, { type: 'summon' }, events);
}

export function dismiss(state: GameState): void {
  state.player.sproto = null;
}

export function useSpecial(state: GameState, ctx: SimContext, events: SimEvent[]): void {
  const player = state.player;
  const sproto = player.sproto;
  const sdef = sproto && ctx.content.sprotos.get(sproto.defId);
  if (!sproto || !sdef) return;
  const sp = sdef.special;
  if (player.summoning.points < sp.cost) {
    events.push({
      type: 'message',
      kind: 'game',
      text: `${sp.name} needs ${sp.cost} Summoning points.`,
    });
    return;
  }
  player.summoning.points -= sp.cost;
  const target = enemyById(state, sproto.target ?? player.action?.targetId);
  switch (sp.kind) {
    case 'rally':
      player.rally = { untilTick: state.tick + sp.ticks, pct: sp.value };
      break;
    case 'heal':
      player.hp = Math.min(maxHp(player), player.hp + sp.value);
      break;
    case 'taunt':
      for (const e of state.zone.enemies) {
        if (e.respawnAt === null && e.target === PLAYER_ID && chebyshev(e, sproto) <= TAUNT_RANGE) {
          e.target = SPROTO_ID;
          e.tauntedUntil = state.tick + sp.ticks;
        }
      }
      break;
    case 'headshot':
      sproto.headshot = true;
      break;
    case 'suppress':
      if (target) target.suppressedUntil = state.tick + sp.ticks;
      break;
  }
  events.push({ type: 'message', kind: 'levelup', text: `${sdef.name}: ${sp.name}!` });
}

export function stepSproto(state: GameState, ctx: SimContext, events: SimEvent[]): void {
  const player = state.player;
  const sproto = player.sproto;
  if (!sproto) return;
  sproto.from = { x: sproto.x, y: sproto.y };
  const sdef = ctx.content.sprotos.get(sproto.defId)!;
  if (state.tick >= sproto.expiresAt) {
    events.push({
      type: 'message',
      kind: 'game',
      text: `Your ${sdef.name}'s tour of duty is over.`,
    });
    player.sproto = null;
    return;
  }
  if (chebyshev(sproto, player.pos) > CATCH_UP_DISTANCE) {
    const spot = besidePlayer(state, ctx);
    Object.assign(sproto, spot, { from: { ...spot } });
  }

  if (
    sdef.heals &&
    state.tick >= sproto.nextHealTick &&
    player.hp < maxHp(player) * sdef.heals.belowPct
  ) {
    sproto.nextHealTick = state.tick + sdef.heals.everyTicks;
    player.hp = Math.min(maxHp(player), player.hp + sdef.heals.amount);
    events.push({ type: 'message', kind: 'game', text: `Your ${sdef.name} patches you up.` });
  }

  // ASSIST > DEFEND > FOLLOW.
  const assist =
    player.action?.action === 'Attack' ? enemyById(state, player.action.targetId) : null;
  const defend =
    state.zone.enemies.find((e) => e.respawnAt === null && e.target === PLAYER_ID) ?? null;
  const current = enemyById(state, sproto.target);
  const target = sdef.heals ? null : (assist ?? current ?? defend);
  sproto.target = target?.id ?? null;

  const grid = gridOf(state, ctx);
  if (!target) {
    // Keep the player's pace: two steps a tick when they run.
    const pace = Math.max(1, player.stepsThisTick.length - 1);
    for (let i = 0; i < pace && chebyshev(sproto, player.pos) > 1; i++) {
      step(sproto, pathToward(grid, sproto, player.pos, true));
    }
    return;
  }
  const reach = sprotoReach(sdef);
  const melee = reach.style === 'melee';
  if (!inAttackRange(grid, sproto, target, reach.range, melee)) {
    step(sproto, pathToward(grid, sproto, target, melee));
    return;
  }
  if (state.tick < sproto.nextAttackTick) return;
  sproto.nextAttackTick = state.tick + reach.everyTicks;

  const edef = ctx.content.enemies.get(target.defId)!;
  const max = reach.maxHit;
  let damage: number;
  if (sproto.headshot) {
    damage = max * 2;
    sproto.headshot = false;
  } else {
    const attRoll = accuracyRoll(sdef.attack + COMBAT.levelOffset, sdef.accuracy);
    const defRoll = accuracyRoll(edef.defense + COMBAT.levelOffset, edef.armor);
    damage = rollDamage(state.rng, attRoll, defRoll, max);
  }
  // Bosses only fear certain weapons, and a Sproto is never one of them.
  damage = damageAfterWeakness(state, ctx, target, null, null, damage, events);
  events.push({
    type: 'attack',
    attackerId: SPROTO_ID,
    targetId: target.id,
    style: reach.style,
  });
  if (target.target === null) target.target = SPROTO_ID;
  if (damage > 0) {
    const name = ctx.content.skills.get('summoning')?.name ?? 'Summoning';
    grantXp(player, 'summoning', name, damage * SUMMONING.xpPerDamage, events);
  }
  damageEnemy(state, ctx, target, damage, events);
}

/**
 * How a Sproto attacks: range in tiles, ticks between attacks, max hit, and how it looks.
 * A rock thrower takes all three numbers from SUMMONING.rockThrow.
 */
export function sprotoReach(sdef: SprotoDef): {
  range: number;
  everyTicks: number;
  maxHit: number;
  style: AttackStyle;
} {
  if (sdef.throws === 'rock') {
    const rock = SUMMONING.rockThrow;
    return {
      range: rock.rangeTiles,
      everyTicks: rock.everyTicks,
      maxHit: rock.damage,
      style: 'rock',
    };
  }
  return {
    range: sdef.range,
    everyTicks: sdef.speed,
    maxHit: maxHit(sdef.strength + COMBAT.levelOffset, sdef.damage),
    style: sdef.range <= 1 ? 'melee' : 'gun',
  };
}

/** Keeps the Sproto next to the player after a zone change or teleport. */
export function besidePlayer(state: GameState, ctx: SimContext): Tile {
  const grid = gridOf(state, ctx);
  const { x, y } = state.player.pos;
  for (const [dx, dy] of [
    [0, 1],
    [1, 0],
    [-1, 0],
    [0, -1],
  ] as const) {
    if (isWalkable(grid, x + dx, y + dy)) return { x: x + dx, y: y + dy };
  }
  return { x, y };
}

function enemyById(state: GameState, id: string | null | undefined): EnemyInstance | null {
  if (!id) return null;
  return state.zone.enemies.find((e) => e.id === id && e.respawnAt === null) ?? null;
}

function step(sproto: Tile, path: Tile[]): void {
  const next = path[0];
  if (next) {
    sproto.x = next.x;
    sproto.y = next.y;
  }
}
