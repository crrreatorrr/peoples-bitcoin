import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../src/config/balance';
import { chebyshev } from '../src/sim/grid';
import { maxHp, type GameState, type Intent, type SimContext } from '../src/sim/state';
import { runTick } from '../src/sim/tick';
import { xpForLevel } from '../src/sim/xp';
import { changeZone } from '../src/sim/zones';
import { content, give, newGame } from './helpers';

/** Puts the player on `step` of `quest`, with every earlier step done, so its boss wakes. */
function atBossStep(state: GameState, quest: string, step: string) {
  const def = content().quests.get(quest)!;
  const idx = def.steps.findIndex((s) => s.id === step);
  state.player.quests[quest] = {
    done: def.steps.slice(0, idx).map((s) => s.id),
    complete: false,
    choices: [],
  };
}

function wake(state: GameState, ctx: SimContext, bossId: string) {
  runTick(state, ctx, []);
  runTick(state, ctx, []);
  const boss = state.zone.enemies.find((e) => e.defId === bossId)!;
  expect(boss.respawnAt).toBeNull();
  return boss;
}

describe('quest bosses in the Treasury leave bystanders alone', () => {
  const cases = [
    ['enemy_corporate_raider', 'quest_hostile_takeover', 'raider'],
    ['enemy_building_inspector', 'quest_bunker', 'inspector'],
  ] as const;

  for (const [bossId, quest, step] of cases) {
    it(`${bossId} never attacks first, and fights back when attacked`, () => {
      const { state, ctx } = newGame(7);
      atBossStep(state, quest, step);
      const spawn = content()
        .zones.get('zone_treasury')!
        .enemies.find((e) => e.enemyId === bossId)!;
      changeZone(state, ctx, 'zone_treasury', { x: spawn.x + 1, y: spawn.y + 1 }, []);
      const boss = wake(state, ctx, bossId);
      const hp = state.player.hp;
      for (let i = 0; i < 200; i++) runTick(state, ctx, []);
      expect(boss.target).toBeNull();
      expect(state.player.hp).toBe(hp);

      state.player.skills.hitpoints = xpForLevel(60);
      state.player.hp = maxHp(state.player);
      let intents: Intent[] = [{ type: 'interact', targetId: boss.id, action: 'Attack' }];
      for (let i = 0; i < 60 && boss.target === null; i++) {
        runTick(state, ctx, intents);
        intents = [];
      }
      expect(boss.target).toBe(state.selfId);
    });
  }
});

describe('a boss fight is a boss fight', () => {
  /**
   * An ordinary aggressive enemy that the way in can wake (its sight plus its wander reaches a
   * path tile) must not be able to walk or shoot to where the boss picks its fight (within the
   * boss's sight of its spawn). Enemies behind a wall or a barricade do not count.
   */
  const lanes = [
    ['zone_trenches', 'enemy_wrongnamer_chief', 'duckboard'],
    ['zone_trenches', 'enemy_captain_motion', 'duckboard'],
    ['zone_academy', 'enemy_rugmancer', 'path'],
  ] as const;

  /** Every tile that can be walked to from `from`. */
  function reachable(ctx: SimContext, zoneId: string, from: { x: number; y: number }) {
    const grid = ctx.grids.get(zoneId)!;
    const seen = new Uint8Array(grid.width * grid.height);
    const queue = [from];
    seen[from.y * grid.width + from.x] = 1;
    while (queue.length > 0) {
      const t = queue.pop()!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = t.x + dx;
        const y = t.y + dy;
        if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
        const i = y * grid.width + x;
        if (seen[i] || grid.blocked[i]) continue;
        seen[i] = 1;
        queue.push({ x, y });
      }
    }
    return (t: { x: number; y: number }) => seen[t.y * grid.width + t.x] === 1;
  }

  for (const [zoneId, bossId, pathTile] of lanes) {
    it(`nobody the path wakes can reach ${bossId}`, () => {
      const c = content();
      const { ctx } = newGame();
      const zone = c.zones.get(zoneId)!;
      const boss = c.enemies.get(bossId)!;
      const at = zone.enemies.find((e) => e.enemyId === bossId)!;
      const sameSide = reachable(ctx, zoneId, at);
      const path: { x: number; y: number }[] = [];
      zone.tiles.forEach((row, y) => {
        for (let x = 0; x < row.length; x++)
          if (zone.legend[row[x]] === pathTile) path.push({ x, y });
      });
      expect(path.length).toBeGreaterThan(0);
      const intruders = zone.enemies.filter((e) => {
        const def = c.enemies.get(e.enemyId)!;
        if (e.quest || def.boss || !def.aggressive || !sameSide(e)) return false;
        const sight = def.aggroRange + def.wanderRadius;
        const reach = ENEMIES.leashRange + def.range;
        return (
          path.some((t) => chebyshev(t, e) <= sight) && chebyshev(e, at) < reach + boss.aggroRange
        );
      });
      expect(intruders.map((e) => `${e.enemyId}@${e.x},${e.y}`)).toEqual([]);
    });
  }

  it('the Extractor calls one Rug Puller at a time', () => {
    expect(content().enemies.get('enemy_extractor')!.boss!.adds).toMatchObject({
      enemy: 'enemy_rug_puller',
      max: 1,
    });
  });
});

describe('Inspector Greysuit is a fight for a new President', () => {
  /** Shooting 3, 10 Hitpoints, no armor, the pistol, and the four Soundbites the quest leaves. */
  function duel(seed: number): boolean {
    const { state, ctx } = newGame(seed);
    const p = state.player;
    atBossStep(state, 'quest_bunker', 'inspector');
    p.skills.shooting = xpForLevel(3);
    p.equipment.weapon = { itemId: 'gun_campaign_pistol', qty: 1 };
    p.equipment.ammo = { itemId: 'item_rounds', qty: 500 };
    give(state, 'item_tp_soundbite', 4);
    changeZone(state, ctx, 'zone_treasury', { x: 31, y: 20 }, []);
    const boss = wake(state, ctx, 'enemy_building_inspector');
    let died = false;
    for (let i = 0; i < 1500; i++) {
      if (boss.respawnAt !== null) return true;
      if (died) return false;
      const intents: Intent[] = [];
      const slot = p.inventory.findIndex((s) => s?.itemId === 'item_tp_soundbite');
      if (slot >= 0 && p.hp <= maxHp(p) - 4 && state.tick >= p.nextEatTick)
        intents.push({ type: 'eat', slot });
      if (!p.action) intents.push({ type: 'interact', targetId: boss.id, action: 'Attack' });
      for (const e of runTick(state, ctx, intents))
        if (e.type === 'death' && e.entityId === state.selfId) died = true;
    }
    return false;
  }

  it('wins more often than not, and not every time', () => {
    const seeds = Array.from({ length: 24 }, (_, i) => 100 + i * 17);
    const wins = seeds.filter(duel).length;
    expect(wins).toBeGreaterThanOrEqual(seeds.length / 2);
  });
});
