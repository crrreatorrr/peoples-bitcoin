import { isTapKey, normalizeKey, type KeyAction } from './bindings';
import { KEYS } from './config';

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const CAMERA: readonly KeyAction[] = ['cameraLeft', 'cameraRight', 'cameraUp', 'cameraDown'];

export interface KeyboardOptions {
  /** The key bound to an action (Controller settings), read on every press. */
  keyOf(action: KeyAction): string | null;
  /** False while a menu covers the game: camera and run keys do nothing then. */
  active(): boolean;
}

/** Camera keys (arrows by default) rotate and tilt the camera; the run key toggles run. */
export class Keyboard {
  private readonly held = new Set<string>();
  private readonly shiftTap = new ShiftTap(KEYS.shiftTapMaxMs);

  /** `onRunKey`: the run key tapped (a modifier on its own) or pressed (any other key). */
  constructor(
    onRunKey: () => void,
    private readonly opts: KeyboardOptions = { keyOf: defaultKeyOf, active: () => true },
  ) {
    window.addEventListener('keydown', (e) => {
      const key = normalizeKey(e.key);
      const run = opts.keyOf('run');
      if (isTapKey(run)) {
        this.shiftTap.key = run!;
        this.shiftTap.down(key, e.repeat, isTyping(e.target, true), performance.now());
      } else {
        this.shiftTap.cancel();
        if (key === run && !e.repeat && !isTyping(e.target, true) && opts.active()) {
          e.preventDefault();
          onRunKey();
          return;
        }
      }
      if (!this.isCameraKey(key) || isTyping(e.target, !ARROWS.has(key))) return;
      if (!opts.active()) return;
      this.held.add(key);
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.held.delete(normalizeKey(e.key));
      if (this.shiftTap.up(e.key, performance.now()) && opts.active()) onRunKey();
    });
    // A click while Shift is held is a shift-click (drop), not a tap.
    window.addEventListener('pointerdown', () => this.shiftTap.cancel(), { capture: true });
    window.addEventListener('blur', () => this.release());
  }

  private isCameraKey(key: string): boolean {
    return CAMERA.some((a) => this.opts.keyOf(a) === key);
  }

  /** Forget every held key (focus left the game, or a window took the keyboard). */
  release(): void {
    this.held.clear();
    this.shiftTap.cancel();
  }

  /** Each axis is -1, 0 or 1. */
  cameraAxes(): { yaw: number; pitch: number } {
    if (!this.opts.active()) return { yaw: 0, pitch: 0 };
    const on = (a: KeyAction) => {
      const k = this.opts.keyOf(a);
      return Number(k !== null && this.held.has(k));
    };
    // Left turns the view left (the camera orbits clockwise seen from above), as in OSRS.
    return {
      yaw: on('cameraRight') - on('cameraLeft'),
      pitch: on('cameraUp') - on('cameraDown'),
    };
  }
}

function defaultKeyOf(action: KeyAction): string | null {
  const keys: Partial<Record<KeyAction, string>> = {
    cameraLeft: 'ArrowLeft',
    cameraRight: 'ArrowRight',
    cameraUp: 'ArrowUp',
    cameraDown: 'ArrowDown',
    run: 'Shift',
  };
  return keys[action] ?? null;
}

/**
 * A modifier on its own (Shift by default): pressed and released within `maxMs`, with no other
 * key or click in between (Shift+letter is a capital, shift-click drops) and not while typing in
 * a text field.
 */
export class ShiftTap {
  private since: number | null = null;

  constructor(
    private readonly maxMs: number,
    public key = 'Shift',
  ) {}

  down(key: string, repeat: boolean, typing: boolean, now: number): void {
    if (key !== this.key) this.since = null;
    else if (!repeat) this.since = typing ? null : now;
  }

  /** True when this release completes a tap. */
  up(key: string, now: number): boolean {
    if (key !== this.key) return false;
    const since = this.since;
    this.since = null;
    return since !== null && now - since <= this.maxMs;
  }

  cancel(): void {
    this.since = null;
  }
}

/**
 * Arrows still turn the camera from the chat line, as in OSRS; other fields keep them.
 * `anyField`: count the chat line too (letters and Shift there are for typing).
 */
function isTyping(target: EventTarget | null, anyField = false): boolean {
  if (!anyField && target instanceof HTMLInputElement && target.classList.contains('chat-input'))
    return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
