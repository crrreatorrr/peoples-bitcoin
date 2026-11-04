/**
 * One online world: up to NET.maxPlayersPerWorld players running the shared
 * sim, server-authoritative. The Nakama `pb_world` match wraps this (in
 * metaverse-hub); tests and `?net=loopback` drive it directly. Pure: all I/O
 * goes through `HostIO`, which is synchronous like Nakama's runtime.
 *
 * Clients only send intents, chat, trade and social operations. Each is
 * validated (protocol.ts), capped, and applied on the next 600 ms sim tick.
 */
import { NET, SOCIAL, START_ZONE_ID } from '../config/balance';
import type { Content } from '../sim/content';
import { loadContent } from '../sim/content';
import { buildGrids, type Grid } from '../sim/grid';
import {
  ackStreamBatch,
  dropStreamBatch,
  openStreamBatch,
  setTicketBalance,
  undoStreamBatch,
} from '../sim/ledger';
import { deserializePlayer, serialize } from '../sim/save';
import {
  addPlayerToWorld,
  createPlayer,
  createWorldState,
  freshHubSession,
  removePlayerFromWorld,
  STREAM_REASONS,
  type GameState,
  type Intent,
  type SimContext,
  type SimEvent,
  type WalletPort,
  type WalletResult,
  type WorldState,
} from '../sim/state';
import { runWorldTick } from '../sim/tick';
import {
  ChatInSchema,
  decode,
  encode,
  HelloSchema,
  IntentSchema,
  IntentsSchema,
  OP,
  PingSchema,
  PROTOCOL_VERSION,
  SocialInSchema,
  TradeInSchema,
  type ChatOut,
  type Delta,
  type KickReason,
  type Snapshot,
  type SocialIn,
  type SocialOut,
  type TradeOut,
  type Welcome,
} from '../net/protocol';
import { SIM_VERSION } from '../net/simVersion';
import {
  eventEntities,
  isAreaEvent,
  newAoi,
  objectChanges,
  selfPatch,
  visibleTo,
  zoneEntities,
  type AoiState,
  type CachedEntity,
} from './aoi';
import {
  deliverPm,
  handleChat,
  newChatCounters,
  type ChatCounters,
  type ChatEnv,
  type ChatMember,
} from './chat';
import { checkText, cleanText, reservedName } from './chatfilter';
import { TradeBook, type TradeEnv } from './trade';
import { questEarnWireKey } from './uuid';

export const GAME_ID = 'peoples-bitcoin';

export interface Presence {
  userId: string;
  sessionId: string;
  username: string;
}

/** The hub session a player joined with (from Nakama `ctx.vars`). */
export interface Who {
  userId: string;
  sid: string;
}

/** A hub economy SQL result: `{ error }` on failure, otherwise `{ balance, ... }`. */
export type EconomyResult = Record<string, unknown>;

export interface OnlineEntry {
  world: number;
  matchId: string;
  at: number;
  /** The player's private filter, so friends lists respect it from any world. */
  pf?: 'on' | 'friends' | 'off';
  /** Friend ids, only when pf is 'friends'. */
  fr?: string[];
}

export interface HostIO {
  nowMs(): number;
  loadCharacters(userIds: string[]): Record<string, { data: unknown; version: string } | null>;
  /** One write for all rows (a transaction). `conflicts` lists user ids whose version was stale. */
  saveCharacters(rows: { userId: string; data: unknown; version?: string }[]): {
    ok: boolean;
    versions?: Record<string, string>;
    conflicts?: string[];
    error?: string;
  };
  loadWorld(): unknown;
  saveWorld(data: unknown): void;
  earnTickets(who: Who, amount: number, reason: string, key: string): EconomyResult;
  spendTickets(who: Who, shopId: string, itemId: string, packs: number, key: string): EconomyResult;
  sellItem(who: Who, shopId: string, itemId: string, packs: number, key: string): EconomyResult;
  ticketBalance(who: Who): EconomyResult;
  readOnline(userIds: string[]): Record<string, OnlineEntry | null>;
  writeOnline(userId: string, entry: OnlineEntry | null): void;
  /** Sends `data` to another world's match signal handler; returns its reply. */
  signalWorld(matchId: string, data: string): string | null;
  /** Account lookup by username (case-insensitive). */
  resolveUsername(name: string): { userId: string; username: string } | null;
  log(level: 'info' | 'warn' | 'error', msg: string): void;
}

export interface Outbound {
  op: number;
  data: string;
  /** User ids; null = everyone in the world. */
  to: string[] | null;
}

export interface LoopResult {
  messages: Outbound[];
  /** User ids the shell must kick from the match after sending `messages`. */
  kick: string[];
  /** Set when the match label should change. */
  label?: string;
}

