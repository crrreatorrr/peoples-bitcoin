/**
 * The offline save belongs to one owner: this browser (device) or the hub account playing.
 * A new account on a used browser starts its own game, device play never reaches an account,
 * and an unresolved hub visit saves nothing. See src/hub/saveOwner.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { hubVisitStarting, type HubSdk, type InitResult } from '@metaverse/hub-sdk';
import { HUB_GAME_ID, HubBridge } from '../src/hub/bridge';
import { OfflineShop } from '../src/game/offlineShop';
import { DEVICE, ownedKey, resolveSaveOwner, type SaveOwner } from '../src/hub/saveOwner';
import { claimWriter } from '../src/hub/singleWriter';
import { clearSavedGame, loadSavedGame, saveGame } from '../src/persist';
import { addStreamUsd } from '../src/sim/ledger';
import type { Intent } from '../src/sim/state';
import { content, give, newGame } from './helpers';

const SAVE_KEY = 'peoples-bitcoin.save';
const SESSION_KEY = `hub:${HUB_GAME_ID}:session`;
const ALICE: SaveOwner = { kind: 'account', playerId: 'alice' };
const BOB: SaveOwner = { kind: 'account', playerId: 'bob' };
const PENDING: SaveOwner = { kind: 'pending' };

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

beforeEach(() => {
  const local = memoryStorage();
  const session = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: local,
      sessionStorage: session,
      location: { href: 'http://game.test/', hash: '' },
      addEventListener() {},
      removeEventListener() {},
    },
    configurable: true,
  });
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

interface FakeHub {
  sdk: HubSdk;
  earns: { amount: number; reason: string; key: string }[];
  /** Every other hub write: spend, sell, exchange, reportEvent, submitScore. */
  calls: string[];
  /** Resolves a held init. */
  answer: () => void;
}

/**
 * A hub SDK whose init gives `playerId` a live session (or none when `live` is false).
 * With `hold`, init waits for `answer()`.
 */
function fakeHub(playerId: string, opts: { live?: boolean; hold?: boolean } = {}): FakeHub {
  const live = opts.live ?? true;
  let answer = () => {};
  const gate = opts.hold ? new Promise<void>((resolve) => (answer = resolve)) : Promise.resolve();
  const earns: FakeHub['earns'] = [];
  const calls: string[] = [];
  const write = (name: string) => async () => {
    calls.push(name);
    return {};
  };
  const sdk = {
    getSession: () =>
      sessionStorage.getItem(SESSION_KEY)
        ? { token: 't', playerId, game: HUB_GAME_ID, ranked: false, expiresAt: Date.now() + 1e6 }
        : null,
    init: async (): Promise<InitResult> => {
      await gate;
      if (live) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ sid: 's', token: 't', playerId }));
      } else {
        sessionStorage.removeItem(SESSION_KEY);
      }
      return {
        playerId,
        ranked: false,
        relics: [],
        effects: {},
        ticketsCapLeft: 1000,
        serverTime: Date.now(),
      };
    },
    getTicketBalance: async () => ({
      balance: 0,
      sessionCapLeft: 1000,
      dailyCapLeft: 1000,
      serverTime: Date.now(),
    }),
    earnTickets: async (amount: number, reason: string, key: string) => {
      earns.push({ amount, reason, key });
      return { balance: amount, capped: false };
    },
    spendTickets: write('spendTickets'),
    sellItem: write('sellItem'),
    exchange: write('exchange'),
    reportEvent: write('reportEvent'),
    submitScore: write('submitScore'),
    exit: () => {},
  } as unknown as HubSdk;
  return { sdk, earns, calls, answer: () => answer() };
}

/** Tickets earned during an earlier hub session: still pending in the save, not yet banked. */
function earnedInHub(state: ReturnType<typeof newGame>['state'], tickets: number): void {
  state.hubSession.mode = 'hub';
  addStreamUsd(state, 'pb_drop', 25 * tickets);
  state.hubSession.mode = 'standalone';
  expect(state.player.ledger.streams.pb_drop.pending).toBe(tickets);
}

