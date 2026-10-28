import { describe, expect, it } from 'vitest';
import { AUTOSAVE_EVERY_TICKS, CHAT, MOVEMENT } from '../src/config/balance';
import { runTick } from '../src/sim/tick';
import { content, give, messages, newGame, objectOf, runUntil, treasuryGrid } from './helpers';

const SPAWN = { x: 27, y: 30 };

describe('tick loop', () => {
  it('advances the tick counter', () => {
    const { state, ctx } = newGame();
    runTick(state, ctx, []);
    runTick(state, ctx, []);
    expect(state.tick).toBe(2);
  });

  it('walks one tile per tick and records steps for interpolation', () => {
    const { state, ctx } = newGame();
    expect(state.player.pos).toEqual(SPAWN);
    runTick(state, ctx, [{ type: 'walk', x: 27, y: 34 }]);
    expect(state.player.pos).toEqual({ x: 27, y: 31 });
    expect(state.player.stepsThisTick).toEqual([SPAWN, { x: 27, y: 31 }]);
    for (let i = 0; i < 3; i++) runTick(state, ctx, []);
    expect(state.player.pos).toEqual({ x: 27, y: 34 });
    runTick(state, ctx, []);
    expect(state.player.stepsThisTick).toEqual([{ x: 27, y: 34 }]);
  });

  it('runs two tiles per tick and drains run energy', () => {
    const { state, ctx } = newGame();
    runTick(state, ctx, [{ type: 'toggleRun' }, { type: 'walk', x: 27, y: 36 }]);
    expect(state.player.pos).toEqual({ x: 27, y: 32 });
    expect(state.player.runEnergy).toBeCloseTo(MOVEMENT.runEnergyMax - MOVEMENT.runDrainPerTick);
    runTick(state, ctx, []);
    runTick(state, ctx, []);
    expect(state.player.pos).toEqual({ x: 27, y: 36 });
  });

  it('walks the last single tile without draining energy', () => {
    const { state, ctx } = newGame();
    state.player.running = true;
    state.player.runEnergy = 50;
    runTick(state, ctx, [{ type: 'walk', x: 27, y: 31 }]);
    expect(state.player.pos).toEqual({ x: 27, y: 31 });
    expect(state.player.runEnergy).toBeCloseTo(50 + MOVEMENT.runRegenPerTick);
  });

  it('turns run off when energy runs out, and refuses to turn it on at zero', () => {
    const { state, ctx } = newGame();
    state.player.running = true;
    state.player.runEnergy = MOVEMENT.runDrainPerTick;
    runTick(state, ctx, [{ type: 'walk', x: 27, y: 36 }]);
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
    runUntil(state, ctx, () => state.player.path.length === 0, [{ type: 'walk', x: 20, y: 20 }]);
    const grid = treasuryGrid(ctx);
    expect(grid.blocked[state.player.pos.y * grid.width + state.player.pos.x]).toBe(0);
    expect(Math.max(Math.abs(state.player.pos.x - 20), Math.abs(state.player.pos.y - 20))).toBe(1);
  });

  it('emits autosave every AUTOSAVE_EVERY_TICKS ticks', () => {
    const { state, ctx } = newGame();
    const saves: number[] = [];
    for (let i = 0; i < AUTOSAVE_EVERY_TICKS * 3; i++) {
      if (runTick(state, ctx, []).some((e) => e.type === 'autosave')) saves.push(state.tick);
    }
    expect(saves).toEqual([
      AUTOSAVE_EVERY_TICKS,
      AUTOSAVE_EVERY_TICKS * 2,
      AUTOSAVE_EVERY_TICKS * 3,
    ]);
  });

  it('a walk click cancels the current action', () => {
    const { state, ctx } = newGame();
    give(state, 'item_pick_rusty');
    const rack = objectOf(state, 'obj_rack_dusty', 36, 28);
    state.player.pos = { x: 35, y: 28 };
    runTick(state, ctx, [{ type: 'interact', targetId: rack.id, action: 'Mine' }]);
    expect(state.player.action).not.toBeNull();
    runTick(state, ctx, [{ type: 'walk', x: 35, y: 34 }]);
    expect(state.player.action).toBeNull();
  });

  it('ignores actions the target does not offer, and unknown targets', () => {
    const { state, ctx } = newGame();
    const rack = objectOf(state, 'obj_rack_dusty', 36, 28);
    runTick(state, ctx, [{ type: 'interact', targetId: rack.id, action: 'Attack' }]);
    expect(state.player.action).toBeNull();
    runTick(state, ctx, [{ type: 'interact', targetId: 'nope', action: 'Mine' }]);
    expect(state.player.action).toBeNull();
  });

  it('opens a one-line-at-a-time dialogue with an NPC, then closes it', () => {
    const { state, ctx } = newGame();
    const treasurer = state.zone.npcs.find((n) => n.defId === 'npc_treasurer')!;
    runUntil(state, ctx, () => state.player.dialogue !== null, [
      { type: 'interact', targetId: treasurer.id, action: 'Talk-to' },
    ]);
    expect(state.player.dialogue).toEqual({ npcId: treasurer.id, line: 0 });
    const lineCount = content().npcs.get('npc_treasurer')!.lines.length;
    for (let line = 1; line < lineCount; line++) {
      runTick(state, ctx, [{ type: 'continueDialogue' }]);
      expect(state.player.dialogue?.line).toBe(line);
    }
    runTick(state, ctx, [{ type: 'continueDialogue' }]);
    expect(state.player.dialogue).toBeNull();
  });

  it('walking away closes the dialogue', () => {
    const { state, ctx } = newGame();
    state.player.dialogue = { npcId: state.zone.npcs[0].id, line: 0 };
    runTick(state, ctx, [{ type: 'walk', x: 27, y: 34 }]);
    expect(state.player.dialogue).toBeNull();
  });

  it('drops an inventory item onto the ground', () => {
    const { state, ctx } = newGame();
    give(state, 'item_scrap_hash');
    runTick(state, ctx, [{ type: 'dropItem', slot: 0 }]);
    expect(state.player.inventory[0]).toBeNull();
    expect(state.zone.groundItems).toMatchObject([{ itemId: 'item_scrap_hash', qty: 1, ...SPAWN }]);
  });

  it('swaps inventory slots', () => {
    const { state, ctx } = newGame();
    give(state, 'item_scrap_hash');
    runTick(state, ctx, [{ type: 'moveItem', from: 0, to: 5 }]);
    expect(state.player.inventory[0]).toBeNull();
    expect(state.player.inventory[5]).toEqual({ itemId: 'item_scrap_hash', qty: 1 });
    runTick(state, ctx, [{ type: 'moveItem', from: 5, to: 99 }]);
    expect(state.player.inventory[5]).not.toBeNull();
  });

  it('public chat goes to the chatbox and above the head, then fades', () => {
    const { state, ctx } = newGame();
    const events = runTick(state, ctx, [{ type: 'chat', text: '  it is   not BTC  ' }]);
    expect(events).toContainEqual({
      type: 'message',
      kind: 'public',
      speaker: state.player.name,
      text: 'it is not BTC',
    });
    expect(state.player.overhead?.text).toBe('it is not BTC');
    for (let i = 0; i < CHAT.overheadTicks; i++) runTick(state, ctx, []);
    expect(state.player.overhead).toBeNull();
  });

  it('ignores empty chat and truncates long chat', () => {
    const { state, ctx } = newGame();
    expect(messages(runTick(state, ctx, [{ type: 'chat', text: '   ' }]))).toEqual([]);
    runTick(state, ctx, [{ type: 'chat', text: 'x'.repeat(500) }]);
    expect(state.player.overhead?.text).toHaveLength(CHAT.maxLength);
  });

  it('is deterministic: same seed + same intents = same state', () => {
    const play = () => {
      const { state, ctx } = newGame(4242);
      give(state, 'item_pick_rusty');
      const rack = objectOf(state, 'obj_rack_dusty', 36, 28);
      for (let i = 0; i < 300; i++) {
        const intents =
          i % 40 === 0 ? [{ type: 'interact' as const, targetId: rack.id, action: 'Mine' }] : [];
        runTick(state, ctx, intents);
      }
      return JSON.stringify(state);
    };
    expect(play()).toBe(play());
  });
});
