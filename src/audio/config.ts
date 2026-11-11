/**
 * Sound tunables. They live here, not in `config/balance.ts`: sound is client-only, and
 * `src/config` feeds the sim version hash (see DECISIONS.md, "Sound effects").
 */
export const AUDIO = {
  /** Master volume on first run, 0..1. */
  defaultVolume: 0.5,
  /** One press of the Settings volume buttons. */
  volumeStep: 0.1,
  /** The same cue never plays twice within this many milliseconds. */
  minGapMs: 70,
  /** localStorage key for { volume, muted }. */
  storageKey: 'peoples-bitcoin.audio',
} as const;

export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';

/** One synthesised note: a pitch (optionally gliding to `to`), when it starts and how long it rings. */
export interface Note {
  wave: Wave;
  /** Hz at the start. */
  freq: number;
  /** Hz at the end, for a glide. */
  to?: number;
  /** Seconds after the cue starts. */
  at: number;
  /** Seconds. */
  dur: number;
  /** Peak gain before the master volume, 0..1. */
  gain: number;
}

export const CUES = {
  /** Your attack did damage. */
  hit: [{ wave: 'square', freq: 240, to: 120, at: 0, dur: 0.08, gain: 0.22 }],
  /** Your attack did 0. */
  miss: [{ wave: 'triangle', freq: 150, to: 110, at: 0, dur: 0.05, gain: 0.12 }],
  /** Something hurt you. */
  hurt: [{ wave: 'sawtooth', freq: 170, to: 85, at: 0, dur: 0.13, gain: 0.2 }],
  mine: [
    { wave: 'triangle', freq: 1250, to: 820, at: 0, dur: 0.05, gain: 0.2 },
    { wave: 'triangle', freq: 1800, to: 1500, at: 0.03, dur: 0.04, gain: 0.1 },
  ],
  purchase: [
    { wave: 'square', freq: 988, at: 0, dur: 0.07, gain: 0.14 },
    { wave: 'square', freq: 1319, at: 0.07, dur: 0.16, gain: 0.14 },
  ],
  levelUp: [
    { wave: 'square', freq: 523, at: 0, dur: 0.1, gain: 0.16 },
    { wave: 'square', freq: 659, at: 0.1, dur: 0.1, gain: 0.16 },
    { wave: 'square', freq: 784, at: 0.2, dur: 0.1, gain: 0.16 },
    { wave: 'square', freq: 1047, at: 0.3, dur: 0.28, gain: 0.16 },
  ],
  questComplete: [
    { wave: 'square', freq: 392, at: 0, dur: 0.12, gain: 0.16 },
    { wave: 'square', freq: 523, at: 0.12, dur: 0.12, gain: 0.16 },
    { wave: 'square', freq: 659, at: 0.24, dur: 0.12, gain: 0.16 },
    { wave: 'square', freq: 784, at: 0.36, dur: 0.12, gain: 0.16 },
    { wave: 'triangle', freq: 523, at: 0.48, dur: 0.5, gain: 0.14 },
    { wave: 'square', freq: 1047, at: 0.48, dur: 0.5, gain: 0.16 },
  ],
  death: [
    { wave: 'sawtooth', freq: 330, to: 82, at: 0, dur: 0.6, gain: 0.2 },
    { wave: 'triangle', freq: 165, to: 41, at: 0.1, dur: 0.6, gain: 0.16 },
  ],
} as const satisfies Record<string, readonly Note[]>;

export type CueId = keyof typeof CUES;
