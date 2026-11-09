/** Test doubles for the online world: a fake HostIO and scripted clients. */
import { OP, decode } from '../../src/net/protocol';
import { SIM_VERSION } from '../../src/net/simVersion';
import { PROTOCOL_VERSION } from '../../src/net/protocol';
import {
  createWorldHost,
  type EconomyResult,
  type HostIO,
  type OnlineEntry,
  type Outbound,
  type Presence,
} from '../../src/server/host';
import { NET } from '../../src/config/balance';
import { content } from '../helpers';

export interface FakeIO extends HostIO {
  storage: Map<string, { data: unknown; version: string }>;
  online: Map<string, OnlineEntry>;
  earns: { userId: string; amount: number; reason: string; key: string }[];
  spends: { userId: string; itemId: string; packs: number; key: string }[];
  balances: Map<string, number>;
  logs: string[];
  /** Override to fail the next saves. */
  failSaves: boolean;
  earnReply: (amount: number, reason: string, key: string) => EconomyResult;
  now: number;
  signals: { matchId: string; data: string }[];
  signalHandler: (matchId: string, data: string) => string | null;
  users: Map<string, string>;
}

export function fakeIO(): FakeIO {
  let version = 0;
  const io: FakeIO = {
    storage: new Map(),
    online: new Map(),
    earns: [],
    spends: [],
    balances: new Map(),
    logs: [],
    failSaves: false,
    now: 1_000_000,
    signals: [],
    users: new Map(),
    earnReply: () => ({}),
    signalHandler: () => null,
    nowMs: () => io.now,
    loadCharacters: (ids) => Object.fromEntries(ids.map((id) => [id, io.storage.get(id) ?? null])),
    saveCharacters(rows) {
      if (io.failSaves) return { ok: false, error: 'db_down' };
      const conflicts = rows.filter(
        (r) => (io.storage.get(r.userId)?.version ?? undefined) !== r.version,
      );
      if (conflicts.length > 0) return { ok: false, conflicts: conflicts.map((c) => c.userId) };
      const versions: Record<string, string> = {};
      for (const r of rows) {
        const v = String(++version);
        io.storage.set(r.userId, { data: JSON.parse(JSON.stringify(r.data)), version: v });
        versions[r.userId] = v;
      }
      return { ok: true, versions };
    },
    loadWorld: () => null,
    saveWorld: () => undefined,
    earnTickets(who, amount, reason, key) {
      io.earns.push({ userId: who.userId, amount, reason, key });
      const r = io.earnReply(amount, reason, key);
      if (r.error) return r;
      const balance = (io.balances.get(who.userId) ?? 0) + amount;
      io.balances.set(who.userId, balance);
      return { balance, ...r };
    },
    spendTickets(who, _shop, itemId, packs, key) {
      io.spends.push({ userId: who.userId, itemId, packs, key });
      const balance = io.balances.get(who.userId) ?? 0;
      if (balance < 10 * packs) return { error: 'insufficient_tickets' };
      io.balances.set(who.userId, balance - 10 * packs);
      return { balance: balance - 10 * packs };
    },
    sellItem(who, _shop, _itemId, packs) {
      const balance = (io.balances.get(who.userId) ?? 0) + packs;
      io.balances.set(who.userId, balance);
      return { balance };
    },
    ticketBalance: (who) => ({
      balance: io.balances.get(who.userId) ?? 0,
      sessionCapLeft: 200,
      dailyCapLeft: 1000,
    }),
    readOnline: (ids) => Object.fromEntries(ids.map((id) => [id, io.online.get(id) ?? null])),
    writeOnline(id, entry) {
      if (entry) io.online.set(id, entry);
      else io.online.delete(id);
    },
    signalWorld(matchId, data) {
      io.signals.push({ matchId, data });
      return io.signalHandler(matchId, data);
    },
    resolveUsername(name) {
      for (const [id, n] of io.users)
        if (n.toLowerCase() === name.toLowerCase()) return { userId: id, username: n };
      return null;
    },
    log: (level, msg) => {
      io.logs.push(`${level} ${msg}`);
    },
  };
  return io;
}

export interface Received {
  op: number;
  body: Record<string, unknown>;
}

/** A host plus helpers to join users and read what each one received. */
export function testWorld(opts: { worldNo?: number; matchId?: string; io?: FakeIO } = {}) {
  const io = opts.io ?? fakeIO();
  const host = createWorldHost({
    worldNo: opts.worldNo ?? 1,
    matchId: opts.matchId ?? 'm1',
    seed: 42,
    io,
    content: content(),
  });
  const inbox = new Map<string, Received[]>();
  const kicked: string[] = [];
  const deliver = (messages: Outbound[]) => {
    for (const m of messages) {
      const to = m.to ?? [...inbox.keys()];
      for (const uid of to) {
        const list = inbox.get(uid) ?? [];
        list.push({ op: m.op, body: decode(m.data) as Record<string, unknown> });
        inbox.set(uid, list);
      }
    }
  };
  const presences = new Map<string, Presence>();
  const api = {
    io,
    host,
    inbox,
    kicked,
    presence: (uid: string) => presences.get(uid)!,
    join(uid: string, username = uid, hello = true) {
      const p: Presence = { userId: uid, sessionId: `sess-${uid}-${presences.size}`, username };
      io.users.set(uid, username);
      const verdict = host.joinAttempt(p, {
        scope: 'game',
        game: 'peoples-bitcoin',
        sid: `sid-${uid}`,
      });
      if (!verdict.accept) return verdict;
      presences.set(uid, p);
      inbox.set(uid, inbox.get(uid) ?? []);
      host.join([p]);
      if (hello) api.send(uid, OP.HELLO, { proto: PROTOCOL_VERSION, sim: SIM_VERSION });
      api.flush();
      return verdict;
    },
    send(uid: string, op: number, body: unknown) {
      host.message(presences.get(uid)!, op, typeof body === 'string' ? body : JSON.stringify(body));
    },
    flush() {
      const r = host.loop();
      deliver(r.messages);
      kicked.push(...r.kick);
      // Undo the loop count so tests control ticks precisely.
      return r;
    },
    /** Runs whole sim ticks (NET.loopsPerTick loops each). */
    ticks(n = 1) {
      for (let i = 0; i < n * NET.loopsPerTick; i++) {
        const r = host.loop();
        deliver(r.messages);
        kicked.push(...r.kick);
      }
    },
    leave(uid: string) {
      host.leave([presences.get(uid)!]);
    },
    take(uid: string, op?: number): Received[] {
      const list = inbox.get(uid) ?? [];
      inbox.set(uid, []);
      return op === undefined ? list : list.filter((m) => m.op === op);
    },
    peek(uid: string, op: number): Received[] {
      return (inbox.get(uid) ?? []).filter((m) => m.op === op);
    },
  };
  return api;
}
