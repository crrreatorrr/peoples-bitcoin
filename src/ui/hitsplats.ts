/**
 * OSRS-style hitsplats: red with the damage, blue for a miss, over the middle
 * of the target each frame. A shot's hitsplat waits until the shot lands.
 */
import { span } from './tooltips';

interface Splat {
  el: HTMLElement;
  targetId: string;
  bornAt: number;
  offset: number;
  shown: boolean;
}

const LIFETIME_MS = 1000;
const STACK_PX = 16;

export class Hitsplats {
  private readonly splats: Splat[] = [];

  constructor(private readonly layer: HTMLElement) {}

  spawn(targetId: string, damage: number, now: number, delayMs = 0): void {
    const stacked = this.splats.filter((s) => s.targetId === targetId).length;
    const el = span(`hitsplat ${damage > 0 ? 'hit' : 'miss'}`, String(damage));
    const offset = (stacked % 3) * STACK_PX;
    this.splats.push({ el, targetId, bornAt: now + delayMs, offset, shown: false });
  }

  /** `screenOf` returns the CSS position over an entity's head, or null if it isn't visible. */
  update(now: number, screenOf: (id: string) => { x: number; y: number } | null): void {
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      if (now < s.bornAt) continue;
      const at = screenOf(s.targetId);
      if (now - s.bornAt > LIFETIME_MS || !at) {
        s.el.remove();
        this.splats.splice(i, 1);
        continue;
      }
      if (!s.shown) {
        this.layer.append(s.el); // the pop animation starts when it lands
        s.shown = true;
      }
      s.el.style.left = `${at.x}px`;
      s.el.style.top = `${at.y - s.offset}px`;
    }
  }

  clear(): void {
    for (const s of this.splats) s.el.remove();
    this.splats.length = 0;
  }
}
