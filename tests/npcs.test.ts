import { describe, expect, it } from 'vitest';
import { isWalkable } from '../src/sim/grid';
import { runTick } from '../src/sim/tick';
import { changeZone } from '../src/sim/zones';
import { content, newGame } from './helpers';

/** The tutors stand still, so the wanderers are Moonward's students. */
function academy(seed: number) {
  const game = newGame(seed);
  changeZone(game.state, game.ctx, 'zone_academy', { x: 29, y: 20 }, []);
  const npc = game.state.zone.npcs.find((n) => content().npcs.get(n.defId)!.wanderRadius >= 2)!;
  return { ...game, npc, grid: game.ctx.grids.get('zone_academy')! };
}

describe('NPC wandering', () => {
  it('wanders within its radius on walkable tiles, one step (maybe diagonal) at a time', () => {
    const { state, ctx, npc, grid } = academy(5);
    const radius = content().npcs.get(npc.defId)!.wanderRadius;
    const visited = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      runTick(state, ctx, []);
      expect(Math.abs(npc.x - npc.spawn.x)).toBeLessThanOrEqual(radius);
      expect(Math.abs(npc.y - npc.spawn.y)).toBeLessThanOrEqual(radius);
      expect(isWalkable(grid, npc.x, npc.y)).toBe(true);
      expect(
        Math.max(Math.abs(npc.x - npc.from.x), Math.abs(npc.y - npc.from.y)),
      ).toBeLessThanOrEqual(1);
      visited.add(`${npc.x},${npc.y}`);
    }
    expect(visited.size).toBeGreaterThan(3);
  });

  it('walks to a chosen spot over several ticks instead of one random step', () => {
    const { state, ctx, npc } = academy(5);
    let longest = 0;
    let run = 0;
    for (let i = 0; i < 3000; i++) {
      runTick(state, ctx, []);
      const moved = npc.x !== npc.from.x || npc.y !== npc.from.y;
      run = moved ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeGreaterThanOrEqual(2);
  });

  it("the tutorial's quest givers never wander off", () => {
    const { state, ctx } = newGame(5);
    const tutors = [
      'npc_morelight',
      'npc_treasurer',
      'npc_sysadmin',
      'npc_drill_sergeant',
      'npc_party_planner',
      'npc_spin_doctor',
      'npc_fixer',
      'npc_sproto_handler',
      'npc_contractor',
    ];
    for (const id of tutors) expect(content().npcs.get(id)!.wanderRadius).toBe(0);
    const morelight = state.zone.npcs.find((n) => n.defId === 'npc_morelight')!;
    const start = { x: morelight.x, y: morelight.y };
    for (let i = 0; i < 200; i++) runTick(state, ctx, []);
    expect({ x: morelight.x, y: morelight.y }).toEqual(start);
    expect(start).toEqual(morelight.spawn);
  });

  it('stands still while the player is talking to it', () => {
    const { state, ctx, npc } = academy(5);
    state.player.dialogue = { npcId: npc.id, line: 0, lines: ['Hi.'] };
    const start = { x: npc.x, y: npc.y };
    for (let i = 0; i < 200; i++) runTick(state, ctx, []);
    expect({ x: npc.x, y: npc.y }).toEqual(start);
  });

  it('never steps onto the player', () => {
    const { state, ctx, npc } = academy(9);
    state.player.pos = { x: npc.x + 1, y: npc.y };
    for (let i = 0; i < 1000; i++) {
      runTick(state, ctx, []);
      expect(npc.x === state.player.pos.x && npc.y === state.player.pos.y).toBe(false);
    }
  });

  it('can still be reached for Talk-to while wandering', () => {
    const { state, ctx, npc } = academy(13);
    for (let i = 0; i < 50; i++) runTick(state, ctx, []);
    runTick(state, ctx, [{ type: 'interact', targetId: npc.id, action: 'Talk-to' }]);
    for (let i = 0; i < 60 && !state.player.dialogue; i++) runTick(state, ctx, []);
    expect(state.player.dialogue?.npcId).toBe(npc.id);
  });
});
