import { KEYS } from './config';

/** Arrow keys rotate (left/right) and tilt (up/down) the camera. */
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export class Keyboard {
  private readonly held = new Set<string>();
  private readonly shiftTap = new ShiftTap(KEYS.shiftTapMaxMs);

  /** `onShiftTap`: Shift pressed and released on its own (toggles run). */
  constructor(onShiftTap: () => void) {
    window.addEventListener('keydown', (e) => {
      this.shiftTap.down(e.key, e.repeat, isTyping(e.target, true), performance.now());
      if (!ARROWS.has(e.key) || isTyping(e.target)) return;
      this.held.add(e.key);
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.held.delete(e.key);
      if (this.shiftTap.up(e.key, performance.now())) onShiftTap();
    });
    // A click while Shift is held is a shift-click (drop), not a tap.
    window.addEventListener('pointerdown', () => this.shiftTap.cancel(), { capture: true });
    window.addEventListener('blur', () => {
      this.held.clear();
      this.shiftTap.cancel();
    });
  }

  /** Each axis is -1, 0 or 1. */
  cameraAxes(): { yaw: number; pitch: number } {
    const axis = (pos: string, neg: string) =>
      Number(this.held.has(pos)) - Number(this.held.has(neg));
    // Left turns the view left (the camera orbits clockwise seen from above), as in OSRS.
    return { yaw: axis('ArrowRight', 'ArrowLeft'), pitch: axis('ArrowUp', 'ArrowDown') };
  }
}

/**
 * Shift on its own: pressed and released within `maxMs`, with no other key or click in between
 * (Shift+letter is a capital, shift-click drops) and not while typing in a text field.
 */
export class ShiftTap {
  private since: number | null = null;

  constructor(private readonly maxMs: number) {}

  down(key: string, repeat: boolean, typing: boolean, now: number): void {
    if (key !== 'Shift') this.since = null;
    else if (!repeat) this.since = typing ? null : now;
  }

  /** True when this release completes a tap. */
  up(key: string, now: number): boolean {
    if (key !== 'Shift') return false;
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
 * `anyField`: count the chat line too (Shift there is for typing).
 */
function isTyping(target: EventTarget | null, anyField = false): boolean {
  if (!anyField && target instanceof HTMLInputElement && target.classList.contains('chat-input'))
    return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
