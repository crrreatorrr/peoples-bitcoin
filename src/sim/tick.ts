/**
 * The tick loop. One call = one 600 ms game tick. Order (DESIGN.md §3):
 * inputs → movement → actions (skilling, interacting, the player's attacks) →
 * Sproto AI → enemies → death → NPCs → regen/timers → economy → autosave.
 */
import {
  AUTOSAVE_EVERY_TICKS,
  CHAT,
  COMBAT,
  MOVEMENT,
  PROCESSING,
  SUMMONING,
} from '../config/balance';
import { deposit, depositAll, withdraw } from './bank';
import { build, builtOption, hotspotActions, useStation } from './bunker';
import { approachEnemy, tickPlayerAttack } from './combat';
import { stepEconomy } from './economy';
import { stepEnemies } from './enemies';
import { eat, equipFromInventory, setStyle, unequip } from './equipment';
import { tickGathering, tickProcessing } from './gathering';
import { interactionTiles, isCardinallyAdjacent, type Footprint } from './grid';
import { despawnGroundItems, dropToGround, takeGroundItem } from './ground';
import { swapSlots } from './inventory';
import { stepNpcs } from './npcs';
import { findPath } from './pathfinding';
import { npcLines, progressQuests } from './quests';
import { dismiss, stepSproto, summonFromInventory, useSpecial } from './sprotos';
import {
  findEntity,
  gridOf,
  maxHp,
  type EntityRef,
  type GameState,
  type Intent,
  type PlayerState,
  type SimContext,
  type SimEvent,
  type Tile,
} from './state';
import { buy, sell } from './terminal';
import { handleDeath, passGate, startDying, usePortal } from './zones';

export function runTick(state: GameState, ctx: SimContext, intents: readonly Intent[]): SimEvent[] {
  const events: SimEvent[] = [];
  state.tick++;
  const player = state.player;
  if (player.dyingUntil === null) {
    for (const intent of intents) applyIntent(state, ctx, intent, events);
    stepMovement(state);
    stepActions(state, ctx, events);
  } else {
    player.stepsThisTick = [{ ...player.pos }];
  }
  stepSproto(state, ctx, events);
  stepEnemies(state, ctx, events);
  if (player.hp <= 0 && player.dyingUntil === null) startDying(state, events);
  if (player.dyingUntil !== null && state.tick >= player.dyingUntil)
    handleDeath(state, ctx, events);
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
  player.interface = null;
}