export interface HostOptions {
  worldNo: number;
  matchId: string;
  seed: number;
  io: HostIO;
  content?: Content;
}

interface Session {
  uid: string;
  name: string;
  sid: string;
  presence: Presence | null;
  view: GameState;
  version: string | undefined;
  helloed: boolean;
  intents: Intent[];
  ack: number;
  strikes: number;
  messagesThisLoop: number;
  aoi: AoiState;
  needSnapshot: boolean;
  chat: ChatCounters;
  /** Tick at which a disconnected player is logged out. */
  graceUntil: number | null;
  /** Friends' last known world, for login/logout notices. */
  friendWorlds: Map<string, number | null>;
  /** The hub session closed: no more earns from this world. */
  expired: boolean;
  shopSeq: number;
}

let cachedContent: Content | null = null;
let cachedGrids: Map<string, Grid> | null = null;

/** Content and grids are built on first use, never at bundle load (Contract C12). */
function sharedContent(given?: Content): { content: Content; grids: Map<string, Grid> } {
  if (given) return { content: given, grids: buildGrids(given) };
  cachedContent ??= loadContent();
  cachedGrids ??= buildGrids(cachedContent);
  return { content: cachedContent, grids: cachedGrids };
}

export interface WorldHost {
  readonly world: WorldState;
  joinAttempt(
    p: Presence,
    vars: Record<string, string> | null,
  ): { accept: boolean; reason?: string };
  join(presences: Presence[]): void;
  leave(presences: Presence[]): void;
  message(sender: Presence, op: number, data: string): void;
  loop(): LoopResult;
  signal(data: string): string;
  shutdown(): LoopResult;
  label(): string;
  size(): number;
  /** The live view for a user (tests). */
  viewOf(uid: string): GameState | undefined;
}

