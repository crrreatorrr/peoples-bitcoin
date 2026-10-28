/**
 * Bank window. Left-click withdraws the selected quantity (1/5/10/All buttons),
 * right-click lists every option. While open, the inventory deposits instead.
 */
import { BANK } from '../config/balance';
import type { Content } from '../sim/content';
import type { InventorySlot, Quantity } from '../sim/state';
import type { MenuOption } from './contextmenu';
import { qtyBadge } from './format';
import type { Tooltip } from './tooltips';

export interface BankHandlers {
  withdraw(index: number, qty: Quantity): void;
  depositAll(): void;
  close(): void;
  examine(itemId: string): void;
  openMenu(options: MenuOption[], x: number, y: number): void;
}

export const QUANTITIES: Quantity[] = [1, 5, 10, 'all'];
export const qtyLabel = (q: Quantity) => (q === 'all' ? 'All' : String(q));

export class BankWindow {
  readonly el = document.createElement('div');
  private readonly grid = document.createElement('div');
  private readonly count = document.createElement('span');
  private items: InventorySlot[] = [];
  private key = '';
  private quantity: Quantity = 1;
  /** Hide immediately on close, without waiting for the tick to confirm. */
  private closing = false;

  constructor(
    root: HTMLElement,
    private readonly content: Content,
    private readonly iconUrl: (modelId: string) => string,
    private readonly tooltip: Tooltip,
    private readonly h: BankHandlers,
  ) {
    this.el.className = 'bank panel';
    this.el.hidden = true;

    const header = document.createElement('div');
    header.className = 'window-header';
    const title = document.createElement('h2');
    title.textContent = 'The Treasury Bank';
    this.count.className = 'bank-count';
    const close = document.createElement('button');
    close.className = 'window-close';
    close.textContent = '✕';
    close.title = 'Close';
    close.addEventListener('click', () => this.close());
    header.append(title, this.count, close);

    this.grid.className = 'bank-grid';
    this.grid.addEventListener('click', (e) => {
      const index = this.indexOf(e);
      if (index !== null) h.withdraw(index, this.quantity);
    });
    this.grid.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const index = this.indexOf(e);
      if (index === null) return;
      const item = this.items[index];
      const name = this.nameOf(item.itemId);
      h.openMenu(
        [
          ...QUANTITIES.map((q) => ({
            action: `Withdraw-${qtyLabel(q)}`,
            target: name,
            targetKind: 'item' as const,
            run: () => h.withdraw(index, q),
          })),
          {
            action: 'Examine',
            target: name,
            targetKind: 'item',
            run: () => h.examine(item.itemId),
          },
        ],
        e.clientX,
        e.clientY,
      );
    });
    this.grid.addEventListener('mousemove', (e) => {
      const index = this.indexOf(e);
      if (index === null) return this.tooltip.hide();
      const name = this.nameOf(this.items[index].itemId);
      this.tooltip.show(
        {
          action: `Withdraw-${qtyLabel(this.quantity)}`,
          target: name,
          targetKind: 'item',
          moreOptions: 4,
        },
        e.clientX,
        e.clientY,
      );
    });
    this.grid.addEventListener('mouseleave', () => this.tooltip.hide());

    const footer = document.createElement('div');
    footer.className = 'bank-footer';
    const qtyButtons = QUANTITIES.map((q) => {
      const btn = document.createElement('button');
      btn.className = 'stone-btn qty-btn';
      btn.textContent = qtyLabel(q);
      btn.title = `Left-click moves ${qtyLabel(q)}`;
      btn.addEventListener('click', () => {
        this.quantity = q;
        for (const b of qtyButtons) b.classList.toggle('active', b === btn);
      });
      return btn;
    });
    qtyButtons[0].classList.add('active');
    const depositAll = document.createElement('button');
    depositAll.className = 'stone-btn deposit-all';
    depositAll.textContent = 'Deposit inventory';
    depositAll.addEventListener('click', () => h.depositAll());
    footer.append(...qtyButtons, depositAll);

    this.el.append(header, this.grid, footer);
    root.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Quantity the inventory deposits on left-click while the bank is open. */
  get leftClickQuantity(): Quantity {
    return this.quantity;
  }

  close(): void {
    if (!this.isOpen) return;
    this.closing = true;
    this.el.hidden = true;
    this.tooltip.hide();
    this.h.close();
  }

  update(open: boolean, bank: InventorySlot[]): void {
    if (!open) this.closing = false;
    this.el.hidden = !open || this.closing;
    if (this.el.hidden) return;
    const key = JSON.stringify(bank);
    if (key === this.key) return;
    this.key = key;
    this.items = bank;
    this.count.textContent = `${bank.length} / ${BANK.slots}`;
    this.grid.replaceChildren(
      ...bank.map((stack, i) => {
        const slot = document.createElement('div');
        slot.className = 'bank-slot';
        slot.dataset.index = String(i);
        const img = document.createElement('img');
        img.src = this.iconUrl(this.content.items.get(stack.itemId)?.model ?? '');
        img.alt = this.nameOf(stack.itemId);
        img.draggable = false;
        slot.append(img, qtyBadge(stack.qty));
        return slot;
      }),
    );
  }

  private indexOf(e: MouseEvent): number | null {
    const slot = (e.target as HTMLElement).closest<HTMLElement>('.bank-slot');
    const index = slot ? Number(slot.dataset.index) : -1;
    return this.items[index] ? index : null;
  }

  private nameOf(itemId: string): string {
    return this.content.items.get(itemId)?.name ?? itemId;
  }
}
