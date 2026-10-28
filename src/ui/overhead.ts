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

/** Overhead lines for any number of speakers (enemy shouts), keyed by entity id. */
export class OverheadPool {
  private readonly els = new Map<string, OverheadText>();

  constructor(private readonly host: HTMLElement) {}

  update(
    lines: readonly { id: string; text: string; at: { x: number; y: number } | null }[],
  ): void {
    const live = new Set<string>();
    for (const line of lines) {
      live.add(line.id);
      let el = this.els.get(line.id);
      if (!el) {
        const div = document.createElement('div');
        div.className = 'overhead';
        this.host.appendChild(div);
        el = new OverheadText(div);
        this.els.set(line.id, el);
      }
      el.update(line.text, line.at);
    }
    for (const [id, el] of this.els) if (!live.has(id)) el.update(null, null);
  }
}
