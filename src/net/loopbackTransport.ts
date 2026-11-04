/**
 * Runs a world host in the page, with in-memory I/O and a few bots, so the
 * online client can be built and played without Nakama (`?net=loopback`).
 * Bots walk around the Treasury and now and then say a quick-chat line.
 */
import { NET } from '../config/balance';
import type { Content } from '../sim/content';
import {
  createWorldHost,
  type HostIO,
  type OnlineEntry,
  type Presence,
  type WorldHost,
} from '../server/host';
import { OP, PROTOCOL_VERSION } from './protocol';
import { SIM_VERSION } from './simVersion';
import { Listeners, type Transport, type WorldInfo } from './transport';

const BOT_LINES = ['hi', 'attention', 'notbitcon', 'gremlin', 'motion', 'trade', 'vow'];

export interface LoopbackOptions {
  content?: Content;
  bots?: number;
  /** Starting Tickets for every account (the loopback wallet is in memory). */
  tickets?: number;
  /** false: the caller drives `host.loop()` (tests). */
  autoLoop?: boolean;
  me?: { userId: string; username: string };
}

/** An in-memory HostIO: storage with versions, a Ticket wallet per user, online rows. */
export function memoryIO(startTickets = 1000): HostIO & { users: Map<string, string> } {
  const store = new Map<string, { data: unknown; version: string }>();
  const online = new Map<string, OnlineEntry>();
  const wallet = new Map<string, number>();
  const users = new Map<string, string>();
  let v = 0;
  const bal = (id: string) => wallet.get(id) ?? startTickets;
  return {
    users,
    nowMs: () => Date.now(),
    loadCharacters: (ids) => Object.fromEntries(ids.map((id) => [id, store.get(id) ?? null])),
    saveCharacters(rows) {
      const conflicts = rows
        .filter((r) => store.get(r.userId)?.version !== r.version)
        .map((r) => r.userId);
      if (conflicts.length) return { ok: false, conflicts };
      const versions: Record<string, string> = {};
      for (const r of rows) {
        versions[r.userId] = String(++v);
        store.set(r.userId, {
          data: JSON.parse(JSON.stringify(r.data)),
          version: versions[r.userId],
        });
      }
      return { ok: true, versions };
    },
    loadWorld: () => null,
    saveWorld: () => undefined,
    earnTickets(who, amount) {
      wallet.set(who.userId, bal(who.userId) + amount);
      return { balance: bal(who.userId) };
    },
    spendTickets(who, _shop, _item, packs) {
      // The loopback has no hub price table: a flat 10 Tickets a pack.
      const cost = 10 * packs;
      if (bal(who.userId) < cost) return { error: 'insufficient_tickets' };
      wallet.set(who.userId, bal(who.userId) - cost);
      return { balance: bal(who.userId) };
    },
    sellItem(who, _shop, _item, packs) {
      wallet.set(who.userId, bal(who.userId) + packs);
      return { balance: bal(who.userId) };
    },
    ticketBalance: (who) => ({ balance: bal(who.userId), sessionCapLeft: 200, dailyCapLeft: 1000 }),
    readOnline: (ids) => Object.fromEntries(ids.map((id) => [id, online.get(id) ?? null])),
    writeOnline(id, entry) {
      if (entry) online.set(id, entry);
      else online.delete(id);
    },
    signalWorld: () => null,
    resolveUsername(name) {
      for (const [id, n] of users)
        if (n.toLowerCase() === name.toLowerCase()) return { userId: id, username: n };
      return null;
    },
    log: (level, msg) => {
      if (level !== 'info') console.warn(`[loopback] ${msg}`);
    },
  };
}

export class LoopbackTransport implements Transport {
  readonly kind = 'loopback' as const;
  readonly host: WorldHost;
  readonly io: ReturnType<typeof memoryIO>;
  private readonly me: Presence;
  private readonly bots: Presence[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private joined = false;
  private loops = 0;
  private readonly messages = new Listeners<[number, string]>();
  private readonly closes = new Listeners<[string]>();
  private readonly rejoins = new Listeners<[]>();

  constructor(opts: LoopbackOptions = {}) {
    this.io = memoryIO(opts.tickets);
    this.host = createWorldHost({
      worldNo: 1,
      matchId: 'loopback-1',
      seed: 1234,
      io: this.io,
      content: opts.content,
    });
    const me = opts.me ?? { userId: 'me', username: 'You' };
    this.me = { ...me, sessionId: 'loopback-me' };
    this.io.users.set(me.userId, me.username);
    for (let i = 0; i < (opts.bots ?? 0); i++) {
      const bot = {
        userId: `bot${i + 1}`,
        sessionId: `loopback-bot${i + 1}`,
        username: `Bot ${i + 1}`,
      };
      this.io.users.set(bot.userId, bot.username);
      this.bots.push(bot);
    }
    if (opts.autoLoop !== false) {
      this.timer = setInterval(() => this.pump(), 1000 / NET.loopHz);
    }
  }

  async listWorlds(): Promise<WorldInfo[]> {
    return [
      {
        world: 1,
        matchId: 'loopback-1',
        players: this.host.size(),
        max: NET.maxPlayersPerWorld,
        sim: SIM_VERSION,
      },
    ];
  }

  async join(): Promise<void> {
    const vars = { scope: 'game', game: 'peoples-bitcoin', sid: 'loopback' };
    const verdict = this.host.joinAttempt(this.me, vars);
    if (!verdict.accept) throw new Error(`match_rejected:${verdict.reason ?? 'rejected'}`);
    this.host.join([this.me]);
    for (const bot of this.bots) {
      if (this.host.joinAttempt(bot, vars).accept) {
        this.host.join([bot]);
        this.host.message(
          bot,
          OP.HELLO,
          JSON.stringify({ proto: PROTOCOL_VERSION, sim: SIM_VERSION }),
        );
      }
    }
    this.joined = true;
  }

  send(op: number, body: unknown): void {
    if (!this.joined) return;
    this.host.message(this.me, op, typeof body === 'string' ? body : JSON.stringify(body));
  }

  /** One 200 ms loop: bots act, the host runs, our messages are delivered. */
  pump(): void {
    if (!this.joined) return;
    this.loops++;
    if (this.loops % NET.loopsPerTick === 0) this.botsAct();
    const out = this.host.loop();
    for (const m of out.messages) {
      if (m.to === null || m.to.includes(this.me.userId)) this.messages.emit(m.op, m.data);
    }
    if (out.kick.includes(this.me.userId)) {
      this.joined = false;
      this.closes.emit('kicked');
    }
  }

  private botsAct(): void {
    for (const [i, bot] of this.bots.entries()) {
      const r = Math.random();
      if (r < 0.15) {
        const x = 14 + Math.floor(Math.random() * 26);
        const y = 22 + Math.floor(Math.random() * 16);
        this.host.message(
          bot,
          OP.INTENTS,
          JSON.stringify({ seq: this.loops, intents: [{ type: 'walk', x, y }] }),
        );
      } else if (r < 0.17 + i * 0.001) {
        const phrase = BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)];
        this.host.message(bot, OP.CHAT, JSON.stringify({ ch: 'quick', phrase }));
      }
    }
  }

  onMessage(cb: (op: number, text: string) => void) {
    return this.messages.add(cb);
  }

  onClose(cb: (reason: string) => void) {
    return this.closes.add(cb);
  }

  onRejoin(cb: () => void) {
    return this.rejoins.add(cb);
  }

  async leave(): Promise<void> {
    if (this.joined) this.host.leave([this.me]);
    this.joined = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
