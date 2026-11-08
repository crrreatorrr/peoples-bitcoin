/**
 * PB-W-1-03: a pending hub sale (`ledger.sale`) holds every unit it will take,
 * packs × the pack size, across all slots of that item, not only the clicked
 * slot. Each removal path must refuse to leave fewer units than the sale needs,
 * and must still let surplus units go.
 */
import { describe, expect, it } from 'vitest';
import { depositAll, deposit } from '../src/sim/bank';
import { hotspotKey } from '../src/sim/bunker';
import type { Content } from '../src/sim/content';
import { attackProfile } from '../src/sim/equipment';
import { countItem } from '../src/sim/inventory';
import { progressQuests } from '../src/sim/quests';
import { saleHeldUnits, spareUnits } from '../src/sim/saleHold';
import type { GameState, Intent, SimContext, SimEvent } from '../src/sim/state';
import { sell } from '../src/sim/terminal';
import { runTick } from '../src/sim/tick';
import { useItemOn } from '../src/sim/uses';
import { xpForLevel } from '../src/sim/xp';
import { changeZone, handleDeath } from '../src/sim/zones';
import { OP } from '../src/net/protocol';
import { content, give, messages, newGame, objectOf, runUntil } from './helpers';
import { testWorld } from './net/helpers';

const HELD = 'That item is waiting on a sale.';

/** A sale of `packs` packs of `itemId` that is in flight or waiting on a retry. */
function pending(state: GameState, itemId: string, packs: number, slot = 0): void {
  state.player.ledger.sale = { key: 'sale-key', shopId: 'shop_terminal', itemId, packs, slot };
}

/** Content with one extra terminal price row, for goods the live price table doesn't list. */
function withRow(ctx: SimContext, itemId: string, packSize: number): SimContext {
  const c: Content = {
    ...ctx.content,
    ticketPrices: [
      ...ctx.content.ticketPrices,
      { shopId: 'shop_terminal', itemId, packSize, price: 1, sellPrice: 1 },
    ],
  };
  return { ...ctx, content: c };
}

function slotsOf(state: GameState, itemId: string): number[] {
  return state.player.inventory.flatMap((s, i) => (s?.itemId === itemId ? [i] : []));
}

function tick(state: GameState, ctx: SimContext, intents: Intent[]): string[] {
  return messages(runTick(state, ctx, intents));
}

describe('sale hold helpers', () => {
  it('holds packs × pack size of the sale item only', () => {
    const { state, ctx } = newGame();
    give(state, 'item_rounds', 250);
    give(state, 'gun_campaign_pistol', 2);
    pending(state, 'item_rounds', 2);
    expect(saleHeldUnits(state.player, ctx.content, 'item_rounds')).toBe(200);
    expect(spareUnits(state.player, ctx.content, 'item_rounds')).toBe(50);
    expect(saleHeldUnits(state.player, ctx.content, 'gun_campaign_pistol')).toBe(0);
    expect(spareUnits(state.player, ctx.content, 'gun_campaign_pistol')).toBe(2);
    state.player.ledger.sale = null;
    expect(spareUnits(state.player, ctx.content, 'item_rounds')).toBe(250);
  });
});