export function createWorldHost(opts: HostOptions): WorldHost {
  const { io, worldNo, matchId } = opts;
  const { content, grids } = sharedContent(opts.content);
  const world = createWorldState(opts.seed >>> 0);
  const sessions = new Map<string, Session>();
  /** sid from joinAttempt, until join. */
  const pendingSid = new Map<string, string>();
  const trades = new TradeBook();
  let outbox: Outbound[] = [];
  let kicks: string[] = [];
  let loops = 0;
  let lastLabel = '';

  const savedEconomy = io.loadWorld();
  if (savedEconomy && typeof savedEconomy === 'object') {
    const e = savedEconomy as Record<string, unknown>;
    if (typeof e.hopium === 'number') world.economy.hopium = Math.min(100, Math.max(0, e.hopium));
    if (typeof e.recentBossWins === 'number') world.economy.recentBossWins = e.recentBossWins;
  }

  const send = (uid: string | null, op: number, body: unknown) => {
    outbox.push({ op, data: encode(body), to: uid === null ? null : [uid] });
  };
  const kick = (s: Session, reason: KickReason) => {
    send(s.uid, OP.KICK, { reason });
    kicks.push(s.uid);
    io.log('warn', `kick ${s.uid} ${reason}`);
  };
  const who = (s: Session): Who => ({ userId: s.uid, sid: s.sid });
  const live = () => [...sessions.values()];
  const byName = (name: string) => {
    const n = name.toLowerCase();
    return live().find((s) => s.name.toLowerCase() === n);
  };

  const wallet: WalletPort = {
    spend: (pid, shopId, itemId, packs) => shopCall(pid, 'buy', shopId, itemId, packs),
    sell: (pid, shopId, itemId, packs) => shopCall(pid, 'sell', shopId, itemId, packs),
  };
  const ctx: SimContext = { content, grids, wallet };

  function shopCall(
    pid: string,
    kind: 'buy' | 'sell',
    shopId: string,
    itemId: string,
    packs: number,
  ): WalletResult {
    const s = sessions.get(pid);
    if (!s) return { ok: false, error: 'no_session' };
    const key = `pbw:${s.sid}:${kind}:${world.tick}:${s.shopSeq++}`;
    try {
      const r =
        kind === 'buy'
          ? io.spendTickets(who(s), shopId, itemId, packs, key)
          : io.sellItem(who(s), shopId, itemId, packs, key);
      if (typeof r.error === 'string') {
        io.log('warn', `${kind} ${s.uid} ${itemId}x${packs}: ${r.error}`);
        return { ok: false, error: r.error };
      }
      const balance = typeof r.balance === 'number' ? r.balance : s.view.player.currencies.tickets;
      s.view.hubSession.serverBalance = balance;
      return { ok: true, balance };
    } catch (err) {
      io.log('error', `${kind} ${s.uid}: ${String(err)}`);
      return { ok: false, error: 'rpc_failed' };
    }
  }

  // ── Persistence ────────────────────────────────────────────────────────────
  function saveRows(list: Session[]): boolean {
    if (list.length === 0) return true;
    const rows = list.map((s) => ({
      userId: s.uid,
      data: serialize(s.view, io.nowMs()),
      version: s.version,
    }));
    let result: ReturnType<HostIO['saveCharacters']>;
    try {
      result = io.saveCharacters(rows);
    } catch (err) {
      io.log('error', `save failed: ${String(err)}`);
      return false;
    }
    if (result.ok) {
      for (const s of list) {
        const v = result.versions?.[s.uid];
        if (v !== undefined) s.version = v;
      }
      return true;
    }
    // Someone else wrote this character: this world's copy is stale. Never overwrite it.
    for (const uid of result.conflicts ?? []) {
      const s = sessions.get(uid);
      if (s) {
        kick(s, 'superseded');
        dropSession(s, false);
      }
    }
    io.log('warn', `save refused: ${result.error ?? 'conflict'}`);
    return false;
  }

  function dropSession(s: Session, save: boolean): void {
    trades.cancelFor(tradeEnv(), s.uid, 'left');
    if (save) {
      flushTickets(s);
      saveRows([s]);
    }
    try {
      io.writeOnline(s.uid, null);
    } catch (err) {
      io.log('warn', `writeOnline: ${String(err)}`);
    }
    removePlayerFromWorld(world, s.uid);
    sessions.delete(s.uid);
  }

  // ── Tickets: exactly-once stream batches and quest earns ───────────────────
  function applyCaps(s: Session, r: EconomyResult): void {
    if (typeof r.sessionCapLeft === 'number') s.view.hubSession.sessionCapLeft = r.sessionCapLeft;
    if (typeof r.dailyCapLeft === 'number') s.view.hubSession.dailyCapLeft = r.dailyCapLeft;
  }

  function refreshBalance(s: Session): number | null {
    try {
      const r = io.ticketBalance(who(s));
      applyCaps(s, r);
      if (typeof r.balance === 'number') {
        setTicketBalance(s.view, r.balance);
        return r.balance;
      }
    } catch (err) {
      io.log('warn', `balance ${s.uid}: ${String(err)}`);
    }
    return null;
  }

  /** Seals batches into the save first, so a retry after a crash reuses the same key and amount. */
  function flushTickets(only?: Session): void {
    const list = (only ? [only] : live()).filter((s) => !s.expired && s.sid !== '');
    const sealed: Session[] = [];
    for (const s of list) {
      let any = false;
      for (const reason of STREAM_REASONS) {
        if (openStreamBatch(s.view, reason, `pbw:${s.sid}:${reason}:${world.tick}`)) any = true;
      }
      if (any) sealed.push(s);
    }
    if (sealed.length > 0 && !saveRows(sealed)) {
      for (const s of sealed) {
        for (const reason of STREAM_REASONS) {
          const b = s.view.player.ledger.batches[reason];
          if (b && b.id === `pbw:${s.sid}:${reason}:${world.tick}`)
            undoStreamBatch(s.view, reason, b.id);
        }
      }
    }
    for (const s of list) {
      if (!sessions.has(s.uid)) continue;
      for (const reason of STREAM_REASONS) {
        const batch = s.view.player.ledger.batches[reason];
        if (batch) sendBatch(s, reason, batch.id, batch.amount);
      }
      sendQuestEarns(s);
    }
  }

  function sendBatch(
    s: Session,
    reason: (typeof STREAM_REASONS)[number],
    id: string,
    amount: number,
  ) {
    if (s.expired) return;
    let r: EconomyResult;
    try {
      r = io.earnTickets(who(s), amount, reason, id);
    } catch (err) {
      io.log('warn', `earn ${s.uid} ${reason}: ${String(err)}`);
      return; // keep the seal; resend later with the same key
    }
    applyCaps(s, r);
    const code = typeof r.error === 'string' ? r.error : null;
    if (code === null) {
      ackStreamBatch(s.view, reason, id, typeof r.balance === 'number' ? r.balance : null);
      return;
    }
    if (code === 'session_closed') {
      expire(s);
      return;
    }
    if (code === 'session_ticket_cap') s.view.hubSession.sessionCapLeft = 0;
    if (code === 'daily_ticket_cap') s.view.hubSession.dailyCapLeft = 0;
    if (code.endsWith('_cap')) return; // keep it sealed; resent when there is room
    if (code === 'idempotency_mismatch' || code === 'amount_over_rule') {
      dropStreamBatch(s.view, reason, id, refreshBalance(s));
      io.log('warn', `earn ${s.uid} ${reason} dropped: ${code}`);
    }
  }

  /** The 6 h lease ended or the player entered another portal: amounts stay pending in the save. */
  function expire(s: Session): void {
    if (s.expired) return;
    s.expired = true;
    kick(s, 'session_expired');
  }

  function sendQuestEarns(s: Session): void {
    if (s.expired) return;
    for (const row of s.view.player.ledger.questEarns) {
      if (row.status !== 'pending') continue;
      row.key ??= questEarnWireKey(row.name);
      let r: EconomyResult;
      try {
        r = io.earnTickets(who(s), row.amount, 'pb_quest', row.key);
      } catch (err) {
        io.log('warn', `quest earn ${s.uid}: ${String(err)}`);
        return;
      }
      const code = typeof r.error === 'string' ? r.error : null;
      if (code === null || code === 'idempotency_mismatch' || code === 'amount_over_rule') {
        row.status = 'acked';
        if (typeof r.balance === 'number') setTicketBalance(s.view, r.balance);
      } else if (code === 'session_closed') {
        expire(s);
        return;
      } else if (code.endsWith('_cap')) {
        row.status = 'capped';
        row.cappedSessionId = s.sid;
      }
    }
  }

  // ── Chat, trade and social environments ────────────────────────────────────
  const member = (s: Session): ChatMember => ({
    uid: s.uid,
    name: s.name,
    view: s.view,
    chat: s.chat,
  });

  function chatEnv(): ChatEnv {
    return {
      tick: world.tick,
      worldNo,
      content,
      byName: (name) => {
        const s = byName(name);
        return s ? member(s) : undefined;
      },
      hearers: (speaker) =>
        live()
          .filter(
            (s) =>
              s.uid !== speaker.uid &&
              s.view.zone === speaker.view.zone &&
              Math.max(
                Math.abs(s.view.player.pos.x - speaker.view.player.pos.x),
                Math.abs(s.view.player.pos.y - speaker.view.player.pos.y),
              ) <= NET.aoiRadius,
          )
          .map(member),
      send: (uid, out: ChatOut) => send(uid, OP.CHAT_OUT, out),
      remotePm: (from, toName, text, quick) => {
        const target = io.resolveUsername(toName);
        if (!target) return 'offline';
        const entry = io.readOnline([target.userId])[target.userId];
        if (!entry || !fresh(entry) || entry.matchId === matchId) return 'offline';
        const reply = io.signalWorld(
          entry.matchId,
          encode({
            t: 'pm',
            from: from.uid,
            fromName: from.name,
            fromWorld: worldNo,
            to: target.userId,
            text,
            quick,
          }),
        );
        return reply === 'ok' ? 'sent' : 'offline';
      },
      log: (level, msg) => io.log(level, msg),
    };
  }

  function tradeEnv(): TradeEnv {
    return {
      tick: world.tick,
      content,
      member: (uid) => {
        const s = sessions.get(uid);
        return s && s.presence ? { uid: s.uid, name: s.name, view: s.view } : undefined;
      },
      send: (uid, out: TradeOut) => send(uid, OP.TRADE_OUT, out),
      notice: (uid, text) =>
        send(uid, OP.CHAT_OUT, { ch: 'trade', from: '', text } satisfies ChatOut),
      persistPair: (a, b) => {
        const sa = sessions.get(a);
        const sb = sessions.get(b);
        return !!sa && !!sb && saveRows([sa, sb]);
      },
      log: (level, msg) => io.log(level, msg),
    };
  }

  const fresh = (e: OnlineEntry) =>
    io.nowMs() - e.at <= NET.onlineRefreshEveryTicks * NET.onlineStaleRefreshes * 600;

  function onlineEntry(s: Session): OnlineEntry {
    const social = s.view.player.social;
    const entry: OnlineEntry = {
      world: worldNo,
      matchId,
      at: io.nowMs(),
      pf: social.privateFilter,
    };
    if (social.privateFilter === 'friends') entry.fr = social.friends.map((f) => f.id);
    return entry;
  }

  /** Where each friend is, as this player may see it (their private filter applies). */
  function friendStatus(s: Session, entries: Record<string, OnlineEntry | null>): SocialOut {
    const social = s.view.player.social;
    const friends = social.friends.map((f) => {
      const local = sessions.get(f.id);
      let world: number | null = null;
      const e = local ? onlineEntry(local) : entries[f.id];
      if (e && (local || fresh(e))) {
        const visible =
          e.pf === 'on' ||
          e.pf === undefined ||
          (e.pf === 'friends' && (e.fr ?? []).includes(s.uid));
        world = visible ? e.world : null;
      }
      return { name: f.name, world };
    });
    return {
      friends,
      ignores: social.ignores.map((i) => i.name),
      filters: {
        public: social.publicFilter,
        private: social.privateFilter,
        trade: social.tradeFilter,
      },
    };
  }

  function pushSocial(s: Session, entries?: Record<string, OnlineEntry | null>): void {
    const ids = s.view.player.social.friends.map((f) => f.id);
    const rows = entries ?? safeReadOnline(ids);
    const out = friendStatus(s, rows);
    for (const [i, f] of out.friends.entries()) {
      const id = s.view.player.social.friends[i].id;
      const before = s.friendWorlds.get(id);
      if (before !== undefined && before !== f.world) {
        if (before === null)
          send(s.uid, OP.CHAT_OUT, { ch: 'system', text: `${f.name} has logged in.` });
        else if (f.world === null)
          send(s.uid, OP.CHAT_OUT, { ch: 'system', text: `${f.name} has logged out.` });
      }
      s.friendWorlds.set(id, f.world);
    }
    send(s.uid, OP.SOCIAL_OUT, out);
  }

  function safeReadOnline(ids: string[]): Record<string, OnlineEntry | null> {
    if (ids.length === 0) return {};
    try {
      return io.readOnline(ids);
    } catch (err) {
      io.log('warn', `readOnline: ${String(err)}`);
      return {};
    }
  }

  function handleSocial(s: Session, msg: SocialIn): void {
    const social = s.view.player.social;
    const note = (text: string) => send(s.uid, OP.CHAT_OUT, { ch: 'system', text });
    if (msg.op === 'filters') {
      social.publicFilter = msg.public;
      social.privateFilter = msg.private;
      social.tradeFilter = msg.trade;
      writeOnlineSafe(s);
      pushSocial(s);
      return;
    }
    const name = cleanText(msg.name, SOCIAL.nameMaxLength * 2);
    const isFriendOp = msg.op === 'addFriend' || msg.op === 'delFriend';
    const list = isFriendOp ? social.friends : social.ignores;
    if (msg.op === 'delFriend' || msg.op === 'delIgnore') {
      const i = list.findIndex((f) => f.name.toLowerCase() === name.toLowerCase());
      if (i >= 0) list.splice(i, 1);
      pushSocial(s);
      return;
    }
    const max = isFriendOp ? SOCIAL.maxFriends : SOCIAL.maxIgnores;
    if (list.length >= max) return note(`Your ${isFriendOp ? 'friends' : 'ignore'} list is full.`);
    const found = io.resolveUsername(name);
    if (!found) return note(`Unable to add ${name} - unknown player.`);
    if (found.userId === s.uid) return note("You can't add yourself.");
    if (list.some((f) => f.id === found.userId))
      return note(`${found.username} is already on your list.`);
    const other = isFriendOp ? social.ignores : social.friends;
    const j = other.findIndex((f) => f.id === found.userId);
    if (j >= 0) other.splice(j, 1);
    list.push({ id: found.userId, name: found.username });
    pushSocial(s);
  }

  function writeOnlineSafe(s: Session): void {
    try {
      io.writeOnline(s.uid, onlineEntry(s));
    } catch (err) {
      io.log('warn', `writeOnline: ${String(err)}`);
    }
  }

  // ── Messages ───────────────────────────────────────────────────────────────
  function strike(s: Session, why: string): void {
    s.strikes += 1;
    io.log('warn', `strike ${s.uid} ${why} (${s.strikes})`);
    if (s.strikes >= NET.floodStrikesToKick) kick(s, 'flood');
  }

  function welcome(s: Session): void {
    const body: Welcome = {
      you: s.view.selfId,
      world: worldNo,
      tick: world.tick,
      sim: SIM_VERSION,
      name: s.name,
      needsCharacter: false,
      canImport: NET.allowSaveImport,
    };
    send(s.uid, OP.WELCOME, body);
  }

  function displayName(username: string, uid: string): string {
    const base = cleanText(username, SOCIAL.nameMaxLength).replace(/[^A-Za-z0-9 _-]/g, '');
    if (base && !reservedName(base) && checkText(base).ok) return base;
    // A reserved or unusable name gets a neutral one (never "President <name>").
    let h = 0;
    for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
    return `Citizen ${(h % 9000) + 1000}`;
  }

  function joinOne(p: Presence): void {
    const existing = sessions.get(p.userId);
    if (existing) {
      // A reconnect (or a second tab): the newest connection wins.
      if (existing.presence && existing.presence.sessionId !== p.sessionId) {
        send(existing.uid, OP.KICK, { reason: 'superseded' });
      }
      existing.presence = p;
      existing.graceUntil = null;
      existing.helloed = false;
      existing.aoi = newAoi();
      welcome(existing);
      return;
    }
    const sid = pendingSid.get(p.userId) ?? '';
    pendingSid.delete(p.userId);
    let loaded: { data: unknown; version: string } | null = null;
    try {
      loaded = io.loadCharacters([p.userId])[p.userId] ?? null;
    } catch (err) {
      io.log('error', `load ${p.userId}: ${String(err)}`);
    }
    const restored = loaded ? deserializePlayer(loaded.data, content) : null;
    if (loaded && !restored) io.log('warn', `character ${p.userId} unreadable; starting fresh`);
    const player = restored?.player ?? createPlayer(content, START_ZONE_ID);
    const zoneId = restored && content.zones.has(restored.zoneId) ? restored.zoneId : START_ZONE_ID;
    const name = displayName(p.username, p.userId);
    player.displayName = name;
    const view = addPlayerToWorld(world, content, p.userId, player, zoneId);
    view.hubSession = { ...freshHubSession(), mode: 'hub', reachable: true };
    const s: Session = {
      uid: p.userId,
      name,
      sid,
      presence: p,
      view,
      version: loaded?.version,
      helloed: false,
      intents: [],
      ack: 0,
      strikes: 0,
      messagesThisLoop: 0,
      aoi: newAoi(),
      needSnapshot: true,
      chat: newChatCounters(),
      graceUntil: null,
      friendWorlds: new Map(),
      expired: false,
      shopSeq: 0,
    };
    sessions.set(s.uid, s);
    refreshBalance(s);
    writeOnlineSafe(s);
    welcome(s);
    io.log('info', `join ${s.uid} as ${name} (world ${worldNo}, ${sessions.size} online)`);
  }

  function onHello(s: Session, body: unknown): void {
    const hello = HelloSchema.safeParse(body);
    if (!hello.success) return strike(s, 'bad hello');
    if (hello.data.proto !== PROTOCOL_VERSION || hello.data.sim !== SIM_VERSION) {
      kick(s, 'sim_mismatch');
      return;
    }
    s.helloed = true;
    s.needSnapshot = true;
    pushSocial(s);
  }

  function onIntents(s: Session, body: unknown): void {
    const parsed = IntentsSchema.safeParse(body);
    if (!parsed.success) return strike(s, 'bad intents');
    s.ack = Math.max(s.ack, parsed.data.seq);
    let bad = false;
    for (const raw of parsed.data.intents) {
      const intent = IntentSchema.safeParse(raw);
      if (!intent.success) {
        bad = true;
        continue;
      }
      if (s.intents.length >= NET.maxIntentsPerTick) {
        bad = true;
        break;
      }
      s.intents.push(intent.data as Intent);
    }
    if (bad) strike(s, 'malformed or too many intents');
  }

  function onTrade(s: Session, body: unknown): void {
    const parsed = TradeInSchema.safeParse(body);
    if (!parsed.success) return strike(s, 'bad trade');
    const env = tradeEnv();
    const me = env.member(s.uid);
    if (!me) return;
    const m = parsed.data;
    if (m.op === 'request') {
      const uid = m.to.startsWith('p:') ? m.to.slice(2) : m.to;
      trades.request(env, me, uid);
    } else if (m.op === 'offer') trades.offer(env, me, m.slot, m.qty);
    else if (m.op === 'remove') trades.remove(env, me, m.index, m.qty);
    else if (m.op === 'accept') trades.accept(env, me);
    else trades.decline(env, s.uid);
  }

  // ── The 600 ms sim tick and what it sends ──────────────────────────────────
  function simTick(): void {
    const intents: Record<string, Intent[]> = {};
    const tEnv = tradeEnv();
    for (const s of sessions.values()) {
      if (s.intents.length === 0) continue;
      // Doing anything else closes the trade window (RuneScape).
      if (trades.inTrade(s.uid)) trades.decline(tEnv, s.uid);
      intents[s.uid] = s.intents;
      s.intents = [];
    }
    const events = runWorldTick(world, ctx, intents);
    trades.tick(tradeEnv());

    for (const s of live()) {
      if (s.graceUntil !== null && world.tick >= s.graceUntil) {
        io.log('info', `logout ${s.uid}`);
        dropSession(s, true);
      }
    }
    if (world.tick % NET.ticketFlushEveryTicks === 0) flushTickets();
    else
      for (const s of live())
        if (s.view.player.ledger.questEarns.some((r) => r.status === 'pending')) sendQuestEarns(s);
    if (world.tick % NET.saveEveryTicks === 0) saveRows(live());
    if (world.tick % NET.onlineRefreshEveryTicks === 0) {
      const all = live();
      for (const s of all) writeOnlineSafe(s);
      const ids = [...new Set(all.flatMap((s) => s.view.player.social.friends.map((f) => f.id)))];
      const rows = safeReadOnline(ids);
      for (const s of all) if (s.presence && s.helloed) pushSocial(s, rows);
    }
    if (world.tick % NET.worldSaveEveryTicks === 0) {
      try {
        io.saveWorld({
          hopium: world.economy.hopium,
          recentBossWins: world.economy.recentBossWins,
        });
      } catch (err) {
        io.log('warn', `saveWorld: ${String(err)}`);
      }
    }
    broadcastTick(events);
  }

  function broadcastTick(events: Record<string, SimEvent[]>): void {
    const keyframe = world.tick % NET.keyframeEveryTicks === 0;
    const byZone = new Map<string, GameState[]>();
    for (const pid of world.joinSeq) {
      const key = world.playerZone[pid];
      const list = byZone.get(key);
      const view = sessions.get(pid)?.view;
      if (!view) continue;
      if (list) list.push(view);
      else byZone.set(key, [view]);
    }
    const cache = new Map<string, CachedEntity[]>();
    for (const [key, views] of byZone) cache.set(key, zoneEntities(views[0].zone, views, content));
    // Area events by zone, from every player's list.
    const area = new Map<string, { from: string; e: SimEvent }[]>();
    for (const [pid, list] of Object.entries(events)) {
      const key = world.playerZone[pid];
      if (key === undefined) continue;
      for (const e of list) {
        if (!isAreaEvent(e)) continue;
        const bucket = area.get(key);
        if (bucket) bucket.push({ from: pid, e });
        else area.set(key, [{ from: pid, e }]);
      }
    }

    for (const s of sessions.values()) {
      if (!s.presence || !s.helloed) continue;
      const key = world.playerZone[s.uid];
      const view = s.view;
      const own = (events[s.uid] ?? []).filter((e) => e.type !== 'zoneChanged');
      if (s.aoi.zoneKey !== key) s.needSnapshot = true;
      const full = s.needSnapshot || keyframe;
      const visible = visibleTo(view, cache.get(key) ?? [], s.aoi.lastSent);
      const seen = new Set(visible.map((e) => e.wire.id));
      seen.add(view.selfId);
      seen.add(view.sprotoId);
      const others = (area.get(key) ?? [])
        .filter((a) => a.from !== s.uid && eventEntities(a.e).some((id) => seen.has(id)))
        .map((a) => a.e);
      const ev = [...own, ...others];
      if (full) {
        s.aoi.lastSent.clear();
        s.aoi.lastSelf.clear();
        for (const e of visible) s.aoi.lastSent.set(e.wire.id, { stat: e.stat, dyn: e.dyn });
        const snap: Snapshot & { ev: SimEvent[]; ack: number } = {
          tick: world.tick,
          zone: view.zone.id,
          self: selfPatch(view.player, s.aoi, true) ?? {},
          ent: [],
          obj: objectChanges(view.zone, s.aoi, true) as [string, number][],
          economy: world.economy,
          ev,
          ack: s.ack,
        };
        s.aoi.zoneKey = key;
        s.needSnapshot = false;
        // Entities go in pre-serialized, so each one is stringified once per tick, not per player.
        const body = encode(snap).replace(
          '"ent":[]',
          `"ent":[${visible.map((e) => e.text).join(',')}]`,
        );
        outbox.push({ op: OP.SNAPSHOT, data: body, to: [s.uid] });
        continue;
      }
      const texts: string[] = [];
      for (const e of visible) {
        const last = s.aoi.lastSent.get(e.wire.id);
        if (last && last.dyn === e.dyn && last.stat === e.stat) continue;
        // Unchanged static parts: send only the moving parts.
        texts.push(last && last.stat === e.stat ? e.dyn : e.text);
        s.aoi.lastSent.set(e.wire.id, { stat: e.stat, dyn: e.dyn });
      }
      const del: string[] = [];
      for (const id of s.aoi.lastSent.keys()) {
        if (!seen.has(id)) {
          del.push(id);
          s.aoi.lastSent.delete(id);
        }
      }
      const delta: Delta = { tick: world.tick, ack: s.ack, ent: [], del, ev };
      const self = selfPatch(view.player, s.aoi, false);
      if (self) delta.self = self;
      const obj = objectChanges(view.zone, s.aoi, false);
      if (obj.length > 0) delta.obj = obj;
      const body =
        texts.length > 0
          ? encode(delta).replace('"ent":[]', `"ent":[${texts.join(',')}]`)
          : encode(delta);
      outbox.push({ op: OP.DELTA, data: body, to: [s.uid] });
    }
  }

  function takeLoop(): LoopResult {
    const result: LoopResult = { messages: outbox, kick: kicks };
    outbox = [];
    kicks = [];
    for (const uid of result.kick) {
      const s = sessions.get(uid);
      if (s) dropSession(s, true);
    }
    const label = host.label();
    if (label !== lastLabel) {
      lastLabel = label;
      result.label = label;
    }
    return result;
  }

  const host: WorldHost = {
    world,
    joinAttempt(p, vars) {
      if (!vars || vars.game !== GAME_ID || vars.scope !== 'game')
        return { accept: false, reason: 'not_game_session' };
      if (!vars.sid) return { accept: false, reason: 'no_session' };
      const existing = sessions.get(p.userId);
      if (!existing && sessions.size >= NET.maxPlayersPerWorld)
        return { accept: false, reason: 'world_full' };
      if (!existing) {
        const entry = safeReadOnline([p.userId])[p.userId];
        if (entry && entry.matchId !== matchId && fresh(entry)) {
          // One world per account: ask the other world to log them out, then the client retries.
          io.signalWorld(entry.matchId, encode({ t: 'kick', uid: p.userId }));
          io.writeOnline(p.userId, null);
          return { accept: false, reason: 'already_online' };
        }
      }
      pendingSid.set(p.userId, vars.sid);
      if (existing) existing.sid = vars.sid;
      return { accept: true };
    },
    join(presences) {
      for (const p of presences) joinOne(p);
    },
    leave(presences) {
      for (const p of presences) {
        const s = sessions.get(p.userId);
        if (!s || !s.presence || s.presence.sessionId !== p.sessionId) continue;
        s.presence = null;
        s.helloed = false;
        s.graceUntil = world.tick + NET.logoutGraceTicks;
        trades.cancelFor(tradeEnv(), s.uid, 'left');
      }
    },
    message(sender, op, data) {
      const s = sessions.get(sender.userId);
      if (!s || !s.presence || s.presence.sessionId !== sender.sessionId) return;
      s.messagesThisLoop += 1;
      if (s.messagesThisLoop > NET.maxMessagesPerLoop) return strike(s, 'flood');
      if (data.length > NET.maxMessageBytes) return strike(s, 'oversized');
      const body = decode(data);
      if (body === null) return strike(s, 'not json');
      if (op === OP.HELLO) return onHello(s, body);
      if (!s.helloed) return;
      switch (op) {
        case OP.INTENTS:
          return onIntents(s, body);
        case OP.CHAT: {
          const parsed = ChatInSchema.safeParse(body);
          if (!parsed.success) return strike(s, 'bad chat');
          return handleChat(chatEnv(), member(s), parsed.data);
        }
        case OP.TRADE:
          return onTrade(s, body);
        case OP.SOCIAL: {
          const parsed = SocialInSchema.safeParse(body);
          if (!parsed.success) return strike(s, 'bad social');
          return handleSocial(s, parsed.data);
        }
        case OP.PING: {
          const parsed = PingSchema.safeParse(body);
          if (parsed.success) send(s.uid, OP.PONG, { t: parsed.data.t, serverTick: world.tick });
          return;
        }
        default:
          return strike(s, `unknown op ${op}`);
      }
    },
    loop() {
      loops += 1;
      for (const s of sessions.values()) s.messagesThisLoop = 0;
      if (loops % NET.loopsPerTick === 0) simTick();
      return takeLoop();
    },
    signal(data) {
      const body = decode(data) as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') return 'bad';
      if (body.t === 'kick' && typeof body.uid === 'string') {
        const s = sessions.get(body.uid);
        if (s) {
          kick(s, 'already_online');
          dropSession(s, true);
        }
        return 'ok';
      }
      if (body.t === 'pm' && typeof body.to === 'string' && typeof body.text === 'string') {
        const s = sessions.get(body.to);
        if (!s || !s.presence) return 'offline';
        const ok = deliverPm(
          chatEnv(),
          { uid: String(body.from), name: String(body.fromName), world: Number(body.fromWorld) },
          member(s),
          cleanText(body.text, 200),
          body.quick === true,
        );
        return ok ? 'ok' : 'offline';
      }
      return 'unknown';
    },
    shutdown() {
      flushTickets();
      saveRows(live());
      for (const s of live()) {
        send(s.uid, OP.KICK, { reason: 'shutdown' });
        try {
          io.writeOnline(s.uid, null);
        } catch {
          // shutting down anyway
        }
      }
      try {
        io.saveWorld({
          hopium: world.economy.hopium,
          recentBossWins: world.economy.recentBossWins,
        });
      } catch {
        // shutting down anyway
      }
      const result: LoopResult = { messages: outbox, kick: [...sessions.keys()] };
      outbox = [];
      return result;
    },
    label() {
      return JSON.stringify({
        game: GAME_ID,
        kind: 'pb_world',
        world: worldNo,
        players: sessions.size,
        max: NET.maxPlayersPerWorld,
        open: sessions.size < NET.maxPlayersPerWorld,
        sim: SIM_VERSION,
      });
    },
    size: () => sessions.size,
    viewOf: (uid) => sessions.get(uid)?.view,
  };
  lastLabel = host.label();
  return host;
}
