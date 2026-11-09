/**
 * Champion Sproto: the relic summon the Tidebreaker Belt (Sproto Fighter) unlocks.
 * Ownership comes from the hub init relics (session only), and it throws rocks.
 */
import { describe, expect, it } from 'vitest';
import { COMBAT, SUMMONING } from '../src/config/balance';
import { maxHit } from '../src/sim/combat';
import { chebyshev, hasLineOfSight } from '../src/sim/grid';
import { deserialize, serialize } from '../src/sim/save';
import { ownedRelicSprotos, sprotoReach } from '../src/sim/sprotos';
import {
  newEnemy,
  type EnemyInstance,
  type GameState,
  type SimContext,
  type SimEvent,
} from '../src/sim/state';
import { runTick } from '../src/sim/tick';
import { content, gridFromRows, messages, newGame } from './helpers';

const CHAMPION = 'sp_champion';
const ROCK = SUMMONING.rockThrow;

function withBelt(seed = 1234): { state: GameState; ctx: SimContext } {
  const game = newGame(seed);
  game.state.hubSession.relics = ['tidebreaker_belt'];
  return game;
}

describe('Champion Sproto ownership', () => {
  it('is defined as the Tidebreaker Belt relic summon with the hub item id', () => {
    const def = content().sprotos.get(CHAMPION)!;
    expect(def.name).toBe('Champion Sproto');
    expect(def.relic).toEqual({
      id: 'tidebreaker_belt',
      name: 'Tidebreaker Belt',
      hubItem: 'pb_summon_champion_sproto',
    });
    expect(def.throws).toBe('rock');
    expect(def.xp).toBe(0);
    // No contract item summons it: it comes only from the relic.
    expect([...content().items.values()].some((i) => i.summon?.sproto === CHAMPION)).toBe(false);
  });

  it('is not owned without the belt, and cannot be summoned', () => {
    const { state, ctx } = newGame();
    expect(ownedRelicSprotos(state, ctx.content)).toEqual([]);
    state.hubSession.relics = ['tinubu_crown', 'hpos10i_core', 'cones_tip', 'genesis_shard'];
    expect(ownedRelicSprotos(state, ctx.content)).toEqual([]);
    const events = runTick(state, ctx, [{ type: 'summonRelic', sprotoId: CHAMPION }]);
    expect(state.player.sproto).toBeNull();
    expect(messages(events)).toContain(
      'Only the holder of the Tidebreaker Belt can summon a Champion Sproto.',
    );
  });

  it('is owned from the tidebreaker_belt init relic, the hub item id, or the resolved summon effect', () => {
    const { state, ctx } = withBelt();
    expect(ownedRelicSprotos(state, ctx.content).map((s) => s.id)).toEqual([CHAMPION]);
    state.hubSession.relics = ['pb_summon_champion_sproto'];
    expect(ownedRelicSprotos(state, ctx.content).map((s) => s.id)).toEqual([CHAMPION]);
    state.hubSession.relics = [];
    state.hubSession.effects = { summon: 'pb_summon_champion_sproto' };
    expect(ownedRelicSprotos(state, ctx.content).map((s) => s.id)).toEqual([CHAMPION]);
  });

  it('summons for free: no contract, no Summoning XP, no Tickets', () => {
    const { state, ctx } = withBelt();
    state.player.currencies.tickets = 77;
    const inventory = JSON.stringify(state.player.inventory);
    const ledger = JSON.stringify(state.player.ledger);
    const events = runTick(state, ctx, [{ type: 'summonRelic', sprotoId: CHAMPION }]);
    expect(state.player.sproto?.defId).toBe(CHAMPION);
    expect(messages(events)).toContain('A Champion Sproto reports for duty!');
    expect(JSON.stringify(state.player.inventory)).toBe(inventory);
    expect(state.player.skills.summoning ?? 0).toBe(0);
    expect(state.player.currencies.tickets).toBe(77);
    expect(JSON.stringify(state.player.ledger)).toBe(ledger);
    expect(state.player.sproto?.expiresAt).toBe(state.tick + SUMMONING.durationTicks);
  });

  it('does not tick off the tutorial step that teaches contracts', () => {
    const { state, ctx } = withBelt();
    const done = [...(state.player.quests.quest_tutorial?.done ?? [])];
    const events = runTick(state, ctx, [{ type: 'summonRelic', sprotoId: CHAMPION }]);
    expect(state.player.sproto?.defId).toBe(CHAMPION);
    expect(state.player.quests.quest_tutorial?.done ?? []).toEqual(done);
    expect(messages(events).some((m) => m.startsWith('Done:'))).toBe(false);
  });

  it('follows the usual one-at-a-time and cooldown rules', () => {
    const { state, ctx } = withBelt();
    runTick(state, ctx, [{ type: 'summonRelic', sprotoId: CHAMPION }]);
    const again = runTick(state, ctx, [{ type: 'summonRelic', sprotoId: CHAMPION }]);
    expect(messages(again)).toContain('You already have a Sproto with you. Dismiss it first.');
    runTick(state, ctx, [{ type: 'dismiss' }]);
    state.player.summoning.cooldownUntil = state.tick + 10;
    const cooling = runTick(state, ctx, [{ type: 'summonRelic', sprotoId: CHAMPION }]);
    expect(messages(cooling)).toContain('Your last Sproto is still recovering.');
    expect(state.player.sproto).toBeNull();
  });

  it('does not let a contract Sproto be summoned without its contract', () => {
    const { state, ctx } = withBelt();
    runTick(state, ctx, [{ type: 'summonRelic', sprotoId: 'sp_recruit' }]);
    expect(state.player.sproto).toBeNull();
  });

  it('keeps ownership out of the save: relics are reread from the hub each session', () => {
    const { state, ctx } = withBelt();
    const loaded = deserialize(serialize(state, 1), ctx.content)!;
    expect(loaded.hubSession.relics).toEqual([]);
    expect(ownedRelicSprotos(loaded, ctx.content)).toEqual([]);
  });
});

