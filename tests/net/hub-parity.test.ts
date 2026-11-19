/** Online hub parity: relics from the hub profile, the tutorial relic event, the XP board, wallet refresh. */
import { describe, expect, it } from 'vitest';
import { NET } from '../../src/config/balance';
import { IntentSchema, OP } from '../../src/net/protocol';
import { RELIC_EVENT, XP_BOARD, type EconomyResult, type HubProfile } from '../../src/server/host';
import { fakeIO, testWorld, type FakeIO } from './helpers';

interface HubCalls {
  events: { userId: string; eventId: string; data: Record<string, unknown>; key: string }[];
  scores: { userId: string; boardId: string; value: number }[];
}

/** A fake IO with the optional hub calls. */
function hubIO(
  profile: HubProfile | null,
  replies: { event?: () => EconomyResult; score?: () => EconomyResult } = {},
): FakeIO & HubCalls {
  const io = fakeIO() as FakeIO & HubCalls;
  io.events = [];
  io.scores = [];
  io.loadProfile = () => profile;
  io.reportEvent = (who, eventId, data, key) => {
    io.events.push({ userId: who.userId, eventId, data, key });
    return replies.event?.() ?? { granted: null };
  };
  io.submitScore = (who, boardId, value) => {
    io.scores.push({ userId: who.userId, boardId, value });
    return replies.score?.() ?? { accepted: true };
  };
  return io;
}

const summonChampion = { type: 'summonRelic', sprotoId: 'sp_champion' };

describe('summonRelic online', () => {
  it('is a valid intent', () => {
    expect(IntentSchema.safeParse(summonChampion).success).toBe(true);
    expect(IntentSchema.safeParse({ ...summonChampion, extra: 1 }).success).toBe(false);
  });

  it('summons a relic Sproto the hub profile owns, and sends the relics in WELCOME', () => {
    const w = testWorld({ io: hubIO({ relics: ['tidebreaker_belt'], effects: { speed: 1 } }) });
    w.join('a');
    const welcome = w.peek('a', OP.WELCOME)[0]!;
    expect(welcome.body.hub).toEqual({ relics: ['tidebreaker_belt'], effects: { speed: 1 } });
    w.send('a', OP.INTENTS, { seq: 1, intents: [summonChampion] });
    w.ticks(1);
    expect(w.host.viewOf('a')!.player.sproto?.defId).toBe('sp_champion');
    expect(w.io.logs.some((l) => l.includes('strike a'))).toBe(false);
  });

  it('refuses a relic Sproto the hub profile does not own, without a strike', () => {
    const w = testWorld({ io: hubIO({ relics: [] }) });
    w.join('a');
    w.send('a', OP.INTENTS, { seq: 1, intents: [summonChampion] });
    w.ticks(1);
    expect(w.host.viewOf('a')!.player.sproto).toBeNull();
    expect(w.io.logs.some((l) => l.includes('strike a'))).toBe(false);
  });

  it('works with a shell that has no hub profile calls (nothing owned, no hub in WELCOME)', () => {
    const w = testWorld();
    w.join('a');
    expect(w.peek('a', OP.WELCOME)[0]!.body.hub).toBeUndefined();
    w.send('a', OP.INTENTS, { seq: 1, intents: [summonChampion] });
    w.ticks(1);
    expect(w.host.viewOf('a')!.player.sproto).toBeNull();
  });

  it('falls back to getRelics when the shell has no loadProfile', () => {
    const io = fakeIO();
    io.getRelics = () => ['tidebreaker_belt'];
    const w = testWorld({ io });
    w.join('a');
    expect(w.peek('a', OP.WELCOME)[0]!.body.hub).toEqual({
      relics: ['tidebreaker_belt'],
      effects: {},
    });
  });
});

