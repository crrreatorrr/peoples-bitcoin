/**
 * Bottom-left chat box: the message log, a typing line with the player's name,
 * and All / Game / Public filter tabs. Messages are added as text nodes (never
 * HTML). The dialogue box draws over the log via `dialogueHost`.
 */
import { CHAT, UI } from '../config/balance';
import type { MessageKind } from '../sim/state';

export type ChatKind = MessageKind | 'examine';

type Filter = 'all' | 'game' | 'public';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'game', label: 'Game' },
  { id: 'public', label: 'Public' },
];

const STICK_TO_BOTTOM_PX = 8;

export class Chat {
  /** Where the NPC dialogue box mounts, on top of the log. */
  readonly dialogueHost: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly log: HTMLElement;

  constructor(root: HTMLElement, playerName: string, onSend: (text: string) => void) {
    this.dialogueHost = document.createElement('div');
    this.dialogueHost.className = 'chat-main';
    this.log = document.createElement('div');
    this.log.className = 'chat-log';
    this.log.dataset.filter = 'all';
    this.dialogueHost.append(this.log);

    const inputRow = document.createElement('label');
    inputRow.className = 'chat-input-row';
    const name = document.createElement('span');
    name.className = 'chat-input-name';
    name.textContent = `${playerName}:`;
    this.input = document.createElement('input');
    this.input.className = 'chat-input';
    this.input.maxLength = CHAT.maxLength;
    this.input.placeholder = 'Press Enter or start typing to chat';
    this.input.addEventListener('keydown', (e) => {
      // Handled here; don't let the window-level shortcut refocus the input.
      if (e.key === 'Enter' || e.key === 'Escape') e.stopPropagation();
      if (e.key === 'Enter') {
        if (this.input.value.trim()) onSend(this.input.value);
        this.input.value = '';
        this.input.blur();
      } else if (e.key === 'Escape') {
        this.input.blur();
      }
    });
    inputRow.append(name, this.input);

    const tabs = document.createElement('div');
    tabs.className = 'chat-tabs';
    for (const filter of FILTERS) {
      const btn = document.createElement('button');
      btn.className = 'chat-tab';
      btn.textContent = filter.label;
      btn.classList.toggle('active', filter.id === 'all');
      btn.addEventListener('click', () => {
        this.log.dataset.filter = filter.id;
        for (const other of tabs.children) other.classList.toggle('active', other === btn);
        this.log.scrollTop = this.log.scrollHeight;
      });
      tabs.append(btn);
    }

    root.replaceChildren(this.dialogueHost, inputRow, tabs);
  }

  add(text: string, kind: ChatKind = 'game', speaker?: string): void {
    const line = document.createElement('div');
    line.className = `chat-line chat-${kind}`;
    if (speaker) {
      const name = document.createElement('span');
      name.className = 'chat-speaker';
      name.textContent = `${speaker}: `;
      line.append(name);
    }
    line.append(text);

    const log = this.log;
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - STICK_TO_BOTTOM_PX;
    log.append(line);
    while (log.childElementCount > UI.chatMaxLines) log.firstElementChild?.remove();
    if (atBottom) log.scrollTop = log.scrollHeight;
  }
}
