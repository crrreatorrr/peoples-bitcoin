/**
 * Ambient NPC movement: idle NPCs occasionally step one tile, staying within
 * their wander radius of their spawn. An NPC the player is using or talking to
 * stands still. Players and NPCs don't block each other's paths (OSRS-style),
 * but an NPC won't step onto the player's or another NPC's tile.
 */
import { NPCS } from '../config/balance';
import { isWalkable } from './grid';
import { chance, nextInt } from './rng';
import type { GameState, SimContext } from './state';

const CARDINALS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function stepNpcs(state: GameState, ctx: SimContext): void {
  const { player, zone } = state;
  const busy = new Set([player.action?.targetId, player.dialogue?.npcId]);
  for (const npc of zone.npcs) {
    npc.from = { x: npc.x, y: npc.y };
    const radius = ctx.content.npcs.get(npc.defId)?.wanderRadius ?? 0;
    if (radius === 0 || busy.has(npc.id) || !chance(state.rng, NPCS.wanderChance)) continue;

    const [dx, dy] = CARDINALS[nextInt(state.rng, 0, CARDINALS.length - 1)];
    const x = npc.x + dx;
    const y = npc.y + dy;
    const inRange = Math.abs(x - npc.spawn.x) <= radius && Math.abs(y - npc.spawn.y) <= radius;
    const occupied =
      (player.pos.x === x && player.pos.y === y) ||
      zone.npcs.some((other) => other !== npc && other.x === x && other.y === y);
    if (inRange && !occupied && isWalkable(ctx.grid, x, y)) {
      npc.x = x;
      npc.y = y;
    }
  }
}
