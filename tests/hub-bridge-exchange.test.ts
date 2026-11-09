import { describe, expect, it } from 'vitest';
import type { ExchangeResult, HubSdk } from '@metaverse/hub-sdk';
import { HubBridge } from '../src/hub/bridge';

function bridgeAnswering(result: Partial<ExchangeResult>): HubBridge {
  const sdk = { exchange: async () => result } as unknown as HubSdk;
  return new HubBridge(sdk);
}

describe('HubBridge.exchange', () => {
  // The hub's exchange RPC answers { verse, ticketsLeft, balance, receiptId, verseCapLeft }.
  it('maps the fields the hub sends', async () => {
    const bridge = bridgeAnswering({
      verse: 12,
      ticketsLeft: 30,
      balance: 30,
      receiptId: 'receipt-1',
      verseCapLeft: 40,
    });
    const out = await bridge.exchange(100, 'key-1');
    expect(out).toEqual({
      receiptId: 'receipt-1',
      balance: 30,
      ticketsDebited: null,
      verse: 12,
      verseCapLeft: 40,
    });
    expect(bridge.reachable).toBe(true);
  });

  it('falls back to ticketsLeft when an older hub omits balance', async () => {
    const bridge = bridgeAnswering({ verse: 3, ticketsLeft: 7, receiptId: 'receipt-2' });
    const out = await bridge.exchange(10, 'key-2');
    expect(out.balance).toBe(7);
    expect(out.verse).toBe(3);
    expect(out.verseCapLeft).toBeNull();
  });
});
