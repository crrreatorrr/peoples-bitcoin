/**
 * Smooth tile-to-tile movement between ticks. Each tick an actor walks its
 * steps over the tick (`t` from 0 to 1). Ticks don't always land exactly when
 * the last one's walk finishes: online, the playout buffer applies a server
 * tick as early as 80% of the way through, or late. Without care the actor then
 * jumps ahead a fifth of a tile, or stands frozen in its idle pose until the
 * late tick shows up, and the walk stutters.
 *
 * Glide hides both. When a tick starts before the actor reached its tile, the
 * distance still to go carries into the new tick and fades out over it, so the
 * actor never jumps. When it reaches its tile and the next tick is late, the
 * walk pose holds (as it does offline, where a stop only shows at the next
 * tick) for up to GAIT_HOLD_MS, then eases to idle.
 */
import type { Tile } from '../sim/state';

export interface Point {
  x: number;
  z: number;
}

// Render-only tunables. They live here, not in config/balance.ts, because
// src/config feeds the sim version hash: a change there would need a world
// server rebuild for online play.
/** A walker that reached its tile keeps its walk pose this long while the next tick is late. */
export const GAIT_HOLD_MS = 300;
/** A tick that starts this many tiles from where an actor is drawn snaps instead of gliding. */
export const GLIDE_MAX_TILES = 1.5;
/** A tick restarting moves `t` back by at least this much. */
const NEW_TICK_DROP = 0.25;
/** Below this many tiles of carry, the actor counts as standing. */
const CARRY_STILL = 0.01;

export class Glide {
  private lastT = 0;
  private fullAt: number | null = null;
  /** World offset from where this tick's walk starts to where the actor was drawn. */
  readonly carry: Point = { x: 0, z: 0 };

  /**
   * Places the actor for this frame: interpolates `steps` at `t`, then adds what
   * is left of the carry. `drawn` is where the actor was drawn last frame; it is
   * overwritten with the new position. Returns whether the actor is walking
   * (for the walk pose) and the direction of its current step.
   */
  place(
    steps: readonly Tile[],
    t: number,
    now: number,
    drawn: Point,
    segment: { dx: number; dz: number },
  ): boolean {
    if (t + NEW_TICK_DROP < this.lastT) {
      const start = steps[0];
      this.carry.x = drawn.x - (start.x + 0.5);
      this.carry.z = drawn.z - (start.y + 0.5);
      // A teleport or respawn snaps instead of sliding across the map.
      if (Math.hypot(this.carry.x, this.carry.z) > GLIDE_MAX_TILES) this.clearCarry();
    }
    this.lastT = t;

    const moved = interpolateSteps(steps, t, drawn, segment);
    const left = 1 - t;
    drawn.x += this.carry.x * left;
    drawn.z += this.carry.z * left;
    const gliding = Math.hypot(this.carry.x, this.carry.z) * left > CARRY_STILL;
    if (t >= 1) {
      this.fullAt ??= now;
      this.clearCarry();
    } else this.fullAt = null;
    if (!moved && gliding) {
      // Finishing the last step after a stop: face the way it was going.
      segment.dx = -this.carry.x;
      segment.dz = -this.carry.z;
    }
    if (gliding) return true;
    return moved && (this.fullAt === null || now - this.fullAt < GAIT_HOLD_MS);
  }

  /** Snaps to the tile (a teleport, a respawn). */
  reset(): void {
    this.clearCarry();
    this.lastT = 0;
    this.fullAt = null;
  }

  private clearCarry(): void {
    this.carry.x = 0;
    this.carry.z = 0;
  }
}

/**
 * Where an actor is `t` (0..1) of the way through this tick's steps, written to
 * `out`; `segment` gets the direction of the step it is on. Returns false if the
 * steps don't go anywhere (it's standing on the last one).
 */
export function interpolateSteps(
  steps: readonly Tile[],
  t: number,
  out: Point,
  segment: { dx: number; dz: number },
): boolean {
  const last = steps.length - 1;
  const moved = last > 0 && (steps[0].x !== steps[last].x || steps[0].y !== steps[last].y);
  if (!moved) {
    out.x = steps[last].x + 0.5;
    out.z = steps[last].y + 0.5;
    return false;
  }
  const f = t * last;
  const i = Math.min(last - 1, Math.floor(f));
  const local = f - i;
  const a = steps[i];
  const b = steps[i + 1];
  out.x = a.x + (b.x - a.x) * local + 0.5;
  out.z = a.y + (b.y - a.y) * local + 0.5;
  segment.dx = b.x - a.x;
  segment.dz = b.y - a.y;
  return true;
}
