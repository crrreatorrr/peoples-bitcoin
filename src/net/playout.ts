/**
 * Jitter buffer for server ticks. Frames are applied in tick order, about
 * NET.interpDelayMs after they arrive and never closer than 80% of a tick
 * apart, so movement interpolates smoothly. A backlog of more than
 * NET.snapAfterTicks frames is applied at once (snap).
 */
import { NET, TICK_MS } from '../config/balance';

export interface Frame<T> {
  tick: number;
  arrivedAt: number;
  body: T;
}

export class Playout<T> {
  private queue: Frame<T>[] = [];
  /** When the last frame was applied (the render interpolates from here). */
  appliedAt = -Infinity;

  push(tick: number, body: T, now: number): void {
    this.queue.push({ tick, arrivedAt: now, body });
    this.queue.sort((a, b) => a.tick - b.tick);
  }

  /** Frames due now, oldest first. */
  take(now: number): T[] {
    if (this.queue.length === 0) return [];
    if (this.queue.length > NET.snapAfterTicks) {
      const all = this.queue.map((f) => f.body);
      this.queue = [];
      this.appliedAt = now;
      return all;
    }
    const head = this.queue[0];
    if (now - head.arrivedAt < NET.interpDelayMs) return [];
    if (now - this.appliedAt < TICK_MS * 0.8) return [];
    this.queue.shift();
    this.appliedAt = now;
    return [head.body];
  }

  /** Interpolation progress through the current tick, 0..1. */
  alpha(now: number): number {
    return Math.min(1, Math.max(0, (now - this.appliedAt) / TICK_MS));
  }

  clear(): void {
    this.queue = [];
  }

  get size(): number {
    return this.queue.length;
  }
}
