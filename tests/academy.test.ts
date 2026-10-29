/** Moonward Academy: staffs and COOM, the Staffwright's shop, the wizards, and Moonward Enrollment. */
import { describe, expect, it } from 'vitest';
import { damageEnemy } from '../src/sim/combat';
import { attackProfile } from '../src/sim/equipment';
import { countItem } from '../src/sim/inventory';
import { findPath } from '../src/sim/pathfinding';
import { newEnemy, type GameState, type SimContext, type SimEvent } from '../src/sim/state';
import { runTick } from '../src/sim/tick';
import { changeZone } from '../src/sim/zones';
import { xpForLevel } from '../src/sim/xp';
import { content, give, newGame, objectOf, runUntil } from './helpers';

const slotOf = (state: GameState, itemId: string) =>
  state.player.inventory.findIndex((s) => s?.itemId === itemId);

function talk(state: GameState, ctx: SimContext, npcDef: string) {
  const npc = state.zone.npcs.find((n) => n.defId === npcDef)!;
  state.player.dialogue = null;
  runUntil(state, ctx, () => state.player.dialogue !== null, [
    { type: 'interact', targetId: npc.id, action: 'Talk-to' },
  ]);
}

function equip(state: GameState, ctx: SimContext, itemId: string) {
  runTick(state, ctx, [{ type: 'equip', slot: slotOf(state, itemId) }]);
}

/** Beats the first live enemy of a kind outright. */
function defeat(state: GameState, ctx: SimContext, enemyId: string): SimEvent[] {
  const enemy = state.zone.enemies.find((e) => e.defId === enemyId && e.respawnAt === null)!;
  const events: SimEvent[] = [];
  damageEnemy(state, ctx, enemy, 9999, events);
  return events;
}

const wayOutDone = (state: GameState) => {
  state.player.quests.quest_way_out = { done: [], complete: true, choices: [] };
};

describe('staffs and COOM', () => {
  it('a staff fires COOM only, and a gun fires Rounds only', () => {
    const { state, ctx } = newGame();
    give(state, 'staff_apprentice');
    equip(state, ctx, 'staff_apprentice');
    state.player.equipment.ammo = { itemId: 'item_rounds', qty: 50 };
    expect(attackProfile(state.player, ctx).outOfAmmo).toBe(true);
    state.player.equipment.ammo = { itemId: 'item_coom', qty: 50 };
    expect(attackProfile(state.player, ctx)).toMatchObject({ type: 'gun', outOfAmmo: false });

    give(state, 'gun_campaign_pistol');
    equip(state, ctx, 'gun_campaign_pistol');
    expect(attackProfile(state.player, ctx).outOfAmmo).toBe(true);
  });

  it('casts spells that use up COOM', () => {
    const { state, ctx } = newGame();
    give(state, 'staff_apprentice');
    give(state, 'item_coom', 20);
    equip(state, ctx, 'staff_apprentice');
    equip(state, ctx, 'item_coom');
    const { x, y } = state.player.pos;
    const dummy = newEnemy('dummy', 'enemy_spam_bot', x + 2, y, content(), false);
    state.zone.enemies = [dummy];
    const events = runUntil(state, ctx, (ev) => ev.some((e) => e.type === 'attack'), [
      { type: 'interact', targetId: dummy.id, action: 'Attack' },
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'attack', attackerId: 'player', style: 'magic' }),
    );
    expect(state.player.equipment.ammo?.qty).toBe(19);
  });

  it('wizard enemies cast spells too', () => {
    const { state, ctx } = newGame();
    const { x, y } = state.player.pos;
    const mage = newEnemy('mage', 'enemy_battlemage', x + 3, y, content(), false);
    state.zone.enemies = [mage];
    const events = runUntil(
      state,
      ctx,
      (ev) => ev.some((e) => e.type === 'attack' && e.attackerId === 'mage'),
      [],
    );
    expect(events).toContainEqual(expect.objectContaining({ attackerId: 'mage', style: 'magic' }));
  });
});