/** An open 40×40 field, one Champion Sproto, and a pinned, tough target `gap` tiles east of it. */
function rockRange(gap: number, rows?: string[]) {
  const { state, ctx } = withBelt(7);
  const open = rows ?? Array.from({ length: 40 }, () => '.'.repeat(40));
  ctx.grids.set(state.zone.id, gridFromRows(open));
  state.zone.enemies = [];
  state.player.pos = { x: 5, y: 20 };
  runTick(state, ctx, [{ type: 'summonRelic', sprotoId: CHAMPION }]);
  const sproto = state.player.sproto!;
  Object.assign(sproto, { x: 6, y: 20, from: { x: 6, y: 20 } });
  const target = newEnemy('e_dummy', 'enemy_spam_bot', 6 + gap, 20, ctx.content, true);
  target.hp = 10_000;
  state.zone.enemies.push(target);
  sproto.target = target.id;
  return { state, ctx, sproto, target };
}

interface Throw {
  tick: number;
  distance: number;
  los: boolean;
  /** Damage of the hitsplat that landed on the target in the same tick. */
  hit: number | null;
}

/** Runs ticks with the target held in place; returns every rock the Sproto threw. */
function watchThrows(
  state: GameState,
  ctx: SimContext,
  target: EnemyInstance,
  ticks: number,
): Throw[] {
  const throws: Throw[] = [];
  const pin = { x: target.x, y: target.y };
  for (let i = 0; i < ticks; i++) {
    Object.assign(target, pin, { from: { ...pin } });
    const events: SimEvent[] = runTick(state, ctx, []);
    const sproto = state.player.sproto!;
    for (const e of events) {
      if (e.type !== 'attack' || e.attackerId !== 'sproto') continue;
      expect(e.style).toBe('rock');
      expect(e.targetId).toBe(target.id);
      const splat = events.find((h) => h.type === 'hitsplat' && h.targetId === target.id);
      // Measured from the pinned tile: enemies step after the Sproto within a tick.
      throws.push({
        tick: state.tick,
        distance: chebyshev(sproto, pin),
        los: hasLineOfSight(ctx.grids.get(state.zone.id)!, sproto, pin),
        hit: splat?.type === 'hitsplat' ? splat.damage : null,
      });
    }
  }
  return throws;
}

