/**
 * NPC dialogue box, drawn over the chat log: speaker, one line of text and
 * "Click to continue" (Space and Enter also continue; A on a controller). Shows whatever
 * state.player.dialogue points at. A line too long for the box is split into pages that each fit;
 * continuing shows the next page, and only the last one sends a continue intent. Like OSRS, the
 * NPC's chat head sits on the left and the player's on the right when they reply,
 * and choices appear as "Select an Option" (click, or press 1-5).
 */
export interface DialogueLine {
  key: string;
  speaker: string;
  text: string;
  /** The player is speaking. */
  player?: boolean;
  /** Chat head image URL: the NPC's on the left, the player's on the right. */
  portrait?: string;
  /** A "Select an Option" menu instead of a line of text. */
  options?: string[];
}

export class DialogueBox {
  private readonly el = document.createElement('div');
  private readonly speaker = document.createElement('div');
  private readonly text = document.createElement('div');
  private readonly head = document.createElement('img');
  private readonly more = document.createElement('div');
  private readonly menu = document.createElement('div');
  private options = 0;
  private key = '';
  private unreadText = '';
  private nextPageText = '';
  private waiting = false;

  constructor(
    host: HTMLElement,
    private readonly onContinue: () => void,
    private readonly onChoose: (index: number) => void,
  ) {
    this.el.className = 'dialogue';
    this.el.hidden = true;
    this.speaker.className = 'dialogue-speaker';
    this.text.className = 'dialogue-text';
    this.more.className = 'dialogue-continue';
    this.more.textContent = 'Click to continue';
    this.menu.className = 'dialogue-options';
    this.head.className = 'chathead';
    this.head.alt = '';
    this.el.append(this.head, this.speaker, this.text, this.menu, this.more);
    this.el.addEventListener('click', () => {
      if (this.options === 0) this.continue();
    });
    host.append(this.el);

    const reflow = () => {
      if (this.canContinue && !this.waiting) this.showPage();
    };
    new ResizeObserver(reflow).observe(this.text);
    document.fonts.addEventListener('loadingdone', reflow);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** A line is showing that Space, Enter or a click continues (not a "Select an Option"). */
  get canContinue(): boolean {
    return this.isOpen && this.options === 0;
  }

  /** The continue prompt follows the last device used ("Click to continue" / "Press A to continue"). */
  setContinuePrompt(text: string): void {
    this.more.textContent = text;
  }

  /** Picks option `index` of a "Select an Option" menu; returns false if none is showing. */
  choose(index: number): boolean {
    if (!this.isOpen || this.waiting || index < 0 || index >= this.options) return false;
    this.waiting = true;
    this.el.classList.add('waiting');
    this.onChoose(index);
    return true;
  }

  /** Shows the next page of a long line, else advances one line; extra presses before the next tick are ignored. */
  continue(): void {
    if (!this.isOpen || this.waiting || this.options > 0) return;
    if (this.nextPageText) {
      this.unreadText = this.nextPageText;
      this.showPage();
      return;
    }
    this.waiting = true;
    this.el.classList.add('waiting');
    this.onContinue();
  }

  update(line: DialogueLine | null): void {
    const key = line?.key ?? '';
    if (key === this.key) return;
    this.key = key;
    this.waiting = false;
    this.el.classList.remove('waiting');
    this.el.hidden = !line;
    if (!line) return;
    this.el.classList.toggle('player', line.player === true);
    this.head.hidden = !line.portrait;
    if (line.portrait) this.head.src = line.portrait;
    this.options = line.options?.length ?? 0;
    this.el.classList.toggle('choosing', this.options > 0);
    this.more.hidden = this.options > 0;
    this.text.hidden = this.options > 0;
    this.menu.hidden = this.options === 0;
    this.menu.replaceChildren(
      ...(line.options ?? []).map((text, i) => {
        const btn = document.createElement('button');
        btn.className = 'dialogue-option';
        btn.textContent = `${i + 1}. ${text}`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.choose(i);
        });
        return btn;
      }),
    );
    if (this.options > 0) {
      this.speaker.textContent = 'Select an Option';
      return;
    }
    this.speaker.textContent = line.speaker;
    this.unreadText = line.text.trim().replace(/\s+/g, ' ');
    this.showPage();
  }

  /** Fits the current page in the text row, leaving the rest for the next press. */
  private showPage(): void {
    const fits = (text: string) => {
      this.text.textContent = text;
      return this.text.scrollHeight <= this.text.clientHeight;
    };
    this.nextPageText = '';
    if (fits(this.unreadText)) return;

    const fittingCount = (parts: string[], separator: string) => {
      let lo = 0;
      let hi = parts.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(parts.slice(0, mid).join(separator))) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };

    const words = this.unreadText.split(' ');
    let count = fittingCount(words, ' ');
    let page: string;
    if (count === 0) {
      // A single long word can span pages on a narrow screen.
      const characters = Array.from(words[0]);
      page = characters.slice(0, Math.max(1, fittingCount(characters, ''))).join('');
    } else {
      // Prefer a sentence ending after the first third of the available page.
      for (let i = count; i > count / 3; i--) {
        if (/[.!?]$/.test(words[i - 1])) {
          count = i;
          break;
        }
      }
      page = words.slice(0, count).join(' ');
    }

    this.text.textContent = page;
    this.nextPageText = this.unreadText.slice(page.length).trimStart();
  }
}
