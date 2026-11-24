import { describe, expect, it } from 'vitest';
import { newEnemy, type GameState, type SimContext, type SimEvent } from '../src/sim/state';
import { runTick } from '../src/sim/tick';
import { changeZone } from '../src/sim/zones';
import { content, newGame } from './helpers';

/**
 * A lone aggressive melee enemy in the open, `gap` tiles north of a player who walks up to hit
 * it with the gavel. Both close in at one tile a tick, so on some gaps the player's planned step
 * is the tile the enemy has just walked onto.
 */
function meleeRush(gap: number, ticks = 40) {
  const { state, ctx }: { state: GameState; ctx: SimContext } = newGame(11);
  changeZone(state, ctx, 'zone_trenches', { x: 20, y: 110 }, []);
  state.zone.enemies = [];
  const enemy = newEnemy('e900', 'enemy_heckler', 20, 110 - gap, content(), false);
  state.zone.enemies.push(enemy);
  state.player.autoRetaliate = false;
  let swings = 0;
  let sharedTile = 0;
  for (let i = 0; i < ticks; i++) {
    const events: SimEvent[] = runTick(
      state,
      ctx,
      i === 0 ? [{ type: 'interact', targetId: enemy.id, action: 'Attack' }] : [],
    );
    swings += events.filter((e) => e.type === 'attack' && e.attackerId === state.selfId).length;
    if (
      enemy.respawnAt === null &&
      enemy.x === state.player.pos.x &&
      enemy.y === state.player.pos.y
    )
      sharedTile++;
    if (enemy.respawnAt !== null) break;
  }
  return { swings, sharedTile };
}

describe('walking up to an enemy that is walking up to you', () => {
  it.each([2, 3, 4, 5, 6, 7, 8])('the gavel swings when the fight starts %i tiles apart', (gap) => {
    const { swings, sharedTile } = meleeRush(gap);
    // Before the fix, some gaps ended with the two trading places forever and nobody swinging.
    expect(swings).toBeGreaterThan(0);
    expect(sharedTile).toBe(0);
  });
});
