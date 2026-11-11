/** Boss mechanics beyond adds (src/sim/bossMechanics.ts): falling sludge, the shouted ticker, the rage-quit run. */
import { describe, expect, it } from 'vitest';
import { BOSSES, CHAT } from '../src/config/balance';
import quickchat from '../src/data/quickchat.json';
import { answerShout, heckleScale, namesTheCoin } from '../src/sim/bossMechanics';
import { damageEnemy } from '../src/sim/combat';
import { isWalkable } from '../src/sim/grid';
import {
  maxHp,
  newEnemy,
  type EnemyInstance,
  type GameState,
  type Intent,
  type SimContext,
  type SimEvent,
} from '../src/sim/state';
import { runTick, runWorldTick } from '../src/sim/tick';
import { changeZone } from '../src/sim/zones';
import { xpForLevel } from '../src/sim/xp';
import { content, give, messages, newGame } from './helpers';
import { newWorld } from './worldHelpers';

const SPAWN = {
  enemy_sludge_mother: { x: 20, y: 87 },
  enemy_wrongnamer_chief: { x: 20, y: 49 },
  enemy_captain_motion: { x: 20, y: 15 },
} as const;
type BossId = keyof typeof SPAWN;

/** The boss alone at its real spawn in the Trenches, awake, with the player four tiles south. */
function arena(bossId: BossId, seed = 5) {
  const { state, ctx } = newGame(seed);
  const at = SPAWN[bossId];
  changeZone(state, ctx, 'zone_trenches', { x: at.x, y: at.y + 4 }, []);
  state.zone.enemies = [];
  const boss = newEnemy('e900', bossId, at.x, at.y, content(), false);
  state.zone.enemies.push(boss);
  return { state, ctx, boss, def: content().enemies.get(bossId)! };
}

/** A tough player the boss can hit all day, so a test can watch the mechanic alone. */
function sturdy(state: GameState) {
  state.player.skills.hitpoints = xpForLevel(99);
  state.player.hp = 99;
  state.player.autoRetaliate = false;
}

function runFor(state: GameState, ctx: SimContext, ticks: number, intents: Intent[] = []) {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...runTick(state, ctx, i === 0 ? intents : []));
  return all;
}

describe('boss mechanics are data', () => {
  it('each Trench boss has its mechanic, and nobody else does', () => {
    const withMechanic = [...content().enemies.values()]
      .filter((e) => e.boss?.mechanic)
      .map((e) => [e.id, e.boss!.mechanic]);
    expect(withMechanic).toEqual([
      ['enemy_sludge_mother', 'sludge'],
      ['enemy_wrongnamer_chief', 'heckle'],
      ['enemy_captain_motion', 'flee'],
    ]);
  });
});

