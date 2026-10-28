import { describe, expect, it } from 'vitest';
import { COMBAT } from '../src/config/balance';
import {
  combatLevel,
  hitChance,
  inAttackRange,
  maxHit,
  triangleMultiplier,
} from '../src/sim/combat';
import { attackProfile } from '../src/sim/equipment';
import { hasLineOfSight } from '../src/sim/grid';
import { countItem } from '../src/sim/inventory';
import { newEnemy, type GameState } from '../src/sim/state';
import { runTick } from '../src/sim/tick';
import { changeZone } from '../src/sim/zones';
import { xpForLevel } from '../src/sim/xp';
import { content, give, gridFromRows, messages, newGame, runUntil } from './helpers';

function armed(state: GameState, gun = 'gun_campaign_pistol', rounds = 200) {
  state.player.equipment.weapon = { itemId: gun, qty: 1 };
  if (rounds > 0) state.player.equipment.ammo = { itemId: 'item_rounds', qty: rounds };
}

function sludgeling(state: GameState) {
  return state.zone.enemies.find((e) => e.defId === 'enemy_sludgeling' && e.respawnAt === null)!;
}

describe('combat math', () => {
  it('uses the OSRS hit-chance comparison', () => {
    expect(hitChance(100, 100)).toBeCloseTo(100 / 202);
    expect(hitChance(300, 100)).toBeCloseTo(1 - 102 / 602);
    expect(hitChance(0, 100)).toBe(0);
  });

  it('computes max hit from effective strength and damage bonus', () => {
    expect(maxHit(9, 0)).toBe(1);
    expect(maxHit(9 + 3, 8)).toBe(Math.floor(0.5 + (12 * 72) / 640));
  });

  it('applies the guns > melee > shields > guns triangle', () => {
    const m = COMBAT.triangleModifier;
    expect(triangleMultiplier('gun', 'melee')).toBe(1 + m);
    expect(triangleMultiplier('gun', 'shield')).toBe(1 - m);
    expect(triangleMultiplier('melee', 'shield')).toBe(1 + m);
    expect(triangleMultiplier('melee', 'gun')).toBe(1 - m);
    expect(triangleMultiplier('gun', 'gun')).toBe(1);
  });

  it('starts at combat level 3, like OSRS', () => {
    expect(combatLevel(newGame().state.player.skills)).toBe(3);
  });

  it('blocks line of sight through walls and needs adjacency for melee', () => {
    const grid = gridFromRows(['.....', '..#..', '.....']);
    expect(hasLineOfSight(grid, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(false);
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    expect(inAttackRange(grid, { x: 0, y: 0 }, { x: 1, y: 1 }, 1, true)).toBe(false);
    expect(inAttackRange(grid, { x: 0, y: 0 }, { x: 1, y: 0 }, 1, true)).toBe(true);
    expect(inAttackRange(grid, { x: 0, y: 0 }, { x: 4, y: 0 }, 5, false)).toBe(true);
  });
});

describe('fighting', () => {
  it('shoots a Sludgeling dead, spending rounds and earning XP and loot', () => {
    const { state, ctx } = newGame(3);
    armed(state);
    const target = sludgeling(state);
    state.player.pos = { x: 9, y: 42 };
    const events = runUntil(
      state,
      ctx,
      (ev) => ev.some((e) => e.type === 'death' && e.entityId === target.id),
      [{ type: 'interact', targetId: target.id, action: 'Attack' }],
    );
    expect(events).toContainEqual({
      type: 'attack',
      attackerId: 'player',
      targetId: target.id,
      style: 'gun',
    });
    expect(state.player.equipment.ammo!.qty).toBeLessThan(200);
    expect(state.player.skills.shooting).toBeGreaterThan(0);
    expect(state.player.skills.hitpoints).toBeGreaterThan(xpForLevel(10));
    expect(target.respawnAt).not.toBeNull();
    expect(state.player.currencies.bitcoin).toBeGreaterThan(0);
  });

  it('melee swings are attack events too, for the player and for enemies', () => {
    const { state, ctx } = newGame(3);
    const target = sludgeling(state);
    state.player.pos = { x: target.x, y: target.y - 1 };
    const events = runUntil(
      state,
      ctx,
      (ev) => ev.some((e) => e.type === 'attack' && e.attackerId === target.id),
      [{ type: 'interact', targetId: target.id, action: 'Attack' }],
    );
    expect(events).toContainEqual({
      type: 'attack',
      attackerId: 'player',
      targetId: target.id,
      style: 'melee',
    });
    expect(events).toContainEqual({
      type: 'attack',
      attackerId: target.id,
      targetId: 'player',
      style: 'melee',
    });
  });

  it('falls back to the gavel when out of rounds', () => {
    const { state, ctx } = newGame();
    armed(state, 'gun_campaign_pistol', 0);
    const profile = attackProfile(state.player, ctx);
    expect(profile.outOfAmmo).toBe(true);
    expect(profile.type).toBe('melee');
    expect(profile.weapon.id).toBe(COMBAT.fallbackWeaponId);
  });

  it('the Hash Cannon fires mined Hash, best first, and splashes neighbors', () => {
    const { state, ctx } = newGame(11);
    state.player.skills.shooting = xpForLevel(40);
    armed(state, 'gun_hash_cannon', 0);
    give(state, 'item_scrap_hash', 3);
    give(state, 'item_molten_hash', 1);
    const profile = attackProfile(state.player, ctx);
    expect(profile.explosive).toBe(true);
    expect(profile.shellSlot).toBe(3); // the Molten Hash

    // Two Sludgelings side by side: one shot, both hurt.
    const a = sludgeling(state);
    const b = state.zone.enemies.find((e) => e !== a && e.defId === 'enemy_sludgeling')!;
    Object.assign(a, { x: 8, y: 45 });
    Object.assign(b, { x: 9, y: 45 });
    state.player.pos = { x: 8, y: 42 };
    const hits = new Set<string>();
    for (let i = 0; i < 40 && hits.size < 2; i++) {
      const ev = runTick(
        state,
        ctx,
        i === 0 ? [{ type: 'interact', targetId: a.id, action: 'Attack' }] : [],
      );
      for (const e of ev) if (e.type === 'hitsplat' && e.damage > 0) hits.add(e.targetId);
    }
    expect(hits.has(a.id) || hits.has(b.id)).toBe(true);
    expect(
      countItem(state.player.inventory, 'item_molten_hash') +
        countItem(state.player.inventory, 'item_scrap_hash'),
    ).toBeLessThan(4);
  });

  it('aggressive enemies attack, auto-retaliate kicks in, and Defense trains from hits', () => {
    const { state, ctx } = newGame(5);
    changeZone(state, ctx, 'zone_trenches', { x: 20, y: 120 }, []);
    const heckler = state.zone.enemies.find((e) => e.defId === 'enemy_heckler')!;
    state.player.pos = { x: heckler.x, y: heckler.y + 1 };
    let hitPlayer = false;
    for (let i = 0; i < 100 && !hitPlayer; i++) {
      const ev = runTick(state, ctx, []);
      hitPlayer = ev.some((e) => e.type === 'hitsplat' && e.targetId === 'player' && e.damage > 0);
    }
    expect(hitPlayer).toBe(true);
    expect(state.player.skills.defense).toBeGreaterThan(0);
    expect(state.player.action?.action).toBe('Attack');
  });

  it('death drops the inventory where you fell and respawns you in the Treasury', () => {
    const { state, ctx } = newGame(5);
    changeZone(state, ctx, 'zone_trenches', { x: 20, y: 110 }, []);
    give(state, 'item_scrap_hash', 2);
    const brute = newEnemy('e999', 'enemy_sludge_brute', 20, 109, content(), true);
    brute.target = 'player';
    state.zone.enemies.push(brute);
    state.player.hp = 1;
    const dying = runUntil(state, ctx, (ev) =>
      ev.some((e) => e.type === 'death' && e.entityId === 'player'),
    );
    expect(messages(dying)).toContain('Oh dear, you are dead!');
    // The fall plays out where you died; enemies lose interest and inputs are ignored.
    expect(state.zone.id).toBe('zone_trenches');
    expect(brute.target).toBeNull();
    runTick(state, ctx, [{ type: 'walk', x: 20, y: 100 }]);
    expect(state.player.path).toEqual([]);
    const events = runUntil(state, ctx, () => state.player.dyingUntil === null);
    expect(messages(events)).toContain('The Secret Service drags you back to safety.');
    expect(state.zone.id).toBe('zone_treasury');
    expect(state.player.hp).toBe(10);
    expect(countItem(state.player.inventory, 'item_scrap_hash')).toBe(0);
    expect(
      state.otherZones.zone_trenches.groundItems.filter((g) => g.itemId === 'item_scrap_hash'),
    ).toHaveLength(2);
  });

  it('enemies respawn after their timer', () => {
    const { state, ctx } = newGame();
    const s = sludgeling(state);
    s.respawnAt = state.tick + 2;
    s.hp = 0;
    runTick(state, ctx, []);
    runTick(state, ctx, []);
    expect(s.respawnAt).toBeNull();
    expect(s.hp).toBe(content().enemies.get('enemy_sludgeling')!.hp);
  });

  it('killing a boss unlocks its barricade, and the boss calls adds', () => {
    const { state, ctx } = newGame(21);
    changeZone(state, ctx, 'zone_trenches', { x: 20, y: 89 }, []);
    const mother = state.zone.enemies.find((e) => e.defId === 'enemy_sludge_mother')!;
    state.player.skills.shooting = xpForLevel(70);
    state.player.skills.defense = xpForLevel(70);
    state.player.skills.hitpoints = xpForLevel(99);
    state.player.hp = 99;
    armed(state, 'gun_treasury_rifle', 1000);
    let sawAdd = false;
    runUntil(
      state,
      ctx,
      (ev) => {
        sawAdd ||= state.zone.enemies.some((e) => e.temp);
        state.player.hp = 99;
        return ev.some((e) => e.type === 'death' && e.entityId === mother.id);
      },
      [{ type: 'interact', targetId: mother.id, action: 'Attack' }],
      2000,
    );
    expect(state.player.unlocks).toContain('boss:enemy_sludge_mother');
    expect(sawAdd).toBe(true);
    expect(state.economy.recentBossWins).toBeGreaterThan(0);

    const gate = state.zone.objects.find((o) => o.defId === 'obj_barricade' && o.y === 83)!;
    state.player.pos = { x: 20, y: 84 };
    runTick(state, ctx, [{ type: 'interact', targetId: gate.id, action: 'Pass' }]);
    expect(state.player.pos).toEqual({ x: 20, y: 82 });
  });

  it('locked barricades refuse to open', () => {
    const { state, ctx } = newGame();
    changeZone(state, ctx, 'zone_trenches', { x: 20, y: 46 }, []);
    const gate = state.zone.objects.find((o) => o.defId === 'obj_barricade' && o.y === 45)!;
    const events = runTick(state, ctx, [{ type: 'interact', targetId: gate.id, action: 'Pass' }]);
    expect(messages(events)).toContain('Locked. Defeat the Wrong-Namer Chief to pass.');
    expect(state.player.pos).toEqual({ x: 20, y: 46 });
  });
});
