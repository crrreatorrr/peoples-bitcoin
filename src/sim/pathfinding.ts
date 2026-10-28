/**
 * A* on the tile grid with 8-directional movement and no corner cutting.
 *
 * Every step (straight or diagonal) takes one tick, so the best path is the one
 * with the fewest steps. Diagonals cost slightly more than straights only to
 * break ties toward natural-looking paths; with STRAIGHT < DIAGONAL < 2*STRAIGHT
 * the cheapest path is always a fewest-steps path.
 */
import { inBounds, isWalkable, type Grid } from './grid';
import type { Tile } from './state';

const STRAIGHT_COST = 10;
const DIAGONAL_COST = 11;

const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export interface PathResult {
  /** Steps to take, excluding the start tile. */
  path: Tile[];
  /** False when no goal was reachable; path then leads to the closest reachable tile. */
  complete: boolean;
}

/**
 * Finds a path from start to the nearest of the goal tiles. If no goal can be
 * reached, returns a path to the reachable tile closest to a goal (OSRS-style
 * "walk as close as you can").
 */
export function findPath(grid: Grid, start: Tile, goals: readonly Tile[]): PathResult {
  const { width } = grid;
  const validGoals = goals.filter((g) => inBounds(grid, g.x, g.y));
  if (validGoals.length === 0) return { path: [], complete: false };

  const startIdx = start.y * width + start.x;
  const goalSet = new Set(validGoals.map((g) => g.y * width + g.x));
  if (goalSet.has(startIdx)) return { path: [], complete: true };

  const heuristic = (idx: number): number => {
    const x = idx % width;
    const y = (idx - x) / width;
    let best = Infinity;
    for (const g of validGoals) {
      const dx = Math.abs(x - g.x);
      const dy = Math.abs(y - g.y);
      const h =
        STRAIGHT_COST * Math.max(dx, dy) + (DIAGONAL_COST - STRAIGHT_COST) * Math.min(dx, dy);
      if (h < best) best = h;
    }
    return best;
  };

  const size = width * grid.height;
  const gScore = new Float64Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open = new MinHeap();

  gScore[startIdx] = 0;
  const startH = heuristic(startIdx);
  open.push(startIdx, startH, startH);
  let closestIdx = startIdx;
  let closestH = startH;

  while (open.size > 0) {
    const current = open.pop();
    if (closed[current]) continue;
    closed[current] = 1;
    if (goalSet.has(current))
      return { path: reconstruct(cameFrom, current, width), complete: true };

    const h = heuristic(current);
    if (h < closestH || (h === closestH && gScore[current] < gScore[closestIdx])) {
      closestH = h;
      closestIdx = current;
    }

    const cx = current % width;
    const cy = (current - cx) / width;
    for (const [dx, dy] of DIRECTIONS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(grid, nx, ny)) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal && (!isWalkable(grid, cx + dx, cy) || !isWalkable(grid, cx, cy + dy))) continue;
      const next = ny * width + nx;
      if (closed[next]) continue;
      const tentative = gScore[current] + (diagonal ? DIAGONAL_COST : STRAIGHT_COST);
      if (tentative < gScore[next]) {
        gScore[next] = tentative;
        cameFrom[next] = current;
        const nh = heuristic(next);
        open.push(next, tentative + nh, nh);
      }
    }
  }
  return { path: reconstruct(cameFrom, closestIdx, width), complete: false };
}

function reconstruct(cameFrom: Int32Array, end: number, width: number): Tile[] {
  const path: Tile[] = [];
  for (let idx = end; cameFrom[idx] !== -1; idx = cameFrom[idx]) {
    const x = idx % width;
    path.push({ x, y: (idx - x) / width });
  }
  return path.reverse();
}

/** Binary min-heap of node indices ordered by f, then h (prefer nodes nearer the goal). */
class MinHeap {
  private nodes: number[] = [];
  private f: number[] = [];
  private h: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, f: number, h: number): void {
    this.nodes.push(node);
    this.f.push(f);
    this.h.push(h);
    let i = this.nodes.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.nodes[0];
    const last = this.nodes.length - 1;
    this.swap(0, last);
    this.nodes.pop();
    this.f.pop();
    this.h.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let smallest = i;
      if (l < this.nodes.length && this.less(l, smallest)) smallest = l;
      if (r < this.nodes.length && this.less(r, smallest)) smallest = r;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    return this.f[a] < this.f[b] || (this.f[a] === this.f[b] && this.h[a] < this.h[b]);
  }

  private swap(a: number, b: number): void {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b], this.nodes[a]];
    [this.f[a], this.f[b]] = [this.f[b], this.f[a]];
    [this.h[a], this.h[b]] = [this.h[b], this.h[a]];
  }
}
