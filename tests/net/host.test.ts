/** The pure world host: joins, intents, anti-cheat, persistence and Tickets. */
import { describe, expect, it } from 'vitest';
import { NET } from '../../src/config/balance';
import { OP } from '../../src/net/protocol';
import { fakeIO, testWorld } from './helpers';

describe('world host', () => {
  it('two players join and see each other', () => {
    const w = testWorld();
    w.join('a', 'Alice');
    w.join('b', 'Bob');
    w.ticks(1);
    const welcome = w.peek('a', OP.WELCOME)[0];
    expect(welcome?.body.you).toBe('p:a');
    const snapA = w.peek('a', OP.SNAPSHOT).at(-1) ?? w.peek('a', OP.DELTA).at(-1);
    expect(snapA).toBeDefined();
    const all = w.take('a').flatMap((m) => (m.body.ent as { id: string; name?: string }[]) ?? []);
    expect(all.some((e) => e.id === 'p:b' && e.name === 'Bob')).toBe(true);
    expect(JSON.parse(w.host.label())).toMatchObject({
      game: 'peoples-bitcoin',
      kind: 'pb_world',
      players: 2,
      open: true,
    });
  });

  it('applies validated intents on the next tick', () => {
    const w = testWorld();
    w.join('a');
    w.join('b');
    const start = { ...w.host.viewOf('a')!.player.pos };
    w.send('a', OP.INTENTS, { seq: 1, intents: [{ type: 'walk', x: start.x, y: start.y + 4 }] });
    w.ticks(2);
    expect(w.host.viewOf('a')!.player.pos).not.toEqual(start);
    const deltas = w.take('b', OP.DELTA);
    expect(deltas.some((d) => (d.body.ent as { id: string }[]).some((e) => e.id === 'p:a'))).toBe(
      true,
    );
    expect(w.take('a', OP.DELTA).at(-1)!.body.ack).toBe(1);
  });

  it('forged or out-of-context ops change nothing', () => {
    const w = testWorld();
    w.join('a');
    w.ticks(1);
    const before = JSON.stringify(w.host.viewOf('a')!.player.inventory);
    w.send('a', OP.INTENTS, {
      seq: 1,
      intents: [
        { type: 'setState', hp: 999 },
        { type: 'withdraw', index: 0, qty: 'all' },
        { type: 'buy', itemId: 'item_rounds', qty: 1 },
      ],
    });
    w.ticks(1);
    expect(w.host.viewOf('a')!.player.hp).toBeLessThan(999);
    expect(JSON.stringify(w.host.viewOf('a')!.player.inventory)).toBe(before);
    expect(w.io.spends).toHaveLength(0);
    expect(w.io.logs.some((l) => l.includes('strike a'))).toBe(true);
  });

  it('kicks a flooding client', () => {
    const w = testWorld();
    w.join('a');
    for (let i = 0; i < NET.maxMessagesPerLoop * (NET.floodStrikesToKick + 1); i++) {
      w.send('a', OP.PING, { t: i });
    }
    w.flush();
    expect(w.kicked).toContain('a');
    expect(w.take('a', OP.KICK)[0].body.reason).toBe('flood');
    expect(w.host.size()).toBe(0);
  });

  it('kicks a client with another sim version', () => {
    const w = testWorld();
    w.join('a', 'a', false);
    w.send('a', OP.HELLO, { proto: 1, sim: 'other' });
    w.flush();
    expect(w.take('a', OP.KICK)[0].body.reason).toBe('sim_mismatch');
  });

  it('rejects non-game sessions and a full world', () => {
    const w = testWorld();
    expect(w.host.joinAttempt({ userId: 'x', sessionId: 's', username: 'x' }, null).accept).toBe(
      false,
    );
    for (let i = 0; i < NET.maxPlayersPerWorld; i++) w.join(`u${i}`, `u${i}`, false);
    expect(w.join('late').reason).toBe('world_full');
  });

  it('one world per account: a join elsewhere signals the old world', () => {
    const io = fakeIO();
    const w1 = testWorld({ io, matchId: 'm1', worldNo: 1 });
    const w2 = testWorld({ io, matchId: 'm2', worldNo: 2 });
    io.signalHandler = (matchId, data) => (matchId === 'm1' ? w1.host.signal(data) : null);
    w1.join('a');
    expect(io.online.get('a')?.world).toBe(1);
    const verdict = w2.join('a');
    expect(verdict.reason).toBe('already_online');
    expect(w1.host.size()).toBe(0);
    // The retry gets in.
    expect(w2.join('a').accept).toBe(true);
  });

  it('a stale save version kicks the player as superseded', () => {
    const w = testWorld();
    w.join('a');
    w.io.storage.set('a', { data: {}, version: 'written-elsewhere' });
    w.ticks(NET.saveEveryTicks + 1);
    expect(w.take('a', OP.KICK).some((k) => k.body.reason === 'superseded')).toBe(true);
    expect(w.io.storage.get('a')!.version).toBe('written-elsewhere');
  });

  it('a dropped connection resumes the same character within the grace period', () => {
    const w = testWorld();
    w.join('a');
    const view = w.host.viewOf('a')!;
    view.player.inventory[0] = { itemId: 'item_rounds', qty: 7 };
    w.leave('a');
    w.ticks(NET.logoutGraceTicks - 2);
    expect(w.host.viewOf('a')).toBe(view);
    w.join('a');
    w.ticks(1);
    expect(w.host.viewOf('a')!.player.inventory[0]).toEqual({ itemId: 'item_rounds', qty: 7 });
    expect(w.take('a', OP.SNAPSHOT).length).toBeGreaterThan(0);
  });

  it('logs out after the grace period and saves, then loads that save next time', () => {
    const w = testWorld();
    w.join('a');
    w.host.viewOf('a')!.player.inventory[0] = { itemId: 'item_rounds', qty: 9 };
    w.leave('a');
    w.ticks(NET.logoutGraceTicks + 1);
    expect(w.host.size()).toBe(0);
    expect(w.io.storage.has('a')).toBe(true);
    const w2 = testWorld({ io: w.io, matchId: 'm2' });
    w2.join('a');
    expect(w2.host.viewOf('a')!.player.inventory[0]).toEqual({ itemId: 'item_rounds', qty: 9 });
  });

  it('saves every NET.saveEveryTicks', () => {
    const w = testWorld();
    w.join('a');
    w.ticks(NET.saveEveryTicks + 1);
    expect(w.io.storage.has('a')).toBe(true);
  });

  it('stream Tickets are sealed in the save before the earn, with a stable key', () => {
    const w = testWorld();
    w.join('a');
    const view = w.host.viewOf('a')!;
    view.player.ledger.streams.pb_drop.pending = 12;
    let sealedInSave = false;
    w.io.earnReply = (_amount, _reason, key) => {
      const saved = w.io.storage.get('a')?.data as {
        player: { ledger: { batches: Record<string, { id: string }> } };
      };
      sealedInSave = saved?.player.ledger.batches.pb_drop?.id === key;
      return {};
    };
    w.ticks(NET.ticketFlushEveryTicks + 1);
    expect(w.io.earns).toHaveLength(1);
    expect(w.io.earns[0]).toMatchObject({ userId: 'a', amount: 12, reason: 'pb_drop' });
    expect(w.io.earns[0].key).toMatch(/^pbw:sid-a:pb_drop:\d+$/);
    expect(sealedInSave).toBe(true);
    expect(view.player.ledger.batches.pb_drop).toBeUndefined();
    expect(view.player.currencies.tickets).toBe(12);
  });

  it('a capped earn keeps its seal and resends the same key and amount', () => {
    const w = testWorld();
    w.join('a');
    const view = w.host.viewOf('a')!;
    view.player.ledger.streams.pb_lobby.pending = 5;
    w.io.earnReply = () => ({ error: 'daily_ticket_cap' });
    w.ticks(NET.ticketFlushEveryTicks + 1);
    const first = w.io.earns[0];
    expect(view.player.ledger.batches.pb_lobby?.id).toBe(first.key);
    w.io.earnReply = () => ({});
    w.ticks(NET.ticketFlushEveryTicks);
    const resend = w.io.earns.at(-1)!;
    expect(resend.key).toBe(first.key);
    expect(resend.amount).toBe(5);
    expect(view.player.ledger.batches.pb_lobby).toBeUndefined();
  });

  it('session_closed keeps the amount and sends the player back to the hub', () => {
    const w = testWorld();
    w.join('a');
    w.host.viewOf('a')!.player.ledger.streams.pb_sell.pending = 3;
    w.io.earnReply = () => ({ error: 'session_closed' });
    w.ticks(NET.ticketFlushEveryTicks + 1);
    expect(w.take('a', OP.KICK).some((k) => k.body.reason === 'session_expired')).toBe(true);
    const saved = w.io.storage.get('a')!.data as {
      player: { ledger: { batches: Record<string, { amount: number }> } };
    };
    expect(saved.player.ledger.batches.pb_sell.amount).toBe(3);
  });

  it('shop buys go through the server wallet', () => {
    const w = testWorld();
    w.join('a');
    w.io.balances.set('a', 500);
    const view = w.host.viewOf('a')!;
    view.player.interface = { kind: 'terminal', shopId: 'shop_terminal' };
    w.send('a', OP.INTENTS, { seq: 1, intents: [{ type: 'buy', itemId: 'item_rounds', qty: 1 }] });
    w.ticks(1);
    expect(w.io.spends).toHaveLength(1);
    expect(view.player.currencies.tickets).toBe(490);
  });

  it('answers ping with the server tick', () => {
    const w = testWorld();
    w.join('a');
    w.send('a', OP.PING, { t: 5 });
    w.flush();
    expect(w.take('a', OP.PONG)[0].body).toMatchObject({ t: 5 });
  });
});
