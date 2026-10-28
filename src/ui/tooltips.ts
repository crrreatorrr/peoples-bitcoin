/** Hover text that follows the cursor: "Mine Dusty Server Rack / 2 more options". */
export type TargetKind = 'object' | 'npc' | 'item';

export interface TooltipContent {
  action: string;
  target?: string;
  targetKind?: TargetKind;
  /** Extra plain-text lines (e.g. XP details). */
  detail?: string;
  moreOptions?: number;
}

const CURSOR_OFFSET_X = 14;
const CURSOR_OFFSET_Y = 18;

export class Tooltip {
  constructor(private readonly el: HTMLElement) {}

  show(content: TooltipContent, x: number, y: number): void {
    const parts: (Node | string)[] = [span('tip-action', content.action)];
    if (content.target)
      parts.push(' ', span(`tip-${content.targetKind ?? 'object'}`, content.target));
    if (content.moreOptions) {
      const n = content.moreOptions;
      parts.push(span('tip-more', ` / ${n} more option${n === 1 ? '' : 's'}`));
    }
    if (content.detail) parts.push(span('tip-detail', `\n${content.detail}`));
    this.el.replaceChildren(...parts);
    // Measure at the origin so the box isn't squeezed by the screen edge.
    this.el.style.left = '0px';
    this.el.style.top = '0px';
    this.el.hidden = false;

    const maxX = window.innerWidth - this.el.offsetWidth - 4;
    const maxY = window.innerHeight - this.el.offsetHeight - 4;
    this.el.style.left = `${Math.min(x + CURSOR_OFFSET_X, maxX)}px`;
    this.el.style.top = `${Math.min(y + CURSOR_OFFSET_Y, maxY)}px`;
  }

  hide(): void {
    this.el.hidden = true;
  }
}

export function span(className: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = text;
  return s;
}
