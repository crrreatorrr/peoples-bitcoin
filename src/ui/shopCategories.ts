/**
 * Shop tabs. Pure (no DOM), so the sorting of every stocked item is unit tested.
 */
import type { ItemDef } from '../sim/schemas';

export const SHOP_CATEGORIES = [
  { id: 'all', name: 'All' },
  { id: 'weapons', name: 'Weapons' },
  { id: 'armor', name: 'Armor' },
  { id: 'tools', name: 'Tools' },
  { id: 'food', name: 'Food & drinks' },
  { id: 'contracts', name: 'Contracts' },
  { id: 'materials', name: 'Materials' },
  { id: 'travel', name: 'Travel' },
] as const;

export type ShopCategoryId = (typeof SHOP_CATEGORIES)[number]['id'];

/** The one tab (besides All) an item is listed under. */
export function shopCategory(item: ItemDef): Exclude<ShopCategoryId, 'all'> {
  if (item.weapon || item.ammoType || item.equip?.slot === 'ammo') return 'weapons';
  if (item.tool) return 'tools';
  if (item.food || item.drink) return 'food';
  if (item.summon) return 'contracts';
  if (item.teleport) return 'travel';
  if (item.armor || item.equip) return 'armor';
  return 'materials';
}

export interface Requirement {
  skill: string;
  level: number;
  met: boolean;
}

/** An item's skill requirements against the player's levels. */
export function requirements(item: ItemDef, levelOf: (skillId: string) => number): Requirement[] {
  return item.requires.map((r) => ({
    skill: r.skill,
    level: r.level,
    met: levelOf(r.skill) >= r.level,
  }));
}
