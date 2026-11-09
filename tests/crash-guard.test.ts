import { describe, expect, it, vi } from 'vitest';
import { TICK_MS } from '../src/config/balance';
import { CrashGuard, createFrameLoop, type CrashReport } from '../src/game/crash';
import { LocalDriver } from '../src/game/driver';
import type { GameState, Intent, SimContext } from '../src/sim/state';

// The driver's ticks: tick `throwAt` throws (or every tick, with throwAt 0), as a broken system
// inside runTick would. Each tick records the intents it got and returns one event naming itself.
const tickCalls = vi.hoisted(() => ({ n: 0, throwAt: -1, intents: [] as unknown[][] }));
vi.mock('../src/sim/tick', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/sim/tick')>()),
  runTick: (_s: unknown, _c: unknown, intents: unknown[]) => {
    tickCalls.n++;
    tickCalls.intents.push(intents);
    if (tickCalls.throwAt === 0 || tickCalls.n === tickCalls.throwAt) {
      throw new Error('combat system threw');
    }
    return [{ tick: tickCalls.n }];
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

  it('a throw inside a tick stops the remaining ticks, keeps earlier events and its intents', () => {
    tickCalls.n = 0;
    tickCalls.throwAt = 2;
    tickCalls.intents = [];
    const driver = new LocalDriver({} as GameState, {} as SimContext, 0);
    const handled: unknown[] = [];
    const guard = new CrashGuard({ log: () => {} });
    const r = fakeRaf();
    let now = TICK_MS * 3;
    driver.queue({ kind: 'walk' } as unknown as Intent);
    // Three ticks are due in this frame; the second throws.
    createFrameLoop(
      () => {
        const ticks = driver.advance(now);
        const failure = driver.takeFailure();
        handled.push(...ticks.flat());
        if (failure) throw failure.error;
      },
      { guard, raf: r.raf },
    )(0);
    expect(tickCalls.n).toBe(2);
    expect(handled).toEqual([{ tick: 1 }]); // the tick that completed keeps its events
    expect(guard.errors).toBe(1);
    expect(r.pending).toBe(1);
    expect(driver.takeFailure()).toBeNull(); // handed over once

    // The intent queued after the first tick ran went to the failed tick; it is not lost.
    tickCalls.intents = [];
    driver.queue({ kind: 'talk' } as unknown as Intent);
    now = TICK_MS * 4;
    r.pump(1);
    expect(tickCalls.intents[0]).toEqual([{ kind: 'talk' }]);
  });

  it('keeps the intents of a tick that threw for the next tick', () => {
    tickCalls.n = 0;
    tickCalls.throwAt = 1;
    tickCalls.intents = [];
    const driver = new LocalDriver({} as GameState, {} as SimContext, 0);
    driver.queue({ kind: 'walk' } as unknown as Intent);
    expect(driver.advance(TICK_MS)).toEqual([]);
    expect(driver.takeFailure()?.error).toBeInstanceOf(Error);
    driver.queue({ kind: 'talk' } as unknown as Intent);
    expect(driver.advance(TICK_MS * 2)).toEqual([[{ tick: 2 }]]);
    expect(tickCalls.intents[1]).toEqual([{ kind: 'walk' }, { kind: 'talk' }]);
    // The failed tick is not rerun at once on half-applied state.
    expect(driver.advance(TICK_MS * 2 + 16)).toEqual([]);
  });

  it('a tick that always throws trips the panel even though most frames run no tick', () => {
    tickCalls.n = 0;
    tickCalls.throwAt = 0;
    tickCalls.intents = [];
    const driver = new LocalDriver({} as GameState, {} as SimContext, 0);
    const guard = new CrashGuard({ threshold: 3, log: () => {} });
    const fatal = vi.fn();
    guard.onFatal(fatal);
    const queue: ((now: number) => void)[] = [];
    // The same rule as src/main.ts: a frame is good only if a tick ran cleanly.
    createFrameLoop(
      (now) => {
        const ticks = driver.advance(now);
        const failure = driver.takeFailure();
        if (failure) throw failure.error;
        return ticks.length > 0;
      },
      { guard, raf: (cb) => queue.push(cb) },
    )(0);
    // 60 fps for 3 s: a tick is due once in every ~36 frames.
    for (let i = 1; i <= 180 && !guard.paused; i++) queue.shift()?.(i * (1000 / 60));
    expect(guard.paused).toBe(true);
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(tickCalls.n).toBe(3);
  });

  it('a step that returns false neither grows nor resets the streak', () => {
    const guard = new CrashGuard({ threshold: 3, log: () => {} });
    const r = fakeRaf();
    let n = 0;
    createFrameLoop(
      () => {
        n++;
        if (n % 10 === 0) throw new Error('tick');
        return false;
      },
      { guard, raf: r.raf },
    )(0);
    r.pump(25);
    expect(guard.consecutive).toBe(2);
    expect(guard.paused).toBe(false);
    r.pump(5);
    expect(guard.paused).toBe(true);
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

  it('page errors with no failing frame never pause the game (async boot, hidden tab)', () => {
    const guard = new CrashGuard({ threshold: 3, log: () => {}, origin: 'https://game.test' });
    const fatal = vi.fn();
    guard.onFatal(fatal);
    const target = new EventTarget() as unknown as Window;
    guard.install(target);
    for (let i = 0; i < 10; i++) {
      target.dispatchEvent(
        Object.assign(new Event('error'), { error: new Error(`e${i}`), message: `e${i}` }),
      );
      target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: `r${i}` }));
    }
    expect(guard.errors).toBe(20); // still counted and logged
    expect(guard.consecutive).toBe(0);
    expect(fatal).not.toHaveBeenCalled();
    // One failing frame after them is one, not a pause.
    guard.report(new Error('frame'), 'frame');
    expect(guard.consecutive).toBe(1);
    expect(guard.paused).toBe(false);
  });

  it('page errors extend a streak that a failing frame started', () => {
    const guard = new CrashGuard({ threshold: 3, log: () => {}, origin: 'https://game.test' });
    const target = new EventTarget() as unknown as Window;
    guard.install(target);
    guard.report(new Error('frame'), 'frame');
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'a' }));
    expect(guard.paused).toBe(false);
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'b' }));
    expect(guard.paused).toBe(true);
  });

  it('ignores cross-origin and muted errors', () => {
    const guard = new CrashGuard({ log: () => {}, origin: 'https://game.test' });
    const target = new EventTarget() as unknown as Window;
    guard.install(target);
    const fire = (init: object) => target.dispatchEvent(Object.assign(new Event('error'), init));
    fire({ error: null, message: 'Script error.' });
    fire({
      error: new Error('ext'),
      message: 'ext',
      filename: 'chrome-extension://abc/content.js',
    });
    fire({ error: new Error('ad'), message: 'ad', filename: 'https://ads.example/x.js' });
    expect(guard.errors).toBe(0);
    fire({ error: new Error('ours'), message: 'ours', filename: 'https://game.test/assets/i.js' });
    expect(guard.errors).toBe(1);
    fire({ error: new Error('inline'), message: 'inline', filename: '' });
    expect(guard.errors).toBe(2);
  });

  it('ignores AbortError and NotAllowedError rejections', () => {
    const guard = new CrashGuard({ threshold: 3, log: () => {} });
    const target = new EventTarget() as unknown as Window;
    guard.install(target);
    const reject = (reason: unknown) =>
      target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));
    reject(new DOMException('The user aborted a request.', 'AbortError'));
    reject(new DOMException('play() failed', 'NotAllowedError'));
    expect(guard.errors).toBe(0);
    reject(new DOMException('bad', 'NotFoundError'));
    expect(guard.errors).toBe(1);
  });

  it('a visibility change resets the streak', () => {
    const guard = new CrashGuard({ threshold: 3, log: () => {} });
    const target = new EventTarget() as unknown as Window;
    const doc = new EventTarget() as unknown as Document;
    const uninstall = guard.install(target, doc);
    guard.report(new Error('a'), 'frame');
    guard.report(new Error('b'), 'frame');
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(guard.consecutive).toBe(0);
    guard.report(new Error('c'), 'frame');
    expect(guard.paused).toBe(false);
    uninstall();
    guard.report(new Error('d'), 'frame');
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(guard.consecutive).toBe(2);
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
