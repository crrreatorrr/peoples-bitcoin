/**
 * Bottom-left chat box: the message log, a typing line with the player's name,
 * and filter tabs (All / Game / Public, plus Private and Trade online).
 * Messages are added as text nodes (never HTML). The dialogue box draws over
 * the log via `dialogueHost`.
 *
 * Online, clicking the active Public, Private or Trade tab cycles its filter
 * (On, Friends, Off), which the server enforces. Typing `/m name text` sends a
 * private message; `/r text`, or Tab, answers the last one.
 */
import { CHAT, UI } from '../config/balance';
import type { ChatFilter, MessageKind } from '../sim/state';
import { maskProfanity } from '../server/chatfilter';

export type ChatKind = MessageKind | 'examine' | 'private' | 'trade';

type Filter = 'all' | 'game' | 'public' | 'private' | 'trade';

const FILTERS: { id: Filter; label: string; online?: boolean }[] = [
  { id: 'all', label: 'All' },
  { id: 'game', label: 'Game' },
  { id: 'public', label: 'Public' },
  { id: 'private', label: 'Private', online: true },
  { id: 'trade', label: 'Trade', online: true },
];

/** Online chat hooks; offline the chat box only sends public lines to the sim. */
export interface OnlineChat {
  pm(to: string, text: string): void;
  reply(text: string): void;
  /** Server-side filters changed. */
  filters(f: { public: ChatFilter; private: ChatFilter; trade: ChatFilter }): void;
  quickChat(anchor: HTMLElement): void;
}

const NEXT_FILTER: Record<ChatFilter, ChatFilter> = { on: 'friends', friends: 'off', off: 'on' };

const STICK_TO_BOTTOM_PX = 8;

export class Chat {
  /** Where the NPC dialogue box mounts, on top of the log. */
  readonly dialogueHost: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly log: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly tabs: HTMLElement;
  private online: OnlineChat | null = null;
  /** Mask crude words in player chat (a setting, default on). */
  maskProfanity = true;
  replyName: string | null = null;
  readonly serverFilters: Record<'public' | 'private' | 'trade', ChatFilter> = {
    public: 'on',
    private: 'on',
    trade: 'on',
  };

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
    this.nameEl = name;
    this.input = document.createElement('input');
    this.input.className = 'chat-input';
    this.input.maxLength = CHAT.maxLength;
    this.input.placeholder = 'Press Enter or start typing to chat';
    this.input.addEventListener('keydown', (e) => {
      // Handled here; don't let the window-level shortcut refocus the input.
      if (e.key === 'Enter' || e.key === 'Escape') e.stopPropagation();
      if (e.key === 'Tab' && this.online && this.replyName) {
        e.preventDefault();
        this.input.value = `/m ${this.replyName} `;
        return;
      }
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        const pm = /^\/(?:m|w|pm)\s+(\S+)\s+(.+)$/i.exec(text);
        const reply = /^\/r\s+(.+)$/i.exec(text);
        if (this.online && pm) this.online.pm(pm[1], pm[2]);
        else if (this.online && reply) this.online.reply(reply[1]);
        else if (text) onSend(this.input.value);
        this.input.value = '';
        this.input.blur();
      } else if (e.key === 'Escape') {
        this.input.blur();
      }
    });
    inputRow.append(name, this.input);

    const tabs = document.createElement('div');
    tabs.className = 'chat-tabs';
    this.tabs = tabs;
    for (const filter of FILTERS) {
      const btn = document.createElement('button');
      btn.className = 'chat-tab';
      btn.dataset.tab = filter.id;
      btn.hidden = filter.online === true;
      const label = document.createElement('span');
      label.textContent = filter.label;
      const state = document.createElement('small');
      state.className = 'chat-tab-filter';
      btn.append(label, state);
      btn.classList.toggle('active', filter.id === 'all');
      btn.addEventListener('click', () => {
        const key = filter.id as 'public' | 'private' | 'trade';
        if (this.online && btn.classList.contains('active') && key in this.serverFilters) {
          this.serverFilters[key] = NEXT_FILTER[this.serverFilters[key]];
          this.online.filters({ ...this.serverFilters });
          this.showFilters();
          return;
        }
        this.log.dataset.filter = filter.id;
        for (const other of tabs.children) other.classList.toggle('active', other === btn);
        this.log.scrollTop = this.log.scrollHeight;
      });
      tabs.append(btn);
    }

    root.replaceChildren(this.dialogueHost, inputRow, tabs);
  }

  /** Turns on the online tabs, quick-chat and PM commands. */
  goOnline(online: OnlineChat, name: string): void {
    this.online = online;
    this.nameEl.textContent = `${name}:`;
    this.input.maxLength = CHAT.maxLength + 40;
    for (const btn of this.tabs.querySelectorAll<HTMLElement>('.chat-tab')) btn.hidden = false;
    const quick = document.createElement('button');
    quick.className = 'chat-tab chat-quick';
    quick.textContent = 'Quick';
    quick.title = 'Quick chat';
    quick.addEventListener('click', () => online.quickChat(quick));
    this.tabs.append(quick);
    this.showFilters();
  }

  setFilters(f: { public: ChatFilter; private: ChatFilter; trade: ChatFilter }): void {
    Object.assign(this.serverFilters, f);
    this.showFilters();
  }

  private showFilters(): void {
    for (const btn of this.tabs.querySelectorAll<HTMLElement>('.chat-tab')) {
      const key = btn.dataset.tab as 'public' | 'private' | 'trade' | undefined;
      const small = btn.querySelector('.chat-tab-filter');
      if (!small || !key || !(key in this.serverFilters) || !this.online) continue;
      const f = this.serverFilters[key];
      small.textContent = f === 'on' ? 'On' : f === 'friends' ? 'Friends' : 'Off';
      small.className = `chat-tab-filter filter-${f}`;
    }
  }

  add(text: string, kind: ChatKind = 'game', speaker?: string, quick = false): void {
    const line = document.createElement('div');
    line.className = `chat-line chat-${kind}`;
    if (quick) {
      const icon = document.createElement('span');
      icon.className = 'chat-quick-icon';
      icon.textContent = '[Q] ';
      icon.title = 'Quick chat';
      line.append(icon);
    }
    if (speaker) {
      const name = document.createElement('span');
      name.className = 'chat-speaker';
      name.textContent = `${speaker}: `;
      line.append(name);
    }
    const playerText = kind === 'public' || kind === 'private';
    line.append(playerText && this.maskProfanity ? maskProfanity(text) : text);

    const log = this.log;
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - STICK_TO_BOTTOM_PX;
    log.append(line);
    while (log.childElementCount > UI.chatMaxLines) log.firstElementChild?.remove();
    if (atBottom) log.scrollTop = log.scrollHeight;
  }
}
