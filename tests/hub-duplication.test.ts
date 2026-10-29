/**
 * Client duplication. The hub SDK is mocked so each earn, spend, exchange,
 * and relic event is counted. A case that the client still gets wrong is left failing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HubSdkError,
  relicForEvent,
  type HubSdk,
  type SellResult,
  type SpendResult,
  type TicketBalanceResult,
} from '@metaverse/hub-sdk';
import { TICKETS } from '../src/config/balance';
import { HubClient } from '../src/hub/client';
import { claimWriter } from '../src/hub/singleWriter';
import { questEarnWireKey, uuidv5 } from '../src/hub/uuid';
import { countItem } from '../src/sim/inventory';
import { addStreamUsd, grantQuestTickets, questEarnName } from '../src/sim/ledger';
import { loadSavedGame, saveGame } from '../src/persist';
import { deserialize, serialize } from '../src/sim/save';
import type { GameState, Intent, SimContext, SimEvent } from '../src/sim/state';
import { runTick } from '../src/sim/tick';
import { content, give, newGame } from './helpers';

const SAVE_KEY = 'peoples-bitcoin.save';
const SESSION_KEY = 'hub:peoples-bitcoin:session';

const holder: { sdk: HubSdk | null } = { sdk: null };

vi.mock('@metaverse/hub-sdk', async () => {
  const actual = await vi.importActual<typeof import('@metaverse/hub-sdk')>('@metaverse/hub-sdk');
  return {
    ...actual,
    createHubSdk: () => {
      if (!holder.sdk) throw new Error('test sdk not installed');
      return holder.sdk;
    },
  };
});

interface EarnCall {
  amount: number;
  reason: string;
  key: string;
}
interface ExchangeCall {
  tickets: number;
  key: string;
}
interface ShopCall {
  shopId: string;
  itemId: string;
  packs: number;
  key: string;
}
interface EventCall {
  eventId: string;
  data: Record<string, unknown>;
  key: string;
}

class ScriptedHub {
  sid = 'sess-1';
  serverBalance = 1000;
  /** When false, init succeeds and leaves no hub session, so the shop stays local. */
  linked = true;
  sessionCapLeft: number | null = 1000;
  dailyCapLeft: number | null = 1000;
  earnCapped = false;
  holdNext = false;
  loseExchange = false;
  loseSpend = false;
  loseSell = false;
  /** Server committed the earn, then the client sees rpc_failed. */
  loseEarn = false;
  stickyError = false;
  earnError: HubSdkError | null = null;
  exchangeError: HubSdkError | null = null;
  eventError: HubSdkError | null = null;
  initError: HubSdkError | null = null;
  shopError: HubSdkError | null = null;
  spendUnits: number | null = null;
  sellUnits: number | null = null;
  spendBalance: number | null = null;
  sellBalance: number | null = null;
  sellCredited: number | null = null;
  earns: EarnCall[] = [];
  exchanges: ExchangeCall[] = [];
  spends: ShopCall[] = [];
  sells: ShopCall[] = [];
  events: EventCall[] = [];
  releaseHold: (() => void) | null = null;
  private readonly ledger = new Map<string, { amount: number; reason: string }>();
  private readonly receipts = new Map<string, { receiptId: string; tickets: number }>();
  private readonly shopResults = new Map<string, SpendResult | SellResult>();

  asSdk(): HubSdk {
    const sdk: HubSdk & {
      spendTickets?: (
        shopId: string,
        itemId: string,
        packs: number,
        key: string,
      ) => Promise<unknown>;
      sellItem?: (shopId: string, itemId: string, packs: number, key: string) => Promise<unknown>;
      getTicketBalance?: () => Promise<unknown>;
    } = {
      init: async () => {
        if (this.initError) throw this.initError;
        if (this.linked) {
          sessionStorage.setItem(
            SESSION_KEY,
            JSON.stringify({ sid: this.sid, token: 't', playerId: 'p' }),
          );
        } else {
          sessionStorage.removeItem(SESSION_KEY);
        }
        return { playerId: 'p', ranked: false, relics: [], effects: {}, ticketsCapLeft: 1000 };
      },
      reportEvent: async (eventId, data, key) => {
        const body = data as Record<string, unknown>;
        const raw = localStorage.getItem(SAVE_KEY);
        this.events.push({ eventId, data: body, key });
        if (!raw || !raw.includes(key)) throw new Error('relic key was sent before it was saved');
        if (this.eventError) {
          const err = this.eventError;
          this.eventError = null;
          throw err;
        }
        return { granted: relicForEvent('peoples-bitcoin', eventId, data) };
      },
      submitScore: async () => {},
      earnTickets: async (amount, reason, key) => {
        this.earns.push({ amount, reason, key });
        if (this.holdNext) {
          this.holdNext = false;
          await new Promise<void>((resolve) => {
            this.releaseHold = resolve;
          });
        }
        if (this.loseEarn) {
          this.loseEarn = false;
          const prior = this.ledger.get(key);
          if (!prior) {
            this.serverBalance += amount;
            this.ledger.set(key, { amount, reason });
          }
          throw new HubSdkError('rpc_failed', 'lost response');
        }
        if (this.earnError) {
          const err = this.earnError;
          if (!this.stickyError) this.earnError = null;
          throw err;
        }
        const prev = this.ledger.get(key);
        if (prev) {
          if (prev.amount !== amount || prev.reason !== reason) {
            throw new HubSdkError('idempotency_mismatch', 'different body');
          }
          return { balance: this.serverBalance, capped: this.earnCapped };
        }
        this.serverBalance += amount;
        this.ledger.set(key, { amount, reason });
        return { balance: this.serverBalance, capped: this.earnCapped };
      },
      exchange: async (tickets, key) => {
        this.exchanges.push({ tickets, key });
        if (!this.receipts.has(key)) {
          this.serverBalance -= tickets;
          this.receipts.set(key, { receiptId: `receipt-${this.receipts.size + 1}`, tickets });
        }
        const rec = this.receipts.get(key)!;
        if (this.loseExchange) {
          this.loseExchange = false;
          throw new HubSdkError('rpc_failed', 'lost response');
        }
        if (this.exchangeError) {
          const err = this.exchangeError;
          this.exchangeError = null;
          throw err;
        }
        return {
          verse: rec.tickets / 10,
          ticketsLeft: this.serverBalance,
          receiptId: rec.receiptId,
          balance: this.serverBalance,
          ticketsDebited: rec.tickets,
          verseCredited: rec.tickets / 10,
          verseCapLeft: 40,
        };
      },
      exit: () => {},
      getTicketBalance: async (): Promise<TicketBalanceResult> => {
        const result: TicketBalanceResult = {
          balance: this.serverBalance,
          sessionCapLeft: 0,
          dailyCapLeft: 0,
        };
        if (this.sessionCapLeft == null)
          delete (result as { sessionCapLeft?: number }).sessionCapLeft;
        else result.sessionCapLeft = this.sessionCapLeft;
        if (this.dailyCapLeft == null) delete (result as { dailyCapLeft?: number }).dailyCapLeft;
        else result.dailyCapLeft = this.dailyCapLeft;
        return result;
      },
      spendTickets: async (shopId, itemId, packs, key) => {
        this.spends.push({ shopId, itemId, packs, key });
        this.assertKeySaved(key);
        const id = `spend:${key}`;
        if (this.loseSpend) {
          this.loseSpend = false;
          const result = this.spendResult(shopId, itemId, packs);
          this.shopResults.set(id, result);
          throw new HubSdkError('rpc_failed', 'lost response');
        }
        if (this.shopError) {
          const err = this.shopError;
          if (!this.stickyError) this.shopError = null;
          throw err;
        }
        const prev = this.shopResults.get(id);
        if (prev) return prev as SpendResult;
        const result = this.spendResult(shopId, itemId, packs);
        this.shopResults.set(id, result);
        this.serverBalance = result.balance;
        return result;
      },
      sellItem: async (shopId, itemId, packs, key) => {
        this.sells.push({ shopId, itemId, packs, key });
        this.assertKeySaved(key);
        const id = `sell:${key}`;
        if (this.loseSell) {
          this.loseSell = false;
          const result = this.sellResult(shopId, itemId, packs);
          this.shopResults.set(id, result);
          throw new HubSdkError('rpc_failed', 'lost response');
        }
        if (this.shopError) {
          const err = this.shopError;
          if (!this.stickyError) this.shopError = null;
          throw err;
        }
        const prev = this.shopResults.get(id);
        if (prev) return prev as SellResult;
        const result = this.sellResult(shopId, itemId, packs);
        this.shopResults.set(id, result);
        this.serverBalance = result.balance;
        return result;
      },
    };
    return sdk;
  }

  private assertKeySaved(key: string): void {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw || !raw.includes(key)) throw new Error('shop key was sent before it was saved');
  }

  private spendResult(shopId: string, itemId: string, packs: number): SpendResult {
    return {
      shop_id: shopId,
      item_id: itemId,
      packs,
      units: this.spendUnits ?? packs,
      spent: 0,
      balance: this.spendBalance ?? this.serverBalance,
    };
  }

  private sellResult(shopId: string, itemId: string, packs: number): SellResult {
    return {
      shop_id: shopId,
      item_id: itemId,
      packs,
      units: this.sellUnits ?? packs,
      credited: this.sellCredited ?? 0,
      balance: this.sellBalance ?? this.serverBalance,
    };
  }
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, String(value));
    },
  };
}

