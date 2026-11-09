/**
 * Online play: intents go to the world right away (a small batch per frame);
 * there is no local sim and no prediction, RuneScape-style. The click cross
 * shows at once and the move starts on the next server tick. Server ticks are
 * played back through a jitter buffer into the replica.
 */
import { NET } from '../config/balance';
import type { Content } from '../sim/content';
import type { Intent, SimEvent } from '../sim/state';
import {
  OP,
  PROTOCOL_VERSION,
  decode,
  type ChatIn,
  type ChatOut,
  type Delta,
  type Kick,
  type Pong,
  type Snapshot,
  type SocialIn,
  type SocialOut,
  type TradeIn,
  type TradeOut,
  type Welcome,
} from '../net/protocol';
import { Playout } from '../net/playout';
import { Replica } from '../net/replica';
import { SIM_VERSION } from '../net/simVersion';
import { Listeners, type Transport } from '../net/transport';
import type { GameDriver } from './driver';

type TickFrame =
  { kind: 'snapshot'; body: Snapshot & { ev?: SimEvent[] } } | { kind: 'delta'; body: Delta };

export class OnlineDriver implements GameDriver {
  readonly mode = 'online' as const;
  readonly replica: Replica;
  readonly chat = new Listeners<[ChatOut]>();
  readonly trade = new Listeners<[TradeOut]>();
  readonly social = new Listeners<[SocialOut]>();
  readonly kicked = new Listeners<[string]>();
  welcome: Welcome | null = null;
  /** Round trip in ms, from PING/PONG. */
  rtt: number | null = null;
  private pending: Intent[] = [];
  private seq = 0;
  private readonly playout = new Playout<TickFrame>();
  private lastPing = 0;
  private readonly unsubs: (() => void)[] = [];

  constructor(
    content: Content,
    zoneId: string,
    readonly transport: Transport,
    private readonly clock: () => number,
  ) {
    this.replica = new Replica(content, zoneId);
    this.unsubs.push(
      transport.onMessage((op, text) => this.receive(op, text)),
      transport.onRejoin(() => this.hello()),
      transport.onClose((reason) =>
        this.kicked.emit(reason === 'rejoin_failed' ? 'connection_lost' : reason),
      ),
    );
  }

  get state() {
    return this.replica.state;
  }

  hello(): void {
    this.playout.clear();
    this.transport.send(OP.HELLO, { proto: PROTOCOL_VERSION, sim: SIM_VERSION, client: 'web' });
  }

  queue(intent: Intent): void {
    // Online chat goes through the CHAT op (server filters and routing).
    if (intent.type === 'chat') {
      this.say({ ch: 'public', text: intent.text });
      return;
    }
    this.pending.push(intent);
  }

  say(msg: ChatIn): void {
    this.transport.send(OP.CHAT, msg);
  }

  sendTrade(msg: TradeIn): void {
    this.transport.send(OP.TRADE, msg);
  }

  sendSocial(msg: SocialIn): void {
    this.transport.send(OP.SOCIAL, msg);
  }

  advance(now: number): SimEvent[][] {
    if (this.pending.length > 0) {
      const intents = this.pending.splice(0, NET.maxIntentsPerTick);
      this.transport.send(OP.INTENTS, { seq: ++this.seq, intents });
    }
    if (now - this.lastPing > NET.pingEveryMs) {
      this.lastPing = now;
      this.transport.send(OP.PING, { t: now });
    }
    const out: SimEvent[][] = [];
    for (const frame of this.playout.take(now)) {
      out.push(
        frame.kind === 'snapshot'
          ? this.replica.applySnapshot(frame.body)
          : this.replica.applyDelta(frame.body),
      );
    }
    return out;
  }

  takeFailure(): null {
    return null;
  }

  alpha(now: number): number {
    return this.playout.alpha(now);
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    void this.transport.leave();
  }

  private receive(op: number, text: string): void {
    const body = decode(text);
    if (body === null) return;
    switch (op) {
      case OP.WELCOME:
        this.welcome = body as Welcome;
        this.replica.setSelf(this.welcome.you);
        this.hello();
        return;
      case OP.SNAPSHOT: {
        const snap = body as Snapshot & { ev?: SimEvent[] };
        this.playout.push(snap.tick, { kind: 'snapshot', body: snap }, this.clock());
        return;
      }
      case OP.DELTA: {
        const delta = body as Delta;
        this.playout.push(delta.tick, { kind: 'delta', body: delta }, this.clock());
        return;
      }
      case OP.CHAT_OUT:
        this.chat.emit(body as ChatOut);
        return;
      case OP.TRADE_OUT:
        this.trade.emit(body as TradeOut);
        return;
      case OP.SOCIAL_OUT:
        this.social.emit(body as SocialOut);
        return;
      case OP.KICK:
        this.kicked.emit((body as Kick).reason);
        return;
      case OP.PONG:
        this.rtt = this.clock() - (body as Pong).t;
        return;
    }
  }
}
