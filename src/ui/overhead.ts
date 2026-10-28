/** Public chat floating above the speaker's head (yellow text, like OSRS). */
export class OverheadText {
  constructor(private readonly el: HTMLElement) {}

  update(text: string | null, at: { x: number; y: number } | null): void {
    if (!text || !at) {
      this.el.hidden = true;
      return;
    }
    if (this.el.textContent !== text) this.el.textContent = text;
    this.el.style.left = `${at.x}px`;
    this.el.style.top = `${at.y}px`;
    this.el.hidden = false;
  }
}
