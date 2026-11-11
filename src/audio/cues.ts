/**
 * Which sounds a tick's events call for. Pure: the sim's event stream in, cue names out.
 * Only the local player's own actions make noise, so a busy online world stays quiet.
 */
import type { SimEvent } from '../sim/state';
import type { CueId } from './config';

const PLAYER = 'player';

/** At most one of each cue per tick, in the order they first happened. */
export function cuesFor(events: readonly SimEvent[]): CueId[] {
  const cues = new Set<CueId>();
  /** Targets the player attacked this tick: their hitsplats are the player's hits. */
  const struck = new Set<string>();
  for (const e of events) {
    if (e.type === 'attack' && e.attackerId === PLAYER) struck.add(e.targetId);
  }
  for (const e of events) {
    switch (e.type) {
      case 'hitsplat':
        if (e.targetId === PLAYER) {
          if (e.damage > 0) cues.add('hurt');
        } else if (struck.has(e.targetId)) cues.add(e.damage > 0 ? 'hit' : 'miss');
        break;
      case 'xp':
        if (e.skillId === 'mining') cues.add('mine');
        break;
      case 'levelUp':
        cues.add('levelUp');
        break;
      case 'questComplete':
        cues.add('questComplete');
        break;
      case 'death':
        if (e.entityId === PLAYER) cues.add('death');
        break;
      case 'message':
        if (e.kind === 'game' && /^You (buy|sell) /.test(e.text)) cues.add('purchase');
        break;
      default:
        break;
    }
  }
  return [...cues];
}
