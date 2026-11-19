/**
 * Pins findPath's answers on every zone, so speed work on the search (scratch buffers, no
 * allocation) can never change a path. The digest was taken from the allocating version.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildGrids } from '../src/sim/grid';
import { findPath } from '../src/sim/pathfinding';
import { content as loadTestContent } from './helpers';

const PINNED = 'b1a6c829f4bd37c4';

describe('findPath golden', () => {
  it('returns the same paths as before on every zone (2,000 seeded queries each)', () => {
    const c = loadTestContent();
    const grids = buildGrids(c);
    const hash = createHash('sha256');
    let seed = 12345;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed % n;
    };
    for (const id of [...grids.keys()].sort()) {
      const grid = grids.get(id)!;
      for (let i = 0; i < 2000; i++) {
        const start = { x: rand(grid.width), y: rand(grid.height) };
        const goals = Array.from({ length: 1 + rand(3) }, () => ({
          x: rand(grid.width + 4) - 2,
          y: rand(grid.height + 4) - 2,
        }));
        const r = findPath(grid, start, goals);
        hash.update(`${id}|${r.complete}|${r.path.map((t) => `${t.x},${t.y}`).join(';')}\n`);
      }
    }
    expect(hash.digest('hex').slice(0, 16)).toBe(PINNED);
  });
});
