/** Quest items can't be lost for good: they stay with you on death, and their giver hands out another. */
import { describe, expect, it } from 'vitest';
import { countItem } from '../src/sim/inventory';
import { progressQuests } from '../src/sim/quests';
import type { GameState, SimContext, SimEvent } from '../src/sim/state';
import { changeZone, handleDeath } from '../src/sim/zones';
import { content, give, newGame } from './helpers';

const OTHERS = [
  'quest_bunker',
  'quest_motion_denied',
  'quest_server_meltdown',
  'quest_gala_night',
  'quest_hostile_takeover',
  'quest_press_conference',
];

/** A President at The Way Out's install_drive step, standing in the Treasury. */
function atInstallDrive(): { state: GameState; ctx: SimContext } {
  const { state, ctx } = newGame();
  state.player.quests.quest_tutorial.complete = true;
  for (const id of OTHERS) state.player.quests[id] = { done: [], complete: true, choices: [] };
  state.player.quests.quest_way_out = {
    done: ['briefing', 'decide', 'announce', 'blueprints', 'install_blueprints'],
    complete: false,
    choices: [],
  };
  return { state, ctx };
}

const talkTo = (state: GameState, ctx: SimContext, npc: string): SimEvent[] => {
  const events: SimEvent[] = [];
  progressQuests(state, ctx, { type: 'talk', npc }, events);
  return events;
};

describe('lost quest items', () => {
  it('stay with you when you die; everything else is left where you fell', () => {
    const { state, ctx } = atInstallDrive();
    give(state, 'item_coordinates_drive');
    give(state, 'item_scrap_hash', 3);
    handleDeath(state, ctx, []);
    expect(countItem(state.player.inventory, 'item_coordinates_drive')).toBe(1);
    expect(countItem(state.player.inventory, 'item_scrap_hash')).toBe(0);
  });

  it('come back from whoever gave them, when your next step needs one', () => {
    const { state, ctx } = atInstallDrive();
    expect(talkTo(state, ctx, 'npc_party_planner')).toEqual([]); // she never had it
    expect(countItem(state.player.inventory, 'item_coordinates_drive')).toBe(0);

    const events = talkTo(state, ctx, 'npc_sysadmin');
    expect(countItem(state.player.inventory, 'item_coordinates_drive')).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({ text: expect.stringMatching(/another Coordinates Drive/) }),
    );
    talkTo(state, ctx, 'npc_sysadmin');
    expect(countItem(state.player.inventory, 'item_coordinates_drive')).toBe(1); // only one
  });

  it('come back from a quest drop too (the Guest List)', () => {
    const { state, ctx } = newGame();
    state.player.quests.quest_tutorial.complete = true;
    state.player.quests.quest_gala_night = {
      done: ['briefing', 'theme', 'catering', 'crashers', 'gatecrasher'],
      complete: false,
      choices: ['gala_disco'],
    };
    const events = talkTo(state, ctx, 'npc_party_planner');
    // Handed back and delivered in the same breath.
    expect(state.player.quests.quest_gala_night.complete).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({ text: expect.stringMatching(/another Guest List/) }),
    );
  });

  it("aren't handed out twice if the bank has one", () => {
    const { state, ctx } = atInstallDrive();
    state.player.bank.push({ itemId: 'item_coordinates_drive', qty: 1 });
    talkTo(state, ctx, 'npc_sysadmin');
    expect(countItem(state.player.inventory, 'item_coordinates_drive')).toBe(0);
  });
});

describe('the seated Captain', () => {
  it('only sits by the Chamber once the running Captain has stopped', () => {
    const { state, ctx } = newGame();
    const here = () => state.zone.npcs.some((n) => n.defId === 'npc_captain_seated');
    changeZone(state, ctx, 'zone_trenches', content().zones.get('zone_trenches')!.spawn, []);
    expect(here()).toBe(false);
    changeZone(state, ctx, 'zone_treasury', content().zones.get('zone_treasury')!.spawn, []);
    state.player.unlocks.push('boss:enemy_captain_motion');
    changeZone(state, ctx, 'zone_trenches', content().zones.get('zone_trenches')!.spawn, []);
    expect(here()).toBe(true);
  });
});

describe('the Empty Canister (Server Meltdown)', () => {
  /** A President who has heard Sysadmin Opal out and then lost the canister she handed over. */
  function atFill(): { state: GameState; ctx: SimContext } {
    const { state, ctx } = newGame();
    state.player.quests.quest_tutorial.complete = true;
    state.player.quests.quest_server_meltdown = {
      done: ['briefing'],
      complete: false,
      choices: [],
    };
    return { state, ctx };
  }

  it('is handed over again when it is lost before it is filled', () => {
    // The fill step is "obtain a Coolant Canister", and the only way to get one is to use the
    // Empty Canister on the fountain. Without a reissue the quest, and The Way Out behind it,
    // could never be finished.
    const { state, ctx } = atFill();
    const events = talkTo(state, ctx, 'npc_sysadmin');
    expect(countItem(state.player.inventory, 'item_empty_canister')).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({ text: expect.stringMatching(/another Empty Canister/) }),
    );
    talkTo(state, ctx, 'npc_sysadmin');
    expect(countItem(state.player.inventory, 'item_empty_canister')).toBe(1); // only one
  });

  it('is not handed over again once the canister is filled', () => {
    const { state, ctx } = atFill();
    state.player.quests.quest_server_meltdown.done.push('fill');
    give(state, 'item_coolant_canister');
    talkTo(state, ctx, 'npc_sysadmin');
    expect(countItem(state.player.inventory, 'item_empty_canister')).toBe(0);
  });
});