function installStorage(): void {
  const local = memoryStorage();
  const session = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
  const listeners: Record<string, Array<(event: Event) => void>> = {};
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: local,
      sessionStorage: session,
      location: { href: 'http://game.test/' },
      addEventListener(type: string, fn: (event: Event) => void) {
        (listeners[type] ??= []).push(fn);
      },
      removeEventListener(type: string, fn: (event: Event) => void) {
        listeners[type] = (listeners[type] ?? []).filter((listener) => listener !== fn);
      },
    },
    configurable: true,
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

let script: ScriptedHub;

beforeEach(() => {
  installStorage();
  script = new ScriptedHub();
  holder.sdk = null;
});

function attach(
  state: GameState,
  ctx: SimContext,
  save: () => boolean = () => saveGame(state),
  queue: (intent: Intent) => void = () => {},
) {
  holder.sdk = script.asSdk();
  const said: string[] = [];
  const hub = new HubClient(state, ctx, (text) => said.push(text), queue, save);
  return { hub, said };
}

function ctxOf(): SimContext {
  const game = newGame();
  return game.ctx;
}

describe('quest earn keys', () => {
  it('derives a stable UUIDv5 and keeps steps and choices apart', () => {
    const quest = questEarnName('quest_tutorial');
    const step = questEarnName('quest_tutorial', 'talk_treasurer');
    const choice = questEarnName('quest_hostile_takeover', 'decision', 'takeover_leverage');
    expect(quest).toBe('pb:quest:quest_tutorial');
    expect(step).toBe('pb:quest:quest_tutorial:talk_treasurer');
    expect(choice).toBe('pb:quest:quest_hostile_takeover:decision:takeover_leverage');
    for (const name of [quest, step, choice]) {
      expect(questEarnWireKey(name)).toBe(uuidv5(name));
      expect(questEarnWireKey(name)).not.toBe(name);
      expect(questEarnWireKey(name)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
    expect(new Set([quest, step, choice].map((name) => questEarnWireKey(name))).size).toBe(3);
    expect(questEarnWireKey(choice)).toBe(questEarnWireKey(choice));
  });
});

describe('relic', () => {
  it('mints one genesis_shard key and reuses it across retry and reload', async () => {
    const { state, ctx } = newGame();
    const { hub } = attach(state, ctx);
    await hub.start();
    state.tick = 42;
    state.player.quests.quest_tutorial.complete = true;
    script.eventError = new HubSdkError('rpc_failed', 'lost');
    hub.onEvents([{ type: 'questComplete', questId: 'quest_tutorial', tick: 42 }]);
    await settle();

    expect(script.events).toHaveLength(1);
    const first = script.events[0]!;
    expect(first.eventId).toBe('pb.quest_complete');
    expect(first.data).toEqual({ questId: 'quest_tutorial', tick: 42 });
    expect(relicForEvent('peoples-bitcoin', first.eventId, first.data)).toBe('genesis_shard');
    expect(first.key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(state.player.ledger.relicKey).toBe(first.key);
    expect(state.player.ledger.relicAcked).toBe(false);

    saveGame(state);
    const loaded = loadSavedGame(content()).state!;
    loaded.tick = 99;
    const { hub: reloaded } = attach(loaded, ctx);
    await reloaded.start();
    await settle();
    expect(script.events).toHaveLength(2);
    expect(script.events[1]).toMatchObject({
      eventId: 'pb.quest_complete',
      data: { questId: 'quest_tutorial', tick: 42 },
      key: first.key,
    });
    expect(loaded.player.ledger.relicAcked).toBe(true);

    reloaded.onEvents([{ type: 'questComplete', questId: 'quest_tutorial', tick: 100 }]);
    await settle();
    expect(script.events).toHaveLength(2);
  });

  it('does not send the relic when the save fails', async () => {
    const { state, ctx } = newGame();
    const { hub } = attach(state, ctx, () => false);
    await hub.start();
    hub.onEvents([{ type: 'questComplete', questId: 'quest_tutorial', tick: 3 }]);
    await settle();
    expect(script.events).toEqual([]);
  });
});

describe('migrated balances', () => {
  it('does not bank a v5 wallet, and replaces it with the server balance', async () => {
    const { state } = newGame();
    const current = serialize(state, 1);
    const v5 = {
      ...current,
      version: 5,
      player: { ...current.player, currencies: { bitcoin: 42, btc: 7 } },
    };
    const loaded = deserialize(v5, content())!;
    expect(loaded.player.currencies).toEqual({ tickets: 42, bitcoin: 0 });
    expect(loaded.player.ledger.streams.pb_drop.pending).toBe(0);
    const { hub } = attach(loaded, ctxOf());
    expect(script.earns).toEqual([]);
    script.serverBalance = 7;
    await hub.start();
    await settle();
    expect(script.earns).toEqual([]);
    expect(loaded.player.currencies.tickets).toBe(7);
  });

  it('ignores a tampered tickets field for earn, spend, and exchange', async () => {
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 25 * 4);
    saveGame(state);
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY)!) as {
      player: { currencies: { tickets: number } };
    };
    raw.player.currencies.tickets = 9999;
    localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
    const loaded = loadSavedGame(content()).state!;
    expect(loaded.player.currencies.tickets).toBe(9999);
    expect(loaded.player.ledger.streams.pb_drop.pending).toBe(4);

    script.serverBalance = 11;
    const { hub, said } = attach(loaded, ctx);
    await hub.start();
    await settle();
    expect(script.earns.map((row) => row.amount)).toEqual([4]);
    expect(loaded.player.currencies.tickets).toBe(15);

    loaded.player.currencies.tickets = 0;
    loaded.hubSession.serverBalance = 500;
    hub.requestExchange(100);
    await settle();
    expect(script.exchanges.map((row) => row.tickets)).toEqual([100]);
    expect(said).not.toContain('Not enough Tickets.');

    loaded.player.interface = { kind: 'terminal', shopId: 'shop_terminal' };
    hub.buy('shop_terminal', 'item_rounds', 2);
    await settle();
    expect(script.spends.map((row) => row.packs)).toEqual([2]);
    expect(script.earns.every((row) => row.amount !== 9999)).toBe(true);
  });
});