describe('Champion Sproto rock throw', () => {
  it('takes range, interval and max hit from balance.ts', () => {
    expect(sprotoReach(content().sprotos.get(CHAMPION)!)).toEqual({
      range: ROCK.rangeTiles,
      everyTicks: ROCK.everyTicks,
      maxHit: ROCK.damage,
      style: 'rock',
    });
  });

  it('walks in and throws from exactly its range, never farther', () => {
    const { state, ctx, sproto, target } = rockRange(ROCK.rangeTiles + 4);
    const throws = watchThrows(state, ctx, target, 40);
    expect(throws.length).toBeGreaterThan(0);
    expect(throws[0]!.distance).toBe(ROCK.rangeTiles);
    for (const t of throws) {
      expect(t.distance).toBeLessThanOrEqual(ROCK.rangeTiles);
      expect(t.distance).toBeGreaterThan(0);
      expect(t.los).toBe(true);
    }
    // It stopped at range: a thrower doesn't close to melee.
    expect(chebyshev(sproto, { x: 6 + ROCK.rangeTiles + 4, y: 20 })).toBe(ROCK.rangeTiles);
    expect(target.defId).toBe('enemy_spam_bot');
  });

  it('does not throw through a wall', () => {
    const rows = Array.from({ length: 40 }, (_, y) =>
      Array.from({ length: 40 }, (_, x) => (x === 8 && y >= 15 && y <= 25 ? '#' : '.')).join(''),
    );
    const { state, ctx, target } = rockRange(ROCK.rangeTiles - 1, rows);
    const throws = watchThrows(state, ctx, target, 30);
    for (const t of throws) expect(t.los).toBe(true);
  });

  it('throws once every everyTicks ticks', () => {
    const { state, ctx, target } = rockRange(2);
    const throws = watchThrows(state, ctx, target, ROCK.everyTicks * 12 + 1);
    expect(throws.length).toBe(13);
    for (let i = 1; i < throws.length; i++) {
      expect(throws[i]!.tick - throws[i - 1]!.tick).toBe(ROCK.everyTicks);
    }
  });

  it('every rock lands on its tick for 0..damage, and the target loses exactly that', () => {
    const { state, ctx, target } = rockRange(3);
    const start = target.hp;
    const throws = watchThrows(state, ctx, target, ROCK.everyTicks * 60);
    expect(throws.length).toBeGreaterThanOrEqual(55);
    const hits = throws.map((t) => t.hit);
    for (const hit of hits) {
      expect(hit).not.toBeNull();
      expect(hit!).toBeGreaterThanOrEqual(0);
      expect(hit!).toBeLessThanOrEqual(ROCK.damage);
    }
    expect(hits.some((h) => h === ROCK.damage)).toBe(true);
    const dealt = hits.reduce<number>((sum, h) => sum + (h ?? 0), 0);
    expect(dealt).toBeGreaterThan(0);
    expect(start - target.hp).toBe(dealt);
  });

  it('Title Shot makes the next rock a sure hit for double the max', () => {
    const { state, ctx, target } = rockRange(2);
    const points = state.player.summoning.points;
    const events = runTick(state, ctx, [{ type: 'special' }]);
    expect(messages(events)).toContain('Champion Sproto: Title Shot!');
    expect(state.player.summoning.points).toBeLessThan(points);
    expect(events).toContainEqual({
      type: 'attack',
      attackerId: 'sproto',
      targetId: target.id,
      style: 'rock',
    });
    expect(events).toContainEqual({
      type: 'hitsplat',
      targetId: target.id,
      damage: ROCK.damage * 2,
    });
    // Back to normal rolls after that.
    for (const t of watchThrows(state, ctx, target, ROCK.everyTicks * 5)) {
      expect(t.hit!).toBeLessThanOrEqual(ROCK.damage);
    }
  });

  it('is a sidegrade: less damage per tick than a Grunt and less reach than a Sniper', () => {
    const c = content();
    const grunt = c.sprotos.get('sp_grunt')!;
    const sniper = c.sprotos.get('sp_sniper')!;
    const gruntMax = maxHit(grunt.strength + COMBAT.levelOffset, grunt.damage);
    expect(ROCK.damage / ROCK.everyTicks).toBeLessThan(gruntMax / grunt.speed);
    expect(ROCK.rangeTiles).toBeLessThan(sniper.range);
    expect(ROCK.rangeTiles).toBeGreaterThan(1);
  });
});
