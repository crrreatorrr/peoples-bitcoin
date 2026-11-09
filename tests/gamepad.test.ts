import { describe, expect, it } from 'vitest';
import { KEYS, PAD } from '../src/input/config';
import { ShiftTap } from '../src/input/keyboard';
import {
  BTN,
  cycleTarget,
  dpadStick,
  keyNav,
  menuDirection,
  nextFocus,
  PadTracker,
  radialDeadzone,
  rankTargets,
  RepeatTimer,
  stickToWorld,
  tileStep,
  type GamepadLike,
} from '../src/input/padlogic';

/** A fake standard-mapping pad: `held` button indices pressed, triggers by value. */
function pad(
  opts: {
    index?: number;
    id?: string;
    held?: number[];
    axes?: number[];
    lt?: number;
    rt?: number;
  } = {},
): GamepadLike {
  const held = new Set(opts.held ?? []);
  const buttons = Array.from({ length: 17 }, (_, i) => {
    if (i === BTN.LT) return { pressed: (opts.lt ?? 0) > 0.1, value: opts.lt ?? 0 };
    if (i === BTN.RT) return { pressed: (opts.rt ?? 0) > 0.1, value: opts.rt ?? 0 };
    return { pressed: held.has(i), value: held.has(i) ? 1 : 0 };
  });
  return {
    index: opts.index ?? 0,
    id: opts.id ?? 'Fake pad (STANDARD GAMEPAD)',
    connected: true,
    buttons,
    axes: opts.axes ?? [0, 0, 0, 0],
  };
}

const tracker = () => new PadTracker(PAD);

describe('radialDeadzone', () => {
  it('reads 0 inside the deadzone', () => {
    expect(radialDeadzone(0.1, 0.1, 0.2)).toEqual({ x: 0, y: 0 });
    expect(radialDeadzone(0.2, 0, 0.2)).toEqual({ x: 0, y: 0 });
  });

  it('starts smoothly from 0 at the edge and reaches 1 at full tilt', () => {
    expect(radialDeadzone(0.21, 0, 0.2).x).toBeCloseTo(0.0125, 4);
    expect(radialDeadzone(0.6, 0, 0.2).x).toBeCloseTo(0.5, 6);
    expect(radialDeadzone(1, 0, 0.2).x).toBeCloseTo(1, 6);
  });

  it('is radial: keeps the direction and caps the magnitude at 1', () => {
    const s = radialDeadzone(1, 1, 0.2);
    expect(Math.hypot(s.x, s.y)).toBeCloseTo(1, 6);
    expect(s.x).toBeCloseTo(s.y, 6);
    // A diagonal just outside the deadzone is not cut by a per-axis (square) deadzone.
    const d = radialDeadzone(0.15, 0.15, 0.2);
    expect(d.x).toBeGreaterThan(0);
  });

  it('ignores NaN', () => {
    expect(radialDeadzone(NaN, 0, 0.2)).toEqual({ x: 0, y: 0 });
  });
});