describe('stream earns', () => {
  it('keeps one key and amount when a batch is resent', async () => {
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 25 * 8);
    script.earnError = new HubSdkError('rpc_failed', 'down');
    script.stickyError = true;
    const { hub } = attach(state, ctx);
    await hub.start();
    await settle();
    expect(script.earns).toHaveLength(1);
    const first = script.earns[0]!;
    expect(first).toMatchObject({ amount: 8, reason: 'pb_drop' });
    expect(state.player.ledger.batches.pb_drop).toMatchObject({ id: first.key, amount: 8 });

    hub.checkpoint();
    await settle();
    hub.checkpoint();
    await settle();
    expect(script.earns).toHaveLength(1);
    expect(state.player.ledger.batches.pb_drop).toMatchObject({ id: first.key, amount: 8 });

    await hub.start();
    await settle();
    expect(script.earns).toHaveLength(2);
    expect(script.earns[1]).toEqual(first);
    expect(state.player.ledger.batches.pb_drop).toMatchObject({ id: first.key, amount: 8 });
    hub.checkpoint();
    await settle();
    expect(script.earns).toHaveLength(2);

    const before = script.serverBalance;
    script.stickyError = false;
    script.earnError = null;
    await hub.start();
    await settle();
    expect(script.earns).toHaveLength(3);
    expect(script.earns[2]).toEqual(first);
    expect(script.serverBalance - before).toBe(8);
    expect(state.player.ledger.batches.pb_drop).toBeUndefined();

    state.player.ledger.batches.pb_drop = { id: first.key, amount: first.amount };
    await hub.start();
    await settle();
    expect(script.earns).toHaveLength(4);
    expect(script.earns[3]).toEqual(first);
    expect(script.serverBalance - before).toBe(8);
  });

  it('does not send a batch when the save fails', async () => {
    const { state, ctx } = newGame();
    const { hub } = attach(state, ctx, () => false);
    await hub.start();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 25 * 3);
    hub.checkpoint();
    await settle();
    expect(script.earns).toEqual([]);
    expect(state.player.ledger.batches).toEqual({});
    expect(state.player.ledger.streams.pb_drop.pending).toBe(3);
  });

  it('never banks a fractional carry twice, including across a reload', async () => {
    const { state } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 20);
    const snap = JSON.parse(JSON.stringify(serialize(state, 1)));
    const loaded = deserialize(snap, content())!;
    loaded.hubSession.mode = 'hub';
    expect(loaded.player.ledger.streams.pb_drop.pending).toBe(0);
    expect(loaded.player.ledger.streams.pb_drop.remainder).toBeCloseTo(0.8, 8);
    expect(deserialize(snap, content())!.player.ledger.streams.pb_drop.remainder).toBeCloseTo(
      0.8,
      8,
    );

    addStreamUsd(loaded, 'pb_drop', 20);
    expect(loaded.player.ledger.streams.pb_drop.pending).toBe(1);
    expect(loaded.player.ledger.streams.pb_drop.remainder).toBeCloseTo(0.6, 8);
    expect(deserialize(snap, content())!.player.ledger.streams.pb_drop.remainder).toBeCloseTo(
      0.8,
      8,
    );

    const { hub } = attach(loaded, ctxOf());
    await hub.start();
    await settle();
    expect(script.earns).toEqual([expect.objectContaining({ amount: 1, reason: 'pb_drop' })]);
    saveGame(loaded);
    const again = loadSavedGame(content()).state!;
    again.hubSession.mode = 'hub';
    const { hub: reloaded } = attach(again, ctxOf());
    await reloaded.start();
    await settle();
    expect(script.earns).toHaveLength(1);
    expect(again.player.ledger.streams.pb_drop.remainder).toBeCloseTo(0.6, 8);
    expect(again.player.ledger.streams.pb_drop.pending).toBe(0);
  });

  it('caps a batch at 200 and does not double-count a split', async () => {
    expect(TICKETS.batchMax).toBe(200);
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 25 * 450);
    expect(state.player.ledger.streams.pb_drop.pending).toBe(450);
    script.holdNext = true;
    const { hub } = attach(state, ctx);
    const starting = hub.start();
    await vi.waitFor(() => {
      expect(script.earns.map((row) => row.amount)).toEqual([200]);
    });
    const key = script.earns[0]!.key;
    hub.checkpoint();
    expect(script.earns).toHaveLength(1);
    script.releaseHold?.();
    await starting;
    await settle();
    expect(state.player.ledger.streams.pb_drop.pending).toBe(250);

    hub.checkpoint();
    await settle();
    hub.checkpoint();
    await settle();
    expect(script.earns.map((row) => row.amount)).toEqual([200, 200, 50]);
    expect(new Set(script.earns.map((row) => row.key)).size).toBe(3);
    expect(script.earns[0]!.key).toBe(key);
    expect(script.earns.reduce((sum, row) => sum + row.amount, 0)).toBe(450);
    expect(state.player.ledger.streams.pb_drop.pending).toBe(0);
    expect(script.earns.every((row) => row.amount <= 200)).toBe(true);
  });

  it('banks floor(sum of usd / 25) and leaves only the carry', async () => {
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    let seed = 0x12345678;
    let expected = 0;
    for (let i = 0; i < 400; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const usd = (seed / 4294967296) * 80;
      expected += usd / TICKETS.usdPerTicket;
      addStreamUsd(state, 'pb_drop', usd);
    }
    const pocket = state.player.ledger.streams.pb_drop;
    expect(pocket.remainder).toBeGreaterThanOrEqual(0);
    expect(pocket.remainder).toBeLessThan(1);
    expect(pocket.pending + pocket.remainder).toBeCloseTo(expected, 6);
    expect(pocket.pending).toBe(Math.floor(expected + 1e-8));

    const carry = pocket.remainder;
    const banked = pocket.pending;
    const { hub } = attach(state, ctx);
    await hub.start();
    await settle();
    for (
      let i = 0;
      i < 30 &&
      (state.player.ledger.streams.pb_drop.pending > 0 || state.player.ledger.batches.pb_drop);
      i++
    ) {
      hub.checkpoint();
      await settle();
    }
    expect(script.earns.every((row) => row.amount <= 200 && row.reason === 'pb_drop')).toBe(true);
    expect(script.earns.reduce((sum, row) => sum + row.amount, 0)).toBe(banked);
    expect(state.player.ledger.streams.pb_drop.pending).toBe(0);
    expect(state.player.ledger.streams.pb_drop.remainder).toBeCloseTo(carry, 8);
    expect(banked + carry).toBeCloseTo(expected, 6);
  });

  it('drops an idempotency mismatch and does not resend it', async () => {
    for (const code of ['idempotency_mismatch']) {
      script = new ScriptedHub();
      installStorage();
      const { state, ctx } = newGame();
      state.hubSession.mode = 'hub';
      addStreamUsd(state, 'pb_sell', 25 * 4);
      script.earnError = new HubSdkError(code, code);
      const { hub } = attach(state, ctx);
      await hub.start();
      await settle();
      expect(script.earns, code).toHaveLength(1);
      expect(state.player.ledger.batches.pb_sell, code).toBeUndefined();
      hub.checkpoint();
      await hub.start();
      await settle();
      expect(script.earns, code).toHaveLength(1);
    }
  });

  it('drops terminal earn errors and resends rpc_failed once per init', async () => {
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 25 * 6);
    script.stickyError = true;
    script.earnError = new HubSdkError('rpc_failed', 'down');
    const { hub } = attach(state, ctx);
    await hub.start();
    await settle();
    expect(script.earns).toHaveLength(1);
    hub.checkpoint();
    await settle();
    hub.checkpoint();
    await settle();
    expect(
      script.earns,
      'rpc_failed should be resent once on the next init, not on every checkpoint',
    ).toHaveLength(1);
  });

  it('does not treat a capped:true success as a cap error', async () => {
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_lobby', 25 * 10);
    script.earnCapped = true;
    const { hub, said } = attach(state, ctx);
    await hub.start();
    await settle();
    expect(said, 'a success body with capped:true is not a cap error').not.toContain(
      'Ticket limit reached',
    );
    expect(script.earns).toHaveLength(1);
    expect(state.player.currencies.tickets).toBe(script.serverBalance);
    hub.checkpoint();
    await settle();
    expect(script.earns).toHaveLength(1);
  });
});

