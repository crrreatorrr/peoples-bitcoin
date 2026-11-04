/**
 * How the client talks to a world: the hub's Nakama match (hubTransport) or an
 * in-page host (loopbackTransport, for tests and `?net=loopback`).
 */
export interface WorldInfo {
  world: number;
  matchId: string;
  players: number;
  max: number;
  sim: string;
}

export interface Transport {
  readonly kind: 'hub' | 'loopback';
  listWorlds(): Promise<WorldInfo[]>;
  /** Rejects with an Error whose message is a code, e.g. 'match_rejected:world_full'. */
  join(matchId: string): Promise<void>;
  send(op: number, body: unknown): void;
  onMessage(cb: (op: number, text: string) => void): () => void;
  /** The connection to the world is gone for good ('kicked', 'rejoin_failed', 'left', 'ended'). */
  onClose(cb: (reason: string) => void): () => void;
  /** The socket dropped and the match was re-joined; send HELLO again for a fresh snapshot. */
  onRejoin(cb: () => void): () => void;
  leave(): Promise<void>;
}

/** A tiny listener list. */
export class Listeners<T extends unknown[]> {
  private readonly fns = new Set<(...args: T) => void>();
  add(fn: (...args: T) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(...args: T): void {
    for (const fn of [...this.fns]) fn(...args);
  }
}
