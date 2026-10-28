import { describe, expect, it } from 'vitest';
import { AUTOSAVE_EVERY_TICKS, MOVEMENT } from '../src/config/balance';
import { addItem } from '../src/sim/inventory';
import { runTick } from '../src/sim/tick';
import { content, messages, newGame, runUntil } from './helpers';

describe('tick loop', () => {
  it('advances the tick counter', () => {
    const { state, ctx } = newGame();
    runTick(state, ctx, []);
    runTick(state, ctx, []);
    expect(state.tick).toBe(2);
  });

  it('walks one tile per tick and records steps for interpolation', () => {
    const { state, ctx } = newGame();
    expect(state.player.pos).toEqual({ x: 19, y: 31 });
    runTick(state, ctx, [{ type: 'walk', x: 19, y: 35 }]);
    expect(state.player.pos).toEqual({ x: 19, y: 32 });
    expect(state.player.stepsThisTick).toEqual([
      { x: 19, y: 31 },
      { x: 19, y: 32 },
    ]);
    runTick(state, ctx, []);
    runTick(state, ctx, []);
    runTick(state, ctx, []);
    expect(state.player.pos).toEqual({ x: 19, y: 35 });
    runTick(state, ctx, []);
    expect(state.player.stepsThisTick).toEqual([{ x: 19, y: 35 }]);
  });

  it('runs two tiles per tick and drains run energy', () => {
    const { state, ctx } = newGame();
    runTick(state, ctx, [{ type: 'toggleRun' }, { type: 'walk', x: 19, y: 37 }]);
    expect(state.player.pos).toEqual({ x: 19, y: 33 });
    expect(state.player.runEnergy).toBeCloseTo(MOVEMENT.runEnergyMax - MOVEMENT.runDrainPerTick);
    runTick(state, ctx, []);
    runTick(state, ctx, []);
    expect(state.player.pos).toEqual({ x: 19, y: 37 });
  });

  it('walks the last single tile without draining energy', () => {
    const { state, ctx } = newGame();
    state.player.running = true;
    state.player.runEnergy = 50;
    runTick(state, ctx, [{ type: 'walk', x: 19, y: 32 }]);
    expect(state.player.pos).toEqual({ x: 19, y: 32 });
    expect(state.player.runEnergy).toBeCloseTo(50 + MOVEMENT.runRegenPerTick);
  });

  it('turns run off when energy runs out, and refuses to turn it on at zero', () => {
    const { state, ctx } = newGame();
    state.player.running = true;
    state.player.runEnergy = MOVEMENT.runDrainPerTick;
    runTick(state, ctx, [{ type: 'walk', x: 19, y: 37 }]);
    expect(state.player.runEnergy).toBe(0);
    expect(state.player.running).toBe(false);

    const events = runTick(state, ctx, [{ type: 'toggleRun' }]);
    expect(state.player.running).toBe(false);
    expect(messages(events)).toContain('You have no Motion left. Rest a moment.');
  });

  it('regenerates run energy while not running, up to the max', () => {
    const { state, ctx } = newGame();
    state.player.runEnergy = MOVEMENT.runEnergyMax - MOVEMENT.runRegenPerTick / 2;
    runTick(state, ctx, []);
    expect(state.player.runEnergy).toBe(MOVEMENT.runEnergyMax);
  });

  it('walks to the nearest reachable tile when clicking a wall', () => {
    const { state, ctx } = newGame();
    runUntil(state, ctx, () => state.player.path.length === 0, [{ type: 'walk', x: 19, y: 20 }]);
    // (19, 20) is the doorway; (6, 25) area is open lawn. Click a wall tile instead:
    runUntil(state, ctx, () => state.player.path.length === 0, [{ type: 'walk', x: 6, y: 20 }]);
    expect(ctx.grid.blocked[state.player.pos.y * ctx.grid.width + state.player.pos.x]).toBe(0);
    expect(Math.max(Math.abs(state.player.pos.x - 6), Math.abs(state.player.pos.y - 20))).toBe(1);
  });

  it('emits autosave every AUTOSAVE_EVERY_TICKS ticks', () => {
    const { state, ctx } = newGame();
    const saves: number[] = [];
    for (let i = 0; i < AUTOSAVE_EVERY_TICKS * 3; i++) {
      if (runTick(state, ctx, []).some((e) => e.type === 'autosave')) saves.push(state.tick);
    }
    expect(saves).toEqual([AUTOSAVE_EVERY_TICKS, AUTOSAVE_EVERY_TICKS * 2, AUTOSAVE_EVERY_TICKS * 3]);
  });

  it('a walk click cancels the current action', () => {
    const { state, ctx } = newGame();
    const rack = state.zone.objects.find((o) => o.x === 27 && o.y === 27)!;
    state.player.pos = { x: 26, y: 27 };
    runTick(state, ctx, [{ type: 'interact', targetId: rack.id, action: 'Mine' }]);
    expect(state.player.action).not.toBeNull();
    runTick(state, ctx, [{ type: 'walk', x: 26, y: 30 }]);
    expect(state.player.action).toBeNull();
  });

  it('ignores actions the target does not offer, and unknown targets', () => {
    const { state, ctx } = newGame();
    const rack = state.zone.objects.find((o) => o.x === 27 && o.y === 27)!;
    runTick(state, ctx, [{ type: 'interact', targetId: rack.id, action: 'Attack' }]);
    expect(state.player.action).toBeNull();
    runTick(state, ctx, [{ type: 'interact', targetId: 'nope', action: 'Mine' }]);
    expect(state.player.action).toBeNull();
  });

  it('talks to an NPC after walking over', () => {
    const { state, ctx } = newGame();
    const treasurer = state.zone.npcs[0];
    const events = runUntil(
      state,
      ctx,
      (ev) => ev.some((e) => e.type === 'message' && e.kind === 'npc'),
      [{ type: 'interact', targetId: treasurer.id, action: 'Talk-to' }],
    );
    const lines = events.filter((e) => e.type === 'message' && e.kind === 'npc');
    expect(lines).toHaveLength(content().npcs.get('npc_treasurer')!.lines.length);
    expect(lines[0]).toMatchObject({ speaker: 'The Treasurer' });
    expect(state.player.action).toBeNull();
  });

  it('drops an inventory item', () => {
    const { state, ctx } = newGame();
    addItem(state.player.inventory, content().items.get('item_scrap_hash')!);
    runTick(state, ctx, [{ type: 'dropItem', slot: 0 }]);
    expect(state.player.inventory[0]).toBeNull();
  });

  it('is deterministic: same seed + same intents = same state', () => {
    const play = () => {
      const { state, ctx } = newGame(4242);
      const rack = state.zone.objects.find((o) => o.x === 27 && o.y === 27)!;
      for (let i = 0; i < 300; i++) {
        const intents = i % 40 === 0 ? [{ type: 'interact' as const, targetId: rack.id, action: 'Mine' }] : [];
        runTick(state, ctx, intents);
      }
      return JSON.stringify(state);
    };
    expect(play()).toBe(play());
  });
});
