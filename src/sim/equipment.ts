/**
 * Equipment, combat styles, eating, and the attack profile the combat code
 * uses. Guns fire Rounds and staffs fire COOM from the ammo slot; explosive
 * cannons fire mined Hash straight from the inventory. A gun or staff with
 * nothing to fire is swung as a club; with no weapon at all the President
 * uses the gavel.
 */
import { COMBAT, OUTFITS } from '../config/balance';
import { addItem, countItem } from './inventory';
import { progressQuests, questItemsNeeded } from './quests';
import type { ItemDef } from './schemas';
import {
  maxHp,
  type CombatStyle,
  type EquipSlot,
  type GameState,
  type PlayerState,
  type SimContext,
  type SimEvent,
} from './state';
import { levelForXp } from './xp';

export const GUN_STYLES: CombatStyle[] = ['accurate', 'rapid', 'longrange'];
export const MELEE_STYLES: CombatStyle[] = ['bash', 'block'];

export interface AttackProfile {
  type: 'gun' | 'melee';
  weapon: ItemDef;
  speed: number;
  range: number;
  accuracyBonus: number;
  damageBonus: number;
  explosive: boolean;
  /** Inventory slot of the Hash shell a cannon will fire. */
  shellSlot: number | null;
  /** A gun is equipped but has nothing to fire. */
  outOfAmmo: boolean;
  /** Out of Hash only because the rest is kept for a quest step. */
  keptForQuest: boolean;
}

/** null if the player meets the item's requirements, otherwise the reason. */
export function unmetRequirement(
  player: PlayerState,
  def: ItemDef,
  ctx: SimContext,
): string | null {
  for (const req of def.requires) {
    if (levelForXp(player.skills[req.skill] ?? 0) < req.level) {
      const name = ctx.content.skills.get(req.skill)?.name ?? req.skill;
      return `You need a ${name} level of ${req.level} to use the ${def.name}.`;
    }
  }
  return null;
}

export function equipFromInventory(
  state: GameState,
  ctx: SimContext,
  slot: number,
  events: SimEvent[],
): void {
  const player = state.player;
  const item = player.inventory[slot];
  const def = item && ctx.content.items.get(item.itemId);
  if (!item || !def?.equip) return;
  const problem = unmetRequirement(player, def, ctx);
  if (problem) {
    events.push({ type: 'message', kind: 'game', text: problem });
    return;
  }
  const target = def.equip.slot;
  const current = player.equipment[target];
  if (current && current.itemId === item.itemId && def.stackable) {
    current.qty += item.qty;
    player.inventory[slot] = null;
  } else {
    player.inventory[slot] = current;
    player.equipment[target] = { ...item };
  }
  if (target === 'weapon') fixStyle(player, ctx);
  progressQuests(state, ctx, { type: 'equip', slot: target }, events);
}

export function unequip(
  state: GameState,
  ctx: SimContext,
  slot: EquipSlot,
  events: SimEvent[],
): void {
  const player = state.player;
  const item = player.equipment[slot];
  const def = item && ctx.content.items.get(item.itemId);
  if (!item || !def) return;
  if (!addItem(player.inventory, def, item.qty)) {
    events.push({ type: 'message', kind: 'game', text: 'You need a free inventory slot.' });
    return;
  }
  player.equipment[slot] = null;
  if (slot === 'weapon') fixStyle(player, ctx);
}

export function eat(state: GameState, ctx: SimContext, slot: number, events: SimEvent[]): void {
  const player = state.player;
  const item = player.inventory[slot];
  const def = item && ctx.content.items.get(item.itemId);
  if (!item || !def?.food || state.tick < player.nextEatTick) return;
  player.nextEatTick = state.tick + COMBAT.eatDelayTicks;
  const before = player.hp;
  player.hp = Math.min(maxHp(player), player.hp + def.food.heal);
  item.qty -= 1;
  if (item.qty === 0) player.inventory[slot] = null;
  player.nextAttackTick = Math.max(player.nextAttackTick, state.tick + COMBAT.eatDelayTicks);
  events.push({
    type: 'message',
    kind: 'game',
    text: `You ${def.food.verb.toLowerCase()} the ${def.name}. (+${player.hp - before} HP)`,
  });
  progressQuests(state, ctx, { type: 'eat' }, events);
}

export function setStyle(player: PlayerState, ctx: SimContext, style: CombatStyle): void {
  const styles = weaponOf(player, ctx).weapon!.type === 'gun' ? GUN_STYLES : MELEE_STYLES;
  if (styles.includes(style)) player.style = style;
}

/** Keep the chosen style valid for the equipped weapon type. */
function fixStyle(player: PlayerState, ctx: SimContext): void {
  const gun = weaponOf(player, ctx).weapon!.type === 'gun';
  if (gun && !GUN_STYLES.includes(player.style)) player.style = 'accurate';
  if (!gun && !MELEE_STYLES.includes(player.style)) player.style = 'bash';
}

