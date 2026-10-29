import { describe, expect, it } from 'vitest';
import { TICKETS } from '../src/config/balance';
import { countItem } from '../src/sim/inventory';
import { buyPrice, sellPrice } from '../src/sim/terminal';
import { runTick } from '../src/sim/tick';
import { xpForLevel } from '../src/sim/xp';
import { content, give, messages, newGame } from './helpers';

function atTerminal() {
  const game = newGame();
  game.state.player.interface = { kind: 'terminal', shopId: 'shop_terminal' };
  return game;
}

describe('Trading Terminal', () => {
  it('prices the Campaign Pistol in Tickets, not the live USD walk', () => {
    const { state, ctx } = atTerminal();
    const hash = content().items.get('item_scrap_hash')!.value;
    expect(hash).toBe(6.9);
    state.economy.priceUsd = 0.069;
    expect(buyPrice(state, ctx, 'gun_campaign_pistol', 1)).toBe(25);
    state.economy.priceUsd = 0.138;
    expect(buyPrice(state, ctx, 'gun_campaign_pistol', 1)).toBe(25);
    // Sell-only goods: floor(usd / 25). Two Scrap Hash are 13.8 USD, so 0 Tickets.
    expect(sellPrice(state, ctx, 'item_scrap_hash', 2)).toBe(
      Math.floor((hash * 2) / TICKETS.usdPerTicket),
    );
  });

  it('buys when you can afford it and have room', () => {
    const { state, ctx } = atTerminal();
    // qty is packs. One pack of Rounds is 3 Tickets and 100 rounds.
    const packs = 1;
    const cost = buyPrice(state, ctx, 'item_rounds', packs)!;
    expect(cost).toBe(3);
    const events = runTick(state, ctx, [{ type: 'buy', itemId: 'item_rounds', qty: packs }]);
    expect(messages(events)[0]).toBe('Not enough Tickets.');
    state.player.currencies.tickets = cost + 5;
    runTick(state, ctx, [{ type: 'buy', itemId: 'item_rounds', qty: packs }]);
    expect(countItem(state.player.inventory, 'item_rounds')).toBe(100);
    expect(state.player.currencies.tickets).toBe(5);
  });

  it('sells a whole stack of non-stackables with "all"', () => {
    const { state, ctx } = atTerminal();
    give(state, 'item_scrap_hash', 5);
    runTick(state, ctx, [{ type: 'sell', slot: 2, qty: 'all' }]);
    const hash = content().items.get('item_scrap_hash')!.value;
    const whole = Math.floor((hash * 5) / TICKETS.usdPerTicket);
    expect(countItem(state.player.inventory, 'item_scrap_hash')).toBe(0);
    expect(whole).toBe(1);
    expect(state.player.currencies.tickets).toBe(whole);
    expect(state.player.ledger.offlineRemainder.pb_sell).toBeCloseTo(
      (hash * 5) / TICKETS.usdPerTicket - whole,
      8,
    );
  });

  it('ignores trades when the Terminal is not open', () => {
    const { state, ctx } = newGame();
    state.player.currencies.bitcoin = 1e9;
    runTick(state, ctx, [{ type: 'buy', itemId: 'item_rounds', qty: 1 }]);
    expect(countItem(state.player.inventory, 'item_rounds')).toBe(0);
  });
});

describe('equipment and food', () => {
  it('checks level requirements before equipping', () => {
    const { state, ctx } = newGame();
    give(state, 'gun_treasury_rifle');
    const events = runTick(state, ctx, [{ type: 'equip', slot: 0 }]);
    expect(messages(events)).toContain(
      'You need a Shooting level of 45 to use the Treasury Rifle.',
    );
    state.player.skills.shooting = xpForLevel(45);
    runTick(state, ctx, [{ type: 'equip', slot: 0 }]);
    expect(state.player.equipment.weapon?.itemId).toBe('gun_treasury_rifle');
  });

  it('merges rounds into the ammo slot and swaps weapons back to the inventory', () => {
    const { state, ctx } = newGame();
    give(state, 'item_rounds', 50);
    give(state, 'gun_campaign_pistol');
    give(state, 'item_oak_gavel');
    runTick(state, ctx, [{ type: 'equip', slot: 0 }]);
    give(state, 'item_rounds', 25);
    runTick(state, ctx, [{ type: 'equip', slot: 0 }]);
    expect(state.player.equipment.ammo).toEqual({ itemId: 'item_rounds', qty: 75 });
    runTick(state, ctx, [{ type: 'equip', slot: 1 }]); // pistol
    expect(state.player.style).toBe('accurate');
    runTick(state, ctx, [{ type: 'equip', slot: 2 }]); // gavel: pistol goes back
    expect(state.player.equipment.weapon?.itemId).toBe('item_oak_gavel');
    expect(state.player.inventory[2]?.itemId).toBe('gun_campaign_pistol');
    expect(state.player.style).toBe('bash');
  });

  it('only allows styles that fit the weapon', () => {
    const { state, ctx } = newGame();
    runTick(state, ctx, [{ type: 'setStyle', style: 'rapid' }]);
    expect(state.player.style).toBe('accurate'); // bare hands use the gavel: no rapid
    runTick(state, ctx, [{ type: 'setStyle', style: 'block' }]);
    expect(state.player.style).toBe('block');
  });

  it('reciting a Talking Point heals and costs an attack delay', () => {
    const { state, ctx } = newGame();
    give(state, 'item_tp_zinger');
    state.player.hp = 3;
    runTick(state, ctx, [{ type: 'eat', slot: 0 }]);
    expect(state.player.hp).toBe(10);
    expect(state.player.inventory[0]).toBeNull();
    expect(state.player.nextAttackTick).toBeGreaterThan(state.tick);
  });
});
