/** A world with several players: shared zones, private instances, determinism. */
import { describe, expect, it } from 'vitest';
import { findEntity, removePlayerFromWorld, viewFor } from '../src/sim/state';
import { runWorldTick } from '../src/sim/tick';
import { changeZone } from '../src/sim/zones';
import { newGame, objectOf } from './helpers';
import { newWorld, worldHash } from './worldHelpers';

describe('world of many players', () => {
  it('a single-player game is a world of one with the classic ids', () => {
    const { state } = newGame();
    expect(state.pid).toBe('player');
    expect(state.selfId).toBe('player');
    expect(state.sprotoId).toBe('sproto');
    expect(state.world.joinSeq).toEqual(['player']);
    expect(state.zone).toBe(state.world.zones.zone_treasury);
  });

  it('players in the same zone share its objects and see each other move', () => {
    const { world, ctx, views } = newWorld(['a', 'b']);
    expect(views.a.zone).toBe(views.b.zone);
    expect(views.a.selfId).toBe('p:a');
    expect(views.b.sprotoId).toBe('s:b');
    runWorldTick(world, ctx, { a: [{ type: 'walk', x: 27, y: 34 }], b: [] });
    expect(views.a.player.pos).not.toEqual(views.b.player.pos);
    expect(world.players.a).toBe(views.a.player);
  });

  it('a depleted rack is depleted for everyone', () => {
    const { world, views } = newWorld(['a', 'b']);
    const rack = objectOf(views.a, 'obj_rack_dusty');
    rack.depletedUntil = world.tick + 50;
    expect(objectOf(views.b, 'obj_rack_dusty').depletedUntil).toBe(rack.depletedUntil);
  });

  it('each online player gets a private bunker instance', () => {
    const { world, ctx, views } = newWorld(['a', 'b']);
    changeZone(views.a, ctx, 'zone_bunker', { x: 5, y: 5 }, []);
    changeZone(views.b, ctx, 'zone_bunker', { x: 5, y: 5 }, []);
    expect(world.playerZone.a).toBe('zone_bunker@a');
    expect(world.playerZone.b).toBe('zone_bunker@b');
    expect(views.a.zone).not.toBe(views.b.zone);
    expect(views.a.zone.id).toBe('zone_bunker');
    removePlayerFromWorld(world, 'a');
    expect(world.zones['zone_bunker@a']).toBeUndefined();
    expect(world.joinSeq).toEqual(['b']);
  });

  it('quest-gated bosses are private copies per player at that step', () => {
    const { world, ctx, views } = newWorld(['a', 'b']);
    for (const v of Object.values(views)) changeZone(v, ctx, 'zone_trenches', { x: 20, y: 95 }, []);
    views.a.player.quests.quest_sludge_duty = {
      done: ['briefing', 'scout'],
      complete: false,
      choices: [],
    };
    runWorldTick(world, ctx, {});
    const mothers = views.a.zone.enemies.filter((e) => e.defId === 'enemy_sludge_mother');
    const mine = mothers.find((e) => e.owner === 'a' && e.respawnAt === null);
    expect(mine).toBeDefined();
    expect(findEntity(views.a, mine!.id)).not.toBeNull();
    expect(findEntity(views.b, mine!.id)).toBeNull();
    // The offline template stays asleep in an online world.
    const template = mothers.find((e) => e.owner === 'player')!;
    expect(template.respawnAt).toBe(Infinity);
    // The copy goes when its owner leaves.
    changeZone(views.a, ctx, 'zone_treasury', { x: 27, y: 30 }, []);
    runWorldTick(world, ctx, {});
    expect(views.b.zone.enemies.some((e) => e.owner === 'a')).toBe(false);
  });

  it('NPCs that need an unlock show only for players who have it', () => {
    const { views } = newWorld(['a', 'b']);
    const npc = { ...views.a.zone.npcs[0], id: 'n999', requires: 'boss:test' };
    views.a.zone.npcs.push(npc);
    views.a.player.unlocks.push('boss:test');
    expect(findEntity(views.a, 'n999')).not.toBeNull();
    expect(findEntity(views.b, 'n999')).toBeNull();
  });

  it('replaying the same seed and intents gives the same world', () => {
    const run = () => {
      const { world, ctx } = newWorld(['a', 'b', 'c'], 5);
      for (let i = 0; i < 40; i++) {
        runWorldTick(world, ctx, {
          a: i === 0 ? [{ type: 'walk', x: 20, y: 30 }] : [],
          b: i === 3 ? [{ type: 'walk', x: 30, y: 36 }] : [],
          c: i === 5 ? [{ type: 'toggleRun' }, { type: 'walk', x: 27, y: 24 }] : [],
        });
      }
      return worldHash(world);
    };
    expect(run()).toBe(run());
  });

  it('views are cached per pid', () => {
    const { world, views } = newWorld(['a']);
    expect(viewFor(world, 'a')).toBe(views.a);
  });
});
