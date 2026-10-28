/** OSRS behaviors from the movement and interface QA pass. */
import { describe, expect, it } from 'vitest';
import { COMBAT, ENEMIES } from '../src/config/balance';
import { withdraw } from '../src/sim/bank';
import { directStep } from '../src/sim/grid';
import { countItem } from '../src/sim/inventory';
import { deserialize, migrate, serialize } from '../src/sim/save';
import { newEnemy, type GameState } from '../src/sim/state';
import { runTick } from '../src/sim/tick';
import { changeZone } from '../src/sim/zones';
import { xpForLevel } from '../src/sim/xp';
import { content, give, gridFromRows, messages, newGame, objectOf, runUntil } from './helpers';

const attack = (targetId: string) => [{ type: 'interact' as const, targetId, action: 'Attack' }];

/** A lone enemy placed in the Trenches' open mud, with the player nearby. */
function arena(defId: string, at = { x: 20, y: 112 }) {
  const { state, ctx } = newGame(31);
  changeZone(state, ctx, 'zone_trenches', { x: at.x, y: at.y + 3 }, []);
  state.zone.enemies = [];
  const enemy = newEnemy('e900', defId, at.x, at.y, content(), false);
  state.zone.enemies.push(enemy);
  return { state, ctx, enemy };
}

function armed(state: GameState) {
  state.player.equipment.weapon = { itemId: 'gun_campaign_pistol', qty: 1 };
  state.player.equipment.ammo = { itemId: 'item_rounds', qty: 500 };
}

describe('movement', () => {
  it('sets off toward an enemy on the same tick as the click', () => {
    const { state, ctx } = newGame();
    const target = state.zone.enemies.find((e) => e.defId === 'enemy_spam_bot')!;
    const start = { ...state.player.pos };
    runTick(state, ctx, attack(target.id));
    expect(state.player.pos).not.toEqual(start);
  });

  it('a Sproto keeps pace with a running player', () => {
    const { state, ctx } = newGame();
    state.player.skills.summoning = xpForLevel(1);
    give(state, 'contract_recruit');
    runTick(state, ctx, [{ type: 'summon', slot: 0 }]);
    state.player.running = true;
    runTick(state, ctx, [{ type: 'walk', x: 27, y: 40 }]);
    for (let i = 0; i < 6; i++) {
      runTick(state, ctx, []);
      const s = state.player.sproto!;
      expect(
        Math.max(Math.abs(s.x - state.player.pos.x), Math.abs(s.y - state.player.pos.y)),
      ).toBeLessThanOrEqual(2);
    }
  });
});

describe('enemy movement', () => {
  it('steps directly toward a target, so walls stop it (safespots)', () => {
    const grid = gridFromRows(['.....', '.#...', '.#...', '.....']);
    const none = () => false;
    expect(directStep(grid, { x: 0, y: 1 }, { x: 4, y: 1 }, none)).toBeNull();
    expect(directStep(grid, { x: 2, y: 0 }, { x: 4, y: 2 }, none)).toEqual({ x: 3, y: 1 });
    // Never cuts a corner past a wall.
    expect(directStep(grid, { x: 0, y: 0 }, { x: 2, y: 1 }, none)).toEqual({ x: 1, y: 0 });
  });

  it('never chases past its leash, and does not heal instantly', () => {
    const { state, ctx, enemy } = arena('enemy_heckler');
    enemy.hp = 3;
    enemy.target = 'player';
    enemy.lastCombatTick = state.tick;
    state.player.pos = { x: 20, y: 112 - ENEMIES.leashRange - 4 };
    for (let i = 0; i < 12; i++) {
      runTick(state, ctx, []);
      expect(Math.abs(enemy.y - enemy.spawn.y)).toBeLessThanOrEqual(ENEMIES.leashRange);
    }
    expect(enemy.hp).toBeLessThanOrEqual(4);
  });

  it('gives up a fight it cannot land and walks home', () => {
    const { state, ctx, enemy } = arena('enemy_heckler');
    enemy.target = 'player';
    enemy.lastCombatTick = state.tick;
    state.player.pos = { x: 20, y: 112 - ENEMIES.leashRange - 4 };
    for (let i = 0; i < ENEMIES.giveUpTicks + 30; i++) runTick(state, ctx, []);
    expect(enemy.target).toBeNull();
    const radius = content().enemies.get('enemy_heckler')!.wanderRadius;
    expect(
      Math.max(Math.abs(enemy.x - enemy.spawn.x), Math.abs(enemy.y - enemy.spawn.y)),
    ).toBeLessThanOrEqual(radius);
  });

  it('regenerates 1 HP a minute', () => {
    const { state, ctx, enemy } = arena('enemy_heckler');
    enemy.hp = 5;
    state.player.pos = { x: 2, y: 120 };
    for (let i = 0; i < COMBAT.hpRegenEveryTicks; i++) runTick(state, ctx, []);
    expect(enemy.hp).toBe(6);
  });

  it('a ranged attacker standing on its target steps off and fights', () => {
    const { state, ctx, enemy } = arena('enemy_heckler');
    armed(state);
    state.player.pos = { x: enemy.x, y: enemy.y };
    const events = runUntil(
      state,
      ctx,
      (ev) => ev.some((e) => e.type === 'attack' && e.attackerId === 'player'),
      attack(enemy.id),
      10,
    );
    expect(messages(events)).not.toContain("I can't reach that!");
    expect(state.player.pos).not.toEqual({ x: enemy.x, y: enemy.y });
  });
});