describe('quest earns', () => {
  async function reward(usd = 100, step?: string, choice?: string) {
    const { state, ctx } = newGame();
    const { hub, said } = attach(state, ctx);
    await hub.start();
    const events: SimEvent[] = [];
    const amount = grantQuestTickets(state, 'quest_tutorial', usd, events, step, choice);
    hub.onEvents(events);
    await settle();
    return { state, ctx, hub, said, amount, events };
  }

  it('pays a quest once, on its UUIDv5, including after reload', async () => {
    const { state, amount } = await reward();
    expect(amount).toBe(10);
    const name = questEarnName('quest_tutorial');
    expect(script.earns).toEqual([{ amount: 10, reason: 'pb_quest', key: questEarnWireKey(name) }]);
    expect(state.player.ledger.questEarns[0]?.status).toBe('acked');
    saveGame(state);
    const loaded = loadSavedGame(content()).state!;
    const { hub } = attach(loaded, ctxOf());
    await hub.start();
    await settle();
    expect(script.earns).toHaveLength(1);
    expect(script.earns[0]!.key).toBe(questEarnWireKey('pb:quest:quest_tutorial'));
  });

  it('credits one pb:quest key when a second tab replays it', async () => {
    const { state, ctx } = newGame();
    const { hub } = attach(state, ctx);
    await hub.start();
    script.holdNext = true;
    const events: SimEvent[] = [];
    grantQuestTickets(state, 'quest_tutorial', 100, events);
    hub.onEvents(events);
    await vi.waitFor(() => {
      expect(script.earns).toHaveLength(1);
    });
    const key = script.earns[0]!.key;
    expect(key).toBe(questEarnWireKey('pb:quest:quest_tutorial'));
    saveGame(state);
    const other = loadSavedGame(content()).state!;
    const { hub: tabB } = attach(other, ctx);
    const before = script.serverBalance;
    await tabB.start();
    await settle();
    script.releaseHold?.();
    await settle();
    const quests = script.earns.filter((row) => row.reason === 'pb_quest');
    expect(quests.every((row) => row.key === key && row.amount === 10)).toBe(true);
    expect(script.serverBalance - before).toBe(10);
  });

  it('does not add the quest reward to the wallet a second time', async () => {
    const { state } = await reward();
    saveGame(state);
    const loaded = loadSavedGame(content()).state!;
    const { hub } = attach(loaded, ctxOf());
    await hub.start();
    await settle();
    const shown = loaded.player.currencies.tickets;
    const again: SimEvent[] = [];
    grantQuestTickets(loaded, 'quest_tutorial', 100, again);
    hub.onEvents(again);
    await settle();
    expect(script.earns).toHaveLength(1);
    expect(again.some((event) => event.type === 'questEarn')).toBe(false);
    expect(
      loaded.player.currencies.tickets,
      'replaying the same quest reward inflates the wallet',
    ).toBe(shown);
  });

  it('resends session_ticket_cap once, only after the session id changes', async () => {
    const { state, ctx } = newGame();
    const { hub } = attach(state, ctx);
    await hub.start();
    script.earnError = new HubSdkError('session_ticket_cap', 'cap');
    const events: SimEvent[] = [];
    grantQuestTickets(state, 'quest_tutorial', 100, events);
    hub.onEvents(events);
    await settle();
    const row = state.player.ledger.questEarns[0]!;
    expect(row.status).toBe('capped');
    expect(row.cappedSessionId).toBe('sess-1');
    expect(script.earns).toHaveLength(1);
    const sent = script.earns[0]!;
    expect(sent.key).toBe(questEarnWireKey(row.name));

    hub.checkpoint();
    await settle();
    expect(script.earns).toHaveLength(1);

    saveGame(state);
    const loaded = loadSavedGame(content()).state!;
    const { hub: sameSession } = attach(loaded, ctx);
    await sameSession.start();
    await settle();
    expect(script.earns).toHaveLength(1);

    script.sid = 'sess-2';
    await sameSession.start();
    await settle();
    expect(script.earns).toHaveLength(2);
    expect(script.earns[1]).toEqual(sent);
    expect(loaded.player.ledger.questEarns[0]?.status).toBe('acked');
    await sameSession.start();
    await settle();
    expect(script.earns).toHaveLength(2);
    expect(script.serverBalance - 1000).toBe(sent.amount);
  });

  it('finishes a mismatched quest earn and keeps a capped one for the next session', async () => {
    for (const code of ['idempotency_mismatch', 'amount_over_rule', 'verse_cap', 'daily_cap']) {
      script = new ScriptedHub();
      installStorage();
      const { state, ctx } = newGame();
      const { hub } = attach(state, ctx);
      await hub.start();
      script.earnError = new HubSdkError(code, code);
      const events: SimEvent[] = [];
      grantQuestTickets(state, 'quest_bunker', 100, events);
      hub.onEvents(events);
      await settle();
      const capped = code !== 'idempotency_mismatch';
      expect(state.player.ledger.questEarns[0]?.status, code).toBe(capped ? 'capped' : 'acked');
      expect(state.player.ledger.questEarns[0]?.key, code).toBe(
        questEarnWireKey('pb:quest:quest_bunker'),
      );
      const calls = script.earns.length;
      hub.checkpoint();
      await hub.start();
      await settle();
      expect(script.earns, code).toHaveLength(calls);
    }
  });

  it('acks a quest success that also says capped:true', async () => {
    const { state, ctx } = newGame();
    const { hub, said } = attach(state, ctx);
    await hub.start();
    script.earnCapped = true;
    const events: SimEvent[] = [];
    grantQuestTickets(state, 'quest_tutorial', 100, events);
    hub.onEvents(events);
    await settle();
    expect(said).not.toContain('Ticket limit reached');
    expect(state.player.ledger.questEarns[0]?.status).toBe('acked');
    expect(script.earns).toHaveLength(1);
    hub.checkpoint();
    await settle();
    expect(script.earns).toHaveLength(1);
    expect(state.player.currencies.tickets).toBe(script.serverBalance);
  });
});

