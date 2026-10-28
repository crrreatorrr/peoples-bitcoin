/**
 * NPC dialogue box, drawn over the chat log: speaker, one line of text and
 * "Click to continue" (Space also continues). Shows whatever state.player.dialogue
 * points at; one click sends one continue intent per line.
 */
export interface DialogueLine {
  key: string;
  speaker: string;
  text: string;
}

export class DialogueBox {
  private readonly el = document.createElement('div');
  private readonly speaker = document.createElement('div');
  private readonly text = document.createElement('div');
  private key = '';
  private waiting = false;

  constructor(
    host: HTMLElement,
    private readonly onContinue: () => void,
  ) {
    this.el.className = 'dialogue';
    this.el.hidden = true;
    this.speaker.className = 'dialogue-speaker';
    this.text.className = 'dialogue-text';
    const more = document.createElement('div');
    more.className = 'dialogue-continue';
    more.textContent = 'Click to continue';
    this.el.append(this.speaker, this.text, more);
    this.el.addEventListener('click', () => this.continue());
    host.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Advances one line; extra presses before the next tick are ignored. */
  continue(): void {
    if (!this.isOpen || this.waiting) return;
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
    this.speaker.textContent = line.speaker;
    this.text.textContent = line.text;
  }
}