describe('Sludge Mother: falling sludge', () => {
  it('does nothing above half HP', () => {
    const { state, ctx, boss } = arena('enemy_sludge_mother');
    sturdy(state);
    boss.target = 'player';
    const events = runFor(state, ctx, 40);
    expect(events.some((e) => e.type === 'telegraph')).toBe(false);
    expect(boss.sludge).toBeUndefined();
  });

  it('below half HP she marks the tiles around you, and sludge lands there 3 ticks later', () => {
    const { state, ctx, boss, def } = arena('enemy_sludge_mother');
    sturdy(state);
    boss.target = 'player';
    boss.hp = Math.floor(def.hp * BOSSES.sludge.belowHpShare);
    const events = runTick(state, ctx, []);
    const mark = events.find((e) => e.type === 'telegraph');
    if (mark?.type !== 'telegraph') throw new Error('no telegraph');
    const { x, y } = state.player.pos;
    expect(mark.landsAtTick).toBe(state.tick + BOSSES.sludge.landAfterTicks);
    expect(mark.tiles).toContainEqual([x, y]);
    const grid = ctx.grids.get('zone_trenches')!;
    for (const [tx, ty] of mark.tiles) {
      expect(Math.max(Math.abs(tx - x), Math.abs(ty - y))).toBeLessThanOrEqual(1);
      expect(isWalkable(grid, tx, ty)).toBe(true);
    }
    expect(messages(events).some((m) => m.includes('Move off the marked tiles'))).toBe(true);

    // Standing still: the sludge lands for 1..maxDamage.
    const before = state.player.hp;
    const landed = runFor(state, ctx, BOSSES.sludge.landAfterTicks);
    expect(messages(landed)).toContain(
      'Sludge rains down on you! Step off the marked ground next time.',
    );
    const lost = before - state.player.hp;
    expect(lost).toBeGreaterThanOrEqual(1);
    expect(boss.sludge).toBeUndefined();

    // The next one comes everyTicks after the first.
    const later = runFor(state, ctx, BOSSES.sludge.everyTicks);
    expect(later.filter((e) => e.type === 'telegraph')).toHaveLength(1);
  });

  it('stepping off the marked tiles avoids it', () => {
    const { state, ctx, boss, def } = arena('enemy_sludge_mother');
    sturdy(state);
    boss.target = 'player';
    boss.hp = Math.floor(def.hp * BOSSES.sludge.belowHpShare);
    runTick(state, ctx, []);
    const { x, y } = state.player.pos;
    const events = runFor(state, ctx, BOSSES.sludge.landAfterTicks, [
      { type: 'walk', x, y: y + 2 },
    ]);
    expect(state.player.pos).toEqual({ x, y: y + 2 });
    expect(messages(events).some((m) => m.startsWith('Sludge rains down'))).toBe(false);
  });

  it('sludge alone never does more than maxDamage', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { state, ctx, boss, def } = arena('enemy_sludge_mother', seed);
      sturdy(state);
      // Out of her reach and not her melee target's tile: only the sludge can hurt.
      boss.hp = Math.floor(def.hp * BOSSES.sludge.belowHpShare);
      boss.target = 'player';
      boss.nextAttackTick = state.tick + 50;
      const before = state.player.hp;
      runFor(state, ctx, BOSSES.sludge.landAfterTicks + 1);
      const lost = before - state.player.hp;
      expect(lost).toBeGreaterThanOrEqual(1);
      expect(lost).toBeLessThanOrEqual(BOSSES.sludge.maxDamage);
    }
  });
});

describe('Wrong-Namer Chief: the shouted ticker', () => {
  it('knows the right name from the wrong one', () => {
    expect(namesTheCoin("It's $BITCOIN!")).toBe(true);
    expect(namesTheCoin('bitcoin')).toBe(true);
    expect(namesTheCoin("It's not $BITCON.")).toBe(true);
    expect(namesTheCoin('$BITCON')).toBe(false);
    expect(namesTheCoin('it is bitcon, actually')).toBe(false);
    expect(namesTheCoin('hello')).toBe(false);
  });

  function shouting() {
    const a = arena('enemy_wrongnamer_chief');
    sturdy(a.state);
    a.boss.target = 'player';
    const before = runFor(a.state, a.ctx, BOSSES.heckle.everyTicks);
    expect(a.boss.shout).toBeUndefined();
    const events = runTick(a.state, a.ctx, []);
    return { ...a, before, events };
  }

  it('shouts the wrong ticker every everyTicks, over his head and in chat', () => {
    const { state, boss, events } = shouting();
    expect(boss.shout).toEqual({
      until: state.tick + BOSSES.heckle.answerTicks,
      pid: 'player',
      answered: false,
    });
    expect(boss.overhead?.text).toContain('$BITCON');
    expect(boss.overhead?.untilTick).toBe(state.tick + CHAT.overheadTicks);
    expect(messages(events).some((m) => m.includes('Say the right one in chat ($BITCOIN)'))).toBe(
      true,
    );
  });

  it('unanswered, you are Heckled: accuracy x0.75 for heckledTicks', () => {
    const { state, ctx, boss } = shouting();
    const events = runFor(state, ctx, BOSSES.heckle.answerTicks);
    expect(boss.shout).toBeUndefined();
    expect(messages(events).some((m) => m.includes('You are Heckled'))).toBe(true);
    expect(state.player.heckledUntil).toBe(state.tick + BOSSES.heckle.heckledTicks);
    expect(heckleScale(state)).toBe(BOSSES.heckle.accuracyScale);
    runFor(state, ctx, BOSSES.heckle.heckledTicks);
    expect(heckleScale(state)).toBe(1);
  });

  it('saying the right name in chat in time avoids it', () => {
    const { state, ctx, boss } = shouting();
    const said = runTick(state, ctx, [{ type: 'chat', text: "It's $BITCOIN!" }]);
    expect(boss.shout?.answered).toBe(true);
    expect(messages(said).some((m) => m.includes('You call it by its name'))).toBe(true);
    const events = runFor(state, ctx, BOSSES.heckle.answerTicks);
    expect(messages(events).some((m) => m.includes('You are Heckled'))).toBe(false);
    expect(heckleScale(state)).toBe(1);
  });

  it('the wrong name, or the right one too late, does not help', () => {
    const { state, ctx, boss } = shouting();
    runTick(state, ctx, [{ type: 'chat', text: '$BITCON' }]);
    expect(boss.shout?.answered).toBe(false);
    runFor(state, ctx, BOSSES.heckle.answerTicks);
    expect(heckleScale(state)).toBe(BOSSES.heckle.accuracyScale);
    // No shout is open now, so this answers nothing.
    expect(answerShout(state, '$BITCOIN', [])).toBe(false);
    expect(heckleScale(state)).toBe(BOSSES.heckle.accuracyScale);
  });

  it('the quick-chat list has a line that answers him', () => {
    const lines = quickchat.groups.flatMap((g) => g.phrases.map((p) => p.text));
    expect(lines).toContain("It's $BITCOIN!");
    expect(lines.filter(namesTheCoin).length).toBeGreaterThanOrEqual(2);
    expect(namesTheCoin("It's not $BITCON.")).toBe(true);
  });
});

