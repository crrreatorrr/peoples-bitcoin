/** Transport over hub-sdk's realtime API (Contract C9): pb.worlds, then the pb_world match. */
import type { HubRealtime, MatchHandle } from '@metaverse/hub-sdk';
import { Listeners, type Transport, type WorldInfo } from './transport';

export class HubTransport implements Transport {
  readonly kind = 'hub' as const;
  private handle: MatchHandle | null = null;
  private unsubs: (() => void)[] = [];
  private connected: Promise<void> | null = null;
  private readonly messages = new Listeners<[number, string]>();
  private readonly closes = new Listeners<[string]>();
  private readonly rejoins = new Listeners<[]>();

  constructor(private readonly rt: HubRealtime) {}

  private connect(): Promise<void> {
    this.connected ??= this.rt.connect();
    return this.connected;
  }

  async listWorlds(): Promise<WorldInfo[]> {
    await this.connect();
    const answer = await this.rt.rpc<{ worlds?: WorldInfo[] }>('pb.worlds', {});
    return Array.isArray(answer.worlds) ? answer.worlds : [];
  }

  async join(matchId: string): Promise<void> {
    await this.connect();
    await this.leave();
    const handle = await this.rt.joinMatch({ matchId });
    this.handle = handle;
    this.unsubs = [
      handle.onMessage((m) => this.messages.emit(m.opCode, m.text())),
      handle.onRejoin(() => this.rejoins.emit()),
      handle.onClose((reason) => {
        if (this.handle === handle) this.handle = null;
        this.closes.emit(reason);
      }),
    ];
  }

  send(op: number, body: unknown): void {
    this.handle?.send(op, typeof body === 'string' ? body : JSON.stringify(body));
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
    const handle = this.handle;
    this.handle = null;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (handle) await handle.leave().catch(() => undefined);
  }
}