/** The equipped weapon definition, or the gavel when the slot is empty. */
export function weaponOf(player: PlayerState, ctx: SimContext): ItemDef {
  const id = player.equipment.weapon?.itemId ?? COMBAT.fallbackWeaponId;
  return ctx.content.items.get(id) ?? ctx.content.items.get(COMBAT.fallbackWeaponId)!;
}

export function attackProfile(player: PlayerState, ctx: SimContext): AttackProfile {
  const equipped = weaponOf(player, ctx);
  let shellSlot: number | null = null;
  let shellDamage = 0;
  let outOfAmmo = false;
  let keptForQuest = false;

  const w = equipped.weapon!;
  if (w.type === 'gun') {
    if ((w.ammo === 'rounds' || w.ammo === 'coom') && !loaded(player, ctx, w.ammo))
      outOfAmmo = true;
    if (w.ammo === 'hash') {
      // Hash your quest is waiting for (Bunker Down's materials, the Chamber's fuel) stays put.
      const keep = questItemsNeeded(player, ctx.content);
      player.inventory.forEach((s, i) => {
        const shell = s && ctx.content.items.get(s.itemId)?.shell;
        if (!shell) return;
        if (countItem(player.inventory, s.itemId) <= (keep.get(s.itemId) ?? 0)) {
          keptForQuest = true;
          return;
        }
        if (shellSlot === null || shell.damage > shellDamage) {
          shellSlot = i;
          shellDamage = shell.damage;
        }
      });
      if (shellSlot === null) outOfAmmo = true;
    }
  }

  const armor = armorTotals(player, ctx);
  if (outOfAmmo) {
    // Nothing to fire: bash with the gun itself, melee-style.
    return {
      type: 'melee',
      weapon: equipped,
      speed: Math.max(COMBAT.bashMinSpeed, w.speed),
      range: 1,
      accuracyBonus: Math.floor(w.accuracy * COMBAT.bashScale) + armor.accuracy,
      damageBonus: Math.floor(w.damage * COMBAT.bashScale) + armor.damage,
      explosive: false,
      shellSlot: null,
      outOfAmmo,
      keptForQuest,
    };
  }
  return {
    type: w.type,
    weapon: equipped,
    speed: w.speed,
    range: w.range,
    accuracyBonus: w.accuracy + armor.accuracy,
    damageBonus: w.damage + shellDamage + armor.damage,
    explosive: w.ammo === 'hash',
    shellSlot,
    outOfAmmo,
    keptForQuest,
  };
}

/** True if the ammo slot holds ammo this weapon can fire. */
function loaded(player: PlayerState, ctx: SimContext, type: 'rounds' | 'coom'): boolean {
  const ammo = player.equipment.ammo;
  return (
    !!ammo && ammo.qty > 0 && (ctx.content.items.get(ammo.itemId)?.ammoType ?? 'rounds') === type
  );
}

/** Spends one round, vial or Hash shell for a shot. */
export function consumeAmmo(player: PlayerState, profile: AttackProfile): void {
  if (profile.type !== 'gun') return;
  if (profile.shellSlot !== null) {
    const shell = player.inventory[profile.shellSlot];
    if (shell) {
      shell.qty -= 1;
      if (shell.qty === 0) player.inventory[profile.shellSlot] = null;
    }
    return;
  }
  const ammo = player.equipment.ammo;
  if (ammo) {
    ammo.qty -= 1;
    if (ammo.qty === 0) player.equipment.ammo = null;
  }
}

export function armorTotals(
  player: PlayerState,
  ctx: SimContext,
): { defense: number; accuracy: number; damage: number } {
  let defense = 0;
  let accuracy = 0;
  let damage = 0;
  for (const slot of Object.values(player.equipment)) {
    const armor = slot && ctx.content.items.get(slot.itemId)?.armor;
    if (armor) {
      defense += armor.defense;
      accuracy += armor.accuracy;
      damage += armor.damage;
    }
  }
  return { defense, accuracy, damage };
}

/**
 * XP multiplier from worn skilling outfit pieces (OSRS prospector-kit style):
 * each piece adds its %, and the full set adds a bonus on top.
 */
export function xpMultiplier(player: PlayerState, ctx: SimContext, skillId: string): number {
  let pct = 0;
  let pieces = 0;
  for (const slot of Object.values(player.equipment)) {
    const bonus = slot && ctx.content.items.get(slot.itemId)?.xpBonus;
    if (bonus?.skill !== skillId) continue;
    pct += bonus.pct;
    pieces += 1;
  }
  if (pieces >= OUTFITS.setPieces) pct += OUTFITS.setBonusPct;
  return 1 + pct / 100;
}
