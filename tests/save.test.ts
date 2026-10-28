import { describe, expect, it } from 'vitest';
import { deserialize, migrate, SAVE_VERSION, serialize } from '../src/sim/save';
import { runTick } from '../src/sim/tick';
import { xpForLevel } from '../src/sim/xp';
import { content, newGame } from './helpers';

/** Plays a bit so the save has non-default data, ending idle. */
function playedGame() {
  const { state, ctx } = newGame(31337);
  const rack = state.zone.objects.find((o) => o.x === 27 && o.y === 27)!;
  for (let i = 0; i < 120; i++) {
    const intents = state.player.action
      ? []
      : [{ type: 'interact' as const, targetId: rack.id, action: 'Mine' }];
    runTick(state, ctx, rack.depletedUntil === null ? intents : []);
  }
  runTick(state, ctx, [{ type: 'walk', x: 25, y: 30 }]);
  for (let i = 0; i < 15; i++) runTick(state, ctx, []);
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
    expect(loaded.player.skills).toEqual(state.player.skills);
    expect(loaded.player.runEnergy).toBe(state.player.runEnergy);
    expect(loaded.economy).toEqual(state.economy);
    expect(loaded.zone.objects.map((o) => o.depletedUntil)).toEqual(
      state.zone.objects.map((o) => o.depletedUntil),
    );
    expect(loaded.player.skills.mining).toBeGreaterThan(0);
  });

  it('continues deterministically after a reload', () => {
    const { state, ctx } = playedGame();
    const loaded = deserialize(roundTrip(serialize(state, 1)), content())!;
    for (let i = 0; i < 50; i++) {
      runTick(state, ctx, []);
      runTick(loaded, ctx, []);
    }
    expect(loaded.economy.history).toEqual(state.economy.history);
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
    const save = serialize(state, 1);
    expect(deserialize({ ...save, zoneId: 'zone_atlantis' }, content())).toBeNull();
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
    save.player.pos = { x: 6, y: 3 }; // a wall
    const loaded = deserialize(roundTrip(save), content())!;
    expect(loaded.player.pos).toEqual(content().zones.get('zone_treasury')!.spawn);
  });

  it('does not save transient movement state', () => {
    const { state, ctx } = newGame();
    runTick(state, ctx, [{ type: 'walk', x: 19, y: 38 }]);
    const loaded = deserialize(roundTrip(serialize(state, 1)), content())!;
    expect(loaded.player.path).toEqual([]);
    expect(loaded.player.action).toBeNull();
  });
});
