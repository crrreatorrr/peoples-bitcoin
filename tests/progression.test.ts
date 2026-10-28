import { describe, expect, it } from 'vitest';
import { SUMMONING } from '../src/config/balance';
import { hotspotKey } from '../src/sim/bunker';
import { interactionTiles } from '../src/sim/grid';
import { countItem } from '../src/sim/inventory';
import { findPath } from '../src/sim/pathfinding';
import { currentHint, npcLines, progressQuests, questPoints } from '../src/sim/quests';
import { newEnemy, type GameState, type SimContext, type SimEvent } from '../src/sim/state';
import { runTick } from '../src/sim/tick';
import { changeZone } from '../src/sim/zones';
import { xpForLevel } from '../src/sim/xp';
import { content, give, messages, newGame, objectOf, runUntil, treasuryGrid } from './helpers';

const talkTo = (npcDef: string) => (state: ReturnType<typeof newGame>['state']) => {
  const npc = state.zone.npcs.find((n) => n.defId === npcDef)!;
  return [{ type: 'interact' as const, targetId: npc.id, action: 'Talk-to' }];
};

describe('tutorial', () => {
  it('starts active, points at Morelight, and pays for steps in any order', () => {
    const { state, ctx } = newGame();
    expect(currentHint(state, ctx)).toMatchObject({
      questName: 'Empty Treasury',
      npc: 'npc_morelight',
    });

    // Do a later step first: talk to the Sysadmin, get a pick.
    runUntil(state, ctx, () => state.player.dialogue !== null, talkTo('npc_sysadmin')(state));
    expect(state.player.quests.quest_tutorial.done).toContain('talk_sysadmin');
    expect(countItem(state.player.inventory, 'item_pick_rusty')).toBe(1);
    expect(currentHint(state, ctx)?.npc).toBe('npc_morelight');

    state.player.dialogue = null;
    runUntil(state, ctx, () => state.player.dialogue !== null, talkTo('npc_morelight')(state));
    expect(currentHint(state, ctx)?.npc).toBe('npc_treasurer');
    state.player.dialogue = null;
    runUntil(state, ctx, () => state.player.dialogue !== null, talkTo('npc_treasurer')(state));
    expect(state.player.currencies.bitcoin).toBeGreaterThan(0);
    expect(currentHint(state, ctx)?.object).toBe('obj_rack_dusty');
  });

  it('the training yard has weak, passive monsters you can walk up to', () => {
    const { state, ctx } = newGame();
    const grid = treasuryGrid(ctx);
    for (const id of ['enemy_spam_bot', 'enemy_sludgeling', 'enemy_comment_troll']) {
      const def = content().enemies.get(id)!;
      expect(def.aggressive).toBe(false);
      expect(def.level).toBeLessThanOrEqual(4);
      const spawned = state.zone.enemies.filter((e) => e.defId === id);
      expect(spawned.length).toBeGreaterThanOrEqual(3);
      for (const e of spawned) {
        const goals = interactionTiles(grid, { x: e.x, y: e.y, width: 1, height: 1 });
        expect(findPath(grid, state.player.pos, goals).complete).toBe(true);
      }
    }
  });

  it('completes when every step is done and pays the completion reward', () => {
    const { state, ctx } = newGame();
    const quest = content().quests.get('quest_tutorial')!;
    state.player.quests.quest_tutorial.done = quest.steps
      .map((s) => s.id)
      .filter((id) => id !== 'trenches');
    const before = state.player.currencies.bitcoin;
    const events: never[] = [];
    changeZone(state, ctx, 'zone_trenches', { x: 20, y: 120 }, events);
    expect(state.player.quests.quest_tutorial.complete).toBe(true);
    expect(state.player.currencies.bitcoin).toBeGreaterThan(before);
  });
});