describe('exchange', () => {
  it('keeps one receipt across a lost response and a reload', async () => {
    const { state, ctx } = newGame();
    const { hub, said } = attach(state, ctx);
    await hub.start();
    state.player.currencies.tickets = 0;
    script.loseExchange = true;
    hub.requestExchange(100);
    await settle();
    const order = state.player.ledger.exchange;
    expect(order).toMatchObject({ tickets: 100 });
    expect(script.exchanges).toHaveLength(1);
    const id = order!.id;
    hub.requestExchange(200);
    expect(state.player.ledger.exchange).toEqual(order);
    expect(said).toContain('Exchange pending');
    expect(script.serverBalance).toBe(900);

    saveGame(state);
    const loaded = loadSavedGame(content()).state!;
    const { hub: reloaded } = attach(loaded, ctx);
    await reloaded.start();
    await settle();
    expect(script.exchanges).toHaveLength(2);
    expect(script.exchanges[1]).toMatchObject({ tickets: 100, key: id });
    expect(script.exchanges[0]!.key).toBe(id);
    expect(loaded.player.ledger.exchange).toBeNull();
    expect(loaded.player.ledger.appliedReceipts).toEqual(['receipt-1']);
    expect(loaded.player.currencies.tickets).toBe(900);
    expect(script.serverBalance).toBe(900);

    await reloaded.start();
    await settle();
    expect(script.exchanges).toHaveLength(2);
    expect(script.serverBalance).toBe(900);
  });
});

