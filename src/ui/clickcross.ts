/**
 * The OSRS click cross: a small yellow (walk) or red (action) X drawn exactly
 * where you clicked on the screen, shrinking away. For an option picked from
 * the right-click menu, that's where the menu was opened. Like OSRS it shrinks
 * in four drawn frames, each pixel-exact at 2x, rather than by scaling the
 * sprite (which smeared and wobbled at in-between sizes).
 */
import { RENDER } from '../config/balance';

export type ClickKind = 'walk' | 'action';

const COLORS: Record<ClickKind, string> = { walk: '#ffe14a', action: '#ff3b2f' };
/** Arm reach from the center (art pixels) of each frame, largest first. */
const FRAME_REACH = [7, 6, 5, 4] as const;

/** Which frame shows `t` (0..1) through the marker's life, or -1 once it's gone. */
export function crossFrameAt(t: number): number {
  if (!(t >= 0 && t < 1)) return -1;
  return Math.min(FRAME_REACH.length - 1, Math.floor(t * FRAME_REACH.length));
}

export class ClickCross {
  private readonly el = document.createElement('div');
  private readonly frames: Record<ClickKind, string[]> = {
    walk: FRAME_REACH.map((r) => crossImage(COLORS.walk, r)),
    action: FRAME_REACH.map((r) => crossImage(COLORS.action, r)),
  };
  private kind: ClickKind = 'walk';
  private frame = -1;
  private shownAt = -Infinity;

  constructor(host: HTMLElement) {
    this.el.className = 'click-cross';
    this.el.hidden = true;
    host.append(this.el);
  }

  /** Shows the cross centered on the client (viewport) point `x`, `y`. */
  show(x: number, y: number, kind: ClickKind, now: number): void {
    this.kind = kind;
    this.frame = -1;
    // Whole pixels, so the 2x art lands on the pixel grid.
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
    this.shownAt = now;
  }

  update(now: number): void {
    const frame = crossFrameAt((now - this.shownAt) / RENDER.clickMarkerMs);
    this.el.hidden = frame < 0;
    if (frame < 0 || frame === this.frame) return;
    this.frame = frame;
    this.el.style.backgroundImage = `url(${this.frames[this.kind][frame]})`;
  }
}

/** A 16×16 pixel-art X with a black outline, arms reaching `reach` pixels from the center. */
function crossImage(color: string, reach: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  const from = 8 - reach;
  const to = 7 + reach;
  ctx.fillStyle = '#000000';
  for (let i = from; i <= to; i++) {
    ctx.fillRect(i - 1, i - 1, 3, 3);
    ctx.fillRect(14 - i, i - 1, 3, 3);
  }
  ctx.fillStyle = color;
  for (let i = from; i <= to; i++) {
    ctx.fillRect(i, i, 1, 1);
    ctx.fillRect(15 - i, i, 1, 1);
  }
  return canvas.toDataURL();
}
