import { describe, expect, it } from 'vitest';
import { AUDIO, CUES, type CueId } from '../src/audio/config';
import { cuesFor } from '../src/audio/cues';
import { loadAudioSettings, Sfx, type AudioLike } from '../src/audio/sfx';
import type { SimEvent } from '../src/sim/state';

function memoryStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

/** A stand-in AudioContext that counts what was scheduled. */
function fakeContext(state = 'running') {
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
  });
  const made = { oscillators: 0, started: 0, gains: [] as { gain: { value: number } }[] };
  const ctx = {
    currentTime: 0,
    state,
    destination: {},
    resume: () => {
      ctx.state = 'running';
      return Promise.resolve();
    },
    createOscillator: () => {
      made.oscillators++;
      return {
        type: 'sine',
        frequency: param(),
        connect() {},
        start: () => void made.started++,
        stop() {},
      };
    },
    createGain: () => {
      const node = { gain: param(), connect() {} };
      made.gains.push(node);
      return node;
    },
  };
  return { ctx: ctx as unknown as AudioLike & { state: string }, made };
}

describe('sound cues from sim events', () => {
  const attack: SimEvent = { type: 'attack', attackerId: 'player', targetId: 'e1', style: 'gun' };

  it("maps the player's hits, misses and wounds", () => {
    expect(cuesFor([attack, { type: 'hitsplat', targetId: 'e1', damage: 3 }])).toEqual(['hit']);
    expect(cuesFor([attack, { type: 'hitsplat', targetId: 'e1', damage: 0 }])).toEqual(['miss']);
    expect(cuesFor([{ type: 'hitsplat', targetId: 'player', damage: 2 }])).toEqual(['hurt']);
    expect(cuesFor([{ type: 'hitsplat', targetId: 'player', damage: 0 }])).toEqual([]);
  });

  it("stays quiet for other players' and Sprotos' fights", () => {
    expect(
      cuesFor([
        { type: 'attack', attackerId: 'p:someone', targetId: 'e2', style: 'melee' },
        { type: 'hitsplat', targetId: 'e2', damage: 5 },
        { type: 'attack', attackerId: 'sproto', targetId: 'e3', style: 'gun' },
        { type: 'hitsplat', targetId: 'e3', damage: 1 },
        { type: 'death', entityId: 'e2' },
      ]),
    ).toEqual([]);
  });

  it('maps level-ups, quests, mining, shopping and death, once each per tick', () => {
    const cues = cuesFor([
      { type: 'xp', skillId: 'mining', amount: 10 },
      { type: 'xp', skillId: 'mining', amount: 10 },
      { type: 'xp', skillId: 'spin', amount: 10 },
      { type: 'levelUp', skillId: 'mining', level: 2 },
      { type: 'questComplete', questId: 'quest_tutorial', tick: 1 },
      { type: 'message', kind: 'game', text: 'You buy 1 × Campaign Pistol for 2 Tickets.' },
      { type: 'message', kind: 'game', text: 'You sell 1 × Scrap Hash for 0.28 Tickets.' },
      { type: 'message', kind: 'game', text: 'Not enough Tickets.' },
      { type: 'death', entityId: 'player' },
    ]);
    expect(cues).toEqual(['mine', 'levelUp', 'questComplete', 'purchase', 'death']);
  });

  it('every cue is a short, quiet set of notes', () => {
    for (const [id, notes] of Object.entries(CUES)) {
      expect(notes.length, id).toBeGreaterThan(0);
      for (const n of notes) {
        expect(n.gain).toBeLessThanOrEqual(0.25);
        expect(n.at + n.dur).toBeLessThanOrEqual(1.2);
        expect(n.freq).toBeGreaterThan(20);
      }
    }
  });
});

describe('Sfx', () => {
  it('is silent until unlocked, then schedules one oscillator per note', () => {
    const { ctx, made } = fakeContext();
    const sfx = new Sfx({ volume: 0.5, muted: false }, null, () => ctx);
    expect(sfx.play('hit')).toBe(false);
    sfx.unlock();
    expect(sfx.play('levelUp')).toBe(true);
    expect(made.oscillators).toBe(CUES.levelUp.length);
    expect(made.started).toBe(CUES.levelUp.length);
  });

  it('resumes a suspended context on unlock and drops cues while it is suspended', () => {
    const { ctx } = fakeContext('suspended');
    let resumed = 0;
    const real = ctx.resume.bind(ctx);
    ctx.resume = () => {
      resumed++;
      return real();
    };
    const sfx = new Sfx({ volume: 0.5, muted: false }, null, () => ctx);
    sfx.unlock();
    expect(resumed).toBe(1);
    expect(sfx.play('hit')).toBe(true);
  });

  it('does not repeat one cue inside the minimum gap', () => {
    const { ctx } = fakeContext();
    let now = 1000;
    const sfx = new Sfx(
      { volume: 0.5, muted: false },
      null,
      () => ctx,
      () => now,
    );
    sfx.unlock();
    expect(sfx.play('hit')).toBe(true);
    expect(sfx.play('hit')).toBe(false);
    expect(sfx.play('miss')).toBe(true);
    now += AUDIO.minGapMs;
    expect(sfx.play('hit')).toBe(true);
  });

  it('mute and volume are applied, clamped and remembered', () => {
    const store = memoryStore();
    const { ctx, made } = fakeContext();
    const sfx = new Sfx(loadAudioSettings(store), store, () => ctx);
    expect(sfx.volume).toBe(AUDIO.defaultVolume);
    expect(sfx.muted).toBe(false);
    sfx.unlock();
    const master = made.gains[0];
    expect(master.gain.value).toBe(AUDIO.defaultVolume);
    sfx.setMuted(true);
    expect(master.gain.value).toBe(0);
    expect(sfx.play('hit')).toBe(false);
    sfx.setMuted(false);
    sfx.setVolume(7);
    expect(sfx.volume).toBe(1);
    sfx.setVolume(-1);
    expect(sfx.volume).toBe(0);
    expect(sfx.play('hit')).toBe(false);
    sfx.setVolume(0.3);
    expect(loadAudioSettings(store)).toEqual({ volume: 0.3, muted: false });
  });

  it('works without Web Audio and with broken storage', () => {
    const sfx = new Sfx({ volume: 0.5, muted: false }, null, () => null);
    sfx.unlock();
    expect(sfx.play('death' satisfies CueId)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadAudioSettings(broken)).toEqual({ volume: AUDIO.defaultVolume, muted: false });
    expect(() =>
      new Sfx(loadAudioSettings(broken), broken, () => null).setVolume(0.2),
    ).not.toThrow();
    expect(loadAudioSettings({ getItem: () => '{"volume":"loud"}', setItem() {} })).toEqual({
      volume: AUDIO.defaultVolume,
      muted: false,
    });
  });
});
