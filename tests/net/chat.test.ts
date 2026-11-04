/** Online chat: public in view, PMs in and across worlds, filters, ignores, quick-chat. */
import { describe, expect, it } from 'vitest';
import { CHAT_NET } from '../../src/config/balance';
import { OP } from '../../src/net/protocol';
import { xpForLevel } from '../../src/sim/xp';
import { fakeIO, testWorld } from './helpers';

const lines = (w: ReturnType<typeof testWorld>, uid: string) =>
  w.take(uid, OP.CHAT_OUT).map((m) => m.body as Record<string, unknown>);

function three() {
  const w = testWorld();
  w.join('a', 'Alice');
  w.join('b', 'Bob');
  w.join('c', 'Carol');
  // Carol walks out of view.
  w.host.viewOf('c')!.player.pos = { x: 2, y: 2 };
  for (const u of ['a', 'b', 'c']) w.take(u);
  return w;
}

describe('online chat', () => {
  it('public chat reaches players in view, with overhead text', () => {
    const w = three();
    w.send('a', OP.CHAT, { ch: 'public', text: 'hello there' });
    w.flush();
    expect(lines(w, 'b')).toContainEqual(
      expect.objectContaining({ ch: 'public', from: 'Alice', text: 'hello there' }),
    );
    expect(lines(w, 'c')).toHaveLength(0);
    expect(w.host.viewOf('a')!.player.overhead?.text).toBe('hello there');
  });

  it('respects the public filter and ignore list', () => {
    const w = three();
    w.host.viewOf('b')!.player.social.publicFilter = 'off';
    w.send('a', OP.CHAT, { ch: 'public', text: 'anyone?' });
    w.flush();
    expect(lines(w, 'b')).toHaveLength(0);
    w.host.viewOf('b')!.player.social.publicFilter = 'friends';
    w.send('a', OP.CHAT, { ch: 'public', text: 'still nobody?' });
    w.flush();
    expect(lines(w, 'b')).toHaveLength(0);
    w.host.viewOf('b')!.player.social.publicFilter = 'on';
    w.send('b', OP.SOCIAL, { op: 'addIgnore', name: 'Alice' });
    w.send('a', OP.CHAT, { ch: 'public', text: 'hello?' });
    w.flush();
    expect(lines(w, 'b').filter((l) => l.ch === 'public')).toHaveLength(0);
  });

  it('blocks links and slurs, and mutes after repeated strikes', () => {
    const w = three();
    for (let i = 0; i < CHAT_NET.strikesToMute; i++) {
      w.send('a', OP.CHAT, { ch: 'public', text: `visit site${i}.com` });
    }
    w.flush();
    expect(lines(w, 'b')).toHaveLength(0);
    const mine = lines(w, 'a');
    expect(mine.some((l) => String(l.text).includes('muted'))).toBe(true);
    w.send('a', OP.CHAT, { ch: 'public', text: 'clean words' });
    w.flush();
    expect(lines(w, 'b')).toHaveLength(0);
    // Quick-chat still works while muted.
    w.send('a', OP.CHAT, { ch: 'quick', phrase: 'hi' });
    w.flush();
    expect(lines(w, 'b')).toContainEqual(expect.objectContaining({ text: 'Hello!', quick: true }));
  });

  it('rate-limits and drops repeats', () => {
    const w = three();
    w.send('a', OP.CHAT, { ch: 'public', text: 'same' });
    w.send('a', OP.CHAT, { ch: 'public', text: 'same' });
    w.flush();
    expect(lines(w, 'b').filter((l) => l.ch === 'public')).toHaveLength(1);
    for (let i = 0; i < CHAT_NET.publicPerWindow + 2; i++)
      w.send('a', OP.CHAT, { ch: 'public', text: `m${i}` });
    w.flush();
    expect(lines(w, 'b').filter((l) => l.ch === 'public').length).toBeLessThanOrEqual(
      CHAT_NET.publicPerWindow,
    );
  });

  it('quick-chat slots come from the server state', () => {
    const w = three();
    w.host.viewOf('a')!.player.skills.mining = xpForLevel(42);
    w.send('a', OP.CHAT, { ch: 'quick', phrase: 'level:mining' });
    w.flush();
    expect(lines(w, 'b')).toContainEqual(
      expect.objectContaining({ text: 'My Mining level is 42.' }),
    );
    w.send('a', OP.CHAT, { ch: 'quick', phrase: 'level:not_a_skill' });
    w.send('a', OP.CHAT, { ch: 'quick', phrase: 'made_up' });
    w.flush();
    expect(lines(w, 'b')).toHaveLength(0);
  });

  it('PMs in the same world, with reply and private filter', () => {
    const w = three();
    w.send('a', OP.CHAT, { ch: 'pm', to: 'carol', text: 'psst' });
    w.flush();
    expect(lines(w, 'c')).toContainEqual(
      expect.objectContaining({ ch: 'pm_in', from: 'Alice', text: 'psst' }),
    );
    expect(lines(w, 'a')).toContainEqual(expect.objectContaining({ ch: 'pm_out', to: 'Carol' }));
    w.send('c', OP.CHAT, { ch: 'reply', text: 'yes?' });
    w.flush();
    expect(lines(w, 'a')).toContainEqual(expect.objectContaining({ ch: 'pm_in', from: 'Carol' }));
    w.host.viewOf('c')!.player.social.privateFilter = 'off';
    w.send('a', OP.CHAT, { ch: 'pm', to: 'Carol', text: 'hello??' });
    w.flush();
    expect(lines(w, 'c').filter((l) => l.ch === 'pm_in')).toHaveLength(0);
    expect(lines(w, 'a')).toContainEqual(
      expect.objectContaining({ ch: 'system', text: 'Carol is currently offline.' }),
    );
  });

  it('PMs across worlds go through the other world signal', () => {
    const io = fakeIO();
    const w1 = testWorld({ io, matchId: 'm1', worldNo: 1 });
    const w2 = testWorld({ io, matchId: 'm2', worldNo: 2 });
    io.signalHandler = (matchId, data) =>
      matchId === 'm2' ? w2.host.signal(data) : w1.host.signal(data);
    w1.join('a', 'Alice');
    w2.join('d', 'Dave');
    w1.take('a');
    w2.take('d');
    w1.send('a', OP.CHAT, { ch: 'pm', to: 'Dave', text: 'hi from world one' });
    w1.flush();
    w2.flush();
    expect(lines(w2, 'd')).toContainEqual(
      expect.objectContaining({ ch: 'pm_in', from: 'Alice', world: 1 }),
    );
    expect(lines(w1, 'a')).toContainEqual(expect.objectContaining({ ch: 'pm_out', to: 'Dave' }));
    // The recipient's ignore list applies on their world.
    w2.send('d', OP.SOCIAL, { op: 'addIgnore', name: 'Alice' });
    w2.flush();
    w1.send('a', OP.CHAT, { ch: 'pm', to: 'Dave', text: 'again' });
    w1.flush();
    w2.flush();
    expect(lines(w2, 'd').filter((l) => l.ch === 'pm_in')).toHaveLength(0);
  });

  it('friends list shows worlds and respects private filters', () => {
    const io = fakeIO();
    const w1 = testWorld({ io, matchId: 'm1', worldNo: 1 });
    const w2 = testWorld({ io, matchId: 'm2', worldNo: 2 });
    w1.join('a', 'Alice');
    w2.join('d', 'Dave');
    w1.send('a', OP.SOCIAL, { op: 'addFriend', name: 'dave' });
    w1.flush();
    const social = w1.take('a', OP.SOCIAL_OUT).at(-1)!.body;
    expect(social.friends).toEqual([{ name: 'Dave', world: 2 }]);
    w2.send('d', OP.SOCIAL, { op: 'filters', public: 'on', private: 'off', trade: 'on' });
    w2.flush();
    w1.send('a', OP.SOCIAL, { op: 'filters', public: 'on', private: 'on', trade: 'on' });
    w1.flush();
    expect(w1.take('a', OP.SOCIAL_OUT).at(-1)!.body.friends).toEqual([
      { name: 'Dave', world: null },
    ]);
    w1.send('a', OP.SOCIAL, { op: 'addFriend', name: 'nobody' });
    w1.flush();
    expect(lines(w1, 'a')).toContainEqual(
      expect.objectContaining({ text: 'Unable to add nobody - unknown player.' }),
    );
  });

  it('a reserved username gets a neutral nameplate', () => {
    const w = testWorld();
    w.join('a', 'Obama');
    expect(w.host.viewOf('a')!.player.displayName).toMatch(/^Citizen \d{4}$/);
  });
});
