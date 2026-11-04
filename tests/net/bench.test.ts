/**
 * 100 players in one world, walking around the Treasury. Logs ms per tick and
 * asserts a Node budget well under the 600 ms tick, because Nakama's goja
 * runtime is expected to be 5-10x slower than Node.
 */
import { describe, expect, it } from 'vitest';
import { NET } from '../../src/config/balance';
import { OP } from '../../src/net/protocol';
import { testWorld } from './helpers';

describe('bench', () => {
  it(`runs ${NET.maxPlayersPerWorld} players under 25 ms per tick`, () => {
    const w = testWorld();
    for (let i = 0; i < NET.maxPlayersPerWorld; i++) w.join(`u${i}`, `Player${i}`);
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed % n;
    };
    const tick = () => {
      for (let i = 0; i < NET.maxPlayersPerWorld; i++) {
        if (rand(4) !== 0) continue;
        w.send(`u${i}`, OP.INTENTS, {
          seq: 1,
          intents: [{ type: 'walk', x: 12 + rand(30), y: 20 + rand(20) }],
        });
      }
      if (rand(3) === 0)
        w.send(`u${rand(100)}`, OP.CHAT, { ch: 'public', text: `hello ${rand(1000)}` });
      // Time only the host (the shell broadcasts without decoding).
      const t0 = performance.now();
      let bytes = 0;
      for (let i = 0; i < NET.loopsPerTick; i++) {
        for (const m of w.host.loop().messages) bytes += m.data.length * (m.to?.length ?? 1);
      }
      samples.push(performance.now() - t0);
      sent += bytes;
    };
    let samples: number[] = [];
    let sent = 0;
    for (let i = 0; i < 10; i++) tick(); // warm up
    samples = [];
    sent = 0;
    const n = 40;
    for (let i = 0; i < n; i++) tick();
    // The median, so other test files running in parallel don't make it flaky.
    const ms = samples.sort((a, b) => a - b)[Math.floor(n / 2)];
    console.log(
      `[bench] ${(sent / n / NET.maxPlayersPerWorld / 1024).toFixed(2)} KB per client per tick`,
    );
    console.log(`[bench] ${NET.maxPlayersPerWorld} players: ${ms.toFixed(2)} ms per tick`);
    expect(ms).toBeLessThan(25);
  });
});
