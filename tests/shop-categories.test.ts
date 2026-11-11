import { describe, expect, it } from 'vitest';
import { requirements, SHOP_CATEGORIES, shopCategory } from '../src/ui/shopCategories';
import { content } from './helpers';

const item = (id: string) => content().items.get(id)!;

describe('shop tabs', () => {
  it('sorts the Terminal stock into the right tabs', () => {
    expect(shopCategory(item('gun_confetti_shotgun'))).toBe('weapons');
    expect(shopCategory(item('item_iron_gavel'))).toBe('weapons');
    expect(shopCategory(item('item_rounds'))).toBe('weapons');
    expect(shopCategory(item('item_flak_vest'))).toBe('armor');
    expect(shopCategory(item('item_grip_gloves'))).toBe('armor');
    expect(shopCategory(item('item_pick_steel'))).toBe('tools');
    expect(shopCategory(item('item_toolkit_basic'))).toBe('tools');
    expect(shopCategory(item('item_tp_soundbite'))).toBe('food');
    expect(shopCategory(item('contract_recruit'))).toBe('contracts');
    expect(shopCategory(item('item_concrete_bag'))).toBe('materials');
  });

  it('every stocked item lands in a tab that exists, and no tab but All is a catch-all', () => {
    const ids = new Set<string>(SHOP_CATEGORIES.map((c) => c.id));
    const counts = new Map<string, number>();
    for (const shop of content().shops.values()) {
      for (const entry of shop.stock) {
        const def = content().items.get(entry.item);
        if (!def) continue;
        const c = shopCategory(def);
        expect(ids.has(c)).toBe(true);
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    for (const n of counts.values()) expect(n).toBeLessThan(total * 0.6);
    for (const c of ['weapons', 'armor', 'tools', 'food', 'contracts', 'materials']) {
      expect(counts.get(c) ?? 0).toBeGreaterThan(0);
    }
  });

  it('shows the Confetti Shotgun needs Shooting 15 and whether the player has it', () => {
    const shotgun = item('gun_confetti_shotgun');
    expect(requirements(shotgun, () => 1)).toEqual([{ skill: 'shooting', level: 15, met: false }]);
    expect(requirements(shotgun, () => 15)).toEqual([{ skill: 'shooting', level: 15, met: true }]);
    expect(requirements(item('item_tp_soundbite'), () => 1)).toEqual([]);
  });
});
