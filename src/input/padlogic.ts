/**
 * Pure gamepad and menu-navigation logic, no DOM: button indices of the W3C "standard" mapping,
 * stick deadzones, latch-on-connect and edge detection across hot-plugged pads, menu auto-repeat,
 * spatial focus navigation, the keys that drive the same focus, camera-relative stick walking and
 * soft-target ranking. src/input/gamepad.ts feeds it navigator.getGamepads() every frame; tests
 * feed it fake pads.
 */

/** Standard-mapping button indices (Xbox names; PlayStation and Switch work by position). */
export const BTN = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  MENU: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

/** Buttons read: 0–15. Home / Guide (16) belongs to the OS and the browser and is never bound. */
export const BUTTON_COUNT = 16;

export interface ButtonLike {
  readonly pressed: boolean;
  readonly value: number;
}

/** The parts of a browser `Gamepad` this logic reads. */
export interface GamepadLike {
  readonly index: number;
  readonly id: string;
  readonly connected: boolean;
  readonly buttons: readonly ButtonLike[];
  readonly axes: readonly number[];
}

export interface Stick {
  x: number;
  y: number;
}

export type Dir = 'up' | 'down' | 'left' | 'right';

/**
 * Radial deadzone: inside `deadzone` the stick reads 0; outside, the magnitude is rescaled so it
 * grows smoothly from 0 at the edge of the deadzone to 1 at full tilt (direction kept).
 */
export function radialDeadzone(x: number, y: number, deadzone: number): Stick {
  const mag = Math.hypot(x, y);
  if (!(mag > deadzone)) return { x: 0, y: 0 };
  const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  return { x: (x / mag) * scaled, y: (y / mag) * scaled };
}

/** Is button `index` down? Triggers (LT, RT) count past `triggerThreshold`. */
export function buttonDown(b: ButtonLike | undefined, index: number, triggerThreshold: number) {
  if (!b) return false;
  if (index === BTN.LT || index === BTN.RT) return b.value > triggerThreshold;
  return b.pressed;
}

export interface PadOptions {
  leftDeadzone: number;
  rightDeadzone: number;
  triggerThreshold: number;
}

export interface PadFrame {
  /** At least one pad is connected. */
  connected: boolean;
  /** Buttons held this frame, all pads merged, without latched ones. */
  down: boolean[];
  /** Buttons that went down this frame. */
  pressed: boolean[];
  /** Left stick before the deadzone (menus use a plain threshold). */
  leftRaw: Stick;
  /** Sticks after their radial deadzones. */
  left: Stick;
  right: Stick;
  /** Trigger values 0..1 (0 while latched). */
  lt: number;
  rt: number;
  /** Any press, stick push or trigger pull this frame: the pad is the last device used. */
  active: boolean;
}

interface PadSlot {
  id: string;
  /** Held when the pad appeared, and not released since: ignored. */
  latched: boolean[];
  /** Effective (unlatched) state last frame, for edges. */
  prev: boolean[];
}

const bigger = (a: Stick, b: Stick) => (Math.hypot(b.x, b.y) > Math.hypot(a.x, a.y) ? b : a);

/**
 * Tracks every connected pad. A pad that appears (page load, hub-to-game travel, reconnect, or a
 * different pad in the same slot) latches the buttons already held: they are ignored until
 * released, so the A that confirmed a hub portal doesn't also confirm something here. All pads
 * drive the one player: buttons are merged, and each stick reads from the pad pushing it most.
 */
export class PadTracker {
  private readonly slots = new Map<number, PadSlot>();

  constructor(private readonly opts: PadOptions) {}

