/**
 * The tick loop. One call = one 600 ms game tick. Order (DESIGN.md §3):
 * inputs → movement → actions → regen/timers → economy → autosave.
 * Combat, Sproto AI, bosses and random events slot in after actions in later phases.
 */
import { AUTOSAVE_EVERY_TICKS, MOVEMENT } from '../config/balance';
import { stepEconomy } from './economy';
import { interactionTiles, isCardinallyAdjacent, type Footprint } from './grid';
import { removeSlot } from './inventory';
import { tickMining } from './mining';
import { findPath } from './pathfinding';
import {
  findEntity,
  type EntityRef,
  type GameState,
  type Intent,
  type SimContext,
  type SimEvent,
} from './state';

export function runTick(state: GameState, ctx: SimContext, intents: readonly Intent[]): SimEvent[] {
  const events: SimEvent[] = [];
  state.tick++;
  for (const intent of intents) applyIntent(state, ctx, intent, events);
  stepMovement(state);
  stepActions(state, ctx, events);
  stepTimers(state);
  stepEconomy(state.economy, state.rng, state.tick);
  if (state.tick % AUTOSAVE_EVERY_TICKS === 0) events.push({ type: 'autosave' });
  return events;
}

function applyIntent(state: GameState, ctx: SimContext, intent: Intent, events: SimEvent[]): void {
  const player = state.player;
  switch (intent.type) {
    case 'walk': {
      player.path = findPath(ctx.grid, player.pos, [{ x: intent.x, y: intent.y }]).path;
      player.action = null;
      break;
    }
    case 'interact': {
      const entity = findEntity(state, intent.targetId);
      if (!entity || !entityActions(ctx, entity).includes(intent.action)) break;
      const goals = interactionTiles(ctx.grid, footprintOf(ctx, entity));
      player.path = findPath(ctx.grid, player.pos, goals).path;
      player.action = { targetId: intent.targetId, action: intent.action, nextAttemptTick: null };
      break;
    }
    case 'toggleRun': {
      if (!player.running && player.runEnergy < MOVEMENT.runEnergyToEnable) {
        events.push({
          type: 'message',
          kind: 'game',
          text: 'You have no Motion left. Rest a moment.',
        });
        break;
      }
      player.running = !player.running;
      break;
    }
    case 'dropItem': {
      removeSlot(player.inventory, intent.slot);
      break;
    }
  }
}

function stepMovement(state: GameState): void {
  const player = state.player;
  player.stepsThisTick = [{ ...player.pos }];
  const running = player.running && player.path.length > 1;
  const steps = running ? MOVEMENT.runTilesPerTick : MOVEMENT.walkTilesPerTick;
  for (let i = 0; i < steps && player.path.length > 0; i++) {
    const next = player.path.shift()!;
    player.pos = { ...next };
    player.stepsThisTick.push({ ...next });
  }
  if (running) {
    player.runEnergy = Math.max(0, player.runEnergy - MOVEMENT.runDrainPerTick);
    if (player.runEnergy === 0) player.running = false;
  } else {
    player.runEnergy = Math.min(MOVEMENT.runEnergyMax, player.runEnergy + MOVEMENT.runRegenPerTick);
  }
}

function stepActions(state: GameState, ctx: SimContext, events: SimEvent[]): void {
  const player = state.player;
  const action = player.action;
  if (!action || player.path.length > 0) return;

  const entity = findEntity(state, action.targetId);
  if (!entity) {
    player.action = null;
    return;
  }
  if (!isCardinallyAdjacent(player.pos, footprintOf(ctx, entity))) {
    events.push({ type: 'message', kind: 'game', text: "I can't reach that!" });
    player.action = null;
    return;
  }

  if (entity.kind === 'object' && action.action === 'Mine') {
    tickMining(state, ctx, entity.instance, events);
  } else if (entity.kind === 'npc' && action.action === 'Talk-to') {
    const npc = ctx.content.npcs.get(entity.instance.defId);
    for (const text of npc?.lines ?? []) {
      events.push({ type: 'message', kind: 'npc', speaker: npc?.name, text });
    }
    player.action = null;
  } else {
    events.push({ type: 'message', kind: 'game', text: 'Nothing interesting happens.' });
    player.action = null;
  }
}

function stepTimers(state: GameState): void {
  for (const obj of state.zone.objects) {
    if (obj.depletedUntil !== null && state.tick >= obj.depletedUntil) obj.depletedUntil = null;
  }
}

export function entityActions(ctx: SimContext, entity: EntityRef): string[] {
  const def =
    entity.kind === 'object'
      ? ctx.content.objects.get(entity.instance.defId)
      : ctx.content.npcs.get(entity.instance.defId);
  return def?.actions ?? [];
}

export function footprintOf(ctx: SimContext, entity: EntityRef): Footprint {
  const { x, y } = entity.instance;
  if (entity.kind === 'npc') return { x, y, width: 1, height: 1 };
  const def = ctx.content.objects.get(entity.instance.defId);
  return { x, y, width: def?.width ?? 1, height: def?.height ?? 1 };
}
