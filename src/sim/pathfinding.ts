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

// The eight neighbours as flat arrays, in the search's fixed order (indexed loops, no tuples:
// this runs millions of times a minute in an interpreted server runtime).
const DX: readonly number[] = [1, -1, 0, 0, 1, 1, -1, -1];
const DY: readonly number[] = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Scratch buffers shared by every search, grown to the largest grid seen. A cell's g, parent
 * and closed flag are valid only when its stamp equals the current search's `gen`, so a search
 * touches only the cells it visits instead of clearing the whole grid.
 */
let stamp = new Uint32Array(0);
let gScore = new Float64Array(0);
let cameFrom = new Int32Array(0);
let closed = new Uint8Array(0);
let gen = 0;

function beginSearch(size: number): void {
  if (stamp.length < size) {
    stamp = new Uint32Array(size);
    gScore = new Float64Array(size);
    cameFrom = new Int32Array(size);
    closed = new Uint8Array(size);
    gen = 0;
  }
  gen = (gen + 1) >>> 0;
  if (gen === 0) {
    // Wrapped after 2^32 searches: forget every old stamp.
    stamp.fill(0);
    gen = 1;
  }
}

/** Marks `idx` as seen by this search, with no parent, unreached and open. */
function touch(idx: number): void {
  if (stamp[idx] === gen) return;
  stamp[idx] = gen;
  gScore[idx] = Infinity;
  cameFrom[idx] = -1;
  closed[idx] = 0;
}

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
  const inside = goals.filter((g) => inBounds(grid, g.x, g.y));
  const validGoals = nearestOpen(grid, inside);
  const substituted = validGoals !== inside;
  if (validGoals.length === 0) return { path: [], complete: false };

  const startIdx = start.y * width + start.x;
  const goalSet = new Set(validGoals.map((g) => g.y * width + g.x));
  if (goalSet.has(startIdx)) return { path: [], complete: !substituted };

  // Hot loop: plain arithmetic, no Math calls or helper functions (the server runs this in an
  // interpreter). Same costs as before: STRAIGHT per step plus the diagonal surcharge.
  const goalCount = validGoals.length;
  const heuristic = (idx: number): number => {
    const x = idx % width;
    const y = (idx - x) / width;
    let best = Infinity;
    for (let i = 0; i < goalCount; i++) {
      const g = validGoals[i];
      const dx = x > g.x ? x - g.x : g.x - x;
      const dy = y > g.y ? y - g.y : g.y - y;
      const h =
        dx > dy
          ? STRAIGHT_COST * dx + (DIAGONAL_COST - STRAIGHT_COST) * dy
          : STRAIGHT_COST * dy + (DIAGONAL_COST - STRAIGHT_COST) * dx;
      if (h < best) best = h;
    }
    return best;
  };
  const { height, blocked } = grid;
  const open1 = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && blocked[y * width + x] === 0;

  beginSearch(width * grid.height);
  const open = heap;
  open.clear();

  touch(startIdx);
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
      return { path: reconstruct(cameFrom, current, width), complete: !substituted };

    const h = open.lastH;
    if (h < closestH || (h === closestH && gScore[current] < gScore[closestIdx])) {
      closestH = h;
      closestIdx = current;
    }

    const cx = current % width;
    const cy = (current - cx) / width;
    for (let d = 0; d < 8; d++) {
      const dx = DX[d];
      const dy = DY[d];
      const nx = cx + dx;
      const ny = cy + dy;
      if (!open1(nx, ny)) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal && (!open1(nx, cy) || !open1(cx, ny))) continue;
      const next = ny * width + nx;
      touch(next);
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

/** How far around a blocked click the walkable stand-ins are looked for. */
const BLOCKED_GOAL_RADIUS = 10;

/**
 * A click on a blocked tile (a wall, a desk) aims at the walkable tiles of the
 * nearest ring around it instead, so the search ends there rather than
 * exploring the whole zone looking for a tile that can't be stood on.
 */
function nearestOpen(grid: Grid, goals: Tile[]): Tile[] {
  if (goals.length === 0 || goals.some((g) => isWalkable(grid, g.x, g.y))) return goals;
  for (let r = 1; r <= BLOCKED_GOAL_RADIUS; r++) {
    // Only the ring's tiles nearest a goal by the search heuristic (straight before diagonal).
    let ring: Tile[] = [];
    let best = Infinity;
    for (const g of goals) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ax = Math.abs(dx);
          const ay = Math.abs(dy);
          if (Math.max(ax, ay) !== r || !isWalkable(grid, g.x + dx, g.y + dy)) continue;
          const h = STRAIGHT_COST * r + (DIAGONAL_COST - STRAIGHT_COST) * Math.min(ax, ay);
          if (h < best) {
            best = h;
            ring = [];
          }
          if (h === best) ring.push({ x: g.x + dx, y: g.y + dy });
        }
      }
    }
    if (ring.length > 0) return ring;
  }
  return goals;
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

  clear(): void {
    this.nodes.length = 0;
    this.f.length = 0;
    this.h.length = 0;
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

  /** The h of the node the last pop returned. */
  lastH = 0;

  pop(): number {
    const top = this.nodes[0];
    this.lastH = this.h[0];
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

  // Plain temporaries, not array destructuring: this runs millions of times a
  // minute on a busy server world, and destructuring allocates.
  private swap(a: number, b: number): void {
    const n = this.nodes[a];
    this.nodes[a] = this.nodes[b];
    this.nodes[b] = n;
    const f = this.f[a];
    this.f[a] = this.f[b];
    this.f[b] = f;
    const h = this.h[a];
    this.h[a] = this.h[b];
    this.h[b] = h;
  }
}

/** The one open list every search reuses (searches never overlap). */
const heap = new MinHeap();
