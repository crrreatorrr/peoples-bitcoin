/**
 * The tick loop. One call = one 600 ms game tick. Order (DESIGN.md §3):
 * inputs → movement → actions → NPCs → regen/timers → economy → autosave.
 * Combat, Sproto AI, bosses and random events slot in after actions in later phases.
 */
import { AUTOSAVE_EVERY_TICKS, CHAT, MOVEMENT } from '../config/balance';
import { deposit, depositAll, withdraw } from './bank';
import { stepEconomy } from './economy';
import { interactionTiles, isCardinallyAdjacent, type Footprint } from './grid';
import { despawnGroundItems, dropToGround, takeGroundItem } from './ground';
import { swapSlots } from './inventory';
import { tickMining } from './mining';
import { stepNpcs } from './npcs';
import { findPath } from './pathfinding';
import {
  findEntity,
  type EntityRef,
  type GameState,
  type Intent,
  type PlayerState,
  type SimContext,
  type SimEvent,
  type Tile,
} from './state';

const GROUND_ACTIONS = ['Take'];

export function runTick(state: GameState, ctx: SimContext, intents: readonly Intent[]): SimEvent[] {
  const events: SimEvent[] = [];
  state.tick++;
  for (const intent of intents) applyIntent(state, ctx, intent, events);
  stepMovement(state);
  stepActions(state, ctx, events);
  stepNpcs(state, ctx);
  stepTimers(state);
  stepEconomy(state.economy, state.rng, state.tick);
  if (state.tick % AUTOSAVE_EVERY_TICKS === 0) events.push({ type: 'autosave' });
  return events;
}

/** Moving or starting a new action closes open interfaces, as in OSRS. */
function interrupt(player: PlayerState): void {
  player.action = null;
  player.dialogue = null;
  player.bankOpen = false;
}

function applyIntent(state: GameState, ctx: SimContext, intent: Intent, events: SimEvent[]): void {
  const player = state.player;
  switch (intent.type) {
    case 'walk': {
      interrupt(player);
      player.path = findPath(ctx.grid, player.pos, [{ x: intent.x, y: intent.y }]).path;
      break;
    }
    case 'interact': {
      const entity = findEntity(state, intent.targetId);
      if (!entity || !entityActions(ctx, entity).includes(intent.action)) break;
      interrupt(player);
      player.path = findPath(ctx.grid, player.pos, interactionGoals(ctx, entity)).path;
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
    case 'dropItem':
      dropToGround(state, ctx, intent.slot);
      break;
    case 'moveItem':
      swapSlots(player.inventory, intent.from, intent.to);
      break;
    case 'chat':
      sayPublic(state, intent.text, events);
      break;
    case 'continueDialogue':
      advanceDialogue(state, ctx);
      break;
    case 'deposit':
      if (player.bankOpen) deposit(player, intent.slot, intent.qty, events);
      break;
    case 'depositAll':
      if (player.bankOpen) depositAll(player, events);
      break;
    case 'withdraw':
      if (player.bankOpen) withdraw(player, ctx.content, intent.index, intent.qty, events);
      break;
    case 'closeBank':
      player.bankOpen = false;
      break;
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
  if (!inInteractionRange(ctx, player.pos, entity)) {
    events.push({ type: 'message', kind: 'game', text: "I can't reach that!" });
    player.action = null;
    return;
  }

  if (entity.kind === 'object' && action.action === 'Mine') {
    tickMining(state, ctx, entity.instance, events);
    return;
  }
  player.action = null;
  if (entity.kind === 'object' && action.action === 'Bank') {
    player.bankOpen = true;
  } else if (entity.kind === 'npc' && action.action === 'Talk-to') {
    const lines = ctx.content.npcs.get(entity.instance.defId)?.lines ?? [];
    if (lines.length > 0) player.dialogue = { npcId: entity.instance.id, line: 0 };
  } else if (entity.kind === 'ground' && action.action === 'Take') {
    takeGroundItem(state, ctx, entity.instance, events);
  } else {
    events.push({ type: 'message', kind: 'game', text: 'Nothing interesting happens.' });
  }
}

function stepTimers(state: GameState): void {
  for (const obj of state.zone.objects) {
    if (obj.depletedUntil !== null && state.tick >= obj.depletedUntil) obj.depletedUntil = null;
  }
  despawnGroundItems(state);
  const overhead = state.player.overhead;
  if (overhead && state.tick >= overhead.untilTick) state.player.overhead = null;
}

function sayPublic(state: GameState, text: string, events: SimEvent[]): void {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, CHAT.maxLength);
  if (!clean) return;
  const player = state.player;
  player.overhead = { text: clean, untilTick: state.tick + CHAT.overheadTicks };
  events.push({ type: 'message', kind: 'public', speaker: player.name, text: clean });
}

function advanceDialogue(state: GameState, ctx: SimContext): void {
  const dialogue = state.player.dialogue;
  if (!dialogue) return;
  const npc = state.zone.npcs.find((n) => n.id === dialogue.npcId);
  const lines = (npc && ctx.content.npcs.get(npc.defId)?.lines) || [];
  dialogue.line++;
  if (dialogue.line >= lines.length) state.player.dialogue = null;
}

export function entityActions(ctx: SimContext, entity: EntityRef): string[] {
  if (entity.kind === 'ground') return GROUND_ACTIONS;
  const def =
    entity.kind === 'object'
      ? ctx.content.objects.get(entity.instance.defId)
      : ctx.content.npcs.get(entity.instance.defId);
  return def?.actions ?? [];
}

export function footprintOf(ctx: SimContext, entity: EntityRef): Footprint {
  const { x, y } = entity.instance;
  if (entity.kind !== 'object') return { x, y, width: 1, height: 1 };
  const def = ctx.content.objects.get(entity.instance.defId);
  return { x, y, width: def?.width ?? 1, height: def?.height ?? 1 };
}

/** Tiles the player can use the entity from: on the tile for ground items, beside it otherwise. */
function interactionGoals(ctx: SimContext, entity: EntityRef): Tile[] {
  if (entity.kind === 'ground') return [{ x: entity.instance.x, y: entity.instance.y }];
  return interactionTiles(ctx.grid, footprintOf(ctx, entity));
}

function inInteractionRange(ctx: SimContext, pos: Tile, entity: EntityRef): boolean {
  if (entity.kind === 'ground') return pos.x === entity.instance.x && pos.y === entity.instance.y;
  return isCardinallyAdjacent(pos, footprintOf(ctx, entity));
}
