/**
 * Ambient NPC movement, OSRS-style: now and then an idle NPC picks a spot
 * within its wander radius of its spawn and walks there over a few ticks. An
 * NPC the player is using or talking to stands still. Players and NPCs don't
 * block each other's paths, but an NPC won't step onto the player's or
 * another NPC's tile.
 */
import { NPCS } from '../config/balance';
import { directStep } from './grid';
import { chance, nextInt } from './rng';
import { gridOf, type GameState, type SimContext } from './state';

export function stepNpcs(state: GameState, ctx: SimContext): void {
  const { player, zone } = state;
  const busy = new Set([player.action?.targetId, player.dialogue?.npcId]);
  for (const npc of zone.npcs) {
    npc.from = { x: npc.x, y: npc.y };
    const radius = ctx.content.npcs.get(npc.defId)?.wanderRadius ?? 0;
    if (radius === 0 || busy.has(npc.id)) continue;
    if (!npc.goal) {
      if (!chance(state.rng, NPCS.wanderChance)) continue;
      npc.goal = {
        x: npc.spawn.x + nextInt(state.rng, -radius, radius),
        y: npc.spawn.y + nextInt(state.rng, -radius, radius),
      };
    }
    const next = directStep(
      gridOf(state, ctx),
      npc,
      npc.goal,
      (x, y) =>
        (player.pos.x === x && player.pos.y === y) ||
        zone.npcs.some((other) => other !== npc && other.x === x && other.y === y),
    );
    if (next) Object.assign(npc, next);
    if (!next || (npc.x === npc.goal.x && npc.y === npc.goal.y)) npc.goal = null;
  }
}