describe('shop on SDK 0.2.0', () => {
  const shopCodes = [
    'unknown_item',
    'insufficient_tickets',
    'zero_value',
    'amount_over_rule',
    'session_ticket_cap',
    'daily_ticket_cap',
  ];

  it('init(peoples-bitcoin) succeeds, and a session-less shop never replays', async () => {
    const actual = await vi.importActual<typeof import('@metaverse/hub-sdk')>('@metaverse/hub-sdk');
    const real = actual.createHubSdk({
      useMock: true,
      local: actual.memoryKeyValue(),
      session: actual.memoryKeyValue(),
      readHash: () => '',
    });
    const profile = await real.init('peoples-bitcoin');
    expect(profile.playerId).toBeTruthy();
    expect(profile.relics).toEqual([]);

    const { state, ctx } = newGame();
    script.linked = false;
    const intents: Intent[] = [];
    const { hub } = attach(
      state,
      ctx,
      () => saveGame(state),
      (intent) => intents.push(intent),
    );
    await hub.start();
    expect(state.hubSession.mode).toBe('standalone');
    expect(hub.shopStatus()).toBe('local');

    state.player.interface = { kind: 'terminal', shopId: 'shop_terminal' };
    state.player.currencies.tickets = 10;
    hub.buy('shop_terminal', 'item_rounds', 1);
    runTick(state, ctx, intents.splice(0));
    expect(countItem(state.player.inventory, 'item_rounds')).toBe(100);
    expect(state.player.currencies.tickets).toBe(7);
    hub.sell(0, 'all');
    runTick(state, ctx, intents.splice(0));
    expect(countItem(state.player.inventory, 'item_rounds')).toBe(0);
    expect(state.player.currencies.tickets).toBe(8);
    addStreamUsd(state, 'pb_drop', 25 * 3 + 10);
    const carry = state.player.ledger.offlineRemainder.pb_drop;
    hub.checkpoint();
    await settle();
    expect(script.spends).toEqual([]);
    expect(script.sells).toEqual([]);
    expect(script.earns).toEqual([]);
    expect(state.player.ledger.purchase).toBeNull();
    expect(state.player.ledger.sale).toBeNull();

    script.linked = true;
    script.serverBalance = 4;
    const { hub: linked } = attach(state, ctx);
    await linked.start();
    await settle();
    expect(script.spends).toEqual([]);
    expect(script.sells).toEqual([]);
    expect(script.earns).toEqual([]);
    expect(state.player.currencies.tickets).toBe(4);
    expect(state.player.ledger.offlineRemainder.pb_drop).toBeCloseTo(carry, 8);
  });

  it('persists a spend key and grants response units once', async () => {
    const { state, ctx } = newGame();
    script.spendUnits = 40;
    script.spendBalance = 90;
    const { hub } = attach(state, ctx);
    await hub.start();
    script.loseSpend = true;
    hub.buy('shop_terminal', 'item_rounds', 1);
    await settle();
    const order = state.player.ledger.purchase;
    expect(order).toMatchObject({ shopId: 'shop_terminal', itemId: 'item_rounds', packs: 1 });
    expect(countItem(state.player.inventory, 'item_rounds')).toBe(0);
    expect(state.player.currencies.tickets).toBe(1000);
    const key = order!.key;
    expect(script.spends).toEqual([
      { shopId: 'shop_terminal', itemId: 'item_rounds', packs: 1, key },
    ]);

    saveGame(state);
    const loaded = loadSavedGame(content()).state!;
    const { hub: reloaded } = attach(loaded, ctx);
    await reloaded.start();
    await settle();
    expect(script.spends).toHaveLength(2);
    expect(script.spends[1]).toEqual(script.spends[0]);
    expect(countItem(loaded.player.inventory, 'item_rounds')).toBe(40);
    expect(loaded.player.currencies.tickets).toBe(90);
    expect(loaded.player.ledger.purchase).toBeNull();

    loaded.player.ledger.purchase = {
      key,
      shopId: 'shop_terminal',
      itemId: 'item_rounds',
      packs: 1,
    };
    reloaded.checkpoint();
    await settle();
    expect(countItem(loaded.player.inventory, 'item_rounds')).toBe(40);
    expect(loaded.player.currencies.tickets).toBe(90);
  });

  it('persists a sell key and removes response units once', async () => {
    const { state, ctx } = newGame();
    give(state, 'item_rounds', 100);
    script.sellUnits = 40;
    script.sellBalance = 111;
    script.sellCredited = 11;
    const { hub } = attach(state, ctx);
    await hub.start();
    script.loseSell = true;
    hub.sell(0, 'all');
    await settle();
    const order = state.player.ledger.sale;
    expect(order).toMatchObject({ shopId: 'shop_terminal', itemId: 'item_rounds', packs: 1 });
    expect(countItem(state.player.inventory, 'item_rounds')).toBe(100);
    expect(state.player.currencies.tickets).toBe(1000);
    const key = order!.key;

    saveGame(state);
    const loaded = loadSavedGame(content()).state!;
    const { hub: reloaded } = attach(loaded, ctx);
    await reloaded.start();
    await settle();
    expect(script.sells).toHaveLength(2);
    expect(script.sells[1]).toMatchObject({
      shopId: 'shop_terminal',
      itemId: 'item_rounds',
      packs: 1,
      key,
    });
    expect(countItem(loaded.player.inventory, 'item_rounds')).toBe(60);
    expect(loaded.player.currencies.tickets).toBe(111);

    loaded.player.ledger.sale = { ...order!, slot: 0 };
    reloaded.checkpoint();
    await settle();
    expect(countItem(loaded.player.inventory, 'item_rounds')).toBe(60);
    expect(loaded.player.currencies.tickets).toBe(111);
  });

  it('drops every shop terminal code without a retry', async () => {
    for (const code of shopCodes) {
      script = new ScriptedHub();
      installStorage();
      const { state, ctx } = newGame();
      give(state, 'gun_campaign_pistol');
      const { hub } = attach(state, ctx);
      await hub.start();
      const before = state.player.currencies.tickets;
      script.shopError = new HubSdkError(code, code);
      hub.buy('shop_terminal', 'item_rounds', 1);
      await settle();
      expect(countItem(state.player.inventory, 'item_rounds'), code).toBe(0);
      expect(state.player.currencies.tickets, code).toBe(before);
      expect(state.player.ledger.purchase, code).toBeNull();
      const buys = script.spends.length;
      hub.checkpoint();
      await hub.start();
      await settle();
      expect(script.spends, code).toHaveLength(buys);

      script.shopError = new HubSdkError(code, code);
      hub.sell(0, 1);
      await settle();
      expect(countItem(state.player.inventory, 'gun_campaign_pistol'), code).toBe(1);
      expect(state.player.currencies.tickets, code).toBe(before);
      expect(state.player.ledger.sale, code).toBeNull();
      const sales = script.sells.length;
      hub.checkpoint();
      await hub.start();
      await settle();
      expect(script.sells, code).toHaveLength(sales);
    }
  });

  it('retries rpc_failed shop calls with the same key', async () => {
    const { state, ctx } = newGame();
    give(state, 'gun_campaign_pistol');
    script.spendUnits = 100;
    script.spendBalance = 970;
    const { hub } = attach(state, ctx);
    await hub.start();
    script.shopError = new HubSdkError('rpc_failed', 'down');
    script.stickyError = true;
    hub.buy('shop_terminal', 'item_rounds', 1);
    await settle();
    expect(state.player.ledger.purchase).not.toBeNull();
    expect(countItem(state.player.inventory, 'item_rounds')).toBe(0);
    const key = state.player.ledger.purchase!.key;
    script.stickyError = false;
    script.shopError = null;
    hub.checkpoint();
    await settle();
    expect(script.spends.map((row) => row.key)).toEqual([key, key]);
    expect(countItem(state.player.inventory, 'item_rounds')).toBe(100);
    expect(state.player.currencies.tickets).toBe(970);
  });

  it('follows the server balance across a sell and a buy', async () => {
    const { state, ctx } = newGame();
    give(state, 'item_rounds', 100);
    script.serverBalance = 100;
    script.sellBalance = 100;
    script.sellCredited = 11;
    script.sellUnits = 100;
    const { hub } = attach(state, ctx);
    await hub.start();
    expect(state.player.currencies.tickets).toBe(100);
    hub.sell(0, 'all');
    await settle();
    expect(state.player.currencies.tickets).toBe(100);
    expect(countItem(state.player.inventory, 'item_rounds')).toBe(0);

    script.spendBalance = 80;
    script.spendUnits = 1;
    hub.buy('shop_terminal', 'gun_campaign_pistol', 1);
    await settle();
    expect(state.player.currencies.tickets).toBe(80);
    expect(countItem(state.player.inventory, 'gun_campaign_pistol')).toBe(1);
  });
});