/** A save that has got somewhere: one Concrete Bag and 100 ticks played. */
function playedSave(): ReturnType<typeof newGame> {
  const game = newGame();
  give(game.state, 'item_concrete_bag', 1);
  game.state.tick = 100;
  return game;
}

describe('owner keys', () => {
  it('keeps the device keys and gives each account its own', () => {
    expect(ownedKey(SAVE_KEY, DEVICE)).toBe(SAVE_KEY);
    expect(ownedKey(SAVE_KEY, ALICE)).toBe(`${SAVE_KEY}@alice`);
    expect(ownedKey(SAVE_KEY, PENDING)).toBeNull();
  });
});

describe('account isolation', () => {
  it('starts a new account on a used browser from nothing', () => {
    const device = playedSave();
    expect(saveGame(device.state)).toBe(true);
    const alice = playedSave();
    expect(saveGame(alice.state, ALICE)).toBe(true);

    expect(loadSavedGame(content(), BOB)).toEqual({ status: 'none', state: null });
    // Bob's first save lands under his key and touches neither other save.
    const bob = newGame();
    const deviceRaw = localStorage.getItem(SAVE_KEY);
    const aliceRaw = localStorage.getItem(`${SAVE_KEY}@alice`);
    expect(saveGame(bob.state, BOB)).toBe(true);
    expect(localStorage.getItem(`${SAVE_KEY}@bob`)).not.toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).toBe(deviceRaw);
    expect(localStorage.getItem(`${SAVE_KEY}@alice`)).toBe(aliceRaw);
    expect(loadSavedGame(content(), ALICE).state?.tick).toBe(100);
    expect(loadSavedGame(content(), BOB).state?.tick).toBe(0);
  });

  it('never loads the device save, from before or outside the hub, for an account', () => {
    const device = playedSave();
    saveGame(device.state);
    expect(loadSavedGame(content(), ALICE).status).toBe('none');
    // The device keeps it, for play outside the hub.
    expect(loadSavedGame(content()).state?.tick).toBe(100);
  });

  it('keeps an unreadable save as a backup under its own owner', () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ tick: 50, broken: true }));
    localStorage.setItem(`${SAVE_KEY}@alice`, JSON.stringify({ tick: 70, broken: true }));
    expect(loadSavedGame(content(), ALICE).status).toBe('unreadable');
    expect(localStorage.getItem(`${SAVE_KEY}.unreadable@alice`)).toContain('"tick":70');
    expect(localStorage.getItem(`${SAVE_KEY}.unreadable`)).toBeNull();
  });

  it('starts over only the owner that asked', () => {
    saveGame(playedSave().state);
    saveGame(playedSave().state, ALICE);
    clearSavedGame(ALICE);
    expect(localStorage.getItem(`${SAVE_KEY}@alice`)).toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
  });
});

describe('pending owner', () => {
  it('saves nothing and reads nothing', () => {
    saveGame(playedSave().state);
    const before = JSON.stringify([...Array(localStorage.length).keys()].map(localStorage.key));
    expect(loadSavedGame(content(), PENDING)).toEqual({ status: 'none', state: null });
    expect(saveGame(playedSave().state, PENDING)).toBe(false);
    clearSavedGame(PENDING);
    let lost = false;
    claimWriter(() => (lost = true), PENDING);
    expect(lost).toBe(false);
    expect(JSON.stringify([...Array(localStorage.length).keys()].map(localStorage.key))).toBe(
      before,
    );
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
  });
});

