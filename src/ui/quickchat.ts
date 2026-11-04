/**
 * Quick-chat: a phrase menu from src/data/quickchat.json. Slot phrases (your
 * level in a skill, your combat level) are filled in by the server from your
 * real state, so the menu sends only the phrase id.
 */
import quickchat from '../data/quickchat.json';
import type { Content } from '../sim/content';

export class QuickChatMenu {
  private menu: HTMLElement | null = null;

  constructor(
    private readonly content: Content,
    private readonly send: (phrase: string) => void,
  ) {}

  open(anchor: HTMLElement): void {
    this.close();
    const menu = document.createElement('div');
    menu.className = 'quickchat-menu';
    const show = (items: { label: string; run: () => void }[]) => {
      menu.replaceChildren(
        ...items.map((item) => {
          const b = document.createElement('button');
          b.textContent = item.label;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            item.run();
          });
          return b;
        }),
      );
    };
    const top = () =>
      show([
        ...quickchat.groups.map((g) => ({
          label: `${g.name} ›`,
          run: () =>
            show([
              { label: '‹ Back', run: top },
              ...g.phrases.map((p) => ({
                label: p.text.replace(/\{(\w+)\}/g, '…'),
                run: () => ('slot' in p && p.slot === 'skill' ? skills(p.id) : this.say(p.id)),
              })),
            ]),
        })),
        { label: 'Close', run: () => this.close() },
      ]);
    const skills = (id: string) =>
      show([
        { label: '‹ Back', run: top },
        ...[...this.content.skills.values()].map((s) => ({
          label: s.name,
          run: () => this.say(`${id}:${s.id}`),
        })),
      ]);
    top();
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(4, rect.left)}px`;
    menu.style.bottom = `${Math.max(4, window.innerHeight - rect.top + 4)}px`;
    document.body.append(menu);
    this.menu = menu;
    setTimeout(() => document.addEventListener('click', this.outside), 0);
  }

  close(): void {
    this.menu?.remove();
    this.menu = null;
    document.removeEventListener('click', this.outside);
  }

  private readonly outside = (e: MouseEvent) => {
    if (this.menu && !this.menu.contains(e.target as Node)) this.close();
  };

  private say(phrase: string): void {
    this.send(phrase);
    this.close();
  }
}
