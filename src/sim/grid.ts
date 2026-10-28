/**
 * Collision grid for a zone. Built once from terrain and blocking objects; it
 * does not change while the zone is loaded. NPCs and players never block paths.
 */
import type { Content } from './content';
import type { ZoneDef } from './schemas';
import type { Tile } from './state';

export interface Grid {
  width: number;
  height: number;
  /** 1 = blocked, indexed y * width + x. */
  blocked: Uint8Array;
}

export interface Footprint {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function buildZoneGrid(zone: ZoneDef, content: Content): Grid {
  const { width, height } = zone;
  const blocked = new Uint8Array(width * height);
  zone.tiles.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const terrain = content.terrain.get(zone.legend[row[x]]);
      if (!terrain?.walkable) blocked[y * width + x] = 1;
    }
  });
  for (const o of zone.objects) {
    const def = content.objects.get(o.objectId);
    if (!def?.blocks) continue;
    for (let dy = 0; dy < def.height; dy++) {
      for (let dx = 0; dx < def.width; dx++) blocked[(o.y + dy) * width + o.x + dx] = 1;
    }
  }
  return { width, height, blocked };
}

export function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

export function isWalkable(grid: Grid, x: number, y: number): boolean {
  return inBounds(grid, x, y) && grid.blocked[y * grid.width + x] === 0;
}

/** Walkable tiles sharing an edge with the footprint: where a player stands to interact. */
export function interactionTiles(grid: Grid, fp: Footprint): Tile[] {
  const tiles: Tile[] = [];
  for (let x = fp.x; x < fp.x + fp.width; x++) {
    tiles.push({ x, y: fp.y - 1 }, { x, y: fp.y + fp.height });
  }
  for (let y = fp.y; y < fp.y + fp.height; y++) {
    tiles.push({ x: fp.x - 1, y }, { x: fp.x + fp.width, y });
  }
  return tiles.filter((t) => isWalkable(grid, t.x, t.y));
}

export function isCardinallyAdjacent(pos: Tile, fp: Footprint): boolean {
  const withinX = pos.x >= fp.x && pos.x < fp.x + fp.width;
  const withinY = pos.y >= fp.y && pos.y < fp.y + fp.height;
  return (
    (withinX && (pos.y === fp.y - 1 || pos.y === fp.y + fp.height)) ||
    (withinY && (pos.x === fp.x - 1 || pos.x === fp.x + fp.width))
  );
}