describe('writer lock per owner', () => {
  it('lets the device and each account write in their own tabs, and only a same-owner tab takes over', async () => {
    const lost: string[] = [];
    claimWriter(() => lost.push('alice-1'), ALICE);
    claimWriter(() => lost.push('device'), DEVICE);
    claimWriter(() => lost.push('bob'), BOB);
    await settle();
    expect(lost).toEqual([]);
    expect(localStorage.getItem('peoples-bitcoin.writer@alice')).toContain('"at"');
    expect(localStorage.getItem('peoples-bitcoin.writer')).toContain('"at"');

    await new Promise((resolve) => setTimeout(resolve, 5));
    claimWriter(() => lost.push('alice-2'), ALICE);
    await settle();
    expect(lost).toEqual(['alice-1']);
  });
});

describe('deciding the owner', () => {
  it('is the device when no hub visit is starting, without waiting for the hub', async () => {
    const hub = fakeHub('alice', { hold: true });
    const bridge = new HubBridge(hub.sdk);
    expect(await resolveSaveOwner(bridge, false, 50)).toEqual(DEVICE);
    expect(bridge.initialized).toBe(false);
  });

  it('is the account when a hub visit gives a live session', async () => {
    const bridge = new HubBridge(fakeHub('alice').sdk);
    expect(await resolveSaveOwner(bridge, true, 1000)).toEqual(ALICE);
  });

  it('waits for an init world select already started, so a slow redeem still uses the account save', async () => {
    const hub = fakeHub('alice', { hold: true });
    const bridge = new HubBridge(hub.sdk);
    void bridge.init(); // World select gave up on this one after 8 s.
    const owner = resolveSaveOwner(bridge, true, 1000);
    hub.answer();
    expect(await owner).toEqual(ALICE);
  });

  it('is the device when the visit turns out standalone or init fails', async () => {
    const standalone = new HubBridge(fakeHub('device-id', { live: false }).sdk);
    expect(await resolveSaveOwner(standalone, true, 1000)).toEqual(DEVICE);
    const failing = new HubBridge({
      init: () => Promise.reject(new Error('offline')),
    } as unknown as HubSdk);
    expect(await resolveSaveOwner(failing, true, 1000)).toEqual(DEVICE);
  });

  it('is pending when the hub never answers, so nothing lands under the wrong owner', async () => {
    const bridge = new HubBridge(fakeHub('alice', { hold: true }).sdk);
    expect(await resolveSaveOwner(bridge, true, 20)).toEqual(PENDING);
  });

  it('sees a hub visit from a portal ticket or a live session in this tab', () => {
    expect(hubVisitStarting(HUB_GAME_ID, '', sessionStorage)).toBe(false);
    sessionStorage.setItem(SESSION_KEY, '{}');
    expect(hubVisitStarting(HUB_GAME_ID, '', sessionStorage)).toBe(true);
  });
});

describe('offline practice', () => {
  // Offline play runs against an editable save, so even an account's own save never reaches the hub.
  it("never banks, spends, exchanges or reports from the account's own save", async () => {
    const hub = fakeHub('alice');
    const bridge = new HubBridge(hub.sdk);
    await bridge.init();
    expect(bridge.mode).toBe('hub');
    const { state, ctx } = newGame();
    earnedInHub(state, 40);
    give(state, 'item_concrete_bag', 1);
    const said: string[] = [];
    const queued: Intent[] = [];
    const shop = new OfflineShop(
      state,
      ctx,
      (text) => said.push(text),
      (intent) => queued.push(intent),
      () => saveGame(state, ALICE),
      bridge,
    );
    shop.checkpoint();
    shop.requestExchange();
    shop.sell(0, 1);
    await settle();
    expect(state.hubSession.mode).toBe('standalone');
    expect(shop.shopStatus()).toBe('local');
    expect(shop.exchangeAmounts()).toEqual([]);
    expect(said).toContain('The exchange needs an online world.');
    expect(queued).toEqual([{ type: 'sell', slot: 0, qty: 1 }]);
    expect(hub.earns).toEqual([]);
    expect(hub.calls).toEqual([]);
    expect(localStorage.getItem(`${SAVE_KEY}@alice`)).not.toBeNull();
  });
});