describe('Captain Motion: the rage-quit run', () => {
  function nearlyBeaten(seed = 5) {
    const a = arena('enemy_captain_motion', seed);
    sturdy(a.state);
    a.boss.target = 'player';
    a.boss.hp = Math.floor(a.def.hp * BOSSES.flee.atHpShare);
    return a;
  }

  it('at 10% HP he stops fighting and runs for the north barricade', () => {
    const { state, ctx, boss } = nearlyBeaten();
    const first = runTick(state, ctx, []);
    expect(boss.flee).toEqual({ until: state.tick + BOSSES.flee.ticks });
    expect(
      messages(first).some((m) => m.includes('rage-quits and runs for the north barricade')),
    ).toBe(true);
    const startY = boss.y;
    const events = runFor(state, ctx, 10);
    expect(events.some((e) => e.type === 'attack' && e.attackerId === boss.id)).toBe(false);
    expect(boss.y).toBeLessThan(startY);
    // He stops on the near side of the barricade north of his spawn.
    const gate = state.zone.objects
      .filter(
        (o) =>
          content().objects.get(o.defId)?.role === 'gate' && o.y < SPAWN.enemy_captain_motion.y,
      )
      .sort((p, q) => q.y - p.y)[0];
    expect({ x: boss.x, y: boss.y }).toEqual({ x: gate.x, y: gate.y + 1 });
    expect(boss.target).toBe('player');
  });

  it('left alone he comes back with 30% HP and fights again', () => {
    const { state, ctx, boss, def } = nearlyBeaten();
    runFor(state, ctx, BOSSES.flee.ticks);
    expect(boss.flee).toBeDefined();
    const events = runTick(state, ctx, []);
    expect(boss.flee).toBeUndefined();
    expect(boss.hp).toBe(Math.ceil(def.hp * BOSSES.flee.returnHpShare));
    expect(messages(events)).toContain('Captain Motion got his wind back.');
    const after = runFor(state, ctx, 30);
    expect(after.some((e) => e.type === 'attack' && e.attackerId === boss.id)).toBe(true);
  });

  it('finished during the run, he is beaten for good', () => {
    const { state, ctx, boss } = nearlyBeaten();
    runFor(state, ctx, 5);
    const events: SimEvent[] = [];
    damageEnemy(state, ctx, boss, 9999, events);
    expect(boss.respawnAt).not.toBeNull();
    expect(state.player.unlocks).toContain('boss:enemy_captain_motion');
    expect(messages(events)).toContain('Captain Motion is defeated! The way forward is open.');
  });
});