describe('the tutorial relic event', () => {
  it('reports pb.quest_complete once, with a stable key, and saves it as acked', () => {
    const io = hubIO(null);
    const w = testWorld({ io });
    w.join('a');
    w.host.viewOf('a')!.player.quests.quest_tutorial = { done: [], complete: true, choices: [] };
    w.ticks(NET.ticketFlushEveryTicks);
    expect(io.events).toHaveLength(1);
    expect(io.events[0]).toMatchObject({ userId: 'a', eventId: RELIC_EVENT });
    expect(io.events[0]!.data.questId).toBe('quest_tutorial');
    expect(w.host.viewOf('a')!.player.ledger.relicAcked).toBe(true);
    w.ticks(NET.ticketFlushEveryTicks);
    expect(io.events).toHaveLength(1);
  });

  it('retries a failed report with the same key, and adds a granted relic', () => {
    let fail = true;
    const io = hubIO(null, {
      event: () => (fail ? { error: 'rpc_failed' } : { granted: 'genesis_shard' }),
    });
    const w = testWorld({ io });
    w.join('a');
    w.host.viewOf('a')!.player.quests.quest_tutorial = { done: [], complete: true, choices: [] };
    w.ticks(NET.ticketFlushEveryTicks);
    fail = false;
    w.take('a');
    w.ticks(NET.ticketFlushEveryTicks);
    expect(io.events).toHaveLength(2);
    expect(io.events[1]!.key).toBe(io.events[0]!.key);
    expect(w.host.viewOf('a')!.hubSession.relics).toContain('genesis_shard');
    expect(w.peek('a', OP.HUB_OUT).at(-1)?.body.relics).toContain('genesis_shard');
  });
});

describe('the XP leaderboard', () => {
  it('posts total XP on the save tick only when it grew, and on logout', () => {
    const io = hubIO(null);
    const w = testWorld({ io });
    w.join('a');
    w.host.viewOf('a')!.player.skills.mining = 1234.6;
    const total = () =>
      Math.floor(Object.values(w.host.viewOf('a')!.player.skills).reduce((a, b) => a + b, 0));
    w.ticks(NET.saveEveryTicks);
    expect(io.scores).toEqual([{ userId: 'a', boardId: XP_BOARD, value: total() }]);
    w.ticks(NET.saveEveryTicks);
    expect(io.scores).toHaveLength(1);
    w.host.viewOf('a')!.player.skills.mining += 50;
    w.leave('a');
    w.ticks(NET.logoutGraceTicks + 1);
    expect(io.scores).toHaveLength(2);
    expect(io.scores[1]!.value).toBeGreaterThan(io.scores[0]!.value);
  });

  it('keeps the last posted value when the hub refuses, so it posts again later', () => {
    let refuse = true;
    const io = hubIO(null, { score: () => (refuse ? { error: 'rate_limited' } : {}) });
    const w = testWorld({ io });
    w.join('a');
    w.host.viewOf('a')!.player.skills.mining = 500;
    w.ticks(NET.saveEveryTicks);
    expect(w.host.viewOf('a')!.player.ledger.submittedXp).toBe(0);
    refuse = false;
    w.ticks(NET.saveEveryTicks);
    expect(io.scores).toHaveLength(2);
    expect(w.host.viewOf('a')!.player.ledger.submittedXp).toBeGreaterThan(0);
  });
});

describe('wallet refresh (OP.WALLET)', () => {
  it('re-reads the balance from the hub, at most once per NET.walletRefreshMinTicks', () => {
    const w = testWorld();
    w.join('a');
    w.ticks(1);
    w.io.balances.set('a', 777);
    w.send('a', OP.WALLET, {});
    expect(w.host.viewOf('a')!.player.currencies.tickets).toBe(777);
    w.io.balances.set('a', 10);
    w.send('a', OP.WALLET, {});
    expect(w.host.viewOf('a')!.player.currencies.tickets).toBe(777);
    w.ticks(NET.walletRefreshMinTicks);
    w.send('a', OP.WALLET, {});
    expect(w.host.viewOf('a')!.player.currencies.tickets).toBe(10);
  });
});

describe('parseIntent fast path', () => {
  it('agrees with IntentSchema on walk intents, valid and not', async () => {
    const { parseIntent } = await import('../../src/net/protocol');
    const values: unknown[] = [
      0,
      1,
      1024,
      1025,
      -1,
      3.5,
      NaN,
      Infinity,
      '5',
      null,
      undefined,
      1e20,
    ];
    const cases: unknown[] = [
      null,
      [],
      'walk',
      { type: 'walk' },
      { type: 'walk', x: 1, y: 2, z: 3 },
    ];
    for (const x of values) for (const y of values) cases.push({ type: 'walk', x, y });
    cases.push(JSON.parse('{"type":"walk","x":1,"y":2,"__proto__":{"a":1}}'));
    cases.push({ type: 'toggleRun' }, { type: 'summon', slot: 2 }, { type: 'nope' });
    for (const c of cases) {
      const fast = parseIntent(c);
      const slow = IntentSchema.safeParse(c);
      expect(fast.success, JSON.stringify(c)).toBe(slow.success);
      if (fast.success && slow.success) expect(fast.data).toEqual(slow.data);
    }
  });
});
