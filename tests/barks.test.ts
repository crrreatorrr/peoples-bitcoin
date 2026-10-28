import { describe, expect, it } from 'vitest';
import { CHAT } from '../src/config/balance';
import { barkOnAggro } from '../src/sim/barks';
import { damageEnemy } from '../src/sim/combat';
import { newEnemy, type SimEvent } from '../src/sim/state';
import { runTick } from '../src/sim/tick';
import { content, newGame } from './helpers';

const said = (events: SimEvent[], speaker: string) =>
  events.flatMap((e) => (e.type === 'message' && e.speaker === speaker ? [e.text] : []));

/** A Captain Motion standing next to a fresh player in the Treasury. */
function captainFight() {
  const { state, ctx } = newGame();
  const { x, y } = state.player.pos;
  const captain = newEnemy('boss', 'enemy_captain_motion', x + 1, y, content(), false);
  state.zone.enemies = [captain];
  return { state, ctx, captain, def: content().enemies.get('enemy_captain_motion')! };
}

describe('enemy barks', () => {
  it('says a fight-start line once per life, in chat and overhead', () => {
    const { state, ctx, captain, def } = captainFight();
    captain.target = 'player';
    const events: SimEvent[] = [];
    barkOnAggro(state, ctx, captain, events);
    barkOnAggro(state, ctx, captain, events);
    const lines = said(events, 'Captain Motion');
    expect(lines).toHaveLength(1);
    expect(def.barks!.aggro).toContain(lines[0]);
    expect(captain.overhead?.text).toBe(lines[0]);
  });

  it('says the hurt line once, at half HP, and a line when beaten', () => {
    const { state, ctx, captain, def } = captainFight();
    const events: SimEvent[] = [];
    damageEnemy(state, ctx, captain, Math.ceil(def.hp / 2), events);
    damageEnemy(state, ctx, captain, 1, events);
    expect(said(events, 'Captain Motion')).toEqual(def.barks!.hurt);
    damageEnemy(state, ctx, captain, def.hp, events);
    expect(said(events, 'Captain Motion')).toEqual([...def.barks!.hurt, ...def.barks!.defeat]);
  });

  it('starts talking when it aggroes in the sim, and the line fades', () => {
    const { state, ctx, captain } = captainFight();
    const events = runTick(state, ctx, []);
    expect(said(events, 'Captain Motion')).toHaveLength(1);
    expect(captain.overhead).not.toBeNull();
    for (let i = 0; i < CHAT.overheadTicks; i++) runTick(state, ctx, []);
    expect(captain.overhead).toBeNull();
  });

  it('keeps quiet for enemies without lines', () => {
    const { state, ctx } = newGame();
    const { x, y } = state.player.pos;
    const bot = newEnemy('bot', 'enemy_spam_bot', x + 1, y, content(), false);
    bot.target = 'player';
    const events: SimEvent[] = [];
    barkOnAggro(state, ctx, bot, events);
    damageEnemy(state, ctx, bot, 99, events);
    expect(events.filter((e) => e.type === 'message' && e.speaker)).toEqual([]);
  });

  it('gives every Trenches boss something to say', () => {
    for (const id of ['enemy_sludge_mother', 'enemy_wrongnamer_chief', 'enemy_captain_motion']) {
      const barks = content().enemies.get(id)!.barks!;
      expect(barks.aggro.length).toBeGreaterThan(0);
      expect(barks.hurt.length).toBeGreaterThan(0);
      expect(barks.defeat.length).toBeGreaterThan(0);
    }
  });
});
