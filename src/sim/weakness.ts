/**
 * Bosses that fear only certain weapons (EnemyDef.weakTo). Their quest's
 * dialogue hints at what works; anything else, a Sproto included, does a
 * sliver of its damage (BOSSES.offWeaponScale), and the boss says so once per
 * weapon.
 */
import { BOSSES } from '../config/balance';
import { bark } from './barks';
import type { ItemDef } from './schemas';
import type { AttackStyle, EnemyInstance, GameState, SimContext, SimEvent } from './state';

/** The damage `enemy` actually takes from a hit with `weapon` (null for a Sproto). */
export function damageAfterWeakness(
  state: GameState,
  ctx: SimContext,
  enemy: EnemyInstance,
  weapon: ItemDef | null,
  style: AttackStyle | null,
  damage: number,
  events: SimEvent[],
): number {
  const def = ctx.content.enemies.get(enemy.defId);
  const weak = def?.weakTo;
  if (!def || !weak) return damage;
  if (weapon && weak.weapons.includes(weapon.id)) return damage;
  if (style && weak.styles.includes(style)) return damage;
  const key = weapon?.id ?? 'sproto';
  if (enemy.resisted !== key) {
    enemy.resisted = key;
    const what = weapon ? `your ${weapon.name}` : 'your Sproto';
    events.push({
      type: 'message',
      kind: 'warning',
      text: `${def.name} barely feels ${what}. Something else might work better.`,
    });
    bark(state, ctx, enemy, 'resist', events);
  }
  return Math.floor(damage * BOSSES.offWeaponScale);
}
