/**
 * Tickets → Verse in an online world. The Tickets are the server wallet the world spends from,
 * so the client asks the hub to exchange with the live session (as the Verse Exchange expects),
 * then asks the world to re-read the balance (OP.WALLET). The world never trusts the client's
 * number: it reads the hub.
 */
import { TICKETS } from '../config/balance';
import { errorCode, type HubBridge } from '../hub/bridge';
import type { GameState, MessageKind } from '../sim/state';

export class OnlineExchange {
  /** The exchange in flight, or one whose answer was lost: a retry reuses its key. */
  private pending: { key: string; tickets: number; inflight: boolean } | null = null;

  constructor(
    private readonly state: GameState,
    private readonly bridge: HubBridge,
    private readonly say: (text: string, kind?: MessageKind) => void,
    private readonly refreshWallet: () => void,
    private readonly newKey: () => string = () => crypto.randomUUID(),
  ) {}

  /** The hub session is live and the world read this character's hub profile. */
  available(): boolean {
    return this.bridge.mode === 'hub' && this.state.hubSession.mode === 'hub';
  }

  isPending(): boolean {
    return this.pending?.inflight === true;
  }

  amounts(): number[] {
    if (!this.available() || this.isPending()) return [];
    const cap = Math.min(TICKETS.exchangeMax, this.state.player.currencies.tickets);
    const out: number[] = [];
    for (let n = TICKETS.exchangeStep; n <= cap; n += TICKETS.exchangeStep) out.push(n);
    return out;
  }

  async request(tickets: number): Promise<void> {
    if (!this.available()) {
      this.say('The exchange needs the hub.');
      return;
    }
    if (this.isPending()) {
      this.say('Exchange pending');
      return;
    }
    const amount = Math.floor(tickets / TICKETS.exchangeStep) * TICKETS.exchangeStep;
    if (amount < TICKETS.exchangeStep || amount > TICKETS.exchangeMax) return;
    if (amount > this.state.player.currencies.tickets) {
      this.say('Not enough Tickets.');
      return;
    }
    const key = this.pending?.tickets === amount ? this.pending.key : this.newKey();
    this.pending = { key, tickets: amount, inflight: true };
    try {
      const result = await this.bridge.exchange(amount, key);
      this.pending = null;
      if (result.verseCapLeft != null) this.state.hubSession.verseCapLeft = result.verseCapLeft;
      const verse = Math.floor(amount / TICKETS.exchangeStep);
      this.say(
        `You exchange ${amount.toLocaleString('en-US')} Tickets for ${verse} Verse.`,
        'game',
      );
    } catch (err) {
      const code = errorCode(err);
      this.bridge.noteFailure(err);
      // A lost answer may have gone through: keep the key so a retry cannot pay twice.
      if (code === 'offline' || code === 'rpc_failed')
        this.pending = { key, tickets: amount, inflight: false };
      else this.pending = null;
      this.say(exchangeMessage(code), 'warning');
    } finally {
      this.refreshWallet();
    }
  }
}

function exchangeMessage(code: string): string {
  if (code === 'insufficient_tickets') return 'Not enough Tickets.';
  if (code.endsWith('_cap')) return 'The exchange limit for today is reached.';
  if (code === 'offline' || code === 'rpc_failed') return 'The exchange did not answer. Try again.';
  return `The exchange failed (${code}).`;
}
