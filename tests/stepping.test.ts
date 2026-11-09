import { describe, expect, it } from 'vitest';
import { GAIT_HOLD_MS, Glide, interpolateSteps, type Point } from '../src/render/stepping';
import { crossFrameAt } from '../src/ui/clickcross';
import type { Tile } from '../src/sim/state';

const TICK = 600;

/** Plays ticks of `steps` at the given apply times, sampling every 16 ms. */
function walk(ticks: { at: number; steps: Tile[] }[], until: number) {
  const glide = new Glide();
  const drawn: Point = { x: ticks[0].steps[0].x + 0.5, z: ticks[0].steps[0].y + 0.5 };
  const seg = { dx: 0, dz: 0 };
  const frames: { now: number; x: number; z: number; moving: boolean }[] = [];
  for (let now = ticks[0].at; now <= until; now += 16) {
    const tick = ticks.filter((k) => k.at <= now).at(-1)!;
    const t = Math.min(1, (now - tick.at) / TICK);
    const moving = glide.place(tick.steps, t, now, drawn, seg);
    frames.push({ now, x: drawn.x, z: drawn.z, moving });
  }
  return frames;
}

const maxJump = (frames: { x: number; z: number }[]) =>
  Math.max(...frames.slice(1).map((f, i) => Math.hypot(f.x - frames[i].x, f.z - frames[i].z)));

describe('interpolateSteps', () => {
  it('walks evenly along a tick of steps', () => {
    const out = { x: 0, z: 0 };
    const seg = { dx: 0, dz: 0 };
    const steps = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(interpolateSteps(steps, 0.75, out, seg)).toBe(true);
    expect(out).toEqual({ x: 1.5, z: 1 });
    expect(seg).toEqual({ dx: 0, dz: 1 });
    expect(interpolateSteps([{ x: 3, y: 4 }], 0.5, out, seg)).toBe(false);
    expect(out).toEqual({ x: 3.5, z: 4.5 });
  });
});

describe('Glide', () => {
  // One tile east per tick.
  const east = (n: number) => [
    { x: n, y: 0 },
    { x: n + 1, y: 0 },
  ];

  it('moves at a steady pace when ticks land on time', () => {
    const frames = walk(
      [0, 1, 2, 3].map((n) => ({ at: n * TICK, steps: east(n) })),
      4 * TICK - 16,
    );
    expect(maxJump(frames)).toBeLessThan(0.04);
    expect(frames.every((f) => f.moving)).toBe(true);
  });

  it("doesn't jump ahead when a tick lands early (online playout)", () => {
    // The second tick is applied at 80% of the first, as the jitter buffer allows.
    const frames = walk(
      [
        { at: 0, steps: east(0) },
        { at: 480, steps: east(1) },
        { at: 1080, steps: east(2) },
      ],
      1080 + TICK,
    );
    // Without the carry the actor jumps 0.2 tiles in one frame at 480 ms.
    expect(maxJump(frames)).toBeLessThan(0.06);
    // Position only ever moves forward.
    expect(frames.every((f, i) => i === 0 || f.x >= frames[i - 1].x - 1e-9)).toBe(true);
    // And still ends on its tile.
    expect(frames.at(-1)!.x).toBeCloseTo(3.5, 5);
  });

  it('keeps the walk pose briefly while a tick is late, then stands', () => {
    // The second tick arrives 200 ms late.
    const frames = walk(
      [
        { at: 0, steps: east(0) },
        { at: 800, steps: east(1) },
      ],
      1400,
    );
    const waiting = frames.filter((f) => f.now >= 600 && f.now < 800);
    expect(waiting.every((f) => f.moving)).toBe(true);
    expect(waiting.every((f) => f.x === 1.5)).toBe(true);

    // A tick that never comes: the pose eases to idle after the hold.
    const stalled = walk([{ at: 0, steps: east(0) }], 600 + GAIT_HOLD_MS + 100);
    expect(stalled.at(-1)!.moving).toBe(false);
  });

  it('glides onto its tile after stopping early, facing the way it went', () => {
    const glide = new Glide();
    const drawn: Point = { x: 0.5, z: 0.5 };
    const seg = { dx: 0, dz: 0 };
    glide.place(east(0), 0.8, 0, drawn, seg);
    expect(drawn.x).toBeCloseTo(1.3, 5);
    // The stop arrives early: the step is not finished yet.
    expect(glide.place([{ x: 1, y: 0 }], 0, 480, drawn, seg)).toBe(true);
    expect(drawn.x).toBeCloseTo(1.3, 5);
    expect(seg.dx).toBeGreaterThan(0);
    expect(glide.place([{ x: 1, y: 0 }], 1, 1080, drawn, seg)).toBe(false);
    expect(drawn.x).toBe(1.5);
  });

  it('snaps on a teleport instead of sliding across the map', () => {
    const glide = new Glide();
    const drawn: Point = { x: 0.5, z: 0.5 };
    const seg = { dx: 0, dz: 0 };
    glide.place(east(0), 0.9, 0, drawn, seg);
    glide.place([{ x: 40, y: 12 }], 0, 540, drawn, seg);
    expect(drawn).toEqual({ x: 40.5, z: 12.5 });
  });
});

describe('click cross', () => {
  it('shrinks through four frames and then hides', () => {
    expect([0, 0.2, 0.3, 0.6, 0.8, 0.99].map(crossFrameAt)).toEqual([0, 0, 1, 2, 3, 3]);
    expect(crossFrameAt(1)).toBe(-1);
    expect(crossFrameAt(-0.1)).toBe(-1);
  });
});