describe('shops', () => {
  it("the Staffwright's Stall sells staffs; the Trading Terminal doesn't", () => {
    const { state, ctx } = newGame();
    changeZone(state, ctx, 'zone_academy', content().zones.get('zone_academy')!.spawn, []);
    state.player.currencies.tickets = 78;
    const stall = objectOf(state, 'obj_staff_stall');
    runUntil(state, ctx, () => state.player.interface !== null, [
      { type: 'interact', targetId: stall.id, action: 'Trade' },
    ]);
    expect(state.player.interface).toEqual({ kind: 'terminal', shopId: 'shop_staffwright' });
    runTick(state, ctx, [{ type: 'buy', itemId: 'staff_hopium', qty: 1 }]);
    expect(countItem(state.player.inventory, 'staff_hopium')).toBe(1);
    expect(state.player.currencies.tickets).toBe(0);

    state.player.interface = { kind: 'terminal', shopId: 'shop_terminal' };
    runTick(state, ctx, [{ type: 'buy', itemId: 'staff_hopium', qty: 1 }]);
    expect(countItem(state.player.inventory, 'staff_hopium')).toBe(1);
  });
});

describe('Moonward Enrollment', () => {
  it('waits for The Way Out', () => {
    const { state, ctx } = newGame();
    changeZone(state, ctx, 'zone_academy', content().zones.get('zone_academy')!.spawn, []);
    talk(state, ctx, 'npc_archmage');
    expect(state.player.quests.quest_moonward).toBeUndefined();
  });

  it('runs from the rowboat to the Rugmancer', () => {
    const { state, ctx } = newGame();
    wayOutDone(state);
    state.player.skills.shooting = xpForLevel(60);
    changeZone(state, ctx, 'zone_outside', content().zones.get('zone_outside')!.spawn, []);
    const boat = objectOf(state, 'obj_ferry_outside');
    runUntil(state, ctx, () => state.zone.id === 'zone_academy', [
      { type: 'interact', targetId: boat.id, action: 'Board' },
    ]);

    talk(state, ctx, 'npc_archmage');
    expect(state.player.quests.quest_moonward.done).toEqual(['briefing']);
    expect(countItem(state.player.inventory, 'staff_apprentice')).toBe(1);
    expect(countItem(state.player.inventory, 'item_coom')).toBe(150);

    equip(state, ctx, 'item_coom');
    equip(state, ctx, 'staff_apprentice');
    expect(state.player.quests.quest_moonward.done).toContain('wield');

    defeat(state, ctx, 'enemy_apprentice');
    defeat(state, ctx, 'enemy_battlemage');
    const rugmancer = state.zone.enemies.find((e) => e.defId === 'enemy_rugmancer')!;
    runTick(state, ctx, []);
    expect(rugmancer.respawnAt).toBe(Infinity); // asleep in the tower until he's the job

    talk(state, ctx, 'npc_archmage');
    expect(state.player.quests.quest_moonward.done).toContain('report');
    runTick(state, ctx, []);
    runTick(state, ctx, []);
    expect(rugmancer.respawnAt).toBeNull();

    defeat(state, ctx, 'enemy_rugmancer');
    talk(state, ctx, 'npc_archmage');
    expect(state.player.quests.quest_moonward.complete).toBe(true);
    expect(countItem(state.player.inventory, 'staff_archmage')).toBe(1);
  });
});

describe('Moonward Academy map', () => {
  it('connects the dock to the hall, the stall, the library, the duelling grounds and the tower', () => {
    const { ctx } = newGame();
    const zone = content().zones.get('zone_academy')!;
    const grid = ctx.grids.get('zone_academy')!;
    for (const goal of [
      { x: 29, y: 19 }, // the Archmage
      { x: 23, y: 41 }, // the stall
      { x: 8, y: 21 }, // the library
      { x: 50, y: 20 }, // the duelling grounds
      { x: 29, y: 7 }, // the tower
    ]) {
      expect(findPath(grid, zone.spawn, [goal]).complete, JSON.stringify(goal)).toBe(true);
    }
  });
});