describe('quest-aware dialogue, Morelight and the quest list', () => {
  const talk = (state: GameState, ctx: SimContext, npcDef: string) => {
    state.player.dialogue = null;
    runUntil(state, ctx, () => state.player.dialogue !== null, talkTo(npcDef)(state));
    return state.player.dialogue!.lines;
  };

  it('NPCs switch to new lines once their quest is complete', () => {
    const { state } = newGame();
    const sergeant = content().npcs.get('npc_drill_sergeant')!;
    expect(npcLines(state.player, sergeant, content())).toBe(sergeant.lines);
    state.player.quests.quest_tutorial.complete = true;
    expect(npcLines(state.player, sergeant, content())).toBe(sergeant.dialogue[0].lines);
    expect(sergeant.dialogue[0].lines).not.toEqual(sergeant.lines);
  });

  it('the talk that finishes a quest already uses the after-quest lines', () => {
    const { state, ctx } = newGame();
    const contractor = content().npcs.get('npc_contractor')!;
    expect(talk(state, ctx, 'npc_contractor')).toEqual(contractor.lines); // materials missing
    give(state, 'item_scrap_hash', 10);
    give(state, 'item_tp_soundbite', 2);
    expect(talk(state, ctx, 'npc_contractor')).toEqual(contractor.dialogue[0].lines);
    expect(state.player.quests.quest_bunker.complete).toBe(true);
  });

  it("dialogue includes the player's own replies", () => {
    const { state, ctx } = newGame();
    const lines = talk(state, ctx, 'npc_morelight');
    expect(lines.some((l) => typeof l === 'object' && l.player.length > 0)).toBe(true);
    expect(lines.some((l) => typeof l === 'string')).toBe(true);
  });

  it('Morelight guides the tutorial: his lines follow the next step', () => {
    const { state, ctx } = newGame();
    const first = talk(state, ctx, 'npc_morelight');
    state.player.quests.quest_tutorial.done.push('talk_treasurer');
    const second = talk(state, ctx, 'npc_morelight');
    expect(second).not.toEqual(first);
    const morelight = content().npcs.get('npc_morelight')!;
    const variant = morelight.dialogue.find((d) => d.step?.includes('talk_sysadmin'));
    expect(second).toBe(variant!.lines);
  });

  it('Morelight only offers the main quests in order, after the tutorial', () => {
    const { state, ctx } = newGame();
    talk(state, ctx, 'npc_morelight');
    expect(state.player.quests.quest_sludge_duty).toBeUndefined();

    state.player.quests.quest_tutorial.complete = true;
    talk(state, ctx, 'npc_morelight');
    expect(state.player.quests.quest_sludge_duty).toEqual({ done: ['briefing'], complete: false });
    expect(state.player.quests.quest_name_calling).toBeUndefined();
    expect(currentHint(state, ctx)).toMatchObject({ questName: 'Sludge Duty', npc: 'npc_scout' });
  });

  it('plays Sludge Duty end to end, then opens Name Calling on the next talk', () => {
    const { state, ctx } = newGame();
    state.player.quests.quest_tutorial.complete = true;
    talk(state, ctx, 'npc_morelight');

    changeZone(state, ctx, 'zone_trenches', { x: 18, y: 119 }, []);
    const scout = content().npcs.get('npc_scout')!;
    expect(talk(state, ctx, 'npc_scout')).toBe(scout.dialogue[0].lines);
    expect(currentHint(state, ctx)?.enemy).toBe('enemy_sludge_mother');

    const events: SimEvent[] = [];
    progressQuests(state, ctx, { type: 'kill', enemy: 'enemy_sludge_mother' }, events);
    changeZone(state, ctx, 'zone_treasury', { x: 28, y: 30 }, events);
    const before = state.player.currencies.bitcoin;
    const lines = talk(state, ctx, 'npc_morelight');
    expect(state.player.quests.quest_sludge_duty.complete).toBe(true);
    expect(state.player.currencies.bitcoin).toBeGreaterThan(before);
    expect(lines.join(' ')).toMatch(/Sludge Mother is gone/);
    expect(state.player.quests.quest_name_calling).toBeUndefined();

    talk(state, ctx, 'npc_morelight');
    expect(state.player.quests.quest_name_calling?.done).toEqual(['briefing']);
  });

  it('counts quest points like OSRS', () => {
    const { state, ctx } = newGame();
    const total = [...content().quests.values()].reduce((sum, q) => sum + q.points, 0);
    expect(questPoints(state.player, ctx)).toEqual({ earned: 0, total });
    state.player.quests.quest_bunker = { done: [], complete: true };
    expect(questPoints(state.player, ctx).earned).toBe(
      content().quests.get('quest_bunker')!.points,
    );
  });
});

