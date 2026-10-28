/** 0.5 mechanics: drinks, teleports, using items, dialogue choices, quest drops and spawns, outfits. */
import { describe, expect, it } from 'vitest';
import { OUTFITS, TELEPORT } from '../src/config/balance';
import { effectiveLevel } from '../src/sim/boosts';
import { damageEnemy } from '../src/sim/combat';
import { xpMultiplier } from '../src/sim/equipment';
import { countItem } from '../src/sim/inventory';
import { atStep } from '../src/sim/quests';
import { newEnemy, type GameState, type SimContext } from '../src/sim/state';
import { runTick } from '../src/sim/tick';
import { changeZone } from '../src/sim/zones';
import { levelForXp, xpForLevel } from '../src/sim/xp';
import { content, give, messages, newGame, objectOf, runUntil } from './helpers';

const slotOf = (state: GameState, itemId: string) =>
  state.player.inventory.findIndex((s) => s?.itemId === itemId);

function talk(state: GameState, ctx: SimContext, npcDef: string) {
  const npc = state.zone.npcs.find((n) => n.defId === npcDef)!;
  state.player.dialogue = null;
  runUntil(state, ctx, () => state.player.dialogue !== null, [
    { type: 'interact', targetId: npc.id, action: 'Talk-to' },
  ]);
}

/** Clicks through the dialogue, picking `choice` at the first option menu. */
function answer(state: GameState, ctx: SimContext, choice: number) {
  for (let i = 0; i < 30 && state.player.dialogue; i++) {
    const d = state.player.dialogue;
    const line = d.lines[d.line];
    const intent =
      typeof line === 'object' && 'options' in line
        ? { type: 'chooseOption' as const, index: choice }
        : { type: 'continueDialogue' as const };
    runTick(state, ctx, [intent]);
  }
}

function useOn(state: GameState, ctx: SimContext, itemId: string, targetId: string) {
  return runUntil(state, ctx, () => state.player.action === null, [
    { type: 'useItem', slot: slotOf(state, itemId), targetId },
  ]);
}

describe('drinks and boosts', () => {
  it('boosts levels for a while, without stacking, then wears off', () => {
    const { state, ctx } = newGame();
    state.player.skills.shooting = xpForLevel(30);
    give(state, 'item_focus_soda', 2);
    runTick(state, ctx, [{ type: 'drink', slot: slotOf(state, 'item_focus_soda') }]);
    expect(effectiveLevel(state.player, 'shooting', state.tick)).toBe(30 + 2 + 3);
    runTick(state, ctx, [{ type: 'drink', slot: slotOf(state, 'item_focus_soda') }]);
    expect(effectiveLevel(state.player, 'shooting', state.tick)).toBe(35);
    const events = runUntil(
      state,
      ctx,
      () => !state.player.boosts.shooting,
      [],
      content().items.get('item_focus_soda')!.drink!.ticks + 5,
    );
    expect(messages(events)).toContain('Your Shooting boost has worn off.');
    expect(effectiveLevel(state.player, 'shooting', state.tick)).toBe(30);
  });

  it('an energy drink restores run energy', () => {
    const { state, ctx } = newGame();
    state.player.runEnergy = 10;
    give(state, 'item_hopium_soda');
    runTick(state, ctx, [{ type: 'drink', slot: slotOf(state, 'item_hopium_soda') }]);
    expect(state.player.runEnergy).toBeGreaterThanOrEqual(50);
  });
});