describe('PadTracker', () => {
  it('reports a press once, on the frame it goes down', () => {
    const t = tracker();
    t.update([pad()]);
    expect(t.update([pad({ held: [BTN.A] })]).pressed[BTN.A]).toBe(true);
    const held = t.update([pad({ held: [BTN.A] })]);
    expect(held.pressed[BTN.A]).toBe(false);
    expect(held.down[BTN.A]).toBe(true);
    expect(t.update([pad()]).down[BTN.A]).toBe(false);
  });

  it('latches buttons held when the pad appears until they are released', () => {
    const t = tracker();
    // The hub's A press that chose the portal is still down when the game first sees the pad.
    const first = t.update([pad({ held: [BTN.A, BTN.MENU] })]);
    expect(first.connected).toBe(true);
    expect(first.pressed[BTN.A]).toBe(false);
    expect(first.down[BTN.A]).toBe(false);
    expect(first.pressed[BTN.MENU]).toBe(false);
    expect(t.update([pad({ held: [BTN.A] })]).down[BTN.A]).toBe(false);
    // Released, then pressed again: that one counts.
    t.update([pad()]);
    expect(t.update([pad({ held: [BTN.A] })]).pressed[BTN.A]).toBe(true);
  });

  it('latches a held trigger too, so it neither presses nor zooms', () => {
    const t = tracker();
    const f = t.update([pad({ rt: 1 })]);
    expect(f.pressed[BTN.RT]).toBe(false);
    expect(f.rt).toBe(0);
    t.update([pad()]);
    const g = t.update([pad({ rt: 0.8 })]);
    expect(g.pressed[BTN.RT]).toBe(true);
    expect(g.rt).toBeCloseTo(0.8);
  });

  it('counts triggers as pressed only past the threshold', () => {
    const t = tracker();
    t.update([pad()]);
    expect(t.update([pad({ lt: 0.4 })]).down[BTN.LT]).toBe(false);
    expect(t.update([pad({ lt: 0.6 })]).down[BTN.LT]).toBe(true);
  });

  it('latches again after an unplug and replug (hot-plug)', () => {
    const t = tracker();
    t.update([pad()]);
    expect(t.update([]).connected).toBe(false);
    expect(t.update([null, undefined]).connected).toBe(false);
    expect(t.update([pad({ held: [BTN.B] })]).pressed[BTN.B]).toBe(false);
  });

  it('treats a different pad in the same slot as new', () => {
    const t = tracker();
    t.update([pad({ id: 'one' })]);
    expect(t.update([pad({ id: 'two', held: [BTN.X] })]).pressed[BTN.X]).toBe(false);
  });

  it('never reads Home / Guide (button 16)', () => {
    const t = tracker();
    t.update([pad()]);
    const f = t.update([pad({ held: [16] })]);
    expect(f.pressed.length).toBe(16);
    expect(f.active).toBe(false);
  });

  it('merges pads: buttons from either, each stick from the one pushed most', () => {
    const t = tracker();
    t.update([pad({ index: 0 }), pad({ index: 1, id: 'p2' })]);
    const f = t.update([
      pad({ index: 0, axes: [0.3, 0, 0, 0] }),
      pad({ index: 1, id: 'p2', held: [BTN.Y], axes: [0, -1, 0, 0] }),
    ]);
    expect(f.pressed[BTN.Y]).toBe(true);
    expect(f.left.y).toBeCloseTo(-1);
    expect(f.left.x).toBe(0);
  });

  it('applies the deadzones and marks the pad active only on real input', () => {
    const t = tracker();
    expect(t.update([pad({ axes: [0.1, 0.1, 0.1, 0] })]).active).toBe(false);
    const f = t.update([pad({ axes: [0, 0, 0.5, 0] })]);
    expect(f.right.x).toBeGreaterThan(0);
    expect(f.active).toBe(true);
  });
});

describe('menuDirection and RepeatTimer', () => {
  const frame = (held: number[], axes = [0, 0, 0, 0]) => {
    const t = tracker();
    t.update([pad()]);
    return t.update([pad({ held, axes })]);
  };

  it('takes the D-pad first, else the left stick past the threshold', () => {
    expect(menuDirection(frame([BTN.DOWN]), 0.5)).toBe('down');
    expect(menuDirection(frame([], [0.7, 0.2, 0, 0]), 0.5)).toBe('right');
    expect(menuDirection(frame([], [0.1, -0.6, 0, 0]), 0.5)).toBe('up');
    expect(menuDirection(frame([], [0.4, 0, 0, 0]), 0.5)).toBe(null);
  });

  it('turns the D-pad into an 8-way stick', () => {
    expect(dpadStick(frame([BTN.UP, BTN.RIGHT]))).toEqual({ x: 1, y: -1 });
  });

  it('repeats a held direction after the first delay, then faster', () => {
    const r = new RepeatTimer(350, 120);
    expect(r.update('down', 0)).toBe('down');
    expect(r.update('down', 200)).toBe(null);
    expect(r.update('down', 350)).toBe('down');
    expect(r.update('down', 400)).toBe(null);
    expect(r.update('down', 470)).toBe('down');
    expect(r.update(null, 500)).toBe(null);
    expect(r.update('up', 510)).toBe('up');
  });
});

describe('nextFocus (spatial navigation)', () => {
  // A 2×2 grid of slots and a wide button below.
  const boxes = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 20, y: 0, w: 10, h: 10 },
    { x: 0, y: 20, w: 10, h: 10 },
    { x: 20, y: 20, w: 10, h: 10 },
    { x: 0, y: 40, w: 30, h: 10 },
  ];

  it('moves in straight lines through a grid', () => {
    expect(nextFocus(boxes, 0, 'right')).toBe(1);
    expect(nextFocus(boxes, 1, 'down')).toBe(3);
    expect(nextFocus(boxes, 3, 'left')).toBe(2);
    expect(nextFocus(boxes, 2, 'up')).toBe(0);
    expect(nextFocus(boxes, 3, 'down')).toBe(4);
  });

  it('stays put at an edge and starts at the first box with no focus', () => {
    expect(nextFocus(boxes, 0, 'up')).toBe(-1);
    expect(nextFocus(boxes, -1, 'down')).toBe(0);
    expect(nextFocus([], -1, 'down')).toBe(-1);
  });
});