  update(pads: readonly (GamepadLike | null | undefined)[]): PadFrame {
    const frame: PadFrame = {
      connected: false,
      down: new Array<boolean>(BUTTON_COUNT).fill(false),
      pressed: new Array<boolean>(BUTTON_COUNT).fill(false),
      leftRaw: { x: 0, y: 0 },
      left: { x: 0, y: 0 },
      right: { x: 0, y: 0 },
      lt: 0,
      rt: 0,
      active: false,
    };
    const seen = new Set<number>();
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      seen.add(pad.index);
      frame.connected = true;
      const raw = Array.from({ length: BUTTON_COUNT }, (_, i) =>
        buttonDown(pad.buttons[i], i, this.opts.triggerThreshold),
      );
      let slot = this.slots.get(pad.index);
      if (!slot || slot.id !== pad.id) {
        slot = {
          id: pad.id,
          latched: [...raw],
          prev: new Array<boolean>(BUTTON_COUNT).fill(false),
        };
        this.slots.set(pad.index, slot);
      }
      for (let i = 0; i < BUTTON_COUNT; i++) {
        slot.latched[i] = slot.latched[i] && raw[i];
        const down = raw[i] && !slot.latched[i];
        if (down) frame.down[i] = true;
        if (down && !slot.prev[i]) frame.pressed[i] = true;
        slot.prev[i] = down;
      }
      const axis = (i: number) => {
        const v = pad.axes[i];
        return typeof v === 'number' && Number.isFinite(v) ? v : 0;
      };
      const lx = axis(0);
      const ly = axis(1);
      frame.leftRaw = bigger(frame.leftRaw, { x: lx, y: ly });
      frame.left = bigger(frame.left, radialDeadzone(lx, ly, this.opts.leftDeadzone));
      frame.right = bigger(frame.right, radialDeadzone(axis(2), axis(3), this.opts.rightDeadzone));
      const trigger = (i: number) => (slot.latched[i] ? 0 : (pad.buttons[i]?.value ?? 0));
      frame.lt = Math.max(frame.lt, trigger(BTN.LT));
      frame.rt = Math.max(frame.rt, trigger(BTN.RT));
    }
    for (const index of [...this.slots.keys()]) if (!seen.has(index)) this.slots.delete(index);
    frame.active =
      frame.pressed.some(Boolean) ||
      frame.left.x !== 0 ||
      frame.left.y !== 0 ||
      frame.right.x !== 0 ||
      frame.right.y !== 0 ||
      frame.lt > this.opts.triggerThreshold ||
      frame.rt > this.opts.triggerThreshold;
    return frame;
  }
}

/** The direction a menu should move: the D-pad first, else the left stick past `threshold`. */
export function menuDirection(frame: PadFrame, threshold: number): Dir | null {
  if (frame.down[BTN.UP]) return 'up';
  if (frame.down[BTN.DOWN]) return 'down';
  if (frame.down[BTN.LEFT]) return 'left';
  if (frame.down[BTN.RIGHT]) return 'right';
  const { x, y } = frame.leftRaw;
  if (Math.abs(x) >= Math.abs(y)) {
    if (x >= threshold) return 'right';
    if (x <= -threshold) return 'left';
  } else {
    if (y >= threshold) return 'down';
    if (y <= -threshold) return 'up';
  }
  return null;
}

/** What a key does while a menu, window or "Select an Option" has the focus ring. */
export type NavKey = Dir | 'confirm';

/**
 * Keyboard menu navigation: the arrow keys move the focus, Enter and Space confirm. W / A / S / D
 * move it too, but only in `modal` menus (the right-click menu, quick-chat, world select, "Select
 * an Option"): with a window open, letters still start a chat message, as everywhere else.
 */
export function keyNav(key: string, modal: boolean): NavKey | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Enter':
    case ' ':
      return 'confirm';
  }
  if (!modal) return null;
  switch (key.toLowerCase()) {
    case 'w':
      return 'up';
    case 's':
      return 'down';
    case 'a':
      return 'left';
    case 'd':
      return 'right';
  }
  return null;
}

/** The D-pad as a stick (8 directions), for walking. */
export function dpadStick(frame: PadFrame): Stick {
  const x = Number(frame.down[BTN.RIGHT]) - Number(frame.down[BTN.LEFT]);
  const y = Number(frame.down[BTN.DOWN]) - Number(frame.down[BTN.UP]);
  return { x, y };
}

/**
 * Key-repeat for a held menu direction: fires on the press, again after `firstMs`, then every
 * `repeatMs`. A new direction starts over.
 */
export class RepeatTimer {
  private dir: Dir | null = null;
  private next = 0;