describe('mechanics reset and stay private', () => {
  it('a respawned boss starts clean', () => {
    const { state, ctx, boss, def } = arena('enemy_wrongnamer_chief');
    boss.shout = { until: 9999, pid: 'player', answered: false };
    boss.nextMechanicTick = 9999;
    boss.sludge = { tiles: [], landsAt: 9999 };
    boss.flee = { until: 9999 };
    damageEnemy(state, ctx, boss, 9999, []);
    // Out of his sight, so he respawns without picking a new fight.
    state.player.pos = { x: 20, y: 60 };
    runFor(state, ctx, def.respawnTicks + 2);
    expect(boss.respawnAt).toBeNull();
    expect(boss.shout).toBeUndefined();
    expect(boss.sludge).toBeUndefined();
    expect(boss.flee).toBeUndefined();
    expect(boss.nextMechanicTick).toBeUndefined();
  });

  it("online, one player's boss only marks, shouts at and hears that player", () => {
    const { world, ctx, views } = newWorld(['a', 'b'], 9);
    for (const v of Object.values(views)) changeZone(v, ctx, 'zone_trenches', { x: 20, y: 91 }, []);
    const zone = views.a.zone;
    zone.enemies = [];
    for (const v of Object.values(views)) sturdy(v);

    // A's private Sludge Mother, below half: B stands on the same tile as A.
    const mother = newEnemy('e900', 'enemy_sludge_mother', 20, 87, content(), false);
    mother.owner = 'a';
    mother.target = 'p:a';
    mother.hp = 10;
    mother.nextAttackTick = 9999;
    zone.enemies.push(mother);
    const out = runWorldTick(world, ctx, {});
    expect(out.a.some((e) => e.type === 'telegraph')).toBe(true);
    expect(out.b.some((e) => e.type === 'telegraph')).toBe(false);
    const hpB = views.b.player.hp;
    const hpA = views.a.player.hp;
    for (let i = 0; i < BOSSES.sludge.landAfterTicks; i++) runWorldTick(world, ctx, {});
    expect(views.b.player.hp).toBe(hpB);
    expect(views.a.player.hp).toBeLessThan(hpA);

    // A's private Chief shouts at A. B naming the coin does not answer for A.
    zone.enemies = [];
    const chief: EnemyInstance = newEnemy(
      'e901',
      'enemy_wrongnamer_chief',
      20,
      87,
      content(),
      false,
    );
    chief.owner = 'a';
    chief.target = 'p:a';
    chief.nextAttackTick = 99999;
    chief.nextMechanicTick = world.tick + 1;
    zone.enemies.push(chief);
    runWorldTick(world, ctx, {});
    expect(chief.shout?.pid).toBe('a');
    expect(answerShout(views.b, '$BITCOIN', [])).toBe(false);
    expect(chief.shout?.answered).toBe(false);
    expect(answerShout(views.a, '$BITCOIN', [])).toBe(true);
    expect(chief.shout?.answered).toBe(true);
  });
});

// ── Duels: each boss is beatable at the level DECISIONS.md states, and the response matters ──

interface Kit {
  boss: BossId;
  skills: Record<string, number>;
  weapon: string;
  armor: Record<string, string>;
  food: string;
  style?: 'rapid';
}

const CAMPAIGN = {
  head: 'item_campaign_hat',
  body: 'item_campaign_jacket',
  legs: 'item_campaign_slacks',
  feet: 'item_campaign_loafers',
  hands: 'item_grip_gloves',
};
const FLAK = {
  head: 'item_flak_helmet',
  body: 'item_flak_vest',
  legs: 'item_flak_pants',
  feet: 'item_combat_boots',
  hands: 'item_grip_gloves',
};

/**
 * Fights the boss with a full pack of food, eating below 60% HP. With `respond` the bot does
 * what the mechanic asks: steps off marked tiles, names the coin, keeps shooting a fleeing boss.
 * Without it, it stands in the sludge, stays silent and lets a fleeing boss go.
 */
