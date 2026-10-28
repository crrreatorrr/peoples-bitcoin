/**
 * Pointer input on the game canvas. Left click = default action; right click =
 * context menu; right/middle drag = rotate camera; wheel = zoom. A right press
 * becomes a drag only after moving a few pixels, so short right clicks still
 * open the menu.
 */
import { RENDER } from '../config/balance';

const LEFT = 0;
const MIDDLE = 1;
const RIGHT = 2;

export interface MouseHandlers {
  /** Called on every press. Return true to swallow it (e.g. it only closed a menu). */
  onPress(): boolean;
  onClick(x: number, y: number, event: PointerEvent): void;
  onContextMenu(x: number, y: number): void;
  onHover(x: number, y: number): void;
  onLeave(): void;
  onDrag(dx: number, dy: number): void;
  onWheel(deltaY: number): void;
}

interface Press {
  button: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  dragging: boolean;
  swallowed: boolean;
}

export function attachMouse(el: HTMLElement, h: MouseHandlers): void {
  let press: Press | null = null;

  el.addEventListener('pointerdown', (e) => {
    if (press) return;
    if (e.button === MIDDLE) e.preventDefault();
    press = {
      button: e.button,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      dragging: false,
      swallowed: h.onPress(),
    };
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener('pointermove', (e) => {
    const rotating = press && (press.button === MIDDLE || press.button === RIGHT);
    if (!press || !rotating) {
      h.onHover(e.clientX, e.clientY);
      return;
    }
    const moved = Math.hypot(e.clientX - press.startX, e.clientY - press.startY);
    if (!press.dragging && moved > RENDER.dragThresholdPx) press.dragging = true;
    if (press.dragging) h.onDrag(e.clientX - press.lastX, e.clientY - press.lastY);
    press.lastX = e.clientX;
    press.lastY = e.clientY;
  });

  el.addEventListener('pointerup', (e) => {
    if (!press || e.button !== press.button) return;
    const done = press;
    press = null;
    if (done.swallowed || done.dragging) return;
    if (done.button === LEFT) h.onClick(e.clientX, e.clientY, e);
    else if (done.button === RIGHT) h.onContextMenu(e.clientX, e.clientY);
  });

  el.addEventListener('pointercancel', () => (press = null));
  el.addEventListener('pointerleave', () => h.onLeave());
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      h.onWheel(e.deltaY);
    },
    { passive: false },
  );
}