describe('Bunker Down and Construction', () => {
  it('the hatch is sealed until the quest is done', () => {
    const { state, ctx } = newGame();
    const hatch = objectOf(state, 'obj_bunker_hatch');
    state.player.pos = { x: hatch.x, y: hatch.y + 1 };
    const events = runTick(state, ctx, [
      { type: 'interact', targetId: hatch.id, action: 'Climb-down' },
    ]);
    expect(messages(events)[0]).toMatch(/sealed/);
    expect(state.zone.id).toBe('zone_treasury');
  });

  it('delivering the materials unlocks the bunker and pays a toolkit', () => {
    const { state, ctx } = newGame();
    give(state, 'item_scrap_hash', 10);
    give(state, 'item_tp_soundbite', 2);
    const events = runUntil(
      state,
      ctx,
      () => state.player.dialogue !== null,
      talkTo('npc_contractor')(state),
    );
    expect(messages(events)).toContain('Quest started: Bunker Down');
    expect(state.player.quests.quest_bunker.complete).toBe(true);
    expect(state.player.unlocks).toContain('bunker');
    expect(countItem(state.player.inventory, 'item_scrap_hash')).toBe(0);
    expect(countItem(state.player.inventory, 'item_toolkit_basic')).toBe(1);
    expect(state.player.skills.construction).toBe(100);

    const hatch = objectOf(state, 'obj_bunker_hatch');
    state.player.dialogue = null;
    state.player.pos = { x: hatch.x, y: hatch.y + 1 };
    runTick(state, ctx, [{ type: 'interact', targetId: hatch.id, action: 'Climb-down' }]);
    expect(state.zone.id).toBe('zone_bunker');
  });

  it('builds need level, toolkit tier and materials; built stations work', () => {
    const { state, ctx } = newGame();
    state.player.unlocks.push('bunker');
    changeZone(state, ctx, 'zone_bunker', { x: 10, y: 11 }, []);
    const spot = objectOf(state, 'obj_hotspot_storage');
    state.player.pos = { x: spot.x, y: spot.y + 1 };
    runTick(state, ctx, [{ type: 'interact', targetId: spot.id, action: 'Build' }]);
    expect(state.player.interface).toEqual({ kind: 'build', targetId: spot.id });

    let events = runTick(state, ctx, [{ type: 'build', buildId: 'build_locker' }]);
    expect(messages(events)).toContain('Needs a tier 1 toolkit.');
    give(state, 'item_toolkit_basic');
    give(state, 'item_scrap_hash', 5);
    give(state, 'item_concrete_bag', 1);
    events = runTick(state, ctx, [{ type: 'build', buildId: 'build_locker' }]);
    expect(messages(events)).toContain('You build a Storage Locker.');
    expect(state.player.bunker[hotspotKey('zone_bunker', spot)]).toBe('build_locker');

    runTick(state, ctx, [{ type: 'interact', targetId: spot.id, action: 'Open' }]);
    expect(state.player.interface).toEqual({ kind: 'bank' });
  });

  it('server farms fill up over time and are collected', () => {
    const { state, ctx } = newGame();
    changeZone(state, ctx, 'zone_bunker', { x: 10, y: 11 }, []);
    const farm = objectOf(state, 'obj_hotspot_farm');
    const key = hotspotKey('zone_bunker', farm);
    state.player.bunker[key] = 'build_farm_1';
    state.player.collected[key] = state.tick;
    state.player.pos = { x: farm.x, y: farm.y + 1 };
    for (let i = 0; i < 160; i++) runTick(state, ctx, []);
    runTick(state, ctx, [{ type: 'interact', targetId: farm.id, action: 'Collect' }]);
    expect(countItem(state.player.inventory, 'item_scrap_hash')).toBe(3);
  });
});