describe('keyNav (keyboard menus)', () => {
  it('moves with the arrow keys and confirms with Enter or Space', () => {
    expect(keyNav('ArrowUp', false)).toBe('up');
    expect(keyNav('ArrowRight', false)).toBe('right');
    expect(keyNav('Enter', false)).toBe('confirm');
    expect(keyNav(' ', false)).toBe('confirm');
  });

  it('moves with W / A / S / D only in modal menus (letters type chat elsewhere)', () => {
    expect(keyNav('w', true)).toBe('up');
    expect(keyNav('S', true)).toBe('down');
    expect(keyNav('a', true)).toBe('left');
    expect(keyNav('d', true)).toBe('right');
    expect(keyNav('s', false)).toBe(null);
    expect(keyNav('x', true)).toBe(null);
    expect(keyNav('Escape', true)).toBe(null); // Esc keeps its own handlers
  });
});

describe('ShiftTap (tap Shift to toggle run)', () => {
  const max = KEYS.shiftTapMaxMs;

  it('fires on a quick press and release of Shift alone', () => {
    const t = new ShiftTap(max);
    t.down('Shift', false, false, 0);
    expect(t.up('Shift', 100)).toBe(true);
  });

  it('does not fire for Shift+letter, a shift-click, a long hold or while typing', () => {
    const t = new ShiftTap(max);
    t.down('Shift', false, false, 0);
    t.down('H', false, false, 10);
    expect(t.up('Shift', 50)).toBe(false);

    t.down('Shift', false, false, 100);
    t.cancel(); // pointerdown while held: shift-click drops an item
    expect(t.up('Shift', 150)).toBe(false);

    t.down('Shift', false, false, 200);
    t.down('Shift', true, false, 500); // auto-repeat keeps the original start
    expect(t.up('Shift', 200 + max + 1)).toBe(false);

    t.down('Shift', false, true, 1000);
    expect(t.up('Shift', 1050)).toBe(false);
  });

  it('ignores other keys being released', () => {
    const t = new ShiftTap(max);
    t.down('Shift', false, false, 0);
    expect(t.up('a', 10)).toBe(false);
    expect(t.up('Shift', 20)).toBe(true);
  });
});

describe('stick walking', () => {
  it('walks away from the camera on stick up, at any camera yaw', () => {
    // Yaw 0 looks north (toward −y): up is north.
    expect(tileStep(stickToWorld({ x: 0, y: -1 }, 0))).toEqual({ dx: 0, dy: -1 });
    // Turned half way round, up is south.
    expect(tileStep(stickToWorld({ x: 0, y: -1 }, Math.PI))).toEqual({ dx: 0, dy: 1 });
    // Stick right at yaw 0 is east.
    expect(tileStep(stickToWorld({ x: 1, y: 0 }, 0))).toEqual({ dx: 1, dy: 0 });
  });

  it('snaps to the 8 tile directions and gives nothing at rest', () => {
    expect(tileStep({ x: 0.7, y: 0.7 })).toEqual({ dx: 1, dy: 1 });
    expect(tileStep({ x: 0.9, y: 0.3 })).toEqual({ dx: 1, dy: 0 });
    expect(tileStep({ x: 0, y: 0 })).toBe(null);
  });
});

describe('soft targeting', () => {
  const from = { x: 10, y: 10 };
  const c = [
    { id: 'ahead', x: 10, y: 7 },
    { id: 'behind', x: 10, y: 12 },
    { id: 'far', x: 10, y: 30 },
  ];

  it('prefers what is ahead, nearest first, within range', () => {
    expect(rankTargets(c, from, { x: 0, y: -1 }, 10, 1)).toEqual(['ahead', 'behind']);
    // Facing the other way, the one behind is now ahead.
    expect(rankTargets(c, from, { x: 0, y: 1 }, 10, 1)).toEqual(['behind', 'ahead']);
    // No facing: plain distance.
    expect(rankTargets(c, from, null, 10, 1)).toEqual(['behind', 'ahead']);
  });

  it('cycles with wrap-around and starts at the first', () => {
    const order = ['a', 'b', 'c'];
    expect(cycleTarget(order, 'c', 1)).toBe('a');
    expect(cycleTarget(order, 'a', -1)).toBe('c');
    expect(cycleTarget(order, 'gone', 1)).toBe('a');
    expect(cycleTarget([], null, 1)).toBe(null);
  });
});
