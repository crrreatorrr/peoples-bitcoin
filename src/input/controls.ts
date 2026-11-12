/**
 * The player's key and button bindings and left-stick dead zone, live: loaded from localStorage
 * (every access wrapped, so a blocked store just means defaults), saved on each change, and
 * announced to listeners so the keyboard, the controller and the on-screen labels update at once.
 * The rules (swap on conflict, reserved keys, what a save may hold) are in ./bindings.ts.
 */
import {
  actionForKey,
  clampDeadzone,
  defaultSettings,
  parseSettings,
  rebindButton,
  rebindKey,
  serializeSettings,
  type ControlSettings,
  type KeyAction,
  type KeyMap,
  type PadAction,
  type PadMap,
  type RebindResult,
} from './bindings';
import { CONTROLS, PAD } from './config';

export type ControlsStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const RANGE = { min: CONTROLS.deadzoneMin, max: CONTROLS.deadzoneMax, step: CONTROLS.deadzoneStep };

export class Controls {
  private settings: ControlSettings;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: ControlsStore | null) {
    let raw: string | null;
    try {
      raw = store?.getItem(CONTROLS.storageKey) ?? null;
    } catch {
      raw = null;
    }
    this.settings = parseSettings(raw, PAD.leftDeadzone, RANGE);
  }

  get keys(): Readonly<KeyMap> {
    return this.settings.keys;
  }

  get pad(): Readonly<PadMap> {
    return this.settings.pad;
  }

  get leftDeadzone(): number {
    return this.settings.leftDeadzone;
  }

  keyOf(action: KeyAction): string | null {
    return this.settings.keys[action];
  }

  actionForKey(key: string): KeyAction | null {
    return actionForKey(this.settings.keys, key);
  }

  setKey(action: KeyAction, key: string): RebindResult<KeyMap> {
    const result = rebindKey(this.settings.keys, action, key);
    if (result.ok) this.update({ ...this.settings, keys: result.map });
    return result;
  }

  setButton(action: PadAction, button: number): RebindResult<PadMap> {
    const result = rebindButton(this.settings.pad, action, button);
    if (result.ok) this.update({ ...this.settings, pad: result.map });
    return result;
  }

  /** Moves the dead zone by `steps` steps (negative: smaller). */
  nudgeDeadzone(steps: number): void {
    const next = clampDeadzone(
      this.settings.leftDeadzone + steps * RANGE.step,
      RANGE,
      PAD.leftDeadzone,
    );
    if (next !== this.settings.leftDeadzone) this.update({ ...this.settings, leftDeadzone: next });
  }

  get deadzoneRange(): { min: number; max: number } {
    return { min: RANGE.min, max: RANGE.max };
  }

  reset(): void {
    this.update(defaultSettings(PAD.leftDeadzone));
  }

  /** Calls `fn` after every change; returns a function that stops it. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private update(next: ControlSettings): void {
    this.settings = next;
    try {
      this.store?.setItem(CONTROLS.storageKey, serializeSettings(next));
    } catch {
      // Not saved (private mode or a full store): it still applies for this visit.
    }
    for (const fn of this.listeners) fn();
  }
}

/** The page's localStorage, or null where the browser blocks it. */
export function controlsStore(): ControlsStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
