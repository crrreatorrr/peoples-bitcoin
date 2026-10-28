/** OSRS-style right-click menu: "Choose Option", one row per action, then Cancel. */
import { optionParts, span, type TargetKind, type TooltipContent } from './tooltips';

export interface MenuOption {
  action: string;
  target?: string;
  targetKind?: TargetKind;
  level?: TooltipContent['level'];
  run?: () => void;
}

const MENU_ANCHOR_OFFSET_Y = 6;

export class ContextMenu {
  constructor(private readonly el: HTMLElement) {
    el.addEventListener('pointerleave', () => this.close());
    // Presses outside the menu close it. Bubble phase, so the canvas can see the
    // menu was open and swallow its own click first.
    document.addEventListener('pointerdown', (e) => {
      if (this.isOpen && !el.contains(e.target as Node)) this.close();
    });
    window.addEventListener('keydown', (e) => e.key === 'Escape' && this.close());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(options: MenuOption[], x: number, y: number): void {
    const rows = [...options, { action: 'Cancel' }].map((opt) => {
      const row = document.createElement('div');
      row.className = 'menu-row';
      row.append(...optionParts(opt));
      // OSRS picks an option on press.
      row.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        this.close();
        opt.run?.();
      });
      return row;
    });
    this.el.replaceChildren(span('menu-title', 'Choose Option'), ...rows);
    this.el.hidden = false;

    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const left = Math.max(2, Math.min(x - w / 2, window.innerWidth - w - 2));
    const top = Math.max(2, Math.min(y - MENU_ANCHOR_OFFSET_Y, window.innerHeight - h - 2));
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  close(): void {
    this.el.hidden = true;
  }
}
