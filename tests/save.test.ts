import { describe, expect, it } from 'vitest';
import { deserialize, migrate, SAVE_VERSION, serialize } from '../src/sim/save';
import { runTick } from '../src/sim/tick';
import { xpForLevel } from '../src/sim/xp';
import { content, give, newGame, objectOf } from './helpers';

/** Plays a bit so the save has non-default data, ending idle. */
function playedGame() {
  const { state, ctx } = newGame(31337);
  give(state, 'item_pick_rusty');
  const rack = objectOf(state, 'obj_rack_dusty', 36, 28);
  for (let i = 0; i < 120; i++) {
    const intents = state.player.action
      ? []
      : [{ type: 'interact' as const, targetId: rack.id, action: 'Mine' }];
    runTick(state, ctx, rack.depletedUntil === null ? intents : []);
  }
  runTick(state, ctx, [{ type: 'walk', x: 33, y: 33 }]);
  for (let i = 0; i < 15; i++) runTick(state, ctx, []);
  state.player.unlocks.push('bunker');
  state.player.quests.quest_tutorial.done.push('talk_treasurer');
  state.player.bunker['zone_bunker:o1'] = 'build_locker';
  state.player.equipment.weapon = { itemId: 'gun_campaign_pistol', qty: 1 };
  state.player.equipment.ammo = { itemId: 'item_rounds', qty: 120 };
  state.player.hp = 7;
  return { state, ctx };
}

const roundTrip = (data: unknown) => JSON.parse(JSON.stringify(data));

describe('save / load', () => {
  it('round-trips the persistent state', () => {
    const { state } = playedGame();
    const loaded = deserialize(roundTrip(serialize(state, 1)), content())!;
    expect(loaded).not.toBeNull();
    expect(loaded.tick).toBe(state.tick);
    expect(loaded.rng).toEqual(state.rng);
    expect(loaded.player.pos).toEqual(state.player.pos);
    expect(loaded.player.inventory).toEqual(state.player.inventory);
    expect(loaded.player.equipment).toEqual(state.player.equipment);
    expect(loaded.player.skills).toEqual(state.player.skills);
    expect(loaded.player.hp).toBe(7);
    expect(loaded.player.quests).toEqual(state.player.quests);
    expect(loaded.player.unlocks).toEqual(['bunker']);
    expect(loaded.player.bunker).toEqual({ 'zone_bunker:o1': 'build_locker' });
    expect(loaded.economy).toEqual(state.economy);
    expect(loaded.zone.objects.map((o) => o.depletedUntil)).toEqual(
      state.zone.objects.map((o) => o.depletedUntil),
    );
    expect(loaded.player.skills.mining).toBeGreaterThan(0);
  });

  it('continues deterministically after a reload', () => {
    const { state, ctx } = playedGame();
    state.zone.enemies.forEach((e) => (e.target = null));
    const loaded = deserialize(roundTrip(serialize(state, 1)), content())!;
    // Enemies and NPCs aren't saved, so reset them on the original too.
    state.zone = loaded.zone;
    const fresh = deserialize(roundTrip(serialize(state, 1)), content())!;
    for (let i = 0; i < 50; i++) {
      runTick(fresh, ctx, []);
      runTick(loaded, ctx, []);
    }
    expect(loaded.economy.history).toEqual(fresh.economy.history);
  });

  it('rejects garbage and unknown versions', () => {
    const c = content();
    expect(deserialize(null, c)).toBeNull();
    expect(deserialize('save', c)).toBeNull();
    expect(deserialize({}, c)).toBeNull();
    expect(deserialize({ version: SAVE_VERSION + 1 }, c)).toBeNull();
    expect(deserialize({ version: SAVE_VERSION, tick: 'x' }, c)).toBeNull();
    expect(migrate({ noVersion: true })).toBeNull();
  });

  it('rejects saves for unknown zones', () => {
    const { state } = newGame();
    expect(deserialize({ ...serialize(state, 1), zoneId: 'zone_atlantis' }, content())).toBeNull();
  });

  it('drops unknown items and skills, and fills in new skills', () => {
    const { state } = newGame();
    const save = serialize(state, 1);
    save.player.inventory[0] = { itemId: 'item_deleted_thing', qty: 1 };
    save.player.inventory[1] = { itemId: 'item_scrap_hash', qty: 1 };
    save.player.skills = { mining: 500, retired_skill: 999 };
    const loaded = deserialize(roundTrip(save), content())!;
    expect(loaded.player.inventory[0]).toBeNull();
    expect(loaded.player.inventory[1]).toEqual({ itemId: 'item_scrap_hash', qty: 1 });
    expect(loaded.player.skills.mining).toBe(500);
    expect(loaded.player.skills.retired_skill).toBeUndefined();
    expect(loaded.player.skills.hitpoints).toBe(xpForLevel(10));
  });

  it('moves the player to spawn if the saved tile is no longer walkable', () => {
    const { state } = newGame();
    const save = serialize(state, 1);
    save.player.pos = { x: 14, y: 3 }; // a wall
    const loaded = deserialize(roundTrip(save), content())!;
    expect(loaded.player.pos).toEqual(content().zones.get('zone_treasury')!.spawn);
  });

  it('upgrades a version 1 save (no bank) all the way', () => {
    const { state } = newGame();
    const v1 = {
      version: 1,
      savedAt: 1,
      tick: 50,
      rngState: 7,
      zoneId: 'zone_treasury',
      player: {
        pos: { x: 27, y: 31 },
        running: false,
        runEnergy: 80,
        inventory: [{ itemId: 'item_scrap_hash', qty: 1 }],
        skills: { mining: 1234, command: 500 },
        currencies: { bitcoin: 0, btc: 0 },
      },
      economy: serialize(state, 1).economy,
      objects: [],
    };
    const loaded = deserialize(v1, content())!;
    expect(loaded).not.toBeNull();
    expect(loaded.player.bank).toEqual([]);
    expect(loaded.player.skills.mining).toBe(1234);
    expect(loaded.player.skills.summoning).toBe(500); // Command became Summoning
    expect(loaded.player.hp).toBe(10);
    expect(loaded.player.quests.quest_tutorial).toEqual({ done: [], complete: false });
  });

  it('does not save transient movement state', () => {
    const { state, ctx } = newGame();
    runTick(state, ctx, [{ type: 'walk', x: 27, y: 40 }]);
    const loaded = deserialize(roundTrip(serialize(state, 1)), content())!;
    expect(loaded.player.path).toEqual([]);
    expect(loaded.player.action).toBeNull();
    expect(loaded.player.sproto).toBeNull();
  });
});
