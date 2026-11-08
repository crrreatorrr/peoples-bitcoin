import { describe, expect, it, vi } from 'vitest';
import { TICK_MS } from '../src/config/balance';
import { CrashGuard, createFrameLoop, type CrashReport } from '../src/game/crash';
import { LocalDriver } from '../src/game/driver';
import type { GameState, SimContext } from '../src/sim/state';

// The driver's ticks: the second one throws, as a broken system inside runTick would.
const tickCalls = vi.hoisted(() => ({ n: 0, throwAt: -1 }));
vi.mock('../src/sim/tick', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/sim/tick')>()),
  runTick: () => {
    tickCalls.n++;
    if (tickCalls.n === tickCalls.throwAt) throw new Error('combat system threw');
    return [];
  },
}));

/** A manual rAF: frames run only when the test pumps them. */
function fakeRaf() {
  const queue: ((now: number) => void)[] = [];
  let scheduled = 0;
  return {
    raf: (cb: (now: number) => void) => {
      scheduled++;
      queue.push(cb);
    },
    pump(n: number) {
      for (let i = 0; i < n; i++) queue.shift()?.(i * 16);
    },
    get scheduled() {
      return scheduled;
    },
    get pending() {
      return queue.length;
    },
  };
}

describe('crash-proof main loop', () => {
  it('keeps scheduling after a frame throws, pauses after 3 failing frames, logs once', () => {
    const log = vi.fn();
    const guard = new CrashGuard({ threshold: 3, log });
    const fatal: CrashReport[] = [];
    guard.onFatal((r) => fatal.push(r));
    const r = fakeRaf();
    const step = vi.fn(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'pos')");
    });
    createFrameLoop(step, { guard, raf: r.raf })(0);
    r.pump(20);

    expect(r.pending).toBe(1); // one throw never stops the loop for good
    expect(r.scheduled).toBe(21);
    expect(step).toHaveBeenCalledTimes(3); // paused after the third failing frame
    expect(guard.paused).toBe(true);
    expect(fatal).toHaveLength(1);
    expect(fatal[0]).toMatchObject({ source: 'frame', fatal: true, count: 3 });
    expect(log).toHaveBeenCalledTimes(1); // not once per frame
  });

  it('a good frame resets the run of failures', () => {
    const guard = new CrashGuard({ threshold: 3, log: () => {} });
    const r = fakeRaf();
    let n = 0;
    createFrameLoop(
      () => {
        if (++n % 3 !== 0) throw new Error('flaky');
      },
      { guard, raf: r.raf },
    )(0);
    r.pump(30);
    expect(guard.paused).toBe(false);
    expect(guard.errors).toBeGreaterThan(10);
  });

  it('a tab lock (frozen) stops the loop without counting an error', () => {
    const guard = new CrashGuard({ log: () => {} });
    const r = fakeRaf();
    let frozen = false;
    const step = vi.fn(() => {
      frozen = true;
    });
    createFrameLoop(step, { guard, raf: r.raf, stop: () => frozen })(0);
    r.pump(5);
    expect(step).toHaveBeenCalledTimes(1);
    expect(r.pending).toBe(0);
    expect(guard.errors).toBe(0);
  });

  it('a throw inside a tick stops the remaining ticks of that frame', () => {
    tickCalls.n = 0;
    tickCalls.throwAt = 2;
    const driver = new LocalDriver({} as GameState, {} as SimContext, 0);
    const guard = new CrashGuard({ log: () => {} });
    const r = fakeRaf();
    // Three ticks are due in this frame; the second throws.
    createFrameLoop(() => driver.advance(TICK_MS * 3), { guard, raf: r.raf })(0);
    expect(tickCalls.n).toBe(2);
    expect(guard.errors).toBe(1);
    expect(r.pending).toBe(1);
  });

  it('hands each distinct frame error to the browser once, and does not count it twice', () => {
    const target = new EventTarget() as unknown as Window;
    const surface = vi.fn((err: unknown) => {
      target.dispatchEvent(Object.assign(new Event('error'), { error: err, message: String(err) }));
    });
    const guard = new CrashGuard({ threshold: 1000, log: () => {}, surface });
    guard.install(target);
    const err = new Error('same');
    for (let i = 0; i < 5; i++) guard.report(err, 'frame');
    expect(surface).toHaveBeenCalledTimes(1);
    expect(guard.errors).toBe(5);
  });

  it('logs at most maxLogs distinct errors', () => {
    const log = vi.fn();
    const guard = new CrashGuard({ threshold: 1000, maxLogs: 2, log });
    for (let i = 0; i < 10; i++) guard.report(new Error(`e${i}`), 'frame');
    expect(log).toHaveBeenCalledTimes(2);
    expect(guard.suppressed).toBe(8);
  });
});

describe('page listeners, boot failures and onCrash', () => {
  it('feeds window error and unhandledrejection into the same counter and hook', () => {
    const log = vi.fn();
    const guard = new CrashGuard({ threshold: 3, log });
    const seen: CrashReport[] = [];
    guard.onCrash((r) => seen.push(r));
    const target = new EventTarget() as unknown as Window;
    const uninstall = guard.install(target);

    const err = new Error('async boom');
    target.dispatchEvent(Object.assign(new Event('error'), { error: err, message: err.message }));
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'nope' }));
    target.dispatchEvent(
      Object.assign(new Event('error'), { error: null, message: 'ResizeObserver loop completed' }),
    );
    expect(guard.errors).toBe(2);
    expect(seen.map((r) => r.source)).toEqual(['error', 'unhandledrejection']);
    expect(seen[0].stack).toContain('async boom');
    expect(log).toHaveBeenCalledTimes(2);

    uninstall();
    target.dispatchEvent(Object.assign(new Event('error'), { error: err, message: err.message }));
    expect(guard.errors).toBe(2);
  });

  it('a boot failure (one asset) opens the panel at once and keeps the message', () => {
    const guard = new CrashGuard({ log: () => {} });
    const fatal: CrashReport[] = [];
    guard.onFatal((r) => fatal.push(r));
    guard.report(new Error('Failed to load assets/sprites/president.png'), 'boot');
    expect(guard.paused).toBe(true);
    expect(fatal).toHaveLength(1);
    expect(fatal[0]).toMatchObject({
      source: 'boot',
      message: 'Failed to load assets/sprites/president.png',
    });
  });

  it('a throwing listener does not break reporting', () => {
    const guard = new CrashGuard({ threshold: 1, log: () => {} });
    guard.onCrash(() => {
      throw new Error('listener');
    });
    const fatal = vi.fn();
    guard.onFatal(fatal);
    expect(() => guard.report(new Error('x'), 'frame')).not.toThrow();
    expect(fatal).toHaveBeenCalledTimes(1);
  });
});
