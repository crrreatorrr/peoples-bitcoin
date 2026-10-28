/** Arrow keys rotate (left/right) and tilt (up/down) the camera. */
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export class Keyboard {
  private readonly held = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!ARROWS.has(e.key) || isTyping(e.target)) return;
      this.held.add(e.key);
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.key));
    window.addEventListener('blur', () => this.held.clear());
  }

  /** Each axis is -1, 0 or 1. */
  cameraAxes(): { yaw: number; pitch: number } {
    const axis = (pos: string, neg: string) =>
      Number(this.held.has(pos)) - Number(this.held.has(neg));
    return { yaw: axis('ArrowLeft', 'ArrowRight'), pitch: axis('ArrowUp', 'ArrowDown') };
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
