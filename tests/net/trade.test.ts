/** Two-screen trading between players. */
import { describe, expect, it } from 'vitest';
import { NET, TRADE } from '../../src/config/balance';
import { OP } from '../../src/net/protocol';
import { countItem } from '../../src/sim/inventory';
import { testWorld } from './helpers';

function pair() {
  const w = testWorld();
  w.join('a', 'Alice');
  w.join('b', 'Bob');
  const A = w.host.viewOf('a')!.player;
  const B = w.host.viewOf('b')!.player;
  A.inventory[0] = { itemId: 'item_rounds', qty: 100 };
  B.inventory[0] = { itemId: 'item_scrap_hash', qty: 1 };
  w.take('a');
  w.take('b');
  return { w, A, B };
}

const trade = (w: ReturnType<typeof testWorld>, uid: string, body: unknown) =>
  w.send(uid, OP.TRADE, body);
const lastTrade = (w: ReturnType<typeof testWorld>, uid: string) =>
  w.take(uid, OP.TRADE_OUT).at(-1)?.body as Record<string, unknown> | undefined;
const waitLock = (w: ReturnType<typeof testWorld>) => w.ticks(TRADE.acceptLockTicks + 1);

function open(w: ReturnType<typeof testWorld>) {
  trade(w, 'a', { op: 'request', to: 'p:b' });
  w.flush();
  expect(
    w.take('b', OP.CHAT_OUT).some((m) => String(m.body.text).includes('wishes to trade')),
  ).toBe(true);
  trade(w, 'b', { op: 'request', to: 'p:a' });
  w.flush();
  expect(lastTrade(w, 'a')?.stage).toBe('offer');
}

describe('trading', () => {
  it('happy path: offer, accept twice, confirm, swap and save both', () => {
    const { w, A, B } = pair();
    open(w);
    trade(w, 'a', { op: 'offer', slot: 0, qty: 40 });
    trade(w, 'b', { op: 'offer', slot: 0, qty: 1 });
    w.flush();
    waitLock(w);
    trade(w, 'a', { op: 'accept' });
    trade(w, 'b', { op: 'accept' });
    w.flush();
    const confirm = lastTrade(w, 'a')!;
    expect(confirm.stage).toBe('confirm');
    expect(confirm.value).toBeDefined();
    trade(w, 'a', { op: 'accept' });
    trade(w, 'b', { op: 'accept' });
    w.flush();
    expect(lastTrade(w, 'b')?.reason).toBe('done');
    expect(countItem(A.inventory, 'item_rounds')).toBe(60);
    expect(countItem(B.inventory, 'item_rounds')).toBe(40);
    expect(countItem(A.inventory, 'item_scrap_hash')).toBe(1);
    expect(w.io.storage.has('a') && w.io.storage.has('b')).toBe(true);
  });

  it('a change resets both accepts and locks Accept briefly', () => {
    const { w } = pair();
    open(w);
    trade(w, 'a', { op: 'offer', slot: 0, qty: 10 });
    w.flush();
    waitLock(w);
    trade(w, 'b', { op: 'accept' });
    w.flush();
    trade(w, 'a', { op: 'offer', slot: 0, qty: 5 });
    trade(w, 'a', { op: 'accept' });
    w.flush();
    const seen = lastTrade(w, 'b')!;
    expect(seen.accepted).toEqual({ me: false, them: false });
    expect(seen.modified).toBe(true);
  });

  it('refuses untradeables, and items are only offered once', () => {
    const { w, A } = pair();
    A.inventory[1] = { itemId: 'item_photo_negatives', qty: 1 };
    open(w);
    trade(w, 'a', { op: 'offer', slot: 1, qty: 1 });
    trade(w, 'a', { op: 'offer', slot: 0, qty: 'all' });
    trade(w, 'a', { op: 'offer', slot: 0, qty: 'all' });
    w.flush();
    const t = lastTrade(w, 'a')!;
    expect(t.mine).toEqual([expect.objectContaining({ itemId: 'item_rounds', qty: 100 })]);
  });

  it('acting in the world cancels the trade', () => {
    const { w, A } = pair();
    open(w);
    trade(w, 'a', { op: 'offer', slot: 0, qty: 10 });
    w.send('a', OP.INTENTS, { seq: 1, intents: [{ type: 'dropItem', slot: 0 }] });
    w.ticks(1);
    expect(lastTrade(w, 'b')?.stage).toBe('closed');
    expect(A.inventory[0]).toBeNull();
  });

  it('a disconnect mid-trade cancels it', () => {
    const { w } = pair();
    open(w);
    w.leave('b');
    w.flush();
    expect(lastTrade(w, 'a')?.stage).toBe('closed');
  });

  it('a failed save rolls the swap back with no dupe', () => {
    const { w, A, B } = pair();
    open(w);
    trade(w, 'a', { op: 'offer', slot: 0, qty: 100 });
    w.flush();
    waitLock(w);
    for (let i = 0; i < 2; i++) {
      trade(w, 'a', { op: 'accept' });
      trade(w, 'b', { op: 'accept' });
      w.flush();
    }
    // The second round is the confirm screen's.
    w.io.failSaves = true;
    trade(w, 'a', { op: 'accept' });
    trade(w, 'b', { op: 'accept' });
    w.flush();
    expect(countItem(A.inventory, 'item_rounds') + countItem(B.inventory, 'item_rounds')).toBe(100);
  });

  it('refuses requests out of range, from the ignored, or with the filter off', () => {
    const { w } = pair();
    w.host.viewOf('b')!.player.social.tradeFilter = 'off';
    trade(w, 'a', { op: 'request', to: 'p:b' });
    w.flush();
    expect(w.take('b', OP.CHAT_OUT).some((m) => String(m.body.text).includes('wishes'))).toBe(
      false,
    );
    w.host.viewOf('b')!.player.social.tradeFilter = 'on';
    w.host.viewOf('b')!.player.pos = { x: 2, y: 2 };
    trade(w, 'a', { op: 'request', to: 'p:b' });
    w.flush();
    expect(w.take('a', OP.CHAT_OUT).some((m) => String(m.body.text).includes('too far'))).toBe(
      true,
    );
  });

  it('an intent flood is capped per tick', () => {
    const { w } = pair();
    const many = Array.from({ length: NET.maxIntentsPerTick + 5 }, () => ({ type: 'toggleRun' }));
    w.send('a', OP.INTENTS, { seq: 1, intents: many });
    w.ticks(1);
    expect(w.io.logs.some((l) => l.includes('too many intents'))).toBe(true);
  });
});
