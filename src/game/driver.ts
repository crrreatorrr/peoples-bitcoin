/**
 * What main.ts runs the game through. Offline, LocalDriver steps the sim in
 * the page; online, OnlineDriver sends intents to a world and plays back the
 * server's ticks. Either way the UI reads `state` and calls `queue`.
 */
import { MAX_CATCHUP_TICKS, TICK_MS } from '../config/balance';
import type { GameState, Intent, SimContext, SimEvent } from '../sim/state';
import { runTick } from '../sim/tick';

export interface GameDriver {
  readonly mode: 'offline' | 'online';
  readonly state: GameState;
  queue(intent: Intent): void;
  /** Runs whatever ticks are due; each entry is one tick's events. */
  advance(now: number): SimEvent[][];
  /** Progress through the current tick, 0..1, for render interpolation. */
  alpha(now: number): number;
}

export class LocalDriver implements GameDriver {
  readonly mode = 'offline' as const;
  private pending: Intent[] = [];
  private lastTickAt: number;
  frozen = false;

  constructor(
    readonly state: GameState,
    private readonly ctx: SimContext,
    now: number,
  ) {
    this.lastTickAt = now;
  }

  queue(intent: Intent): void {
    if (!this.frozen) this.pending.push(intent);
  }

  advance(now: number): SimEvent[][] {
    if (this.frozen) return [];
    // After a long stall (background tab), resume without a burst of ticks.
    if (now - this.lastTickAt > TICK_MS * MAX_CATCHUP_TICKS) this.lastTickAt = now - TICK_MS;
    const out: SimEvent[][] = [];
    while (now - this.lastTickAt >= TICK_MS) {
      this.lastTickAt += TICK_MS;
      const intents = this.pending;
      this.pending = [];
      out.push(runTick(this.state, this.ctx, intents));
    }
    return out;
  }

  alpha(now: number): number {
    return (now - this.lastTickAt) / TICK_MS;
  }
}
