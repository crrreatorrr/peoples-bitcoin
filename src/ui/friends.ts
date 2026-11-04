/**
 * Friends and ignore lists (side-panel tab, online only). Friends show their
 * world or Offline; clicking one starts a private message. Names are resolved
 * on the server.
 */
import type { SocialIn, SocialOut } from '../net/protocol';

export class FriendsPanel {
  readonly el: HTMLElement;
  private readonly friends: HTMLUListElement;
  private readonly ignores: HTMLUListElement;

  constructor(
    private readonly send: (op: SocialIn) => void,
    private readonly message: (name: string) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'friends-panel';
    const fh = document.createElement('h4');
    fh.textContent = 'Friends';
    this.friends = document.createElement('ul');
    this.friends.className = 'friends-list';
    const ih = document.createElement('h4');
    ih.textContent = 'Ignore list';
    this.ignores = document.createElement('ul');
    this.ignores.className = 'friends-list';
    const row = document.createElement('div');
    row.className = 'row';
    row.append(
      this.button('Add friend', () => this.ask('addFriend', 'Enter name of friend to add')),
      this.button('Del friend', () => this.ask('delFriend', 'Enter name of friend to remove')),
    );
    const row2 = document.createElement('div');
    row2.className = 'row';
    row2.append(
      this.button('Add ignore', () => this.ask('addIgnore', 'Enter name to ignore')),
      this.button('Del ignore', () => this.ask('delIgnore', 'Enter name to stop ignoring')),
    );
    this.el.append(fh, this.friends, row, ih, this.ignores, row2);
  }

  update(s: SocialOut): void {
    this.friends.replaceChildren(
      ...s.friends.map((f) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = f.name;
        const where = document.createElement('span');
        where.className = f.world === null ? 'offline' : 'online';
        where.textContent = f.world === null ? 'Offline' : `World ${f.world}`;
        li.append(name, where);
        li.title = 'Message';
        li.addEventListener('click', () => this.message(f.name));
        return li;
      }),
    );
    this.ignores.replaceChildren(
      ...s.ignores.map((n) => {
        const li = document.createElement('li');
        li.textContent = n;
        return li;
      }),
    );
  }

  private ask(op: 'addFriend' | 'delFriend' | 'addIgnore' | 'delIgnore', prompt: string): void {
    const name = window.prompt(prompt)?.trim();
    if (name) this.send({ op, name });
  }

  private button(label: string, run: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', run);
    return b;
  }
}