describe('combat rules', () => {
  it('auto retaliates even while skilling, and can be turned off', () => {
    const { state, ctx, enemy } = arena('enemy_heckler');
    state.player.pos = { x: enemy.x, y: enemy.y + 1 };
    state.player.action = { targetId: 'o0', action: 'Mine', nextAttemptTick: state.tick + 99 };
    state.player.interface = { kind: 'bank' };
    runUntil(state, ctx, () => state.player.action?.action === 'Attack');
    expect(state.player.interface).toBeNull();

    const quiet = arena('enemy_heckler');
    runTick(quiet.state, quiet.ctx, [{ type: 'toggleRetaliate' }]);
    expect(quiet.state.player.autoRetaliate).toBe(false);
    quiet.state.player.pos = { x: quiet.enemy.x, y: quiet.enemy.y + 1 };
    for (let i = 0; i < 20; i++) runTick(quiet.state, quiet.ctx, []);
    expect(quiet.state.player.hp).toBeLessThan(10);
    expect(quiet.state.player.action).toBeNull();
  });

  it('single-way combat: a second enemy waits while another one has you', () => {
    const { state, ctx, enemy } = arena('enemy_heckler');
    const second = newEnemy('e901', 'enemy_heckler', enemy.x + 2, enemy.y + 1, content(), false);
    state.zone.enemies.push(second);
    state.player.pos = { x: enemy.x, y: enemy.y + 1 };
    state.player.autoRetaliate = false;
    const attackers = new Set<string>();
    for (let i = 0; i < 30; i++) {
      state.player.hp = 10; // stand there and take it
      for (const e of runTick(state, ctx, [])) {
        if (e.type === 'attack' && e.targetId === 'player') attackers.add(e.attackerId);
      }
    }
    expect(attackers.size).toBe(1);
  });

  it('food has a 3-tick delay', () => {
    const { state, ctx } = newGame();
    give(state, 'item_tp_soundbite', 3);
    state.player.hp = 2;
    const eat = () => ({
      type: 'eat' as const,
      slot: state.player.inventory.findIndex((s) => s?.itemId === 'item_tp_soundbite'),
    });
    runTick(state, ctx, [eat(), eat()]);
    expect(countItem(state.player.inventory, 'item_tp_soundbite')).toBe(2);
    runTick(state, ctx, [eat()]);
    expect(countItem(state.player.inventory, 'item_tp_soundbite')).toBe(2);
    for (let i = 0; i < COMBAT.eatDelayTicks; i++) runTick(state, ctx, []);
    runTick(state, ctx, [eat()]);
    expect(countItem(state.player.inventory, 'item_tp_soundbite')).toBe(1);
  });

  it('enemies left behind in another zone forget you', () => {
    const { state, ctx, enemy } = arena('enemy_heckler');
    enemy.target = 'player';
    changeZone(state, ctx, 'zone_treasury', { x: 46, y: 47 }, []);
    expect(state.otherZones.zone_trenches.enemies[0].target).toBeNull();
  });
});

describe('interface', () => {
  it('withdraws the clicked item even if the bank shifted under the click', () => {
    const { state } = newGame();
    state.player.bank = [
      { itemId: 'item_scrap_hash', qty: 1 },
      { itemId: 'item_tp_soundbite', qty: 5 },
    ];
    withdraw(state.player, content(), 0, 'all', [], 'item_scrap_hash');
    // The Soundbites are now at index 0; a stale "index 1" click still finds them.
    withdraw(state.player, content(), 1, 1, [], 'item_tp_soundbite');
    expect(countItem(state.player.inventory, 'item_tp_soundbite')).toBe(1);
    withdraw(state.player, content(), 0, 1, [], 'item_btc_shard');
    expect(state.player.bank).toEqual([{ itemId: 'item_tp_soundbite', qty: 4 }]);
  });

  it('says what you start doing when you start skilling', () => {
    const { state, ctx } = newGame();
    give(state, 'item_pick_rusty');
    const rack = objectOf(state, 'obj_rack_dusty', 36, 28);
    state.player.pos = { x: 35, y: 28 };
    const events = runTick(state, ctx, [{ type: 'interact', targetId: rack.id, action: 'Mine' }]);
    expect(messages(events)).toContain('You swing your pick at the rack.');
  });

  it('saves the Auto Retaliate setting, and older saves default it on', () => {
    const { state } = newGame();
    state.player.autoRetaliate = false;
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(state, 0))), content())!;
    expect(loaded.player.autoRetaliate).toBe(false);
    const v3 = { ...serialize(state, 0), version: 3 } as Record<string, unknown>;
    delete (v3.player as Record<string, unknown>).autoRetaliate;
    expect((migrate(v3) as { player: { autoRetaliate: boolean } }).player.autoRetaliate).toBe(true);
  });
});