function applyIntent(state: GameState, ctx: SimContext, intent: Intent, events: SimEvent[]): void {
  const player = state.player;
  const ui = player.interface;
  switch (intent.type) {
    case 'walk':
      interrupt(player);
      player.path = findPath(gridOf(state, ctx), player.pos, [{ x: intent.x, y: intent.y }]).path;
      break;
    case 'interact': {
      const entity = findEntity(state, intent.targetId);
      if (!entity || !entityActions(state, ctx, entity).includes(intent.action)) break;
      interrupt(player);
      player.action = { targetId: intent.targetId, action: intent.action, nextAttemptTick: null };
      if (entity.kind === 'enemy') approachEnemy(state, ctx, entity.instance);
      else {
        const goals = interactionGoals(state, ctx, entity);
        player.path = findPath(gridOf(state, ctx), player.pos, goals).path;
      }
      break;
    }
    case 'toggleRun':
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
    case 'toggleRetaliate':
      player.autoRetaliate = !player.autoRetaliate;
      break;
    case 'dropItem':
      dropToGround(state, ctx, intent.slot);
      break;
    case 'moveItem':
      swapSlots(player.inventory, intent.from, intent.to);
      break;
    case 'equip':
      equipFromInventory(state, ctx, intent.slot, events);
      break;
    case 'unequip':
      unequip(state, ctx, intent.slot, events);
      break;
    case 'eat':
      eat(state, ctx, intent.slot, events);
      break;
    case 'summon':
      summonFromInventory(state, ctx, intent.slot, events);
      break;
    case 'dismiss':
      dismiss(state);
      break;
    case 'special':
      useSpecial(state, ctx, events);
      break;
    case 'setStyle':
      setStyle(player, ctx, intent.style);
      break;
    case 'chat':
      sayPublic(state, intent.text, events);
      break;
    case 'continueDialogue':
      advanceDialogue(state);
      break;
    case 'deposit':
      if (ui?.kind === 'bank') {
        deposit(player, intent.slot, intent.qty, events);
        progressQuests(state, ctx, { type: 'deposit' }, events);
      }
      break;
    case 'depositAll':
      if (ui?.kind === 'bank') {
        depositAll(player, events);
        progressQuests(state, ctx, { type: 'deposit' }, events);
      }
      break;
    case 'withdraw':
      if (ui?.kind === 'bank') {
        withdraw(player, ctx.content, intent.index, intent.qty, events, intent.itemId);
      }
      break;
    case 'buy':
      if (ui?.kind === 'terminal') buy(state, ctx, intent.itemId, intent.qty, events);
      break;
    case 'sell':
      if (ui?.kind === 'terminal') sell(state, ctx, intent.slot, intent.qty, events);
      break;
    case 'build': {
      const target = ui?.kind === 'build' ? findEntity(state, ui.targetId) : null;
      if (target?.kind === 'object') build(state, ctx, target.instance, intent.buildId, events);
      break;
    }
    case 'closeInterface':
      player.interface = null;
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
  if (!action) return;
  const entity = findEntity(state, action.targetId);
  if (!entity) {
    player.action = null;
    return;
  }
  // Attacks re-plan their own approach every tick, since targets move.
  if (entity.kind === 'enemy') {
    tickPlayerAttack(state, ctx, entity.instance, events);
    return;
  }
  if (player.path.length > 0) return;
  if (!inInteractionRange(ctx, player.pos, entity)) {
    events.push({ type: 'message', kind: 'game', text: "I can't reach that!" });
    player.action = null;
    return;
  }

  if (entity.kind === 'npc') {
    player.action = null;
    const npcDef = ctx.content.npcs.get(entity.instance.defId);
    // Quests advance first, so an NPC who just finished one already talks about it.
    progressQuests(state, ctx, { type: 'talk', npc: entity.instance.defId }, events);
    const lines = npcDef ? npcLines(player, npcDef, ctx.content) : [];
    if (lines.length > 0) player.dialogue = { npcId: entity.instance.id, line: 0, lines };
    return;
  }
  if (entity.kind === 'ground') {
    player.action = null;
    takeGroundItem(state, ctx, entity.instance, events);
    return;
  }

  const obj = entity.instance;
  const def = ctx.content.objects.get(obj.defId)!;
  if (def.role === 'gather') {
    const node = ctx.content.gatherByObject.get(obj.defId);
    if (node) tickGathering(state, ctx, obj, node, events);
    else player.action = null;
    return;
  }
  if (def.role === 'station' && def.skill) {
    tickProcessing(state, ctx, def.skill, PROCESSING.intervalTicks, events);
    return;
  }
  player.action = null;
  switch (def.role) {
    case 'bank':
      player.interface = { kind: 'bank' };
      break;
    case 'terminal':
      player.interface = { kind: 'terminal' };
      break;
    case 'portal':
      usePortal(state, ctx, obj, events);
      break;
    case 'gate':
      passGate(state, ctx, obj, events);
      break;
    case 'hotspot': {
      const built = builtOption(state, def, obj);
      if (action.action === 'Build' || !built)
        player.interface = { kind: 'build', targetId: obj.id };
      else useStation(state, ctx, obj, built, events);
      break;
    }
    default:
      events.push({ type: 'message', kind: 'game', text: 'Nothing interesting happens.' });
  }
}

function stepTimers(state: GameState): void {
  const player = state.player;
  for (const obj of state.zone.objects) {
    if (obj.depletedUntil !== null && state.tick >= obj.depletedUntil) obj.depletedUntil = null;
  }
  despawnGroundItems(state);
  if (player.overhead && state.tick >= player.overhead.untilTick) player.overhead = null;
  if (state.tick % COMBAT.hpRegenEveryTicks === 0)
    player.hp = Math.min(maxHp(player), player.hp + 1);
  player.summoning.points = Math.min(
    SUMMONING.pointsMax,
    player.summoning.points + SUMMONING.pointsRegenPerTick,
  );
}

function sayPublic(state: GameState, text: string, events: SimEvent[]): void {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, CHAT.maxLength);
  if (!clean) return;
  const player = state.player;
  player.overhead = { text: clean, untilTick: state.tick + CHAT.overheadTicks };
  events.push({ type: 'message', kind: 'public', speaker: player.name, text: clean });
}

function advanceDialogue(state: GameState): void {
  const dialogue = state.player.dialogue;
  if (!dialogue) return;
  dialogue.line++;
  if (dialogue.line >= dialogue.lines.length) state.player.dialogue = null;
}

export function entityActions(state: GameState, ctx: SimContext, entity: EntityRef): string[] {
  switch (entity.kind) {
    case 'ground':
      return ['Take'];
    case 'enemy':
      return ['Attack'];
    case 'npc':
      return ctx.content.npcs.get(entity.instance.defId)?.actions ?? [];
    case 'object': {
      const def = ctx.content.objects.get(entity.instance.defId);
      if (!def) return [];
      return def.role === 'hotspot' ? hotspotActions(state, def, entity.instance) : def.actions;
    }
  }
}

export function footprintOf(ctx: SimContext, entity: EntityRef): Footprint {
  const { x, y } = entity.instance;
  if (entity.kind !== 'object') return { x, y, width: 1, height: 1 };
  const def = ctx.content.objects.get(entity.instance.defId);
  return { x, y, width: def?.width ?? 1, height: def?.height ?? 1 };
}

/** Tiles the player can use the entity from: on the tile for ground items, beside it otherwise. */
function interactionGoals(state: GameState, ctx: SimContext, entity: EntityRef): Tile[] {
  if (entity.kind === 'ground') return [{ x: entity.instance.x, y: entity.instance.y }];
  return interactionTiles(gridOf(state, ctx), footprintOf(ctx, entity));
}

function inInteractionRange(ctx: SimContext, pos: Tile, entity: EntityRef): boolean {
  if (entity.kind === 'ground') return pos.x === entity.instance.x && pos.y === entity.instance.y;
  return isCardinallyAdjacent(pos, footprintOf(ctx, entity));
}
