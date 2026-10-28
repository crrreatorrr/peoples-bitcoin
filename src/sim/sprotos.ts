/**
 * Summoning: Sproto allies (DESIGN.md §9). One at a time, summoned with a
 * contract, for a limited time. AI priority: ASSIST (the player's target) >
 * DEFEND (whatever is attacking the player) > FOLLOW. Medics heal instead of
 * fighting. Each Sproto has one special that costs Summoning points.
 */
import { COMBAT, SUMMONING } from '../config/balance';
import { accuracyRoll, damageEnemy, inAttackRange, maxHit, pathToward, rollDamage } from './combat';
import { chebyshev, isWalkable } from './grid';
import { progressQuests } from './quests';
import {
  gridOf,
  maxHp,
  PLAYER_ID,
  SPROTO_ID,
  type EnemyInstance,
  type GameState,
  type SimContext,
  type SimEvent,
  type Tile,
} from './state';
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
  const say = (text: string): void => {
    events.push({ type: 'message', kind: 'game', text });
  };
  if (player.sproto) return say('You already have a Sproto with you. Dismiss it first.');
  if (state.tick < player.summoning.cooldownUntil)
    return say('Your last Sproto is still recovering.');
  if (levelForXp(player.skills.summoning ?? 0) < sdef.levelReq) {
    return say(`You need a Summoning level of ${sdef.levelReq} to summon a ${sdef.name}.`);
  }
  item.qty -= 1;
  if (item.qty === 0) player.inventory[slot] = null;
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
  say(`A ${sdef.name} reports for duty!`);
  grantXp(
    player,
    'summoning',
    ctx.content.skills.get('summoning')?.name ?? 'Summoning',
    sdef.xp,
    events,
  );
  progressQuests(state, ctx, { type: 'summon' }, events);
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
    Object.assign(sproto, besidePlayer(state, ctx));
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
    if (chebyshev(sproto, player.pos) > 1) step(sproto, pathToward(grid, sproto, player.pos, true));
    return;
  }
  const melee = sdef.range <= 1;
  if (!inAttackRange(grid, sproto, target, sdef.range, melee)) {
    step(sproto, pathToward(grid, sproto, target, melee));
    return;
  }
  if (state.tick < sproto.nextAttackTick) return;
  sproto.nextAttackTick = state.tick + sdef.speed;

  const edef = ctx.content.enemies.get(target.defId)!;
  const max = maxHit(sdef.strength + COMBAT.levelOffset, sdef.damage);
  let damage: number;
  if (sproto.headshot) {
    damage = max * 2;
    sproto.headshot = false;
  } else {
    const attRoll = accuracyRoll(sdef.attack + COMBAT.levelOffset, sdef.accuracy);
    const defRoll = accuracyRoll(edef.defense + COMBAT.levelOffset, edef.armor);
    damage = rollDamage(state.rng, attRoll, defRoll, max);
  }
  events.push({
    type: 'attack',
    attackerId: SPROTO_ID,
    targetId: target.id,
    style: melee ? 'melee' : 'gun',
  });
  if (target.target === null) target.target = SPROTO_ID;
  if (damage > 0) {
    const name = ctx.content.skills.get('summoning')?.name ?? 'Summoning';
    grantXp(player, 'summoning', name, damage * SUMMONING.xpPerDamage, events);
  }
  damageEnemy(state, ctx, target, damage, events);
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
