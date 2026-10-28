/** Right-hand tabbed panel (Inventory, Equipment, Skills, Military, Quests, Settings). */
export interface TabDef {
  id: string;
  icon: string;
  title: string;
  content: HTMLElement;
}

export class SidePanel {
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly body = document.createElement('div');

  constructor(
    root: HTMLElement,
    private readonly tabs: TabDef[],
  ) {
    const bar = document.createElement('div');
    bar.className = 'tab-bar';
    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.title = tab.title;
      btn.textContent = tab.icon;
      btn.addEventListener('click', () => this.select(tab.id));
      this.buttons.set(tab.id, btn);
      bar.append(btn);
    }
    this.body.className = 'tab-body';
    root.replaceChildren(bar, this.body);
    this.select(tabs[0].id);
  }

  select(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    for (const [tabId, btn] of this.buttons) btn.classList.toggle('active', tabId === id);
    const heading = document.createElement('h2');
    heading.className = 'tab-title';
    heading.textContent = tab.title;
    this.body.replaceChildren(heading, tab.content);
  }
}

/** A tab body holding a short message, for features that land in later phases. */
export function comingSoon(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'coming-soon';
  p.textContent = text;
  return p;
}
