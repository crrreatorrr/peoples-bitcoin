/**
 * Adapter over @metaverse/hub-sdk: sign-in (init redeems the portal ticket inside the SDK),
 * the Tickets → Verse exchange for online worlds, and the way back to the hub. Offline play
 * never banks, spends or reports through the hub (src/game/offlineShop.ts); online worlds do
 * that on the server (src/server/host.ts).
 */
import { createHubSdk, HubSdkError, type HubSdk, type InitResult } from '@metaverse/hub-sdk';
import { pageServerKey } from './serverKey';

/** Public game id. Exit fragment, init, and logs all use this. */
export const HUB_GAME_ID = 'peoples-bitcoin';

export function hubUrl(): string {
  const raw = import.meta.env.VITE_HUB_URL;
  return typeof raw === 'string' && raw.length > 0 ? raw : '/hub/';
}

/** Absolute hub URL with the return fragment. Relative config is resolved against this page. */
export function absoluteHubUrl(base = hubUrl()): string {
  const url = new URL(base, window.location.href);
  url.hash = `from=${HUB_GAME_ID}`;
  return url.href;
}

export interface ExchangeCallResult {
  receiptId: string;
  balance: number | null;
  ticketsDebited: number | null;
  /** Verse wallet balance after the exchange (`ExchangeResult.verse`). */
  verse: number | null;
  verseCapLeft: number | null;
}

export function errorCode(err: unknown): string {
  if (err instanceof HubSdkError) return err.code;
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'offline';
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

// Nakama's client server key. The rule (env key, else the local stock key in dev or on a
// loopback host) is in ./serverKey.ts.
const NAKAMA_SERVER_KEY = pageServerKey();

export function createGameHub(): HubSdk {
  const url = hubUrl();
  return createHubSdk({
    serverUrl: '',
    serverKey: NAKAMA_SERVER_KEY,
    hubUrl: url,
    assign: () => {
      window.location.assign(absoluteHubUrl(url));
    },
  });
}

export class HubBridge {
  readonly sdk: HubSdk;
  mode: 'standalone' | 'hub' = 'standalone';
  reachable = false;
  effects: Record<string, number | boolean | string> = {};
  /** Relic ids from init (e.g. tidebreaker_belt). Session only; they unlock relic Sprotos. */
  relics: string[] = [];
  private profile: InitResult | null = null;

  constructor(sdk: HubSdk = createGameHub()) {
    this.sdk = sdk;
  }

  /** Set once init has run (world select redeems the ticket before the game starts). */
  initialized = false;
  private running: Promise<void> = Promise.resolve();

  /** Resolves when the latest `init` has answered (at once if none ran). Never rejects. */
  settled(): Promise<void> {
    return this.running;
  }

  /** The hub player id while a hub session is live, else null (a standalone id is not an account). */
  accountId(): string | null {
    return this.mode === 'hub' ? this.profile?.playerId || null : null;
  }

  init(): Promise<void> {
    this.initialized = true;
    this.running = this.redeem();
    return this.running;
  }

  private async redeem(): Promise<void> {
    try {
      this.profile = await this.sdk.init(HUB_GAME_ID);
      this.mode = this.sdk.getSession?.() ? 'hub' : 'standalone';
      this.reachable = this.mode === 'hub';
      this.effects = { ...(this.profile?.effects ?? {}) };
      this.relics = this.mode === 'hub' ? [...(this.profile?.relics ?? [])] : [];
    } catch (err) {
      console.warn('[hub] init failed; running standalone', err);
      this.mode = 'standalone';
      this.reachable = false;
      this.profile = null;
      this.effects = {};
      this.relics = [];
    }
  }

  async exchange(tickets: number, key: string): Promise<ExchangeCallResult> {
    const result = asRecord(await this.sdk.exchange(tickets, key));
    this.reachable = true;
    const verseCapLeft = num(result.verseCapLeft);
    return {
      receiptId: typeof result.receiptId === 'string' ? result.receiptId : '',
      balance: num(result.balance) ?? num(result.ticketsLeft),
      ticketsDebited: num(result.ticketsDebited),
      verse: num(result.verse),
      verseCapLeft,
    };
  }

  /** Leaves for the hub. With a live session the SDK closes it and navigates; else this does. */
  exit(reason: string): void {
    const live = this.sdk.getSession?.() != null;
    try {
      this.sdk.exit(reason);
      if (live) return;
    } catch (err) {
      console.warn('[hub] exit failed', err);
    }
    window.location.assign(absoluteHubUrl());
  }

  noteFailure(err: unknown): void {
    const code = errorCode(err);
    if (
      code === 'offline' ||
      code === 'rpc_failed' ||
      code === 'auth_failed' ||
      code === 'unauthorized'
    ) {
      this.reachable = false;
    }
  }
}
