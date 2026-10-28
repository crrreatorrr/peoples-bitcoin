/**
 * Quests and the tutorial. Game systems report what happened (talked to an NPC,
 * obtained an item, killed an enemy...) and matching steps complete. Tutorial
 * steps can be done in any order (hints only, never locked); quest steps go in
 * order. Rewards are paid per step and on completion.
 */
import { payUsd } from './economy';
import { giveItem } from './ground';
import { countItem, removeItem } from './inventory';
import type { Content } from './content';
import type { DialogueLine, NpcDef, QuestDef, QuestTrigger, Reward } from './schemas';
import type { EquipSlot, GameState, PlayerState, SimContext, SimEvent } from './state';
import { grantXp } from './xp';

export type QuestEvent =
  | { type: 'talk'; npc: string }
  | { type: 'obtain'; item: string }
  | { type: 'xp'; skill: string }
  | { type: 'sell' }
  | { type: 'buy'; item: string }
  | { type: 'equip'; slot: EquipSlot }
  | { type: 'kill'; enemy: string }
  | { type: 'eat' }
  | { type: 'summon' }
  | { type: 'deposit' }
  | { type: 'enterZone'; zone: string }
  | { type: 'build' }
  | { type: 'use'; item: string; target: string }
  | { type: 'choice'; id: string };

export interface QuestHint {
  questName: string;
  text: string;
  npc?: string;
  object?: string;
  enemy?: string;
}

export function progressQuests(
  state: GameState,
  ctx: SimContext,
  ev: QuestEvent,
  events: SimEvent[],
): void {
  const player = state.player;
  if (ev.type === 'talk') {
    for (const q of ctx.content.quests.values()) {
      const ready = q.requires.every((id) => player.quests[id]?.complete);
      if (q.startNpc === ev.npc && !player.quests[q.id] && ready) {
        player.quests[q.id] = { done: [], complete: false, choices: [] };
        events.push({ type: 'message', kind: 'quest', text: `Quest started: ${q.name}` });
      }
    }
    reissueLostItems(state, ctx, ev.npc, events);
  }

  for (const [questId, progress] of Object.entries(player.quests)) {
    const quest = ctx.content.quests.get(questId);
    if (!quest || progress.complete) continue;
    let advanced = true;
    while (advanced) {
      advanced = false;
      for (const step of openSteps(quest, progress.done)) {
        if (!matches(step.trigger, ev, player)) continue;
        if (step.trigger.type === 'deliver') {
          for (const s of step.trigger.items) removeItem(player.inventory, s.item, s.qty);
        }
        progress.done.push(step.id);
        events.push({ type: 'message', kind: 'quest', text: `Done: ${step.text}` });
        grantReward(state, ctx, step.reward, events);
        if (ev.type === 'choice') {
          progress.choices.push(ev.id);
          grantReward(state, ctx, step.choiceRewards[ev.id], events);
        }
        advanced = quest.ordered; // the next ordered step may match the same event
        break;
      }
    }
    if (progress.done.length === quest.steps.length) {
      progress.complete = true;
      grantReward(state, ctx, quest.reward, events);
      events.push({ type: 'message', kind: 'quest', text: quest.completeMessage });
    }
  }
}

/**
 * OSRS-style reclaim: talking to whoever gave you a quest item (worth nothing,
 * so it can't be bought back) hands you another if your next step needs it
 * and you've lost it.
 */
function reissueLostItems(
  state: GameState,
  ctx: SimContext,
  npcId: string,
  events: SimEvent[],
): void {
  const player = state.player;
  for (const [questId, progress] of Object.entries(player.quests)) {
    const quest = ctx.content.quests.get(questId);
    if (!quest || progress.complete) continue;
    const t = nextStep(quest, progress.done)?.trigger;
    const needed =
      t?.type === 'use' ? [t.item] : t?.type === 'deliver' ? t.items.map((s) => s.item) : [];
    for (const itemId of needed) {
      const def = ctx.content.items.get(itemId);
      if (!def || def.value > 0 || giverOf(ctx.content, quest, itemId) !== npcId) continue;
      const owned =
        countItem(player.inventory, itemId) +
        countItem(player.bank, itemId) +
        Object.values(player.equipment).filter((s) => s?.itemId === itemId).length;
      if (owned > 0) continue;
      giveItem(state, ctx, itemId, 1, events);
      const name = ctx.content.npcs.get(npcId)?.name ?? 'Someone';
      events.push({
        type: 'message',
        kind: 'quest',
        text: `${name} hands you another ${def.name}. Try not to lose this one.`,
      });
    }
  }
}

