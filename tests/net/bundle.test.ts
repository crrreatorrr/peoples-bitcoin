/**
 * The server bundle in a context like Nakama's goja: only ES built-ins (no
 * TextEncoder, crypto, timers, structuredClone, process or window).
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs build script without types
import { buildSimBundle } from '../../scripts/build-sim-bundle.mjs';
import { fakeIO } from './helpers';

describe('server bundle', () => {
  it('loads lazily in a bare context and runs a world', async () => {
    const { code, version } = (await buildSimBundle({})) as { code: string; version: string };
    expect(code.length).toBeLessThan(1.5 * 1024 * 1024);
    const sandbox: Record<string, unknown> = {};
    const context = vm.createContext(sandbox);
    for (const name of [
      'TextEncoder',
      'TextDecoder',
      'crypto',
      'setTimeout',
      'structuredClone',
      'process',
      'window',
    ]) {
      expect(vm.runInContext(`typeof ${name}`, context)).toBe('undefined');
    }
    // Best of three fresh contexts, so a busy machine doesn't make it flaky.
    let evalMs = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      vm.runInContext(code, i === 0 ? context : vm.createContext({}));
      evalMs = Math.min(evalMs, performance.now() - t0);
    }
    expect(evalMs).toBeLessThan(50);
    expect(vm.runInContext('PB_SIM_VERSION', context)).toBe(version);

    const io = fakeIO();
    const PbSim = sandbox.PbSim as {
      createWorldHost(o: unknown): {
        joinAttempt(p: unknown, v: unknown): { accept: boolean };
        join(p: unknown[]): void;
        message(p: unknown, op: number, d: string): void;
        loop(): { messages: { op: number; data: string }[] };
        size(): number;
      };
      constants(): { SIM_VERSION: string; PROTOCOL_VERSION: number };
    };
    expect(PbSim.constants().SIM_VERSION).toBe(version);
    const host = PbSim.createWorldHost({ worldNo: 1, matchId: 'm', seed: 1, io });
    const users = ['a', 'b'].map((id) => ({ userId: id, sessionId: `s${id}`, username: id }));
    for (const u of users) {
      expect(
        host.joinAttempt(u, { scope: 'game', game: 'peoples-bitcoin', sid: `sid${u.userId}` })
          .accept,
      ).toBe(true);
    }
    host.join(users);
    for (const u of users) host.message(u, 1, JSON.stringify({ proto: 1, sim: version }));
    host.message(
      users[0],
      2,
      JSON.stringify({ seq: 1, intents: [{ type: 'walk', x: 27, y: 34 }] }),
    );
    host.message(users[0], 3, JSON.stringify({ ch: 'public', text: 'hello world' }));
    let deltas = 0;
    for (let i = 0; i < 20; i++) deltas += host.loop().messages.filter((m) => m.op === 103).length;
    expect(host.size()).toBe(2);
    expect(deltas).toBeGreaterThan(0);
  }, 30_000);
});
