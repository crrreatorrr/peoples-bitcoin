/** Helpers for multi-player worlds in sim tests. */
import { START_ZONE_ID } from '../src/config/balance';
import { buildGrids } from '../src/sim/grid';
import {
  addPlayerToWorld,
  createPlayer,
  createWorldState,
  type GameState,
  type SimContext,
  type WorldState,
} from '../src/sim/state';
import { content } from './helpers';

export function newWorld(
  pids: string[],
  seed = 77,
  zoneId = START_ZONE_ID,
): { world: WorldState; ctx: SimContext; views: Record<string, GameState> } {
  const c = content();
  const world = createWorldState(seed);
  const views: Record<string, GameState> = {};
  for (const pid of pids) {
    views[pid] = addPlayerToWorld(world, c, pid, createPlayer(c, zoneId), zoneId);
  }
  return { world, ctx: { content: c, grids: buildGrids(c) }, views };
}

/** A stable fingerprint of everything that matters in a world. */
export function worldHash(world: WorldState): string {
  return JSON.stringify({
    tick: world.tick,
    rng: world.rng.s,
    economy: world.economy,
    players: world.players,
    zones: world.zones,
    playerZone: world.playerZone,
  });
}
