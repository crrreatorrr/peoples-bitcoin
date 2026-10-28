import { describe, expect, it } from 'vitest';
import { isWalkable, type Grid } from '../src/sim/grid';
import { findPath } from '../src/sim/pathfinding';
import type { Tile } from '../src/sim/state';
import { gridFromRows } from './helpers';

/** Asserts each step moves to a walkable neighbor and never cuts a blocked corner. */
function expectValidPath(grid: Grid, start: Tile, path: Tile[]): void {
  let prev = start;
  for (const step of path) {
    const dx = step.x - prev.x;
    const dy = step.y - prev.y;
    expect(Math.max(Math.abs(dx), Math.abs(dy))).toBe(1);
    expect(isWalkable(grid, step.x, step.y)).toBe(true);
    if (dx !== 0 && dy !== 0) {
      expect(isWalkable(grid, prev.x + dx, prev.y)).toBe(true);
      expect(isWalkable(grid, prev.x, prev.y + dy)).toBe(true);
    }
    prev = step;
  }
}

const open = gridFromRows(['..........', '..........', '..........', '..........', '..........']);

describe('findPath', () => {
  it('returns an empty complete path when already at the goal', () => {
    expect(findPath(open, { x: 2, y: 2 }, [{ x: 2, y: 2 }])).toEqual({ path: [], complete: true });
  });

  it('walks a straight line', () => {
    const r = findPath(open, { x: 0, y: 0 }, [{ x: 5, y: 0 }]);
    expect(r.complete).toBe(true);
    expect(r.path).toHaveLength(5);
    expect(r.path.at(-1)).toEqual({ x: 5, y: 0 });
    expectValidPath(open, { x: 0, y: 0 }, r.path);
  });

  it('moves diagonally, one tile per step', () => {
    const r = findPath(open, { x: 0, y: 0 }, [{ x: 3, y: 3 }]);
    expect(r.path).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
  });

  it('uses the fewest steps (Chebyshev distance) on an open grid', () => {
    const r = findPath(open, { x: 0, y: 0 }, [{ x: 7, y: 3 }]);
    expect(r.path).toHaveLength(7);
    expectValidPath(open, { x: 0, y: 0 }, r.path);
  });

  it('detours around a wall', () => {
    const grid = gridFromRows([
      '.....', //
      '.###.',
      '.#...',
      '.#...',
      '.....',
    ]);
    const start = { x: 0, y: 2 };
    const r = findPath(grid, start, [{ x: 3, y: 2 }]);
    expect(r.complete).toBe(true);
    expect(r.path.at(-1)).toEqual({ x: 3, y: 2 });
    expectValidPath(grid, start, r.path);
  });

  it('never cuts a corner past a blocked tile', () => {
    const grid = gridFromRows([
      '.#', //
      '..',
    ]);
    const r = findPath(grid, { x: 0, y: 0 }, [{ x: 1, y: 1 }]);
    expect(r.path).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it('cannot squeeze diagonally between two blocked tiles', () => {
    const grid = gridFromRows([
      '.#.', //
      '#..',
      '...',
    ]);
    const r = findPath(grid, { x: 0, y: 0 }, [{ x: 1, y: 1 }]);
    expect(r.complete).toBe(false);
    expect(r.path).toEqual([]);
  });

  it('walks as close as possible to an unreachable goal', () => {
    const grid = gridFromRows([
      '.......', //
      '....###',
      '....#.#',
      '....###',
    ]);
    const start = { x: 0, y: 0 };
    const r = findPath(grid, start, [{ x: 5, y: 2 }]);
    expect(r.complete).toBe(false);
    expectValidPath(grid, start, r.path);
    const end = r.path.at(-1)!;
    expect(Math.max(Math.abs(end.x - 5), Math.abs(end.y - 2))).toBe(2);
  });

  it('paths next to a blocked goal tile when the goal itself is a wall', () => {
    const grid = gridFromRows([
      '.....', //
      '..#..',
      '.....',
    ]);
    const r = findPath(grid, { x: 0, y: 1 }, [{ x: 2, y: 1 }]);
    expect(r.complete).toBe(false);
    expect(r.path.at(-1)).toEqual({ x: 1, y: 1 });
  });

  it('picks the nearest of several goals', () => {
    const r = findPath(open, { x: 0, y: 2 }, [
      { x: 9, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(r.complete).toBe(true);
    expect(r.path.at(-1)).toEqual({ x: 2, y: 2 });
    expect(r.path).toHaveLength(2);
  });

  it('ignores out-of-bounds goals', () => {
    expect(findPath(open, { x: 0, y: 0 }, [{ x: 50, y: 50 }])).toEqual({ path: [], complete: false });
  });

  it('finds a long path through a maze', () => {
    const grid = gridFromRows([
      '.#.....', //
      '.#.###.',
      '.#.#...',
      '.#.#.##',
      '...#...',
    ]);
    const start = { x: 0, y: 0 };
    const r = findPath(grid, start, [{ x: 6, y: 4 }]);
    expect(r.complete).toBe(true);
    expectValidPath(grid, start, r.path);
    expect(r.path.at(-1)).toEqual({ x: 6, y: 4 });
  });
});
