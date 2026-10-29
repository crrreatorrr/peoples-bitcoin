/**
 * Adapter over @metaverse/hub-sdk 0.1.0. Shop methods are the 0.2.0 shapes;
 * until that SDK is vendored they are missing and the shop stays offline.
 * The game id is peoples-bitcoin. A hub that rejects it leaves the game standalone.
 */
import {
  createHubSdk,
  HubSdkError,
  type GameId,
  type HubSdk,
  type InitResult,
} from '@metaverse/hub-sdk';

/** Public game id. Exit fragment, init, and logs all use this. */
export const HUB_GAME_ID = 'peoples-bitcoin';

const RELIC_EVENT = 'pb.quest_complete';
const SCORE_BOARD = 'pb_total_xp';

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

export interface ShopCallResult {
  units: number;
  balance: number;
}

export interface EarnCallResult {
  balance: number | null;
  capped: boolean;
}

export interface ExchangeCallResult {
  receiptId: string;
  balance: number | null;
  ticketsDebited: number | null;
  verseCredited: number | null;
  verseCapLeft: number | null;
}

type ShopSdk = HubSdk & {
  spendTickets?(shopId: string, itemId: string, packs: number, key: string): Promise<unknown>;
  sellItem?(shopId: string, itemId: string, packs: number, key: string): Promise<unknown>;
  getTicketBalance?(): Promise<unknown>;
};

export function errorCode(err: unknown): string {
  if (err instanceof HubSdkError) return err.code;
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'offline';
}

export function capRemaining(err: unknown): number | undefined {
  const sources: unknown[] = [err];
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === 'string') {
      try {
        sources.push(JSON.parse(message));
      } catch {
        // The message is prose, not a JSON body.
      }
    }
  }
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const rec = source as Record<string, unknown>;
    for (const key of ['remaining', 'ticketsCapLeft', 'capLeft', 'left']) {
      const value = rec[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

export function ticketLimitMessage(remaining?: number): string {
  return remaining == null ? 'Ticket limit reached' : `Ticket limit reached (${remaining} left)`;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function createGameHub(): HubSdk {
  const url = hubUrl();
  return createHubSdk({
    serverUrl: '',
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
  private profile: InitResult | null = null;

  constructor(sdk: HubSdk = createGameHub()) {
    this.sdk = sdk;
  }

  /** True when the vendored SDK actually has the shop RPCs. */
  shopReady(): boolean {
    const shop = this.sdk as ShopSdk;
    return this.mode === 'hub' && this.reachable && typeof shop.spendTickets === 'function';
  }

  async init(): Promise<void> {
    try {
      // 0.1.0's allow-list does not include this id yet. A rejection is standalone.
      this.profile = await this.sdk.init(HUB_GAME_ID as GameId);
      const saved = sessionStorage.getItem(`hub:${HUB_GAME_ID}:session`);
      this.mode = saved ? 'hub' : 'standalone';
      this.reachable = this.mode === 'hub';
      this.effects = { ...(this.profile?.effects ?? {}) };
    } catch (err) {
      console.warn('[hub] init failed; running standalone', err);
      this.mode = 'standalone';
      this.reachable = false;
      this.profile = null;
      this.effects = {};
    }
  }

  async getTicketBalance(): Promise<number | null> {
    const fn = (this.sdk as ShopSdk).getTicketBalance;
    if (this.mode !== 'hub' || typeof fn !== 'function') return null;
    try {
      const balance = num(asRecord(await fn.call(this.sdk)).balance);
      this.reachable = true;
      return balance;
    } catch (err) {
      this.noteFailure(err);
      return null;
    }
  }

  async earnTickets(amount: number, reason: string, key: string): Promise<EarnCallResult> {
    const result = (await this.sdk.earnTickets(amount, reason, key)) as {
      balance?: unknown;
      capped?: unknown;
    };
    this.reachable = true;
    return { balance: num(result?.balance), capped: result?.capped === true };
  }

  async exchange(tickets: number, key: string): Promise<ExchangeCallResult> {
    const result = asRecord(await this.sdk.exchange(tickets, key));
    this.reachable = true;
    const verseCapLeft = num(result.verseCapLeft);
    return {
      receiptId: typeof result.receiptId === 'string' ? result.receiptId : '',
      balance: num(result.balance) ?? num(result.ticketsLeft),
      ticketsDebited: num(result.ticketsDebited),
      verseCredited: num(result.verseCredited),
      verseCapLeft,
    };
  }

  async spendTickets(
    shopId: string,
    itemId: string,
    packs: number,
    key: string,
    packSize: number,
  ): Promise<ShopCallResult> {
    const fn = (this.sdk as ShopSdk).spendTickets;
    if (typeof fn !== 'function')
      throw new HubSdkError('offline', 'spendTickets is not in this SDK');
    const raw = await fn.call(this.sdk, shopId, itemId, packs, key);
    this.reachable = true;
    return shopResult(raw, packs, packSize);
  }

  async sellItem(
    shopId: string,
    itemId: string,
    packs: number,
    key: string,
    packSize: number,
  ): Promise<ShopCallResult> {
    const fn = (this.sdk as ShopSdk).sellItem;
    if (typeof fn !== 'function') throw new HubSdkError('offline', 'sellItem is not in this SDK');
    const raw = await fn.call(this.sdk, shopId, itemId, packs, key);
    this.reachable = true;
    return shopResult(raw, packs, packSize);
  }

  async reportQuest(key: string, tick: number): Promise<void> {
    await this.sdk.reportEvent(RELIC_EVENT, { questId: 'quest_tutorial', tick }, key);
    this.reachable = true;
  }

  async submitXp(totalXp: number): Promise<void> {
    await this.sdk.submitScore(SCORE_BOARD, totalXp, {});
    this.reachable = true;
  }

  exit(reason: string): void {
    try {
      this.sdk.exit(reason);
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

function shopResult(raw: unknown, packs: number, packSize: number): ShopCallResult {
  const rec = asRecord(raw);
  const balance = num(rec.balance);
  if (balance == null) throw new HubSdkError('bad_result', 'Shop call returned no balance');
  const units = num(rec.units) ?? packs * packSize;
  return { units, balance };
}