  constructor(
    private readonly firstMs: number,
    private readonly repeatMs: number,
  ) {}

  update(dir: Dir | null, now: number): Dir | null {
    if (dir !== this.dir) {
      this.dir = dir;
      this.next = now + this.firstMs;
      return dir;
    }
    if (dir && now >= this.next) {
      this.next = now + this.repeatMs;
      return dir;
    }
    return null;
  }
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Spatial navigation: the box to move to from `boxes[from]` in direction `dir`, or -1 if there
 * is none that way. Candidates must lie past the current box's centre in that direction; the
 * nearest wins, with sideways distance counting double (and none at all while the two boxes
 * overlap sideways, so grids and lists move in straight lines).
 */
export function nextFocus(boxes: readonly Box[], from: number, dir: Dir): number {
  const cur = boxes[from];
  if (!cur) return boxes.length > 0 ? 0 : -1;
  const cx = cur.x + cur.w / 2;
  const cy = cur.y + cur.h / 2;
  const horizontal = dir === 'left' || dir === 'right';
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  let best = -1;
  let bestScore = Infinity;
  boxes.forEach((b, i) => {
    if (i === from) return;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const primary = (horizontal ? bx - cx : by - cy) * sign;
    if (primary <= 1) return;
    const overlap = horizontal
      ? b.y < cur.y + cur.h && cur.y < b.y + b.h
      : b.x < cur.x + cur.w && cur.x < b.x + b.w;
    const side = overlap ? 0 : Math.abs(horizontal ? by - cy : bx - cx);
    const score = primary + 2 * side;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** The box whose centre is nearest to `point`, or -1 for none. */
export function nearestBox(boxes: readonly Box[], point: { x: number; y: number }): number {
  let best = -1;
  let bestDist = Infinity;
  boxes.forEach((b, i) => {
    const d = Math.hypot(b.x + b.w / 2 - point.x, b.y + b.h / 2 - point.y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/**
 * Camera-relative stick direction to a world direction on the tile grid. `yaw` is the orbit
 * camera's (0 = looking north, toward −y); stick up walks away from the camera. World x is tile
 * x and world z is tile y.
 */
export function stickToWorld(stick: Stick, yaw: number): Stick {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: stick.x * c + stick.y * s, y: -stick.x * s + stick.y * c };
}

/** A world direction snapped to one of the 8 tile steps, or null for no direction. */
export function tileStep(dir: Stick): { dx: number; dy: number } | null {
  if (dir.x === 0 && dir.y === 0) return null;
  const octant = Math.round(Math.atan2(dir.y, dir.x) / (Math.PI / 4));
  const angle = (octant * Math.PI) / 4;
  return { dx: Math.round(Math.cos(angle)), dy: Math.round(Math.sin(angle)) };
}

export interface TargetCandidate {
  id: string;
  x: number;
  y: number;
}

/**
 * Soft-target order: candidates within `range` tiles of `from`, nearest first, where a target
 * away from `facing` counts as farther (up to (1 + facingWeight) times, straight behind). Ties
 * go by id so the order is stable.
 */
export function rankTargets(
  candidates: readonly TargetCandidate[],
  from: { x: number; y: number },
  facing: Stick | null,
  range: number,
  facingWeight: number,
): string[] {
  const fLen = facing ? Math.hypot(facing.x, facing.y) : 0;
  const scored: { id: string; score: number }[] = [];
  for (const c of candidates) {
    const dx = c.x - from.x;
    const dy = c.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist > range) continue;
    let score = dist;
    if (facing && fLen > 0 && dist > 0) {
      const cos = (dx * facing.x + dy * facing.y) / (dist * fLen);
      score *= 1 + (facingWeight * (1 - cos)) / 2;
    }
    scored.push({ id: c.id, score });
  }
  scored.sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return scored.map((s) => s.id);
}

/** The id `step` places after `current` in `order`, wrapping; the first one if `current` is absent. */
export function cycleTarget(order: readonly string[], current: string | null, step: number) {
  if (order.length === 0) return null;
  const at = current === null ? -1 : order.indexOf(current);
  if (at < 0) return order[0];
  return order[(((at + step) % order.length) + order.length) % order.length];
}
