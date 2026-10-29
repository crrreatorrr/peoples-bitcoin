/**
 * Right-hand side panel: one fixed-size content box between two arched stone
 * tab bars (OSRS fixed-mode look). Every tab renders inside the same box
 * (overflow scrolls inside it), so switching tabs never resizes the panel.
 *
 * Only tabs with a real feature are shown: Combat, Skills, Quests and
 * Inventory on the top bar; Equipment, Summoning and Settings on the bottom
 * bar. Each bar spreads its tabs evenly (see TAB_LAYOUT and frame.py, which
 * paints the matching sockets).
 */
export interface TabDef {
  id: string;
  /** Text glyph, used when there is no `image`. */
  icon: string;
  /** Pixel-art icon URL (src/assets/ui/tab_*.png). */
  image?: string | null;
  title: string;
  content: HTMLElement;
  /** Keyboard shortcut, OSRS-style (e.g. "F4"). */
  hotkey?: string;
}

/** Tabs per bar the frame art has sockets for (tools/ui-art/frame.py). */
export const TAB_LAYOUT = { top: 4, bottom: 3 } as const;

function tabIcon(image: string | null | undefined, glyph: string): HTMLElement {
  if (image) {
    const img = document.createElement('img');
    img.className = 'tab-icon tab-icon-img';
    img.src = image;
    img.alt = '';
    img.draggable = false;
    return img;
  }
  return Object.assign(document.createElement('span'), {
    className: 'tab-icon',
    textContent: glyph,
  });
}

export class SidePanel {
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly body = document.createElement('div');
  private readonly tabs: TabDef[];
  private current = '';

  constructor(root: HTMLElement, top: TabDef[], bottom: TabDef[]) {
    if (top.length !== TAB_LAYOUT.top || bottom.length !== TAB_LAYOUT.bottom)
      throw new Error(`The frame art has ${TAB_LAYOUT.top} + ${TAB_LAYOUT.bottom} tab sockets`);
    this.tabs = [...top, ...bottom];
    root.classList.add('osrs-panel');
    this.body.className = 'tab-body';
    root.replaceChildren(
      this.row(top, 'tab-row-top'),
      this.body,
      this.row(bottom, 'tab-row-bottom'),
    );
    this.select(this.tabs[0].id);
  }

  private row(tabs: TabDef[], cls: string): HTMLElement {
    const bar = document.createElement('div');
    bar.className = `tab-row ${cls}`;
    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.title = tab.hotkey ? `${tab.title} (${tab.hotkey})` : tab.title;
      btn.setAttribute('aria-label', tab.title);
      btn.append(tabIcon(tab.image, tab.icon));
      btn.addEventListener('click', () => this.select(tab.id));
      this.buttons.set(tab.id, btn);
      bar.append(btn);
    }
    return bar;
  }

  /** Selects the tab bound to a key like "F4"; returns false if none is. */
  selectByHotkey(key: string): boolean {
    const tab = this.tabs.find((t) => t.hotkey === key);
    if (tab) this.select(tab.id);
    return tab !== undefined;
  }

  select(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    for (const [tabId, btn] of this.buttons) btn.classList.toggle('active', tabId === id);
    if (this.current === id) return;
    this.current = id;
    this.body.dataset.tab = id;
    this.body.setAttribute('aria-label', tab.title);
    this.body.replaceChildren(tab.content);
    this.body.scrollTop = 0;
  }
}

/** A tab body holding a short message, for features that land in later phases. */
export function comingSoon(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'coming-soon';
  p.textContent = text;
  return p;
}
