import { describe, expect, it } from 'vitest';
import { GATHERING, TICKETS } from '../src/config/balance';
import { successChance } from '../src/sim/gathering';
import { countItem } from '../src/sim/inventory';
import { runTick } from '../src/sim/tick';
import { xpForLevel } from '../src/sim/xp';
import { give, messages, newGame, objectOf, runUntil } from './helpers';

const act = (targetId: string, action: string) => [{ type: 'interact' as const, targetId, action }];

describe('gathering skills', () => {
  it('scales success with level and tool, capped', () => {
    expect(successChance(1, 1, 0)).toBeCloseTo(GATHERING.successAtReq);
    expect(successChance(11, 1, 0.1)).toBeCloseTo(
      GATHERING.successAtReq + 10 * GATHERING.successPerLevel + 0.1,
    );
    expect(successChance(99, 1, 0.16)).toBe(GATHERING.successMax);
  });

  it('needs a tool', () => {
    const { state, ctx } = newGame();
    const rack = objectOf(state, 'obj_rack_dusty', 36, 28);
    state.player.pos = { x: 35, y: 28 };
    const events = runTick(state, ctx, act(rack.id, 'Mine'));
    expect(messages(events)).toContain('You need a Hash Pick for that.');
    expect(state.player.action).toBeNull();
  });

  it('mines Hash with a pick', () => {
    const { state, ctx } = newGame();
    give(state, 'item_pick_rusty');
    const rack = objectOf(state, 'obj_rack_dusty', 36, 28);
    state.player.pos = { x: 35, y: 28 };
    const events = runUntil(
      state,
      ctx,
      (ev) => ev.some((e) => e.type === 'xp'),
      act(rack.id, 'Mine'),
    );
    expect(messages(events)).toContain('You mine some Scrap Hash.');
    expect(countItem(state.player.inventory, 'item_scrap_hash')).toBe(1);
    expect(state.player.skills.mining).toBe(17.5);
  });

  it('refuses nodes above the player level', () => {
    const { state, ctx } = newGame();
    give(state, 'item_pick_rusty');
    const rack = objectOf(state, 'obj_rack_liquid', 16, 6);
    state.player.pos = { x: 16, y: 7 };
    const events = runTick(state, ctx, act(rack.id, 'Mine'));
    expect(messages(events)).toContain('You need a Mining level of 30 to do that.');
  });

  it('fundraising digs up scandals', () => {
    const { state, ctx } = newGame();
    give(state, 'item_donor_list');
    const table = objectOf(state, 'obj_donor_chicken', 3, 24);
    state.player.pos = { x: 3, y: 25 };
    runUntil(state, ctx, (ev) => ev.some((e) => e.type === 'xp'), act(table.id, 'Work the room'));
    expect(countItem(state.player.inventory, 'item_raw_minor_scandal')).toBe(1);
  });

  it('lobbying pays a fraction of a Ticket per favor, except when blackmailed', () => {
    const { state, ctx } = newGame(99);
    give(state, 'item_business_cards');
    const lobbyist = objectOf(state, 'obj_lobbyist_junior', 45, 24);
    // Junior favors are 3–6 USD, which is 0.12–0.24 Tickets at 1 per 25 USD.
    const min = 3 / TICKETS.usdPerTicket;
    const max = 6 / TICKETS.usdPerTicket;
    const owed = () =>
      state.player.currencies.tickets + state.player.ledger.offlineRemainder.pb_lobby;
    let paid = 0;
    let blackmailed = 0;
    for (
      let i = 0;
      i < 4000 && (paid < 3 || blackmailed < 1 || state.player.currencies.tickets < 1);
      i++
    ) {
      state.player.pos = { x: 45, y: 25 };
      const before = owed();
      const beforeTickets = state.player.currencies.tickets;
      const events = runTick(state, ctx, state.player.action ? [] : act(lobbyist.id, 'Do a favor'));
      if (!events.some((e) => e.type === 'xp')) continue;
      const delta = owed() - before;
      if (messages(events).some((m) => m.startsWith('Blackmail!'))) {
        blackmailed++;
        expect(delta).toBe(0);
        expect(state.player.currencies.tickets).toBe(beforeTickets);
      } else if (delta > 0) {
        paid++;
        expect(delta).toBeGreaterThanOrEqual(min - 1e-9);
        expect(delta).toBeLessThanOrEqual(max + 1e-9);
      }
    }
    expect(paid).toBeGreaterThanOrEqual(3);
    expect(blackmailed).toBeGreaterThanOrEqual(1);
    expect(state.player.currencies.tickets).toBeGreaterThanOrEqual(1);
    expect(countItem(state.player.inventory, 'item_raw_minor_scandal')).toBe(0);
  });

  it('spin turns raw scandals into Talking Points, sometimes losing one', () => {
    const { state, ctx } = newGame(7);
    give(state, 'item_raw_minor_scandal', 10);
    const podium = objectOf(state, 'obj_press_podium');
    state.player.pos = { x: podium.x, y: podium.y + 1 };
    runUntil(state, ctx, () => state.player.action === null, act(podium.id, 'Spin'));
    const made = countItem(state.player.inventory, 'item_tp_soundbite');
    expect(countItem(state.player.inventory, 'item_raw_minor_scandal')).toBe(0);
    expect(made).toBeGreaterThan(0);
    expect(made).toBeLessThan(10); // level 1 burns some
    expect(state.player.skills.spin).toBe(made * 15);
  });

  it('spin never fails past the safe level', () => {
    const { state, ctx } = newGame(7);
    state.player.skills.spin = xpForLevel(20);
    give(state, 'item_raw_minor_scandal', 6);
    const podium = objectOf(state, 'obj_press_podium');
    state.player.pos = { x: podium.x, y: podium.y + 1 };
    runUntil(state, ctx, () => state.player.action === null, act(podium.id, 'Spin'));
    expect(countItem(state.player.inventory, 'item_tp_soundbite')).toBe(6);
  });
});