describe('teleports', () => {
  it('a ticket is used up and lands you after a short delay', () => {
    const { state, ctx } = newGame();
    give(state, 'item_ticket_trenches', 2);
    runTick(state, ctx, [{ type: 'teleport', slot: slotOf(state, 'item_ticket_trenches') }]);
    expect(state.zone.id).toBe('zone_treasury');
    expect(countItem(state.player.inventory, 'item_ticket_trenches')).toBe(1);
    for (let i = 0; i < TELEPORT.delayTicks; i++) runTick(state, ctx, []);
    expect(state.zone.id).toBe('zone_trenches');
  });

  it('needs its unlock, and reusable ones recharge instead of being used up', () => {
    const { state, ctx } = newGame();
    give(state, 'item_ticket_bunker');
    const events = runTick(state, ctx, [
      { type: 'teleport', slot: slotOf(state, 'item_ticket_bunker') },
    ]);
    expect(messages(events).join(' ')).toMatch(/haven't unlocked/);
    expect(state.player.teleport).toBeNull();

    give(state, 'item_teleprompter');
    changeZone(state, ctx, 'zone_trenches', { x: 20, y: 120 }, []);
    runTick(state, ctx, [{ type: 'teleport', slot: slotOf(state, 'item_teleprompter') }]);
    for (let i = 0; i < TELEPORT.delayTicks; i++) runTick(state, ctx, []);
    expect(state.zone.id).toBe('zone_treasury');
    expect(countItem(state.player.inventory, 'item_teleprompter')).toBe(1);
    const again = runTick(state, ctx, [
      { type: 'teleport', slot: slotOf(state, 'item_teleprompter') },
    ]);
    expect(messages(again).join(' ')).toMatch(/recharging/);
  });
});

describe('using items on things', () => {
  it('says "Nothing interesting happens." when nothing does', () => {
    const { state, ctx } = newGame();
    give(state, 'item_tp_soundbite');
    const rack = objectOf(state, 'obj_rack_dusty', 36, 28);
    const events = useOn(state, ctx, 'item_tp_soundbite', rack.id);
    expect(messages(events)).toContain('Nothing interesting happens.');
    expect(countItem(state.player.inventory, 'item_tp_soundbite')).toBe(1);
  });
});

describe('Server Meltdown: use, quest spawns and a password choice', () => {
  it('plays end to end', () => {
    const { state, ctx } = newGame(8);
    state.player.quests.quest_tutorial.complete = true;
    talk(state, ctx, 'npc_sysadmin');
    expect(countItem(state.player.inventory, 'item_empty_canister')).toBe(1);

    const rogue = state.zone.enemies.find((e) => e.defId === 'enemy_rogue_process')!;
    runTick(state, ctx, []);
    expect(rogue.respawnAt).not.toBeNull(); // dormant until its step

    useOn(state, ctx, 'item_empty_canister', objectOf(state, 'obj_statue_gremlin').id);
    expect(countItem(state.player.inventory, 'item_coolant_canister')).toBe(1);
    useOn(state, ctx, 'item_coolant_canister', objectOf(state, 'obj_rack_liquid', 16, 6).id);
    expect(atStep(state.player, ctx.content, 'quest_server_meltdown', 'rogue')).toBe(true);

    runUntil(state, ctx, () => rogue.respawnAt === null);
    state.player.skills.shooting = xpForLevel(70);
    state.player.skills.hitpoints = xpForLevel(99);
    // It patches itself between single shots; rapid fire floods it.
    state.player.equipment.weapon = { itemId: 'gun_press_pass_smg', qty: 1 };
    state.player.equipment.ammo = { itemId: 'item_rounds', qty: 500 };
    runUntil(
      state,
      ctx,
      (ev) => {
        state.player.hp = 99;
        return ev.some((e) => e.type === 'death' && e.entityId === rogue.id);
      },
      [{ type: 'interact', targetId: rogue.id, action: 'Attack' }],
      2000,
    );

    talk(state, ctx, 'npc_sysadmin');
    answer(state, ctx, 0); // "password123": wrong
    expect(state.player.quests.quest_server_meltdown.complete).toBe(false);
    talk(state, ctx, 'npc_sysadmin');
    answer(state, ctx, 1); // Lord Fluffington the Third
    expect(state.player.quests.quest_server_meltdown.complete).toBe(true);
    expect(countItem(state.player.inventory, 'item_coordinates_drive')).toBe(1);
    expect(countItem(state.player.inventory, 'item_pick_overclocked')).toBe(1);
    for (let i = 0; i < 5; i++) runTick(state, ctx, []);
    expect(rogue.respawnAt).not.toBeNull(); // gone again once the quest moved on
  });
});

describe('quest-only drops and branching choices', () => {
  it('Paper-Hands drop the negatives only during Hostile Takeover, and the choice changes the reward', () => {
    const { state, ctx } = newGame(4);
    state.player.quests.quest_tutorial.complete = true;
    talk(state, ctx, 'npc_fixer');
    expect(state.player.quests.quest_hostile_takeover).toBeUndefined(); // the Paper-Hands are past the Sludge Mother
    state.player.quests.quest_sludge_duty = { done: [], complete: true, choices: [] };
    talk(state, ctx, 'npc_fixer');
    useOn(state, ctx, 'item_sealed_envelope', objectOf(state, 'obj_lobbyist_broker').id);
    expect(countItem(state.player.inventory, 'item_blackmail_photo')).toBe(1);

    changeZone(state, ctx, 'zone_trenches', { x: 20, y: 76 }, []);
    state.player.skills.shooting = xpForLevel(80);
    state.player.skills.hitpoints = xpForLevel(99);
    state.player.equipment.weapon = { itemId: 'gun_treasury_rifle', qty: 1 };
    state.player.equipment.ammo = { itemId: 'item_rounds', qty: 2000 };
    for (
      let i = 0;
      i < 40 && !state.zone.groundItems.some((g) => g.itemId === 'item_photo_negatives');
      i++
    ) {
      const goblin = newEnemy(`q${i}`, 'enemy_paper_hands', 20, 74, content(), true);
      state.zone.enemies.push(goblin);
      runUntil(
        state,
        ctx,
        (ev) => {
          state.player.hp = 99;
          return ev.some((e) => e.type === 'death' && e.entityId === goblin.id);
        },
        [{ type: 'interact', targetId: goblin.id, action: 'Attack' }],
        400,
      );
    }
    const drop = state.zone.groundItems.find((g) => g.itemId === 'item_photo_negatives')!;
    expect(drop).toBeDefined();
    runUntil(state, ctx, () => countItem(state.player.inventory, 'item_photo_negatives') > 0, [
      { type: 'interact', targetId: drop.id, action: 'Take' },
    ]);

    changeZone(state, ctx, 'zone_treasury', { x: 44, y: 22 }, []);
    const before = state.player.currencies.bitcoin;
    talk(state, ctx, 'npc_fixer');
    answer(state, ctx, 1); // use them on the Broker
    expect(atStep(state.player, ctx.content, 'quest_hostile_takeover', 'raider')).toBe(true);
    runTick(state, ctx, []);
    const raider = state.zone.enemies.find((e) => e.defId === 'enemy_corporate_raider')!;
    runTick(state, ctx, []);
    expect(raider.respawnAt).toBeNull();
    damageEnemy(state, ctx, raider, 9999, []);
    expect(state.player.quests.quest_hostile_takeover).toMatchObject({
      complete: true,
      choices: ['takeover_leverage'],
    });
    expect(state.player.currencies.bitcoin).toBeGreaterThan(before);
    expect(countItem(state.player.inventory, 'item_exit_permit')).toBe(1);
    const fixer = content().npcs.get('npc_fixer')!;
    talk(state, ctx, 'npc_fixer');
    expect(state.player.dialogue!.lines).toBe(
      fixer.dialogue.find((d) => d.choice === 'takeover_leverage')!.lines,
    );
  });
});

describe('outfits and new slots', () => {
  it('each outfit piece adds XP, and the full set adds a bonus', () => {
    const { state, ctx } = newGame();
    const set = ['item_hard_hat', 'item_hi_vis_vest', 'item_work_trousers', 'item_steel_toe_boots'];
    let pct = 0;
    for (const id of set) {
      const def = content().items.get(id)!;
      state.player.equipment[def.equip!.slot] = { itemId: id, qty: 1 };
      pct += def.xpBonus!.pct;
    }
    expect(xpMultiplier(state.player, ctx, 'mining')).toBeCloseTo(
      1 + (pct + OUTFITS.setBonusPct) / 100,
    );
    expect(xpMultiplier(state.player, ctx, 'fundraising')).toBe(1);
  });

  it('neck, hands and feet items can be worn', () => {
    const { state, ctx } = newGame();
    for (const id of ['item_press_lanyard', 'item_grip_gloves', 'item_campaign_loafers']) {
      give(state, id);
      runTick(state, ctx, [{ type: 'equip', slot: slotOf(state, id) }]);
    }
    expect(state.player.equipment.neck?.itemId).toBe('item_press_lanyard');
    expect(state.player.equipment.hands?.itemId).toBe('item_grip_gloves');
    expect(state.player.equipment.feet?.itemId).toBe('item_campaign_loafers');
  });
});

describe('The Way Out', () => {
  it('needs every other quest, then ends by stepping through the Teleport Chamber', () => {
    const { state, ctx } = newGame();
    const done = { done: [], complete: true, choices: [] };
    for (const q of ['quest_tutorial', 'quest_bunker', 'quest_sludge_duty', 'quest_name_calling']) {
      state.player.quests[q] = { ...done };
    }
    talk(state, ctx, 'npc_morelight');
    expect(state.player.quests.quest_way_out).toBeUndefined();
    for (const q of [
      'quest_motion_denied',
      'quest_server_meltdown',
      'quest_gala_night',
      'quest_hostile_takeover',
      'quest_press_conference',
    ]) {
      state.player.quests[q] = { ...done };
    }
    for (const id of [
      'item_coordinates_drive',
      'item_power_cell',
      'item_exit_permit',
      'item_press_release',
    ])
      give(state, id);
    give(state, 'item_scrap_hash', 20);
    talk(state, ctx, 'npc_morelight');
    expect(state.player.quests.quest_way_out.done).toEqual(['briefing']);
    answer(state, ctx, 0); // "Let's get out of here."
    useOn(
      state,
      ctx,
      'item_press_release',
      state.zone.npcs.find((n) => n.defId === 'npc_reporter')!.id,
    );
    talk(state, ctx, 'npc_contractor');
    expect(countItem(state.player.inventory, 'item_chamber_blueprints')).toBe(1);

    state.player.unlocks.push(
      'boss:enemy_sludge_mother',
      'boss:enemy_wrongnamer_chief',
      'boss:enemy_captain_motion',
    );
    changeZone(state, ctx, 'zone_trenches', { x: 20, y: 6 }, []);
    // The north end's level-80 guards would eat a test President; keep only the Warden.
    state.zone.enemies = state.zone.enemies.filter((e) => e.defId === 'enemy_lockdown_warden');
    const chamber = objectOf(state, 'obj_teleport_chamber');
    expect(
      messages(
        runUntil(state, ctx, () => state.player.action === null, [
          { type: 'interact', targetId: chamber.id, action: 'Enter' },
        ]),
      ).join(' '),
    ).toMatch(/sealed/);
    for (const id of [
      'item_chamber_blueprints',
      'item_coordinates_drive',
      'item_power_cell',
      'item_exit_permit',
    ]) {
      useOn(state, ctx, id, chamber.id);
    }
    useOn(state, ctx, 'item_scrap_hash', chamber.id);
    expect(countItem(state.player.inventory, 'item_scrap_hash')).toBe(0);
    expect(state.player.unlocks).not.toContain('chamber_ready'); // the Lockdown stands up first
    runTick(state, ctx, []);
    runTick(state, ctx, []);
    const warden = state.zone.enemies.find((e) => e.defId === 'enemy_lockdown_warden')!;
    expect(warden.respawnAt).toBeNull();
    damageEnemy(state, ctx, warden, 9999, []);
    expect(state.player.unlocks).toContain('chamber_ready');
    runUntil(state, ctx, () => state.zone.id === 'zone_outside', [
      { type: 'interact', targetId: chamber.id, action: 'Enter' },
    ]);
    expect(state.player.quests.quest_way_out.complete).toBe(true);
    expect(countItem(state.player.inventory, 'item_chamber_key')).toBe(1);
    expect(levelForXp(state.player.skills.lobbying)).toBeGreaterThan(1);
  });
});
