/** The client replica over the loopback world: snapshot, deltas, ids, keyframes. */
import { describe, expect, it } from 'vitest';
import { NET, START_ZONE_ID, TICK_MS } from '../../src/config/balance';
import { OnlineDriver } from '../../src/game/onlineDriver';
import { LoopbackTransport } from '../../src/net/loopbackTransport';
import { Playout } from '../../src/net/playout';
import { Replica } from '../../src/net/replica';
import type { SimEvent } from '../../src/sim/state';
import { content } from '../helpers';

function online(bots = 2) {
  let now = 0;
  const transport = new LoopbackTransport({ content: content(), bots, autoLoop: false });
  const driver = new OnlineDriver(content(), START_ZONE_ID, transport, () => now);
  const events: SimEvent[] = [];
  const run = (ticks: number) => {
    for (let i = 0; i < ticks * NET.loopsPerTick; i++) {
      transport.pump();
      now += 1000 / NET.loopHz;
      for (const batch of driver.advance(now)) events.push(...batch);
    }
  };
  return { transport, driver, events, run, setNow: (t: number) => (now = t) };
}

describe('replica', () => {
  it('builds a GameState-shaped view with others, and maps own ids to player', async () => {
    const o = online(2);
    await o.transport.join();
    o.run(4);
    expect(o.driver.welcome?.you).toBe('p:me');
    expect(o.driver.state.player.displayName).toBe('You');
    expect([...o.driver.replica.others.keys()].sort()).toEqual(['p:bot1', 'p:bot2']);
    expect(o.driver.replica.others.get('p:bot1')!.name).toBe('Bot 1');
    expect(o.driver.state.zone.npcs.length).toBeGreaterThan(0);
    expect(o.driver.state.zone.enemies.length).toBeGreaterThan(0);
  });

  it('applies our intents through the server and moves us', async () => {
    const o = online(0);
    await o.transport.join();
    o.run(3);
    const start = { ...o.driver.state.player.pos };
    o.driver.queue({ type: 'walk', x: start.x, y: start.y + 3 });
    o.run(6);
    expect(o.driver.state.player.pos).not.toEqual(start);
  });

  it('public chat round-trips through the server', async () => {
    const o = online(1);
    await o.transport.join();
    o.run(2);
    const lines: string[] = [];
    o.driver.chat.add((c) => {
      if (c.ch === 'public') lines.push(c.text);
    });
    o.driver.queue({ type: 'chat', text: 'hello world' });
    o.run(1);
    expect(lines).toContain('hello world');
    expect(o.driver.state.player.overhead?.text).toBe('hello world');
  });

  it('maps own entity ids in events and merges moving-part updates', () => {
    const r = new Replica(content(), START_ZONE_ID);
    r.setSelf('p:u1');
    r.applySnapshot({
      tick: 1,
      zone: START_ZONE_ID,
      self: {},
      ent: [
        {
          id: 'p:u2',
          k: 'p',
          d: 'player_president',
          x: 5,
          y: 5,
          name: 'Two',
          cl: 9,
          look: '|||',
          mhp: 10,
          hp: 10,
        },
      ],
      obj: [],
      ev: [],
    });
    const ev = r.applyDelta({
      tick: 2,
      ack: 0,
      ent: [
        {
          id: 'p:u2',
          x: 6,
          y: 5,
          st: [
            [5, 5],
            [6, 5],
          ],
          hp: 9,
        } as never,
      ],
      del: [],
      ev: [
        { type: 'hitsplat', targetId: 'p:u1', damage: 3 },
        { type: 'attack', attackerId: 's:u1', targetId: 'e1', style: 'gun' },
      ],
    });
    expect(ev[0]).toMatchObject({ targetId: 'player' });
    expect(ev[1]).toMatchObject({ attackerId: 'sproto' });
    const two = r.others.get('p:u2')!;
    expect(two).toMatchObject({ name: 'Two', combatLevel: 9, hp: 9, x: 6 });
    expect(two.steps).toEqual([
      { x: 5, y: 5 },
      { x: 6, y: 5 },
    ]);
    r.applyDelta({ tick: 3, ack: 0, ent: [], del: ['p:u2'], ev: [] });
    expect(r.others.has('p:u2')).toBe(false);
  });

  it('a keyframe snapshot replaces the view without a zone change', () => {
    const r = new Replica(content(), START_ZONE_ID);
    const snap = {
      tick: 1,
      zone: START_ZONE_ID,
      self: {},
      ent: [],
      obj: [] as [string, number][],
      ev: [],
    };
    expect(r.applySnapshot(snap).some((e) => e.type === 'zoneChanged')).toBe(false);
    expect(r.applySnapshot({ ...snap, zone: 'zone_trenches' })[0]).toEqual({
      type: 'zoneChanged',
      zoneId: 'zone_trenches',
    });
    expect(r.state.zone.id).toBe('zone_trenches');
  });
});

describe('playout', () => {
  it('applies in tick order after the delay, spaced at least 80% of a tick', () => {
    const p = new Playout<number>();
    p.push(2, 2, 0);
    p.push(1, 1, 0);
    expect(p.take(NET.interpDelayMs - 1)).toEqual([]);
    expect(p.take(NET.interpDelayMs)).toEqual([1]);
    expect(p.take(NET.interpDelayMs + 10)).toEqual([]);
    expect(p.take(NET.interpDelayMs + TICK_MS * 0.8)).toEqual([2]);
    expect(p.alpha(NET.interpDelayMs + TICK_MS * 0.8 + TICK_MS / 2)).toBeCloseTo(0.5);
  });

  it('snaps through a backlog', () => {
    const p = new Playout<number>();
    for (let t = 1; t <= NET.snapAfterTicks + 2; t++) p.push(t, t, 0);
    expect(p.take(1)).toHaveLength(NET.snapAfterTicks + 2);
    expect(p.size).toBe(0);
  });
});
