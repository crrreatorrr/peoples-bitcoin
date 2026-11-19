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

const PINNED = 'f1a7f22051c1493f';

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
    let areaEvents = 0;
    for (let t = 0; t < 220; t++) {
      for (const uid of players) {
        const roll = rand(10);
        const fighter = uid === 'u0' || uid === 'u1' || uid === 'u2';
        if (roll < 3 && !fighter) {
          w.send(uid, OP.INTENTS, {
            seq: t,
            intents: [{ type: 'walk', x: 3 + rand(50), y: 3 + rand(46) }],
          });
        } else if (roll === 3) {
          w.send(uid, OP.INTENTS, { seq: t, intents: [{ type: 'toggleRun' }] });
        }
      }
      // Some fight, so hitsplats, attacks and deaths (area events) are in the stream too.
      if (t % 20 === 5) {
        const enemies = w.host.viewOf('u0')!.zone.enemies.filter((e) => e.respawnAt === null);
        for (let i = 0; i < 3 && i < enemies.length; i++) {
          w.send(`u${i}`, OP.INTENTS, {
            seq: 1000 + t,
            intents: [{ type: 'interact', targetId: enemies[i]!.id, action: 'Attack' }],
          });
        }
      }
      if (t === 80) w.leave('u3');
      w.ticks(1);
      for (const uid of players) {
        // The sim version is a hash of these very sources, so it is left out.
        for (const m of w.take(uid)) {
          const text = JSON.stringify(m.body).replaceAll(SIM_VERSION, 'SIM');
          hash.update(`${uid}|${m.op}|${text}\n`);
          if (text.includes('"hitsplat"')) areaEvents++;
        }
      }
    }
    // Another player's fight reaches u9 as area events, so that path is covered.
    expect(areaEvents).toBeGreaterThan(0);
    expect(hash.digest('hex').slice(0, 16)).toBe(PINNED);
  });
});