function duel(seed: number, kit: Kit, respond: boolean) {
  const { state, ctx, boss } = arena(kit.boss, seed);
  const p = state.player;
  for (const [k, lv] of Object.entries(kit.skills)) p.skills[k] = xpForLevel(lv);
  p.hp = maxHp(p);
  p.equipment.weapon = { itemId: kit.weapon, qty: 1 };
  if (content().items.get(kit.weapon)!.weapon!.ammo === 'rounds')
    p.equipment.ammo = { itemId: 'item_rounds', qty: 5000 };
  for (const [slot, id] of Object.entries(kit.armor))
    (p.equipment as unknown as Record<string, unknown>)[slot] = { itemId: id, qty: 1 };
  give(state, kit.food, 27);
  if (kit.style) p.style = kit.style;
  const heal = content().items.get(kit.food)!.food!.heal;
  let dodging = false;
  let died = false;
  let heckles = 0;
  let sludgeHits = 0;
  for (let i = 0; i < 3000; i++) {
    if (boss.respawnAt !== null) return { win: true, ticks: i, heckles, sludgeHits };
    if (died) return { win: false, ticks: i, heckles, sludgeHits };
    const intents: Intent[] = [];
    const max = maxHp(p);
    const slot = p.inventory.findIndex((s) => s?.itemId === kit.food);
    if (slot >= 0 && p.hp <= max - heal && p.hp < max * 0.6 && state.tick >= p.nextEatTick)
      intents.push({ type: 'eat', slot });
    if (respond && boss.shout && !boss.shout.answered)
      intents.push({ type: 'chat', text: "It's $BITCOIN!" });
    const marked = boss.sludge?.tiles.some((t) => t.x === p.pos.x && t.y === p.pos.y) ?? false;
    if (respond && boss.sludge && marked) {
      if (!dodging) {
        dodging = true;
        const away = [
          [0, 2],
          [2, 0],
          [-2, 0],
          [0, -2],
        ]
          .map(([dx, dy]) => ({ x: p.pos.x + dx, y: p.pos.y + dy }))
          .find(
            (t) =>
              !boss.sludge!.tiles.some((m) => m.x === t.x && m.y === t.y) &&
              !(t.x === boss.x && t.y === boss.y),
          );
        if (away) intents.push({ type: 'walk', x: away.x, y: away.y });
      }
    } else if (!boss.sludge) {
      dodging = false;
      if (!respond && boss.flee) p.action = null;
      else if (!p.action) intents.push({ type: 'interact', targetId: boss.id, action: 'Attack' });
    }
    for (const e of runTick(state, ctx, intents)) {
      if (e.type === 'death' && e.entityId === 'player') died = true;
      if (e.type === 'message' && e.text.includes('You are Heckled')) heckles++;
      if (e.type === 'message' && e.text.startsWith('Sludge rains')) sludgeHits++;
    }
  }
  return { win: false, ticks: 3000, heckles, sludgeHits };
}

const SEEDS = [17, 34, 51, 68, 85, 102, 119, 136];
const tally = (kit: Kit, respond: boolean) => {
  const runs = SEEDS.map((s) => duel(s, kit, respond));
  return {
    wins: runs.filter((r) => r.win).length,
    heckles: runs.reduce((n, r) => n + r.heckles, 0),
    sludgeHits: runs.reduce((n, r) => n + r.sludgeHits, 0),
  };
};

describe('boss duels with the mechanics', () => {
  it('Sludge Mother: Shooting 15 and the shotgun win by stepping out of the sludge', () => {
    const kit: Kit = {
      boss: 'enemy_sludge_mother',
      skills: { shooting: 15, hitpoints: 14, defense: 7 },
      weapon: 'gun_confetti_shotgun',
      armor: CAMPAIGN,
      food: 'item_tp_soundbite',
    };
    const dodge = tally(kit, true);
    const stand = tally(kit, false);
    expect(dodge.wins).toBe(SEEDS.length);
    expect(dodge.sludgeHits).toBe(0);
    expect(stand.sludgeHits).toBeGreaterThan(SEEDS.length * 5);
    expect(stand.wins).toBeLessThan(dodge.wins);
  });

  it('Wrong-Namer Chief: Melee 30 and the Iron Gavel win more often by naming the coin', () => {
    const kit: Kit = {
      boss: 'enemy_wrongnamer_chief',
      skills: { melee: 30, shooting: 30, hitpoints: 30, defense: 20 },
      weapon: 'item_iron_gavel',
      armor: FLAK,
      food: 'item_tp_zinger',
    };
    const answer = tally(kit, true);
    const silent = tally(kit, false);
    expect(answer.heckles).toBe(0);
    expect(silent.heckles).toBeGreaterThan(SEEDS.length * 10);
    // Naming the coin costs nothing, so this is the fight as it was before the mechanic.
    expect(answer.wins).toBeGreaterThanOrEqual(SEEDS.length / 2);
    expect(silent.wins).toBeLessThan(answer.wins);
  });

  it('Captain Motion: Shooting 45 and the rifle on Rapid can finish him; letting him run cannot', () => {
    const kit: Kit = {
      boss: 'enemy_captain_motion',
      skills: { shooting: 45, melee: 30, hitpoints: 40, defense: 30 },
      weapon: 'gun_treasury_rifle',
      armor: FLAK,
      food: 'item_tp_mic_drop',
      style: 'rapid',
    };
    const chase = tally(kit, true);
    const wait = tally(kit, false);
    expect(chase.wins).toBeGreaterThanOrEqual(SEEDS.length / 2);
    expect(wait.wins).toBe(0);
  });
});
