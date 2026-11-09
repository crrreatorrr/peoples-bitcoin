/**
 * The two trade screens. Offer: both sides' items, your inventory to offer
 * from (click 1, right-click for 5 / 10 / All), Accept and Decline; any change
 * resets both accepts. Confirm: a read-only list with each side's Terminal
 * value as a scam check. Items only, never Tickets.
 */
import type { Content } from '../sim/content';
import type { Inventory } from '../sim/state';
import type { TradeIn, TradeOut } from '../net/protocol';

export class TradeWindow {
  private readonly el: HTMLElement;
  private current: TradeOut | null = null;

  constructor(
    host: HTMLElement,
    private readonly content: Content,
    private readonly send: (msg: TradeIn) => void,
    private readonly inventory: () => Inventory,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'trade-window panel';
    this.el.hidden = true;
    host.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  update(t: TradeOut): void {
    if (t.stage === 'closed' || t.stage === 'request') {
      if (t.stage === 'closed') {
        this.current = null;
        this.el.hidden = true;
      }
      return;
    }
    this.current = t;
    this.render();
  }

  /** Redraws the offer screen when the inventory changes. */
  refresh(): void {
    if (this.current?.stage === 'offer') this.render();
  }

  private render(): void {
    const t = this.current;
    if (!t) return;
    this.el.hidden = false;
    const title = document.createElement('h3');
    title.textContent =
      t.stage === 'offer' ? `Trading with: ${t.with}` : `Are you sure you want to make this trade?`;
    const cols = document.createElement('div');
    cols.className = 'trade-cols';
    const mine = this.list('Your offer', t.mine, t.stage === 'offer', false);
    const theirs = this.list(`${t.with}'s offer`, t.theirs, false, t.modified === true);
    cols.append(mine, theirs);
    const status = document.createElement('p');
    status.className = 'trade-status';
    status.textContent = t.accepted.them
      ? 'Other player has accepted.'
      : t.accepted.me
        ? 'Waiting for other player...'
        : t.stage === 'confirm' && t.value
          ? `Terminal value: you give ${t.value.mine} Tickets' worth, you get ${t.value.theirs}.`
          : `${t.with} has ${t.theirFree ?? 0} free inventory slots.`;
    const actions = document.createElement('div');
    actions.className = 'trade-actions';
    const accept = document.createElement('button');
    accept.textContent = 'Accept';
    accept.addEventListener('click', () => this.send({ op: 'accept' }));
    const decline = document.createElement('button');
    decline.textContent = 'Decline';
    decline.addEventListener('click', () => this.send({ op: 'decline' }));
    actions.append(accept, decline);
    const children: HTMLElement[] = [title, cols, status, actions];
    if (t.stage === 'offer') children.splice(2, 0, this.bag());
    this.el.replaceChildren(...children);
  }

  private list(
    label: string,
    rows: TradeOut['mine'],
    removable: boolean,
    changed: boolean,
  ): HTMLElement {
    const box = document.createElement('div');
    const h = document.createElement('h4');
    h.textContent = label;
    const ul = document.createElement('ul');
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      li.textContent = r.qty > 1 ? `${r.name} × ${r.qty.toLocaleString('en-US')}` : r.name;
      if (changed) li.className = 'changed';
      if (removable) {
        li.title = 'Click to remove';
        li.addEventListener('click', () => this.send({ op: 'remove', index: i, qty: 'all' }));
      }
      ul.append(li);
    });
    box.append(h, ul);
    return box;
  }

  private bag(): HTMLElement {
    const box = document.createElement('div');
    const h = document.createElement('h4');
    h.textContent = 'Your inventory (click: offer 1, right-click: all)';
    const ul = document.createElement('ul');
    this.inventory().forEach((s, slot) => {
      if (!s) return;
      const item = this.content.items.get(s.itemId);
      if (!item) return;
      const li = document.createElement('li');
      li.textContent = s.qty > 1 ? `${item.name} × ${s.qty.toLocaleString('en-US')}` : item.name;
      li.addEventListener('click', () => this.send({ op: 'offer', slot, qty: 1 }));
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.send({ op: 'offer', slot, qty: 'all' });
      });
      ul.append(li);
    });
    box.append(h, ul);
    return box;
  }
}
