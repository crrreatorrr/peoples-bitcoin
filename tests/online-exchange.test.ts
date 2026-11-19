import { describe, expect, it } from 'vitest';
import { HubSdkError, type HubSdk } from '@metaverse/hub-sdk';
import { HubBridge } from '../src/hub/bridge';
import { OnlineExchange } from '../src/game/onlineExchange';
import { newGame } from './helpers';

function setup(answer: (tickets: number, key: string) => Promise<unknown>) {
  const calls: { tickets: number; key: string }[] = [];
  const sdk = {
    exchange: (tickets: number, key: string) => {
      calls.push({ tickets, key });
      return answer(tickets, key);
    },
  } as unknown as HubSdk;
  const bridge = new HubBridge(sdk);
  bridge.mode = 'hub';
  const { state } = newGame();
  state.hubSession.mode = 'hub';
  state.player.currencies.tickets = 120;
  const said: string[] = [];
  let refreshes = 0;
  let n = 0;
  const ex = new OnlineExchange(
    state,
    bridge,
    (t) => said.push(t),
    () => refreshes++,
    () => `key-${++n}`,
  );
  return { ex, calls, said, state, refreshes: () => refreshes };
}

describe('online exchange', () => {
  it('offers steps up to the server wallet and asks the world to re-read it after', async () => {
    const t = setup(async () => ({ verse: 5, balance: 70, receiptId: 'r', verseCapLeft: 45 }));
    expect(t.ex.amounts()).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    await t.ex.request(50);
    expect(t.calls).toEqual([{ tickets: 50, key: 'key-1' }]);
    expect(t.state.hubSession.verseCapLeft).toBe(45);
    expect(t.refreshes()).toBe(1);
    expect(t.said.at(-1)).toContain('50 Tickets for 5 Verse');
  });

  it('reuses the key after a lost answer, so a retry cannot pay twice', async () => {
    let fail = true;
    const t = setup(async () => {
      if (fail) throw new HubSdkError('rpc_failed', 'lost');
      return { verse: 1, balance: 110 };
    });
    await t.ex.request(10);
    fail = false;
    await t.ex.request(10);
    expect(t.calls.map((c) => c.key)).toEqual(['key-1', 'key-1']);
  });

  it('is unavailable without a live hub session', async () => {
    const t = setup(async () => ({}));
    t.state.hubSession.mode = 'standalone';
    expect(t.ex.amounts()).toEqual([]);
    await t.ex.request(10);
    expect(t.calls).toEqual([]);
    expect(t.said).toContain('The exchange needs the hub.');
  });
});
