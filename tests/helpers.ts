import { START_ZONE_ID } from '../src/config/balance';
import { loadContent, type Content } from '../src/sim/content';
import { addItem } from '../src/sim/inventory';
import { buildGrids, type Grid } from '../src/sim/grid';
import {
  createGameState,
  type GameState,
  type Intent,
  type SimContext,
  type SimEvent,
} from '../src/sim/state';
import { runTick } from '../src/sim/tick';

/** Grid from ASCII rows: '#' is blocked, anything else is walkable. */
export function gridFromRows(rows: string[]): Grid {
  const height = rows.length;
  const width = rows[0].length;
  const blocked = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) if (row[x] === '#') blocked[y * width + x] = 1;
  });
  return { width, height, blocked };
}

let cachedContent: Content | null = null;
export function content(): Content {
  cachedContent ??= loadContent();
  return cachedContent;
}

export function newGame(seed = 1234): { state: GameState; ctx: SimContext } {
  const c = content();
  return {
    state: createGameState(c, START_ZONE_ID, seed),
    ctx: { content: c, grids: buildGrids(c) },
  };
}

export function treasuryGrid(ctx: SimContext): Grid {
  return ctx.grids.get(START_ZONE_ID)!;
}

export function give(state: GameState, itemId: string, qty = 1): void {
  addItem(state.player.inventory, content().items.get(itemId)!, qty);
}

/** First object instance of a def in the current zone (optionally at a position). */
export function objectOf(state: GameState, defId: string, x?: number, y?: number) {
  const o = state.zone.objects.find(
    (obj) => obj.defId === defId && (x === undefined || (obj.x === x && obj.y === y)),
  );
  if (!o) throw new Error(`no ${defId}`);
  return o;
}

/** Runs ticks until `done` returns true; returns all events. Throws if it takes too long. */
export function runUntil(
  state: GameState,
  ctx: SimContext,
  done: (events: SimEvent[]) => boolean,
  firstIntents: Intent[] = [],
  maxTicks = 500,
): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < maxTicks; i++) {
    const events = runTick(state, ctx, i === 0 ? firstIntents : []);
    all.push(...events);
    if (done(events)) return all;
  }
  throw new Error(`condition not met within ${maxTicks} ticks`);
}

export function messages(events: SimEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'message' ? [e.text] : []));
}
