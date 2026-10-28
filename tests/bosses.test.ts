/** Quest bosses that fear only certain weapons (EnemyDef.weakTo), hinted in their quest dialogue. */
import { describe, expect, it } from 'vitest';
import { BOSSES, COMBAT } from '../src/config/balance';
import { newEnemy, type SimEvent } from '../src/sim/state';
import { damageAfterWeakness } from '../src/sim/weakness';
import { content, newGame } from './helpers';

const item = (id: string) => content().items.get(id)!;

function boss(defId: string) {
  const { state, ctx } = newGame();
  const enemy = newEnemy('boss', defId, 1, 1, content(), false);
  state.zone.enemies = [enemy];
  return { state, ctx, enemy };
}

describe('weapon-locked bosses', () => {
  it('take full damage from their weapon and a sliver from anything else', () => {
    const { state, ctx, enemy } = boss('enemy_sludge_mother');
    const events: SimEvent[] = [];
    const shotgun = item('gun_confetti_shotgun');
    expect(damageAfterWeakness(state, ctx, enemy, shotgun, 'gun', 30, events)).toBe(30);
    expect(events).toEqual([]);
    const rifle = item('gun_treasury_rifle');
    expect(damageAfterWeakness(state, ctx, enemy, rifle, 'gun', 30, events)).toBe(
      Math.floor(30 * BOSSES.offWeaponScale),
    );
  });

  it('say so once per wrong weapon', () => {
    const { state, ctx, enemy } = boss('enemy_wrongnamer_chief');
    const events: SimEvent[] = [];
    const pistol = item('gun_campaign_pistol');
    damageAfterWeakness(state, ctx, enemy, pistol, 'gun', 10, events);
    damageAfterWeakness(state, ctx, enemy, pistol, 'gun', 10, events);
    const warnings = events.filter((e) => e.type === 'message' && e.kind === 'warning');
    expect(warnings).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({ speaker: 'Wrong-Namer Chief', text: "LOUDER! I CAN'T HEAR YOU!" }),
    );
    // Calling order with a gavel works.
    expect(
      damageAfterWeakness(state, ctx, enemy, item('item_iron_gavel'), 'melee', 10, events),
    ).toBe(10);
  });

  it('can be keyed to an attack style (the Gatecrasher fears fireworks)', () => {
    const { state, ctx, enemy } = boss('enemy_gatecrasher');
    const cannon = item('gun_hash_cannon');
    expect(damageAfterWeakness(state, ctx, enemy, cannon, 'explosive', 40, [])).toBe(40);
    expect(damageAfterWeakness(state, ctx, enemy, item('gun_press_pass_smg'), 'gun', 40, [])).toBe(
      4,
    );
  });

  it('barely notice Sprotos', () => {
    const { state, ctx, enemy } = boss('enemy_captain_motion');
    expect(damageAfterWeakness(state, ctx, enemy, null, null, 50, [])).toBe(5);
  });

  it('leave ordinary enemies alone', () => {
    const { state, ctx, enemy } = boss('enemy_sludgeling');
    expect(damageAfterWeakness(state, ctx, enemy, item('gun_campaign_pistol'), 'gun', 7, [])).toBe(
      7,
    );
  });
});

describe('every quest has a boss', () => {
  it('with a kill step, and a weakness to weapons you can actually get', () => {
    const c = content();
    // The Presidential Gavel is what you swing with nothing wielded.
    const obtainable = new Set<string>([COMBAT.fallbackWeaponId]);
    for (const shop of c.shops.values()) for (const s of shop.stock) obtainable.add(s.item);
    for (const table of c.drops.values())
      for (const t of table.table) if (t.item) obtainable.add(t.item);
    for (const q of c.quests.values()) {
      for (const r of q.reward?.items ?? []) obtainable.add(r.item);
      for (const s of q.steps) for (const r of s.reward?.items ?? []) obtainable.add(r.item);
    }
    for (const quest of c.quests.values()) {
      const bosses = quest.steps
        .flatMap((s) =>
          s.trigger.type === 'kill' && s.trigger.enemy ? [c.enemies.get(s.trigger.enemy)!] : [],
        )
        .filter((e) => e.weakTo);
      expect(bosses.length, quest.id).toBeGreaterThan(0);
      for (const b of bosses) {
        for (const w of b.weakTo!.weapons) {
          expect(c.items.get(w)?.weapon, `${b.id}: ${w}`).toBeDefined();
          expect(obtainable.has(w), `${b.id}: ${w} can't be bought or earned`).toBe(true);
        }
        expect(b.weakTo!.weapons.length + b.weakTo!.styles.length, b.id).toBeGreaterThan(0);
        expect(
          b.barks?.resist.length,
          `${b.id} says nothing when it shrugs a hit off`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
