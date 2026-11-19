/**
 * Pins every byte a busy world sends, so speed work on serialization and interest management
 * (src/server/aoi.ts, the broadcast in src/server/host.ts) can never change what clients get.
 * Re-pin only for a deliberate wire change.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OP } from '../../src/net/protocol';
import { SIM_VERSION } from '../../src/net/simVersion';
import { testWorld } from './helpers';

const PINNED = '09f45409d4c727a8';

describe('broadcast golden', () => {
  it('sends the same bytes for a seeded busy world', () => {
    const w = testWorld();
    const players = Array.from({ length: 14 }, (_, i) => `u${i}`);
    for (const uid of players) w.join(uid, `Player${uid}`);
    let seed = 99;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed % n;
    };
    const hash = createHash('sha256');
    for (let t = 0; t < 160; t++) {
      for (const uid of players) {
        const roll = rand(10);
        if (roll < 3) {
          w.send(uid, OP.INTENTS, {
            seq: t,
            intents: [{ type: 'walk', x: 3 + rand(50), y: 3 + rand(46) }],
          });
        } else if (roll === 3) {
          w.send(uid, OP.INTENTS, { seq: t, intents: [{ type: 'toggleRun' }] });
        }
      }
      if (t === 80) w.leave('u3');
      w.ticks(1);
      for (const uid of players) {
        // The sim version is a hash of these very sources, so it is left out.
        for (const m of w.take(uid)) {
          const text = JSON.stringify(m.body).replaceAll(SIM_VERSION, 'SIM');
          hash.update(`${uid}|${m.op}|${text}\n`);
        }
      }
    }
    expect(hash.digest('hex').slice(0, 16)).toBe(PINNED);
  });
});
