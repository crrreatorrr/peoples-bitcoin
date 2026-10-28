/**
 * Pointer input on the game canvas, OSRS-style: a left press does the default
 * action and a right press opens the menu at once (on press, not release);
 * middle-drag rotates the camera; the wheel zooms, and a sideways trackpad
 * swipe rotates (for laptops without a middle button).
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
  onWheel(deltaX: number, deltaY: number): void;
}

interface Drag {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  dragging: boolean;
}

export function attachMouse(el: HTMLElement, h: MouseHandlers): void {
  let drag: Drag | null = null;

  el.addEventListener('pointerdown', (e) => {
    // The canvas closes open menus itself (onPress); keep the document's
    // "press outside closes the menu" handler from closing one just opened.
    e.stopPropagation();
    if (e.button === MIDDLE) {
      e.preventDefault();
      drag = {
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        dragging: false,
      };
      el.setPointerCapture(e.pointerId);
      return;
    }
    if (h.onPress()) return;
    if (e.button === LEFT) h.onClick(e.clientX, e.clientY, e);
    else if (e.button === RIGHT) h.onContextMenu(e.clientX, e.clientY);
  });

  el.addEventListener('pointermove', (e) => {
    if (!drag) {
      h.onHover(e.clientX, e.clientY);
      return;
    }
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (!drag.dragging && moved > RENDER.dragThresholdPx) drag.dragging = true;
    if (drag.dragging) h.onDrag(e.clientX - drag.lastX, e.clientY - drag.lastY);
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
  });

  el.addEventListener('pointerup', (e) => {
    if (e.button === MIDDLE) drag = null;
  });
  el.addEventListener('pointercancel', () => (drag = null));
  el.addEventListener('pointerleave', () => h.onLeave());
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      h.onWheel(e.deltaX, e.deltaY);
    },
    { passive: false },
  );
}
