/** Combat with several players in one zone: aggro, single-way, loot ownership. */
import { describe, expect, it } from 'vitest';
import { LOOT } from '../src/config/balance';
import { damageEnemy } from '../src/sim/combat';
import { findEntity, newEnemy, type GameState } from '../src/sim/state';
import { runWorldTick } from '../src/sim/tick';
import { changeZone } from '../src/sim/zones';
import { content, messages } from './helpers';
import { newWorld } from './worldHelpers';

function trenches(pids: string[]) {
  const w = newWorld(pids, 9);
  for (const v of Object.values(w.views))
    changeZone(v, w.ctx, 'zone_trenches', { x: 20, y: 120 }, []);
  const zone = Object.values(w.views)[0].zone;
  zone.enemies = [];
  return { ...w, zone };
}

function armed(state: GameState) {
  state.player.equipment.weapon = { itemId: 'gun_campaign_pistol', qty: 1 };
  state.player.equipment.ammo = { itemId: 'item_rounds', qty: 500 };
}

describe('multi-player combat', () => {
  it('an aggressive enemy goes for the nearest player', () => {
    const { world, ctx, views, zone } = trenches(['a', 'b']);
    const e = newEnemy('e900', 'enemy_heckler', 20, 112, content(), false);
    zone.enemies.push(e);
    views.a.player.pos = { x: 20, y: 118 };
    views.b.player.pos = { x: 20, y: 114 };
    runWorldTick(world, ctx, {});
    expect(e.target).toBe('p:b');
  });

  it('single-way: you cannot join a fight someone else is in', () => {
    const { world, ctx, views, zone } = trenches(['a', 'b']);
    const e = newEnemy('e900', 'enemy_heckler', 20, 112, content(), false);
    zone.enemies.push(e);
    e.target = 'p:a';
    e.lastCombatTick = world.tick;
    const out = runWorldTick(world, ctx, {
      b: [{ type: 'interact', targetId: 'e900', action: 'Attack' }],
    });
    expect(messages(out.b)).toContain('Someone else is fighting that.');
    expect(views.b.player.action).toBeNull();
  });

  it('the top damager owns the loot, privately at first', () => {
    const { world, ctx, views, zone } = trenches(['a', 'b']);
    // Sergeant Sandbag always drops rounds.
    const e = newEnemy('e900', 'enemy_sergeant_sandbag', 20, 112, content(), false);
    zone.enemies.push(e);
    e.hp = 10;
    damageEnemy(views.a, ctx, e, 7, []);
    damageEnemy(views.b, ctx, e, 3, []);
    expect(e.respawnAt).not.toBeNull();
    const loot = zone.groundItems;
    expect(loot.length).toBeGreaterThan(0);
    for (const g of loot) {
      expect(g.owner).toBe('a');
      expect(findEntity(views.a, g.id)).not.toBeNull();
      expect(findEntity(views.b, g.id)).toBeNull();
    }
    // Tradeable loot turns public after LOOT.privateTicks.
    const tradeable = loot.find((g) => (content().items.get(g.itemId)?.value ?? 0) > 0);
    if (tradeable) {
      world.tick += LOOT.privateTicks;
      expect(findEntity(views.b, tradeable.id)).not.toBeNull();
    }
  });

  it('a death pile is never public', () => {
    const { world, ctx, views, zone } = trenches(['a', 'b']);
    views.a.player.inventory[0] = { itemId: 'item_rounds', qty: 10 };
    views.a.player.hp = 0;
    for (let i = 0; i < 10; i++) runWorldTick(world, ctx, {});
    const pile = zone.groundItems.find((g) => g.itemId === 'item_rounds');
    expect(pile?.owner).toBe('a');
    expect(pile?.publicAt).toBeUndefined();
    world.tick += 1000;
    expect(findEntity(views.b, pile!.id)).toBeNull();
  });

  it('two players can both fight a boss (multi-way) and enemies forget a leaver', () => {
    const { world, ctx, views, zone } = trenches(['a', 'b']);
    armed(views.a);
    armed(views.b);
    const boss = newEnemy('e901', 'enemy_sludge_mother', 20, 112, content(), false);
    zone.enemies.push(boss);
    boss.target = 'p:a';
    boss.lastCombatTick = world.tick;
    const out = runWorldTick(world, ctx, {
      b: [{ type: 'interact', targetId: 'e901', action: 'Attack' }],
    });
    expect(messages(out.b)).not.toContain('Someone else is fighting that.');
    changeZone(views.a, ctx, 'zone_treasury', { x: 27, y: 30 }, []);
    expect(boss.target).toBeNull();
  });
});
