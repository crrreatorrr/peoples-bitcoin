import { describe, expect, it } from 'vitest';
import { isWalkable } from '../src/sim/grid';
import { runTick } from '../src/sim/tick';
import { content, newGame, treasuryGrid } from './helpers';

describe('NPC wandering', () => {
  it('wanders within its radius on walkable tiles, one step at a time', () => {
    const { state, ctx } = newGame(5);
    const npc = state.zone.npcs[0];
    const radius = content().npcs.get(npc.defId)!.wanderRadius;
    const visited = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      runTick(state, ctx, []);
      expect(Math.abs(npc.x - npc.spawn.x)).toBeLessThanOrEqual(radius);
      expect(Math.abs(npc.y - npc.spawn.y)).toBeLessThanOrEqual(radius);
      expect(isWalkable(treasuryGrid(ctx), npc.x, npc.y)).toBe(true);
      expect(Math.abs(npc.x - npc.from.x) + Math.abs(npc.y - npc.from.y)).toBeLessThanOrEqual(1);
      visited.add(`${npc.x},${npc.y}`);
    }
    expect(visited.size).toBeGreaterThan(3);
  });

  it('stands still while the player is talking to it', () => {
    const { state, ctx } = newGame(5);
    const npc = state.zone.npcs[0];
    state.player.dialogue = { npcId: npc.id, line: 0, lines: ['Hi.'] };
    const start = { x: npc.x, y: npc.y };
    for (let i = 0; i < 200; i++) runTick(state, ctx, []);
    expect({ x: npc.x, y: npc.y }).toEqual(start);
  });

  it('never steps onto the player', () => {
    const { state, ctx } = newGame(9);
    const npc = state.zone.npcs[0];
    state.player.pos = { x: npc.x + 1, y: npc.y };
    for (let i = 0; i < 1000; i++) {
      runTick(state, ctx, []);
      expect(npc.x === state.player.pos.x && npc.y === state.player.pos.y).toBe(false);
    }
  });

  it('can still be reached for Talk-to while wandering', () => {
    const { state, ctx } = newGame(13);
    for (let i = 0; i < 50; i++) runTick(state, ctx, []);
    const npc = state.zone.npcs[0];
    runTick(state, ctx, [{ type: 'interact', targetId: npc.id, action: 'Talk-to' }]);
    for (let i = 0; i < 60 && !state.player.dialogue; i++) runTick(state, ctx, []);
    expect(state.player.dialogue?.npcId).toBe(npc.id);
  });
});
