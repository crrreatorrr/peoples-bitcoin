/** Periodic saves and online rows are spread over the interval by join slot. */
import { describe, expect, it } from 'vitest';
import { NET } from '../../src/config/balance';
import { fakeIO, testWorld } from './helpers';

describe('staggered persistence', () => {
  it('saves each player once per NET.saveEveryTicks, never all in the same tick', () => {
    const io = fakeIO();
    const batches: string[][] = [];
    const save = io.saveCharacters.bind(io);
    io.saveCharacters = (rows) => {
      batches.push(rows.map((r) => r.userId));
      return save(rows);
    };
    const w = testWorld({ io });
    for (const uid of ['a', 'b', 'c', 'd']) w.join(uid);
    batches.length = 0;
    w.ticks(NET.saveEveryTicks);
    const saved = batches.flat().sort();
    expect(saved).toEqual(['a', 'b', 'c', 'd']);
    expect(Math.max(...batches.map((b) => b.length))).toBe(1);
  });

  it('writes each online row once per NET.onlineRefreshEveryTicks', () => {
    const io = fakeIO();
    const writes: string[] = [];
    const write = io.writeOnline.bind(io);
    io.writeOnline = (uid, entry) => {
      writes.push(uid);
      write(uid, entry);
    };
    const w = testWorld({ io });
    for (const uid of ['a', 'b', 'c']) w.join(uid);
    writes.length = 0;
    w.ticks(NET.onlineRefreshEveryTicks);
    expect(writes.sort()).toEqual(['a', 'b', 'c']);
  });
});
