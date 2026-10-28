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
    // Left turns the view left (the camera orbits clockwise seen from above), as in OSRS.
    return { yaw: axis('ArrowRight', 'ArrowLeft'), pitch: axis('ArrowUp', 'ArrowDown') };
  }
}

/** Arrows still turn the camera from the chat line, as in OSRS; other fields keep them. */
function isTyping(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement && target.classList.contains('chat-input')) return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