describe('earn caps from getTicketBalance', () => {
  it('clamps a batch to the smaller cap and keeps the rest pending', async () => {
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 25 * 450);
    script.sessionCapLeft = 50;
    script.dailyCapLeft = 80;
    const { hub } = attach(state, ctx);
    await hub.start();
    await settle();
    expect(script.earns.map((row) => row.amount)).toEqual([50]);
    expect(state.player.ledger.streams.pb_drop.pending).toBe(400);
    hub.checkpoint();
    await settle();
    expect(script.earns).toHaveLength(1);
    expect(state.player.ledger.streams.pb_drop.pending).toBe(400);
    expect(state.player.ledger.batches.pb_drop).toBeUndefined();
  });

  it('uses the 200 batch cap when the cap fields are missing', async () => {
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 25 * 450);
    script.sessionCapLeft = null;
    script.dailyCapLeft = null;
    const { hub } = attach(state, ctx);
    await hub.start();
    await settle();
    hub.checkpoint();
    await settle();
    hub.checkpoint();
    await settle();
    expect(script.earns.map((row) => row.amount)).toEqual([200, 200, 50]);
    expect(script.earns.reduce((sum, row) => sum + row.amount, 0)).toBe(450);
    expect(state.player.ledger.streams.pb_drop.pending).toBe(0);
  });

  it('puts a rejected batch back on the same key', async () => {
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 25 * 80);
    script.earnError = new HubSdkError('session_ticket_cap', 'cap');
    const { hub } = attach(state, ctx);
    await hub.start();
    await settle();
    expect(script.earns).toEqual([expect.objectContaining({ amount: 80, reason: 'pb_drop' })]);
    const key = script.earns[0]!.key;
    // The 80 stays on the seal. It is not returned to pending.
    expect(state.player.ledger.streams.pb_drop.pending).toBe(0);
    expect(state.player.ledger.batches.pb_drop).toMatchObject({ id: key, amount: 80 });

    script.earnError = null;
    const before = script.serverBalance;
    await hub.start();
    await settle();
    expect(script.earns).toHaveLength(2);
    expect(script.earns[1]).toEqual({ amount: 80, reason: 'pb_drop', key });
    expect(script.serverBalance - before).toBe(80);
    await hub.start();
    await settle();
    expect(script.serverBalance - before).toBe(80);
  });

  it('keeps a capped or lost seal and resends it once there is room', async () => {
    for (const code of ['session_ticket_cap', 'daily_ticket_cap', 'rpc_failed'] as const) {
      script = new ScriptedHub();
      installStorage();
      const { state, ctx } = newGame();
      state.hubSession.mode = 'hub';
      addStreamUsd(state, 'pb_drop', 25 * 80);
      script.earnError = new HubSdkError(
        code,
        code,
        undefined,
        code === 'rpc_failed' ? undefined : 0,
      );
      const { hub } = attach(state, ctx);
      await hub.start();
      await settle();
      const first = script.earns[0]!;
      expect(first, code).toMatchObject({ amount: 80, reason: 'pb_drop' });
      expect(state.player.ledger.batches.pb_drop, code).toMatchObject({
        id: first.key,
        amount: 80,
      });
      const sealed = script.earns.length;
      script.earnError = null;
      // A lost response still has room, so the next start resends this key.
      // A cap has no room until the balance snapshot says so, and start mints nothing.
      if (code !== 'rpc_failed') {
        script.sessionCapLeft = code === 'session_ticket_cap' ? 0 : 1000;
        if (code === 'daily_ticket_cap') script.dailyCapLeft = 0;
        await hub.start();
        await settle();
        expect(script.earns, code).toHaveLength(sealed);
        expect(state.player.ledger.batches.pb_drop, code).toMatchObject({
          id: first.key,
          amount: 80,
        });
        script.sessionCapLeft = 1000;
        script.dailyCapLeft = 1000;
      }
      const before = script.serverBalance;
      await hub.start();
      await settle();
      expect(script.earns, code).toHaveLength(sealed + 1);
      expect(script.earns.at(-1), code).toEqual(first);
      // One idempotency record: the replay credits 80 once and a later start does not.
      expect(script.serverBalance - before, code).toBe(80);
      await hub.start();
      await settle();
      expect(script.serverBalance - before, code).toBe(80);
      expect(state.player.ledger.batches.pb_drop, code).toBeUndefined();
    }
  });

  it('seals tickets that arrive while a batch is open only after it confirms', async () => {
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 25 * 80);
    script.earnError = new HubSdkError('session_ticket_cap', 'cap', undefined, 0);
    const { hub } = attach(state, ctx);
    await hub.start();
    await settle();
    const first = script.earns[0]!;
    addStreamUsd(state, 'pb_drop', 25 * 30);
    expect(state.player.ledger.streams.pb_drop.pending).toBe(30);
    expect(state.player.ledger.batches.pb_drop).toMatchObject({ id: first.key, amount: 80 });
    script.sessionCapLeft = 0;
    script.earnError = null;
    hub.checkpoint();
    await settle();
    expect(script.earns).toHaveLength(1);
    expect(state.player.ledger.streams.pb_drop.pending).toBe(30);
    script.sessionCapLeft = 1000;
    const before = script.serverBalance;
    await hub.start();
    await settle();
    hub.checkpoint();
    await settle();
    expect(script.earns.map((row) => row.amount)).toEqual([80, 80, 30]);
    expect(script.earns[1]!.key).toBe(first.key);
    expect(script.earns[2]!.key).not.toBe(first.key);
    expect(script.serverBalance - before).toBe(110);
    expect(state.player.ledger.streams.pb_drop.pending).toBe(0);
  });

  it('keeps an open seal across a reload', async () => {
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 25 * 80);
    script.earnError = new HubSdkError('session_ticket_cap', 'cap', undefined, 0);
    const { hub } = attach(state, ctx);
    await hub.start();
    await settle();
    const key = script.earns[0]!.key;
    saveGame(state);
    const loaded = loadSavedGame(content()).state!;
    expect(loaded.player.ledger.batches.pb_drop).toMatchObject({ id: key, amount: 80 });
    expect(localStorage.getItem('peoples-bitcoin.hub-ledger')).toContain(key);
    script.sessionCapLeft = 0;
    script.earnError = null;
    const { hub: again } = attach(loaded, ctx);
    await again.start();
    await settle();
    expect(script.earns).toHaveLength(1);
    expect(loaded.player.ledger.batches.pb_drop).toMatchObject({ id: key, amount: 80 });
  });

  it('the new tab resends an open seal and the old tab does not', async () => {
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 25 * 40);
    let frozen = false;
    const { hub } = attach(state, ctx, () => !frozen && saveGame(state));
    claimWriter(() => {
      if (frozen) return;
      saveGame(state);
      frozen = true;
    });
    script.earnError = new HubSdkError('rpc_failed', 'down');
    await hub.start();
    await settle();
    const key = script.earns[0]!.key;
    await new Promise((resolve) => setTimeout(resolve, 5));
    claimWriter(() => {});
    await settle();
    expect(frozen).toBe(true);
    hub.checkpoint();
    await settle();
    expect(script.earns).toHaveLength(1);
    const other = loadSavedGame(content()).state!;
    script.earnError = null;
    const before = script.serverBalance;
    const { hub: newer } = attach(other, ctx);
    await newer.start();
    await settle();
    expect(script.earns).toHaveLength(2);
    expect(script.earns[1]).toEqual({ amount: 40, reason: 'pb_drop', key });
    expect(script.serverBalance - before).toBe(40);
    hub.checkpoint();
    await settle();
    expect(script.earns).toHaveLength(2);
    expect(script.serverBalance - before).toBe(40);
  });

  it('credits a lost earn response once from the idempotency store', async () => {
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 25 * 15);
    script.loseEarn = true;
    const { hub } = attach(state, ctx);
    await hub.start();
    await settle();
    const first = script.earns[0]!;
    expect(state.player.ledger.batches.pb_drop).toMatchObject({ id: first.key, amount: 15 });
    const before = script.serverBalance;
    expect(before).toBe(1015);
    await hub.start();
    await settle();
    expect(script.earns).toHaveLength(2);
    expect(script.earns[1]).toEqual(first);
    expect(script.serverBalance).toBe(before);
    expect(state.player.ledger.batches.pb_drop).toBeUndefined();
  });

  it('drops a mismatched or over-rule batch without retrying', async () => {
    for (const code of ['idempotency_mismatch', 'amount_over_rule'] as const) {
      script = new ScriptedHub();
      installStorage();
      const { state, ctx } = newGame();
      state.hubSession.mode = 'hub';
      addStreamUsd(state, 'pb_drop', 25 * 4);
      script.earnError = new HubSdkError(code, code);
      const { hub } = attach(state, ctx);
      const before = script.serverBalance;
      await hub.start();
      await settle();
      expect(script.earns, code).toHaveLength(1);
      expect(state.player.ledger.batches.pb_drop, code).toBeUndefined();
      expect(state.player.ledger.streams.pb_drop.pending, code).toBe(0);
      expect(script.serverBalance, code).toBe(before);
      expect(state.player.currencies.tickets, code).toBe(before - 4);
      hub.checkpoint();
      await hub.start();
      await settle();
      expect(script.earns, code).toHaveLength(1);
      expect(script.serverBalance, code).toBe(before);
    }
  });

  it('sends nothing when a cap room is zero and leaves the pending amount', async () => {
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 25 * 40);
    script.sessionCapLeft = 0;
    script.dailyCapLeft = 100;
    const { hub } = attach(state, ctx);
    await hub.start();
    await settle();
    hub.checkpoint();
    await settle();
    expect(script.earns).toEqual([]);
    expect(state.player.ledger.streams.pb_drop.pending).toBe(40);
  });
});

