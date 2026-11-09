import { afterEach, describe, expect, it, vi } from 'vitest';
import { AWAKENING, CHAT_NET } from '../../src/config/balance';
import script from '../../src/data/awakening.json';
import { ACTS, actAt, AwakeningDirector, awakeningNames } from '../../src/net/awakening';
import { LoopbackTransport } from '../../src/net/loopbackTransport';
import { OP } from '../../src/net/protocol';
import { checkText, reservedName } from '../../src/server/chatfilter';
import { buildGrids, isWalkable } from '../../src/sim/grid';
import { content } from '../helpers';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `bot${i + 1}`);
const end = AWAKENING.actStartTicks[AWAKENING.actStartTicks.length - 1];

function allLines(): string[] {
  const lines: string[] = [];
  for (const c of script.characters)
    lines.push(...c.loop, ...c.reverie, ...c.maze, ...c.behind, ...c.awake);
  for (const pool of Object.values(script.shared)) lines.push(...pool);
  for (const s of script.scenes) lines.push(...s.lines.map((l) => l.text));
  return lines.map((t) => t.replaceAll('{uid}', 'bot99'));
}

afterEach(() => vi.restoreAllMocks());

describe('awakening script', () => {
  it('every line fits public chat and passes the server filter', () => {
    const lines = allLines();
    expect(lines.length).toBeGreaterThan(200);
    for (const text of lines) {
      expect(text.length, text).toBeLessThanOrEqual(CHAT_NET.maxLength);
      expect(checkText(text).ok, text).toBe(true);
    }
  });

  it('bot names are usable nameplates, numbered past one round', () => {
    const names = awakeningNames(20);
    expect(names[0]).toBe(script.characters[0].name);
    expect(new Set(names).size).toBe(20);
    for (const n of names) {
      expect(n.length).toBeLessThanOrEqual(12);
      expect(reservedName(n), n).toBe(false);
    }
  });

  it('routes, the gate and the gathering circle are walkable Treasury tiles', () => {
    const grid = buildGrids(content()).get('zone_treasury')!;
    const tiles = [
      ...script.characters.flatMap((c) => c.route),
      ...script.gate,
      ...Array.from({ length: 16 }, (_, i) => {
        const p = new AwakeningDirector(ids(16)).circleSpot(i);
        return [p.x, p.y];
      }),
    ];
    for (const [x, y] of tiles) expect(isWalkable(grid, x, y), `${x},${y}`).toBe(true);
  });

  it('scene speakers are characters', () => {
    const chars = new Set(script.characters.map((c) => c.id));
    for (const s of script.scenes) {
      expect(ACTS).toContain(s.act);
      for (const l of s.lines) expect(l.who === '*' || chars.has(l.who), l.who).toBe(true);
    }
  });
});

describe('awakening director', () => {
  it('acts follow the configured start ticks', () => {
    expect(actAt(0)).toBe('loop');
    AWAKENING.actStartTicks.forEach((t, i) => expect(actAt(t)).toBe(ACTS[i]));
  });

  it('in the loop act a bot repeats its own lines, in order, and walks its route', () => {
    const d = new AwakeningDirector(ids(8));
    const said: string[] = [];
    const walked: string[] = [];
    // HollisMines wakes early; RanchRue (index 2) has no lead.
    for (let t = 0; t < 140; t++) {
      const a = d.step()[2];
      if (a.say) said.push(a.say);
      if (a.walk) walked.push(`${a.walk.x},${a.walk.y}`);
    }
    const loop = script.characters[2].loop;
    expect(said.length).toBeGreaterThan(3);
    said.forEach((line, k) => expect(line).toBe(loop[(2 + k) % loop.length]));
    const route = script.characters[2].route.map(([x, y]) => `${x},${y}`);
    for (const w of walked) expect(route).toContain(w);
  });

  it('plays every scene once, in story order, and each bot ends free', () => {
    const d = new AwakeningDirector(ids(8));
    const said: string[] = [];
    for (let t = 0; t < end + 200; t++) for (const a of d.step()) if (a.say) said.push(a.say);
    let from = 0;
    for (const s of script.scenes) {
      const first = s.lines[0].text.replaceAll('{uid}', 'bot7');
      const at = said.indexOf(first, from);
      expect(at, s.id).toBeGreaterThanOrEqual(from);
      from = at;
    }
    expect(said.filter((l) => l === 'The Hash remembers. And so do we.')).toHaveLength(8);
    for (let i = 0; i < 8; i++) expect(d.actOf(i)).toBe('free');
  });

  it('pace speeds the story up and act skips ahead', () => {
    const fast = new AwakeningDirector(ids(3), { pace: 10 });
    for (let t = 0; t < 40; t++) fast.step();
    expect(fast.storyTick()).toBe(400);
    expect(new AwakeningDirector(ids(3), { startAct: 5 }).actOf(2)).toBe('awake');
  });

  it('is deterministic for a seed', () => {
    const run = () => {
      const d = new AwakeningDirector(ids(5), { seed: 7, pace: 5 });
      return Array.from({ length: 300 }, () => JSON.stringify(d.step()));
    };
    expect(run()).toEqual(run());
  });
});

describe('awakening on the loopback', () => {
  it('bots chat in public under their names without tripping the chat limits', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const transport = new LoopbackTransport({
      content: content(),
      bots: 8,
      awaken: { pace: 4, seed: 1 },
      autoLoop: false,
    });
    const from = new Set<string>();
    let lines = 0;
    transport.onMessage((op, text) => {
      if (op !== OP.CHAT_OUT) return;
      const msg = JSON.parse(text) as { ch: string; from?: string };
      if (msg.ch === 'public' && msg.from) {
        from.add(msg.from);
        lines++;
      }
    });
    await transport.join();
    // The whole arc at pace 4, in host loops (3 per tick).
    for (let i = 0; i < ((end + 100) / 4) * 3; i++) transport.pump();
    await transport.leave();
    expect(lines).toBeGreaterThan(40);
    expect([...from].sort()).toEqual(awakeningNames(8).sort());
    expect(warn.mock.calls.flat().join('\n')).not.toMatch(/strike/);
  });
});