describe('a pending hub sale holds its units in every slot', () => {
  it('drop: the units the sale needs stay, surplus can be dropped', () => {
    const { state, ctx } = newGame();
    give(state, 'gun_campaign_pistol', 3);
    pending(state, 'gun_campaign_pistol', 3);
    // Not the clicked slot: the old slot lock let these go.
    expect(tick(state, ctx, [{ type: 'dropItem', slot: 1 }])).toContain(HELD);
    expect(tick(state, ctx, [{ type: 'dropItem', slot: 2 }])).toContain(HELD);
    expect(countItem(state.player.inventory, 'gun_campaign_pistol')).toBe(3);
    expect(state.zone.groundItems).toHaveLength(0);

    give(state, 'gun_campaign_pistol', 1);
    expect(tick(state, ctx, [{ type: 'dropItem', slot: 3 }])).not.toContain(HELD);
    expect(countItem(state.player.inventory, 'gun_campaign_pistol')).toBe(3);
    expect(tick(state, ctx, [{ type: 'dropItem', slot: 1 }])).toContain(HELD);
  });

  it('drop: a stack keeps the sale in place even with surplus in it', () => {
    const { state, ctx } = newGame();
    give(state, 'item_rounds', 150);
    pending(state, 'item_rounds', 1);
    expect(tick(state, ctx, [{ type: 'dropItem', slot: 0 }])).toContain(HELD);
    expect(countItem(state.player.inventory, 'item_rounds')).toBe(150);
  });

  it('bank deposit: only the surplus goes in', () => {
    const { state, ctx } = newGame();
    give(state, 'gun_campaign_pistol', 3);
    pending(state, 'gun_campaign_pistol', 3);
    const events: SimEvent[] = [];
    deposit(state.player, ctx.content, 1, 'all', events);
    expect(messages(events)).toContain(HELD);
    expect(countItem(state.player.inventory, 'gun_campaign_pistol')).toBe(3);
    expect(state.player.bank).toEqual([]);

    give(state, 'gun_campaign_pistol', 2);
    deposit(state.player, ctx.content, 2, 'all', []);
    expect(countItem(state.player.inventory, 'gun_campaign_pistol')).toBe(3);
    expect(state.player.bank).toEqual([{ itemId: 'gun_campaign_pistol', qty: 2 }]);
  });

  it('bank deposit through the tick, with a stack', () => {
    const { state, ctx } = newGame();
    give(state, 'item_rounds', 150);
    pending(state, 'item_rounds', 1);
    state.player.interface = { kind: 'bank' };
    tick(state, ctx, [{ type: 'deposit', slot: 0, qty: 'all' }]);
    expect(countItem(state.player.inventory, 'item_rounds')).toBe(100);
    expect(state.player.bank).toEqual([{ itemId: 'item_rounds', qty: 50 }]);
    expect(tick(state, ctx, [{ type: 'deposit', slot: 0, qty: 1 }])).toContain(HELD);
    expect(countItem(state.player.inventory, 'item_rounds')).toBe(100);
  });

  it('bank deposit-all: everything else and the surplus go in', () => {
    const { state, ctx } = newGame();
    give(state, 'gun_campaign_pistol', 4);
    give(state, 'item_rounds', 30);
    pending(state, 'gun_campaign_pistol', 3);
    const events: SimEvent[] = [];
    depositAll(state.player, ctx.content, events);
    expect(messages(events)).toContain(HELD);
    expect(countItem(state.player.inventory, 'gun_campaign_pistol')).toBe(3);
    expect(countItem(state.player.inventory, 'item_rounds')).toBe(0);
    expect(state.player.bank).toEqual(
      expect.arrayContaining([
        { itemId: 'gun_campaign_pistol', qty: 1 },
        { itemId: 'item_rounds', qty: 30 },
      ]),
    );
  });

  it('equip: a held unit stays, a surplus unit can be worn', () => {
    const { state, ctx } = newGame();
    give(state, 'gun_campaign_pistol', 2);
    pending(state, 'gun_campaign_pistol', 2);
    expect(tick(state, ctx, [{ type: 'equip', slot: 1 }])).toContain(HELD);
    expect(countItem(state.player.inventory, 'gun_campaign_pistol')).toBe(2);
    expect(state.player.equipment.weapon?.itemId).not.toBe('gun_campaign_pistol');

    give(state, 'gun_campaign_pistol', 1);
    tick(state, ctx, [{ type: 'equip', slot: 2 }]);
    expect(state.player.equipment.weapon?.itemId).toBe('gun_campaign_pistol');
    expect(countItem(state.player.inventory, 'gun_campaign_pistol')).toBe(2);
  });

  it('eat: held food is not eaten, surplus is', () => {
    const { state, ctx } = newGame();
    state.player.hp = 1;
    give(state, 'item_tp_soundbite', 2);
    pending(state, 'item_tp_soundbite', 2);
    expect(tick(state, ctx, [{ type: 'eat', slot: 1 }])).toContain(HELD);
    expect(countItem(state.player.inventory, 'item_tp_soundbite')).toBe(2);
    expect(state.player.hp).toBe(1);

    give(state, 'item_tp_soundbite', 1);
    tick(state, ctx, [{ type: 'eat', slot: 2 }]);
    expect(countItem(state.player.inventory, 'item_tp_soundbite')).toBe(2);
    expect(state.player.hp).toBeGreaterThan(1);
  });

  it('drink: a held drink is not drunk, surplus is', () => {
    const { state, ctx } = newGame();
    give(state, 'item_hopium_soda', 1);
    pending(state, 'item_hopium_soda', 1);
    expect(tick(state, ctx, [{ type: 'drink', slot: 0 }])).toContain(HELD);
    expect(countItem(state.player.inventory, 'item_hopium_soda')).toBe(1);

    give(state, 'item_hopium_soda', 1);
    tick(state, ctx, [{ type: 'drink', slot: 0 }]);
    expect(countItem(state.player.inventory, 'item_hopium_soda')).toBe(1);
  });

  it('teleport: a held ticket is not torn, a surplus one is', () => {
    const { state, ctx } = newGame();
    give(state, 'item_ticket_treasury', 2);
    pending(state, 'item_ticket_treasury', 2);
    expect(tick(state, ctx, [{ type: 'teleport', slot: 0 }])).toContain(HELD);
    expect(countItem(state.player.inventory, 'item_ticket_treasury')).toBe(2);
    expect(state.player.teleport).toBeNull();

    give(state, 'item_ticket_treasury', 1);
    tick(state, ctx, [{ type: 'teleport', slot: 0 }]);
    expect(countItem(state.player.inventory, 'item_ticket_treasury')).toBe(2);
    expect(state.player.teleport).not.toBeNull();
  });

  it('summon: a held contract is not signed, a surplus one is', () => {
    const { state, ctx } = newGame();
    give(state, 'contract_recruit', 1);
    pending(state, 'contract_recruit', 1);
    expect(tick(state, ctx, [{ type: 'summon', slot: 0 }])).toContain(HELD);
    expect(countItem(state.player.inventory, 'contract_recruit')).toBe(1);
    expect(state.player.sproto).toBeNull();

    give(state, 'contract_recruit', 1);
    tick(state, ctx, [{ type: 'summon', slot: 1 }]);
    expect(countItem(state.player.inventory, 'contract_recruit')).toBe(1);
    expect(state.player.sproto).not.toBeNull();
  });

  it('use on an object: a held unit is not consumed, surplus is', () => {
    const { state, ctx: base } = newGame();
    const podium = objectOf(state, 'obj_press_podium');
    const ctx: SimContext = {
      ...base,
      content: {
        ...base.content,
        uses: [
          ...base.content.uses,
          {
            item: 'item_concrete_bag',
            target: 'obj_press_podium',
            consume: 2,
            give: [],
            message: 'You prop up the podium.',
            xp: {},
          },
        ],
      },
    };
    give(state, 'item_concrete_bag', 3);
    pending(state, 'item_concrete_bag', 2);
    const target = { kind: 'object' as const, instance: podium };
    let events: SimEvent[] = [];
    useItemOn(state, ctx, 'item_concrete_bag', target, events);
    expect(messages(events)).toContain(HELD);
    expect(countItem(state.player.inventory, 'item_concrete_bag')).toBe(3);

    give(state, 'item_concrete_bag', 1);
    events = [];
    useItemOn(state, ctx, 'item_concrete_bag', target, events);
    expect(messages(events)).toContain('You prop up the podium.');
    expect(countItem(state.player.inventory, 'item_concrete_bag')).toBe(2);
  });

  it('quest hand-in: held units are not delivered, surplus is', () => {
    const { state, ctx } = newGame();
    state.player.quests.quest_tutorial.complete = true;
    state.player.quests.quest_press_conference = {
      done: ['briefing'],
      complete: false,
      choices: [],
    };
    give(state, 'item_tp_soundbite', 3);
    pending(state, 'item_tp_soundbite', 1);
    let events: SimEvent[] = [];
    progressQuests(state, ctx, { type: 'talk', npc: 'npc_spin_doctor' }, events);
    expect(messages(events)).toContain(HELD);
    expect(state.player.quests.quest_press_conference.done).toEqual(['briefing']);
    expect(countItem(state.player.inventory, 'item_tp_soundbite')).toBe(3);

    give(state, 'item_tp_soundbite', 1);
    events = [];
    progressQuests(state, ctx, { type: 'talk', npc: 'npc_spin_doctor' }, events);
    expect(state.player.quests.quest_press_conference.done).toContain('prep');
    expect(countItem(state.player.inventory, 'item_tp_soundbite')).toBe(1);
  });

  it('bunker build: held materials are not used, surplus is', () => {
    const { state, ctx } = newGame();
    state.player.unlocks.push('bunker');
    changeZone(state, ctx, 'zone_bunker', { x: 10, y: 11 }, []);
    const spot = objectOf(state, 'obj_hotspot_storage');
    state.player.pos = { x: spot.x, y: spot.y + 1 };
    give(state, 'item_toolkit_basic');
    give(state, 'item_scrap_hash', 5);
    give(state, 'item_concrete_bag', 1);
    pending(state, 'item_concrete_bag', 1);
    state.player.interface = { kind: 'build', targetId: spot.id };
    expect(tick(state, ctx, [{ type: 'build', buildId: 'build_locker' }])).toContain(HELD);
    expect(state.player.bunker[hotspotKey('zone_bunker', spot)]).toBeUndefined();
    expect(countItem(state.player.inventory, 'item_concrete_bag')).toBe(1);

    give(state, 'item_concrete_bag', 1);
    expect(tick(state, ctx, [{ type: 'build', buildId: 'build_locker' }])).toContain(
      'You build the Storage Locker.',
    );
    expect(countItem(state.player.inventory, 'item_concrete_bag')).toBe(1);
  });

  it('standalone terminal sell: only the surplus is sold', () => {
    const { state, ctx } = newGame();
    give(state, 'gun_campaign_pistol', 3);
    pending(state, 'gun_campaign_pistol', 3);
    state.player.interface = { kind: 'terminal', shopId: 'shop_terminal' };
    let events: SimEvent[] = [];
    sell(state, ctx, 2, 'all', events);
    expect(messages(events)).toContain(HELD);
    expect(countItem(state.player.inventory, 'gun_campaign_pistol')).toBe(3);

    give(state, 'gun_campaign_pistol', 1);
    const before = state.player.currencies.tickets;
    events = [];
    sell(state, ctx, 1, 'all', events);
    expect(countItem(state.player.inventory, 'gun_campaign_pistol')).toBe(3);
    expect(state.player.currencies.tickets).toBeGreaterThan(before);
  });

  it('processing (Spin): held inputs are not used, surplus is', () => {
    const { state, ctx: base } = newGame(7);
    const ctx = withRow(base, 'item_raw_minor_scandal', 1);
    state.player.skills.spin = xpForLevel(20);
    give(state, 'item_raw_minor_scandal', 3);
    pending(state, 'item_raw_minor_scandal', 3);
    const podium = objectOf(state, 'obj_press_podium');
    state.player.pos = { x: podium.x, y: podium.y + 1 };
    const act: Intent = { type: 'interact', targetId: podium.id, action: 'Spin' };
    const events = runUntil(state, ctx, () => state.player.action === null, [act]);
    expect(messages(events)).toContain(HELD);
    expect(countItem(state.player.inventory, 'item_raw_minor_scandal')).toBe(3);

    give(state, 'item_raw_minor_scandal', 2);
    runUntil(state, ctx, () => state.player.action === null, [act]);
    expect(countItem(state.player.inventory, 'item_raw_minor_scandal')).toBe(3);
    expect(countItem(state.player.inventory, 'item_tp_soundbite')).toBe(2);
  });

  it('Hash Cannon shells: held Hash is not fired, surplus is', () => {
    const { state, ctx: base } = newGame();
    const ctx = withRow(base, 'item_scrap_hash', 1);
    state.player.skills.shooting = xpForLevel(40);
    state.player.equipment.weapon = { itemId: 'gun_hash_cannon', qty: 1 };
    give(state, 'item_scrap_hash', 2);
    pending(state, 'item_scrap_hash', 2);
    expect(attackProfile(state.player, ctx).outOfAmmo).toBe(true);
    give(state, 'item_scrap_hash', 1);
    const profile = attackProfile(state.player, ctx);
    expect(profile.outOfAmmo).toBe(false);
    expect(profile.shellSlot).not.toBeNull();
  });

  it('death: the units the sale needs stay with you, the rest is left behind', () => {
    const { state, ctx } = newGame();
    give(state, 'gun_campaign_pistol', 4);
    give(state, 'item_rounds', 150);
    pending(state, 'item_rounds', 1, 4);
    handleDeath(state, ctx, []);
    expect(countItem(state.player.inventory, 'item_rounds')).toBe(100);
    expect(countItem(state.player.inventory, 'gun_campaign_pistol')).toBe(0);
  });

  it('death: unstackable sale units stay, surplus ones drop', () => {
    const { state, ctx } = newGame();
    give(state, 'gun_campaign_pistol', 4);
    pending(state, 'gun_campaign_pistol', 3);
    handleDeath(state, ctx, []);
    expect(countItem(state.player.inventory, 'gun_campaign_pistol')).toBe(3);
  });

  it('trade offer: only the surplus can be offered', () => {
    const w = testWorld();
    w.join('a', 'Alice');
    w.join('b', 'Bob');
    const A = w.host.viewOf('a')!;
    A.player.inventory[0] = { itemId: 'item_rounds', qty: 150 };
    A.player.inventory[1] = { itemId: 'gun_campaign_pistol', qty: 1 };
    pending(A, 'item_rounds', 1);
    A.player.ledger.sale!.packs = 1;
    w.take('a');
    w.take('b');
    w.send('a', OP.TRADE, { op: 'request', to: 'p:b' });
    w.flush();
    w.send('b', OP.TRADE, { op: 'request', to: 'p:a' });
    w.flush();
    w.send('a', OP.TRADE, { op: 'offer', slot: 0, qty: 'all' });
    w.send('a', OP.TRADE, { op: 'offer', slot: 0, qty: 'all' });
    w.flush();
    const out = w.take('a', OP.TRADE_OUT).at(-1)?.body as {
      mine: { itemId: string; qty: number }[];
    };
    expect(out.mine).toEqual([expect.objectContaining({ itemId: 'item_rounds', qty: 50 })]);

    A.player.ledger.sale!.itemId = 'gun_campaign_pistol';
    w.send('a', OP.TRADE, { op: 'offer', slot: 1, qty: 1 });
    w.flush();
    const after = w.take('a', OP.TRADE_OUT).at(-1)?.body as
      { mine: { itemId: string }[] } | undefined;
    expect(after?.mine.some((r) => r.itemId === 'gun_campaign_pistol') ?? false).toBe(false);
    expect(slotsOf(A, 'gun_campaign_pistol')).toEqual([1]);
  });
});

// The live price table is the reference for these tests' pack sizes.
it('the tests use the live pack sizes', () => {
  const size = (id: string) =>
    content().ticketPrices.find((r) => r.shopId === 'shop_terminal' && r.itemId === id)?.packSize;
  expect(size('item_rounds')).toBe(100);
  expect(size('gun_campaign_pistol')).toBe(1);
  expect(size('item_concrete_bag')).toBe(1);
});
