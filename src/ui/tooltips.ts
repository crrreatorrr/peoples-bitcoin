/**
 * Hover text: "Mine Dusty Server Rack / 2 more options". In the game world it
 * sits in the top-left of the play area like OSRS; over panels it follows the
 * cursor so details can sit beside what you're pointing at.
 */
export type TargetKind = 'object' | 'npc' | 'item';

export interface TooltipContent {
  action: string;
  target?: string;
  targetKind?: TargetKind;
  /** A monster's "(level-N)", colored against the player's combat level. */
  level?: { text: string; color: string };
  /** Extra plain-text lines (e.g. XP details). */
  detail?: string;
  moreOptions?: number;
}

/** The action, target and level of a menu entry or hover text. */
export function optionParts(content: TooltipContent): (Node | string)[] {
  const parts: (Node | string)[] = [span('tip-action', content.action)];
  if (content.target)
    parts.push(' ', span(`tip-${content.targetKind ?? 'object'}`, content.target));
  if (content.level) {
    const level = span('tip-level', `  ${content.level.text}`);
    level.style.color = content.level.color;
    parts.push(level);
  }
  return parts;
}

const CURSOR_OFFSET_X = 14;
const CURSOR_OFFSET_Y = 18;

export class Tooltip {
  constructor(private readonly el: HTMLElement) {}

  /** Beside the cursor (panels: inventory, bank, skills). */
  show(content: TooltipContent, x: number, y: number): void {
    this.render(content);
    this.el.classList.remove('fixed');
    // Measure at the origin so the box isn't squeezed by the screen edge.
    this.el.style.left = '0px';
    this.el.style.top = '0px';
    this.el.hidden = false;

    const maxX = window.innerWidth - this.el.offsetWidth - 4;
    const maxY = window.innerHeight - this.el.offsetHeight - 4;
    this.el.style.left = `${Math.min(x + CURSOR_OFFSET_X, maxX)}px`;
    this.el.style.top = `${Math.min(y + CURSOR_OFFSET_Y, maxY)}px`;
  }

  /** In the top-left of the play area, like OSRS mouseover text (the game world). */
  showFixed(content: TooltipContent): void {
    this.render(content);
    this.el.classList.add('fixed');
    this.el.style.left = '';
    this.el.style.top = '';
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  private render(content: TooltipContent): void {
    const parts = optionParts(content);
    if (content.moreOptions) {
      const n = content.moreOptions;
      parts.push(span('tip-more', ` / ${n} more option${n === 1 ? '' : 's'}`));
    }
    if (content.detail) parts.push(span('tip-detail', `\n${content.detail}`));
    this.el.replaceChildren(...parts);
  }
}

export function span(className: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = text;
  return s;
}
