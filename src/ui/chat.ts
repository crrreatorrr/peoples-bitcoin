/** Bottom-left chat box. Messages are added as text nodes (never HTML). */
import { UI } from '../config/balance';
import type { MessageKind } from '../sim/state';

export type ChatKind = MessageKind | 'examine';

const STICK_TO_BOTTOM_PX = 8;

export class Chat {
  private readonly log: HTMLElement;

  constructor(root: HTMLElement) {
    this.log = document.createElement('div');
    this.log.className = 'chat-log';
    root.replaceChildren(this.log);
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