/** Who hands out `itemId`: the NPC of the step that rewards it, or the quest giver for a quest reward or an earlier 'obtain' step of `quest`. */
function giverOf(content: Content, quest: QuestDef, itemId: string): string | undefined {
  const has = (r: Reward | undefined) => r?.items.some((s) => s.item === itemId) ?? false;
  for (const q of content.quests.values()) {
    if (has(q.reward)) return q.startNpc;
    for (const s of q.steps) {
      if (has(s.reward) || Object.values(s.choiceRewards).some(has)) {
        return s.trigger.type === 'talk' || s.trigger.type === 'deliver'
          ? s.trigger.npc
          : q.startNpc;
      }
    }
  }
  return quest.steps.some((s) => s.trigger.type === 'obtain' && s.trigger.item === itemId)
    ? quest.startNpc
    : undefined;
}

/** An NPC's lines for the player's quest progress: the first matching variant, else the defaults. */
export function npcLines(player: PlayerState, npc: NpcDef, content: Content): DialogueLine[] {
  const variant = npc.dialogue.find((d) => {
    const progress = player.quests[d.quest];
    if (d.choice && !progress?.choices.includes(d.choice)) return false;
    if (d.status === 'complete') return progress?.complete === true;
    if (!progress || progress.complete) return false;
    const quest = content.quests.get(d.quest);
    return (
      !d.step || (quest !== undefined && d.step.includes(nextStep(quest, progress.done)?.id ?? ''))
    );
  });
  return variant?.lines ?? npc.lines;
}

/** True while the quest is under way and its next step is `step`. */
export function atStep(
  player: PlayerState,
  content: Content,
  questId: string,
  step: string,
): boolean {
  const progress = player.quests[questId];
  const quest = content.quests.get(questId);
  if (!progress || progress.complete || !quest) return false;
  return nextStep(quest, progress.done)?.id === step;
}

/** The step the hint points at: the first one not done. */
export function nextStep(quest: QuestDef, done: string[]): QuestDef['steps'][number] | undefined {
  return openSteps(quest, done)[0];
}

/** Quest points earned and available, for the quest list. */
export function questPoints(
  player: PlayerState,
  ctx: SimContext,
): { earned: number; total: number } {
  let earned = 0;
  let total = 0;
  for (const q of ctx.content.quests.values()) {
    total += q.points;
    if (player.quests[q.id]?.complete) earned += q.points;
  }
  return { earned, total };
}

/** The next thing to do: the tutorial first, then any active quest. */
export function currentHint(state: GameState, ctx: SimContext): QuestHint | null {
  const active = Object.entries(state.player.quests)
    .filter(([, p]) => !p.complete)
    .map(([id, p]) => ({ quest: ctx.content.quests.get(id), done: p.done }))
    .filter((q): q is { quest: QuestDef; done: string[] } => q.quest !== undefined)
    .sort((a, b) => Number(b.quest.autoStart) - Number(a.quest.autoStart));
  for (const { quest, done } of active) {
    const step = nextStep(quest, done);
    if (step) return { questName: quest.name, text: step.text, ...step.hint };
  }
  return null;
}

function openSteps(quest: QuestDef, done: string[]): QuestDef['steps'] {
  const open = quest.steps.filter((s) => !done.includes(s.id));
  return quest.ordered ? open.slice(0, 1) : open;
}

function matches(t: QuestTrigger, ev: QuestEvent, player: PlayerState): boolean {
  switch (t.type) {
    case 'talk':
      return ev.type === 'talk' && ev.npc === t.npc;
    case 'deliver':
      return (
        ev.type === 'talk' &&
        ev.npc === t.npc &&
        t.items.every((s) => countItem(player.inventory, s.item) >= s.qty)
      );
    case 'obtain':
      return ev.type === 'obtain' && ev.item === t.item;
    case 'xp':
      return ev.type === 'xp' && ev.skill === t.skill;
    case 'buy':
      return ev.type === 'buy' && (!t.item || ev.item === t.item);
    case 'equip':
      return ev.type === 'equip' && (!t.slot || ev.slot === t.slot);
    case 'kill':
      return ev.type === 'kill' && (!t.enemy || ev.enemy === t.enemy);
    case 'enterZone':
      return ev.type === 'enterZone' && ev.zone === t.zone;
    case 'use':
      return ev.type === 'use' && ev.item === t.item && ev.target === t.target;
    case 'choice':
      return ev.type === 'choice' && t.ids.includes(ev.id);
    default:
      return ev.type === t.type;
  }
}

export function grantReward(
  state: GameState,
  ctx: SimContext,
  reward: Reward | undefined,
  events: SimEvent[],
): void {
  if (!reward) return;
  if (reward.unlock && !state.player.unlocks.includes(reward.unlock)) {
    state.player.unlocks.push(reward.unlock);
  }
  for (const s of reward.items) giveItem(state, ctx, s.item, s.qty, events);
  if (reward.usd > 0) {
    const paid = payUsd(state, reward.usd);
    events.push({
      type: 'message',
      kind: 'quest',
      text: `You receive ${paid.toLocaleString('en-US')} $BITCOIN.`,
    });
  }
  for (const [skillId, xp] of Object.entries(reward.xp)) {
    grantXp(state.player, skillId, ctx.content.skills.get(skillId)?.name ?? skillId, xp, events);
  }
}
