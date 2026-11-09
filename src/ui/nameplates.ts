/** Other players' nameplates and speech, as DOM labels over their heads. */
export interface Plate {
  id: string;
  name: string;
  say: string | null;
  at: { x: number; y: number } | null;
}

export class Nameplates {
  private readonly els = new Map<string, HTMLElement>();

  constructor(private readonly root: HTMLElement) {}

  update(plates: Plate[]): void {
    const live = new Set<string>();
    for (const p of plates) {
      if (!p.at) continue;
      live.add(p.id);
      let el = this.els.get(p.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'nameplate';
        this.root.append(el);
        this.els.set(p.id, el);
      }
      const say = el.querySelector('.np-say');
      const text = p.say ?? '';
      if (el.dataset.name !== p.name || (say?.textContent ?? '') !== text) {
        el.dataset.name = p.name;
        const s = document.createElement('span');
        s.className = 'np-say';
        s.textContent = text;
        el.replaceChildren(s, document.createTextNode(p.name));
      }
      el.style.left = `${p.at.x}px`;
      el.style.top = `${p.at.y}px`;
    }
    for (const [id, el] of this.els) {
      if (live.has(id)) continue;
      el.remove();
      this.els.delete(id);
    }
  }
}
