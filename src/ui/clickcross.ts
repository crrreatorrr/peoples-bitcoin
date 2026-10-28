/**
 * The OSRS click cross: a small yellow (walk) or red (action) X drawn exactly
 * where you clicked on the screen, shrinking away. For an option picked from
 * the right-click menu, that's where the menu was opened.
 */
import { RENDER } from '../config/balance';

export type ClickKind = 'walk' | 'action';

const COLORS: Record<ClickKind, string> = { walk: '#ffe14a', action: '#ff3b2f' };
/** On-screen size in CSS pixels (the 16px pixel-art cross, doubled). */
const SIZE = 32;

export class ClickCross {
  private readonly el = document.createElement('div');
  private readonly images: Record<ClickKind, string> = {
    walk: crossImage(COLORS.walk),
    action: crossImage(COLORS.action),
  };
  private shownAt = -Infinity;

  constructor(host: HTMLElement) {
    this.el.className = 'click-cross';
    this.el.hidden = true;
    host.append(this.el);
  }

  /** Shows the cross centered on the client (viewport) point `x`, `y`. */
  show(x: number, y: number, kind: ClickKind, now: number): void {
    this.el.style.backgroundImage = `url(${this.images[kind]})`;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.shownAt = now;
  }

  update(now: number): void {
    const t = (now - this.shownAt) / RENDER.clickMarkerMs;
    this.el.hidden = !(t >= 0 && t < 1);
    if (this.el.hidden) return;
    const size = Math.round(SIZE * (1 - t * 0.5));
    this.el.style.width = this.el.style.height = `${size}px`;
  }
}

/** A 16×16 pixel-art X with a black outline, as a data URL. */
function crossImage(color: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  for (let i = 1; i < 15; i++) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(i - 1, i - 1, 3, 3);
    ctx.fillRect(14 - i, i - 1, 3, 3);
  }
  ctx.fillStyle = color;
  for (let i = 1; i < 15; i++) {
    ctx.fillRect(i, i, 1, 1);
    ctx.fillRect(15 - i, i, 1, 1);
  }
  return canvas.toDataURL();
}
