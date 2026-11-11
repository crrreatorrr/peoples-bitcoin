/**
 * Synthesised sound effects (Web Audio oscillators). No sound files: every cue is a few
 * notes from `CUES`, so there is nothing to load and nothing to license.
 *
 * Browsers keep audio suspended until the first click or key press; `unlock()` is called
 * from those, and cues before it are dropped silently.
 */
import { AUDIO, CUES, type CueId, type Note } from './config';

export interface AudioSettings {
  /** 0..1 */
  volume: number;
  muted: boolean;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function loadAudioSettings(storage: Store | null): AudioSettings {
  const fallback: AudioSettings = { volume: AUDIO.defaultVolume, muted: false };
  try {
    const raw = storage?.getItem(AUDIO.storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      volume:
        typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
          ? clamp01(parsed.volume)
          : fallback.volume,
      muted: parsed.muted === true,
    };
  } catch {
    return fallback;
  }
}

export function saveAudioSettings(storage: Store | null, settings: AudioSettings): void {
  try {
    storage?.setItem(AUDIO.storageKey, JSON.stringify(settings));
  } catch {
    // Storage blocked: the setting lasts for this visit.
  }
}

/** The little of AudioContext this module uses, so tests can pass a fake. */
export interface AudioLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
}

export class Sfx {
  private ctx: AudioLike | null = null;
  private master: GainNode | null = null;
  private readonly lastPlayed = new Map<CueId, number>();

  constructor(
    private settings: AudioSettings,
    private readonly storage: Store | null,
    /** Returns a new context, or null where Web Audio is missing. */
    private readonly makeContext: () => AudioLike | null,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  get volume(): number {
    return this.settings.volume;
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  /** Call from a click or key press: creates or resumes the audio context. */
  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = this.makeContext();
        if (!this.ctx) return;
        this.master = this.ctx.createGain();
        this.master.gain.value = this.level();
        this.master.connect(this.ctx.destination as AudioNode);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  setVolume(volume: number): void {
    this.settings = { ...this.settings, volume: Math.round(clamp01(volume) * 100) / 100 };
    this.apply();
  }

  setMuted(muted: boolean): void {
    this.settings = { ...this.settings, muted };
    this.apply();
  }

  /** Plays a cue now. Returns whether anything was scheduled. */
  play(cue: CueId): boolean {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || ctx.state !== 'running' || this.level() === 0) return false;
    const now = this.clock();
    if (now - (this.lastPlayed.get(cue) ?? -Infinity) < AUDIO.minGapMs) return false;
    this.lastPlayed.set(cue, now);
    try {
      for (const note of CUES[cue] as readonly Note[]) this.note(ctx, master, note);
    } catch {
      return false;
    }
    return true;
  }

  private note(ctx: AudioLike, master: GainNode, note: Note): void {
    const start = ctx.currentTime + note.at;
    const end = start + note.dur;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.wave;
    osc.frequency.setValueAtTime(note.freq, start);
    if (note.to) osc.frequency.exponentialRampToValueAtTime(note.to, end);
    // A fast attack and a fade to silence, so notes never click.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(note.gain, start + Math.min(0.01, note.dur / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  private level(): number {
    return this.settings.muted ? 0 : this.settings.volume;
  }

  private apply(): void {
    if (this.master) this.master.gain.value = this.level();
    saveAudioSettings(this.storage, this.settings);
  }
}

/** The browser's AudioContext, or null where there is none (old browsers, tests). */
export function browserAudioContext(): AudioLike | null {
  const w = globalThis as unknown as {
    AudioContext?: new () => AudioLike;
    webkitAudioContext?: new () => AudioLike;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}