describe('Summoning', () => {
  it('needs the level, consumes the contract, and follows the player', () => {
    const { state, ctx } = newGame();
    give(state, 'contract_medic');
    const events = runTick(state, ctx, [{ type: 'summon', slot: 0 }]);
    expect(messages(events)).toContain(
      'You need a Summoning level of 10 to summon a Sproto Medic.',
    );
    give(state, 'contract_recruit');
    runTick(state, ctx, [{ type: 'summon', slot: 1 }]);
    expect(state.player.sproto?.defId).toBe('sp_recruit');
    expect(state.player.inventory[1]).toBeNull();
    expect(state.player.skills.summoning).toBe(25);

    runUntil(state, ctx, () => state.player.path.length === 0, [{ type: 'walk', x: 27, y: 40 }]);
    for (let i = 0; i < 5; i++) runTick(state, ctx, []);
    const s = state.player.sproto!;
    expect(Math.max(Math.abs(s.x - 27), Math.abs(s.y - 40))).toBeLessThanOrEqual(1);
  });

  it('assists in fights and earns Summoning XP from damage', () => {
    const { state, ctx } = newGame(8);
    give(state, 'contract_recruit');
    runTick(state, ctx, [{ type: 'summon', slot: 0 }]);
    const target = state.zone.enemies.find((e) => e.defId === 'enemy_sludgeling')!;
    state.player.pos = { x: 9, y: 42 };
    const xpBefore = state.player.skills.summoning;
    let sprotoShot = false;
    for (let i = 0; i < 200 && !sprotoShot; i++) {
      const ev = runTick(
        state,
        ctx,
        i === 0 ? [{ type: 'interact', targetId: target.id, action: 'Attack' }] : [],
      );
      sprotoShot = ev.some(
        (e) => e.type === 'attack' && e.attackerId === 'sproto' && e.style === 'gun',
      );
    }
    expect(sprotoShot).toBe(true);
    expect(state.player.skills.summoning).toBeGreaterThanOrEqual(xpBefore);
  });

  it('specials cost points; Taunt pulls enemies off the player', () => {
    const { state, ctx } = newGame();
    state.player.skills.summoning = xpForLevel(20);
    give(state, 'contract_grunt');
    runTick(state, ctx, [{ type: 'summon', slot: 0 }]);
    const e = newEnemy(
      'e900',
      'enemy_heckler',
      state.player.pos.x + 2,
      state.player.pos.y,
      content(),
      true,
    );
    e.target = 'player';
    state.zone.enemies.push(e);
    const points = state.player.summoning.points;
    runTick(state, ctx, [{ type: 'special' }]);
    expect(e.target).toBe('sproto');
    expect(state.player.summoning.points).toBeLessThan(points);
    state.player.summoning.points = 0;
    const events = runTick(state, ctx, [{ type: 'special' }]);
    expect(messages(events)[0]).toMatch(/needs \d+ Summoning points/);
  });

  it('expires after its tour of duty', () => {
    const { state, ctx } = newGame();
    give(state, 'contract_recruit');
    runTick(state, ctx, [{ type: 'summon', slot: 0 }]);
    state.player.sproto!.expiresAt = state.tick + 1;
    runTick(state, ctx, []);
    expect(state.player.sproto).toBeNull();
    expect(SUMMONING.durationTicks).toBeGreaterThan(0);
  });
});

describe('zones', () => {
  it('portals move you between zones and keep the old zone around', () => {
    const { state, ctx } = newGame();
    const entrance = objectOf(state, 'obj_trench_entrance');
    state.player.pos = { x: entrance.x, y: entrance.y - 1 };
    const events = runTick(state, ctx, [
      { type: 'interact', targetId: entrance.id, action: 'Enter' },
    ]);
    expect(events).toContainEqual({ type: 'zoneChanged', zoneId: 'zone_trenches' });
    expect(state.zone.id).toBe('zone_trenches');
    expect(state.player.pos).toEqual({ x: 20, y: 120 });
    expect(state.otherZones.zone_treasury).toBeDefined();
    expect(state.player.quests.quest_tutorial.done).toContain('trenches');
  });
});
