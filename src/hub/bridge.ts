/**
 * Adapter over @metaverse/hub-sdk. Shop calls are
 * spendTickets(shopId, itemId, packs, key) and sellItem with the same arguments.
 * earnTickets(amount, reason, key) and getTicketBalance() use that build's results.
 * init redeems the portal ticket inside the SDK (custom auth, then the session token).
 * With no hub session the SDK no-ops and this game shops locally instead.
 */
import {
  createHubSdk,
  HubSdkError,
  type EarnResult,
  type HubSdk,
  type InitResult,
  type SpendResult,
  type SellResult,
  type TicketBalanceResult,
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
  /** Tickets the server credited on a sale. Buys leave this null. */
  credited: number | null;
}

export interface TicketSnapshot {
  balance: number;
  sessionCapLeft: number | null;
  dailyCapLeft: number | null;
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

export function errorCode(err: unknown): string {
  if (err instanceof HubSdkError) return err.code;
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'offline';
}

export function capRemaining(err: unknown): number | undefined {
  if (err instanceof HubSdkError) {
    for (const value of [err.capLeft, err.sessionCapLeft, err.dailyCapLeft]) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
  }
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

  /** A hub session is up and this SDK build actually has the shop RPCs. */
  shopReady(): boolean {
    const sdk = this.sdk as { spendTickets?: unknown; sellItem?: unknown };
    return (
      this.mode === 'hub' &&
      this.reachable &&
      typeof sdk.spendTickets === 'function' &&
      typeof sdk.sellItem === 'function'
    );
  }

  async init(): Promise<void> {
    try {
      this.profile = await this.sdk.init(HUB_GAME_ID);
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

  /** Hub session id cached by the SDK, or '' when there is no session. */
  sessionId(): string {
    try {
      const raw = sessionStorage.getItem(`hub:${HUB_GAME_ID}:session`);
      if (!raw) return '';
      const sid = (JSON.parse(raw) as { sid?: unknown }).sid;
      return typeof sid === 'string' ? sid : '';
    } catch {
      return '';
    }
  }

  async getTicketBalance(): Promise<TicketSnapshot | null> {
    if (this.mode !== 'hub') return null;
    try {
      const result: TicketBalanceResult = await this.sdk.getTicketBalance();
      this.reachable = true;
      return {
        balance: result.balance,
        sessionCapLeft: finite(result.sessionCapLeft),
        dailyCapLeft: finite(result.dailyCapLeft),
      };
    } catch (err) {
      this.noteFailure(err);
      return null;
    }
  }

  async earnTickets(amount: number, reason: string, key: string): Promise<EarnCallResult> {
    const result: EarnResult = await this.sdk.earnTickets(amount, reason, key);
    this.reachable = true;
    return { balance: result.balance, capped: result.capped };
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
  ): Promise<ShopCallResult> {
    const result = await this.sdk.spendTickets(shopId, itemId, packs, key);
    this.reachable = true;
    return shopResult(result);
  }

  async sellItem(
    shopId: string,
    itemId: string,
    packs: number,
    key: string,
  ): Promise<ShopCallResult> {
    const result = await this.sdk.sellItem(shopId, itemId, packs, key);
    this.reachable = true;
    return shopResult(result);
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

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function shopResult(raw: SpendResult | SellResult): ShopCallResult {
  if (typeof raw.balance !== 'number' || typeof raw.units !== 'number') {
    throw new HubSdkError('bad_result', 'Shop call returned no balance');
  }
  const credited = 'credited' in raw ? raw.credited : null;
  return { units: raw.units, balance: raw.balance, credited };
}