describe('two tabs', () => {
  it('does not double-send a key when two instances share one save', async () => {
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 25 * 5);
    saveGame(state);
    const snap = localStorage.getItem(SAVE_KEY)!;

    const first = loadSavedGame(content()).state!;
    const { hub: tabA } = attach(first, ctx);
    await tabA.start();
    await settle();

    localStorage.setItem(SAVE_KEY, snap);
    const second = loadSavedGame(content()).state!;
    const { hub: tabB } = attach(second, ctx);
    await tabB.start();
    await settle();

    const drops = script.earns.filter((row) => row.reason === 'pb_drop');
    const byKey = new Map(drops.map((row) => [row.key, row.amount]));
    expect(byKey.size, 'both tabs minted a batch for the same 5 Tickets').toBe(1);
    expect([...byKey.values()]).toEqual([5]);
  });

  it('credits one purchase when two tabs send the same shop key', async () => {
    const { state, ctx } = newGame();
    const key = '018f3b2e-7c4a-7b11-8d2e-6a5b4c3d2e1f';
    state.player.ledger.purchase = {
      key,
      shopId: 'shop_terminal',
      itemId: 'item_rounds',
      packs: 1,
    };
    saveGame(state);
    const snap = localStorage.getItem(SAVE_KEY)!;
    script.spendUnits = 100;
    script.spendBalance = 75;

    const first = loadSavedGame(content()).state!;
    const { hub: tabA } = attach(first, ctx);
    await tabA.start();
    await settle();

    localStorage.setItem(SAVE_KEY, snap);
    const second = loadSavedGame(content()).state!;
    const { hub: tabB } = attach(second, ctx);
    await tabB.start();
    await settle();

    const final = loadSavedGame(content()).state!;
    expect(script.spends.every((row) => row.key === key && row.packs === 1)).toBe(true);
    expect(countItem(final.player.inventory, 'item_rounds')).toBe(100);
  });

  it('the newest tab takes the writer lock and the old tab saves once', async () => {
    let lostA = 0;
    let lostB = 0;
    claimWriter(() => {
      lostA += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    claimWriter(() => {
      lostB += 1;
    });
    await settle();
    expect(lostA).toBe(1);
    expect(lostB).toBe(0);
    expect(localStorage.getItem('peoples-bitcoin.writer')).toContain('"at"');
  });

  it('stops the old tab during an in-flight flush and credits the earn once', async () => {
    const { state, ctx } = newGame();
    state.hubSession.mode = 'hub';
    addStreamUsd(state, 'pb_drop', 25 * 8);
    saveGame(state);
    let frozen = false;
    let freezeSaves = 0;
    const { hub } = attach(state, ctx, () => !frozen && saveGame(state));
    claimWriter(() => {
      if (frozen) return;
      saveGame(state);
      freezeSaves += 1;
      frozen = true;
    });
    script.holdNext = true;
    const starting = hub.start();
    await vi.waitFor(() => {
      expect(script.earns).toHaveLength(1);
    });
    const key = script.earns[0]!.key;
    const before = script.serverBalance;
    await new Promise((resolve) => setTimeout(resolve, 5));
    claimWriter(() => {});
    await settle();
    expect(frozen).toBe(true);
    expect(freezeSaves).toBe(1);
    script.releaseHold?.();
    await starting;
    await settle();
    expect(script.serverBalance - before).toBe(8);

    hub.checkpoint();
    await settle();
    expect(script.earns.filter((row) => row.reason === 'pb_drop')).toHaveLength(1);

    const other = loadSavedGame(content()).state!;
    const { hub: newer } = attach(other, ctx);
    await newer.start();
    await settle();
    const drops = script.earns.filter((row) => row.reason === 'pb_drop');
    expect(new Set(drops.map((row) => row.key))).toEqual(new Set([key]));
    expect(script.serverBalance - before).toBe(8);
  });

  it('replaces a stale wallet on load and does not invent inventory', async () => {
    const { state, ctx } = newGame();
    give(state, 'item_rounds', 10);
    state.player.currencies.tickets = 9999;
    saveGame(state);
    const loaded = loadSavedGame(content()).state!;
    script.serverBalance = 4;
    const { hub } = attach(loaded, ctx);
    await hub.start();
    await settle();
    expect(loaded.player.currencies.tickets).toBe(4);
    expect(countItem(loaded.player.inventory, 'item_rounds')).toBe(10);
    expect(script.earns).toEqual([]);
    expect(script.spends).toEqual([]);
  });
});
