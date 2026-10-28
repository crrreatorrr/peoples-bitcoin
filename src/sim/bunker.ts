/**
 * Construction: the player's bunker (unlocked by the Bunker Down quest).
 * Hotspots accept builds that need a Construction level, a toolkit tier and
 * materials. Every build is useful: storage, a home terminal, a med bay, a
 * respawn bed, a summoning circle, and production stations that fill up over
 * time (server farms, an ammo crate).
 */
import { SUMMONING, TERMINAL_SHOP_ID } from '../config/balance';
import { giveItem } from './ground';
import { bestTool, countItem, removeItem } from './inventory';
import { progressQuests } from './quests';
import type { BuildOption, ObjectDef } from './schemas';
import {
  maxHp,
  type GameState,
  type ObjectInstance,
  type SimContext,
  type SimEvent,
} from './state';
import { grantXp, levelForXp } from './xp';

export const BUNKER_ZONE_ID = 'zone_bunker';

const ACTION_FOR: Record<BuildOption['provides'], string> = {
  bank: 'Open',
  terminal: 'Use',
  heal: 'Rest',
  respawn: 'Sleep',
  recharge: 'Recharge',
  produce: 'Collect',
};

export function hotspotKey(zoneId: string, obj: ObjectInstance): string {
  return `${zoneId}:${obj.id}`;
}

export function builtOption(
  state: GameState,
  def: ObjectDef,
  obj: ObjectInstance,
): BuildOption | null {
  const built = state.player.bunker[hotspotKey(state.zone.id, obj)];
  return def.builds.find((b) => b.id === built) ?? null;
}

export function hotspotActions(state: GameState, def: ObjectDef, obj: ObjectInstance): string[] {
  const built = builtOption(state, def, obj);
  return built ? [ACTION_FOR[built.provides], 'Build'] : ['Build'];
}

/** Why a build can't happen right now, or null if it can. */
export function buildProblem(
  state: GameState,
  ctx: SimContext,
  option: BuildOption,
): string | null {
  const player = state.player;
  const level = levelForXp(player.skills.construction ?? 0);
  if (level < option.levelReq) return `Needs Construction level ${option.levelReq}.`;
  const tool = bestTool(player.inventory, ctx.content, 'construction', level);
  if (!tool || tool.tool!.tier < option.toolTier) return `Needs a tier ${option.toolTier} toolkit.`;
  for (const m of option.materials) {
    if (countItem(player.inventory, m.item) < m.qty) {
      return `Needs ${m.qty} × ${ctx.content.items.get(m.item)?.name ?? m.item}.`;
    }
  }
  return null;
}

export function build(
  state: GameState,
  ctx: SimContext,
  obj: ObjectInstance,
  buildId: string,
  events: SimEvent[],
): void {
  const def = ctx.content.objects.get(obj.defId);
  const option = def?.builds.find((b) => b.id === buildId);
  if (!def || !option) return;
  const problem = buildProblem(state, ctx, option);
  if (problem) {
    events.push({ type: 'message', kind: 'game', text: problem });
    return;
  }
  for (const m of option.materials) removeItem(state.player.inventory, m.item, m.qty);
  const key = hotspotKey(state.zone.id, obj);
  state.player.bunker[key] = option.id;
  state.player.collected[key] = state.tick;
  events.push({ type: 'message', kind: 'game', text: `You build the ${option.name}.` });
  grantXp(
    state.player,
    'construction',
    ctx.content.skills.get('construction')?.name ?? 'Construction',
    option.xp,
    events,
  );
  progressQuests(state, ctx, { type: 'build' }, events);
}

/** Uses a built station: opens the bank or terminal, heals, recharges, or collects production. */
export function useStation(
  state: GameState,
  ctx: SimContext,
  obj: ObjectInstance,
  option: BuildOption,
  events: SimEvent[],
): void {
  const player = state.player;
  const say = (text: string) => events.push({ type: 'message', kind: 'game', text });
  switch (option.provides) {
    case 'bank':
      player.interface = { kind: 'bank' };
      break;
    case 'terminal':
      player.interface = { kind: 'terminal', shopId: TERMINAL_SHOP_ID };
      break;
    case 'heal':
      player.hp = maxHp(player);
      say('You rest in the med bay. Fully healed.');
      break;
    case 'respawn':
      say('You test the bed. If you fall in battle, you will wake up here.');
      break;
    case 'recharge':
      player.summoning.points = SUMMONING.pointsMax;
      say('The circle hums. Your Summoning points are full.');
      break;
    case 'produce': {
      const p = option.produce!;
      const key = hotspotKey(state.zone.id, obj);
      const since = state.tick - (player.collected[key] ?? state.tick);
      const batches = Math.min(Math.floor(since / p.everyTicks), Math.ceil(p.cap / p.qty));
      const qty = Math.min(p.cap, batches * p.qty);
      if (qty === 0) {
        say(
          `Nothing to collect yet. Check back in ${p.everyTicks - (since % p.everyTicks)} ticks.`,
        );
        return;
      }
      player.collected[key] = state.tick;
      giveItem(state, ctx, p.item, qty, events);
      say(`You collect ${qty} × ${ctx.content.items.get(p.item)?.name ?? p.item}.`);
      break;
    }
  }
}

/** True if a respawn bed is built anywhere in the bunker. */
export function hasRespawnBed(state: GameState, ctx: SimContext): boolean {
  const zone = ctx.content.zones.get(BUNKER_ZONE_ID);
  if (!zone) return false;
  return zone.objects.some((o, i) => {
    const built = state.player.bunker[`${BUNKER_ZONE_ID}:o${i}`];
    return ctx.content.objects
      .get(o.objectId)
      ?.builds.some((b) => b.id === built && b.provides === 'respawn');
  });
}
