/**
 * 28-slot inventory grid. Normally: left-click examines, shift-click drops,
 * right-click opens Drop / Examine, and dragging swaps slots. While the bank is
 * open: left-click deposits the bank's selected quantity, right-click lists
 * Deposit-1/5/10/All. Changes go out as intents; the grid re-renders from state.
 */
import type { Content } from '../sim/content';
import type { Inventory, Quantity } from '../sim/state';
import { QUANTITIES, qtyLabel } from './bank';
import type { MenuOption } from './contextmenu';
import { qtyBadge } from './format';
import type { Tooltip } from './tooltips';

export interface InventoryHandlers {
  examine(itemId: string): void;
  drop(slot: number): void;
  move(from: number, to: number): void;
  deposit(slot: number, qty: Quantity): void;
  openMenu(options: MenuOption[], x: number, y: number): void;
  /** The bank's left-click quantity while it's open, otherwise null. */
  bankQuantity(): Quantity | null;
}

const DRAG_TYPE = 'text/x-inventory-slot';

export class InventoryPanel {
  readonly el = document.createElement('div');
  private readonly slots: HTMLElement[] = [];
  private items: Inventory = [];
  private key = '';

  constructor(
    private readonly content: Content,
    private readonly iconUrl: (modelId: string) => string,
    private readonly tooltip: Tooltip,
    size: number,
    private readonly h: InventoryHandlers,
  ) {
    this.el.className = 'inventory';
    for (let i = 0; i < size; i++) {
      const slot = document.createElement('div');
      slot.className = 'inv-slot';
      slot.dataset.slot = String(i);
      this.slots.push(slot);
    }
    this.el.append(...this.slots);

    this.el.addEventListener('click', (e) => {
      const index = this.slotOf(e);
      if (index === null) return;
      const options = this.options(index);
      if (e.shiftKey && this.h.bankQuantity() === null) this.h.drop(index);
      else options[0].run?.();
    });
    this.el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const index = this.slotOf(e);
      if (index !== null) this.h.openMenu(this.options(index), e.clientX, e.clientY);
    });
    this.el.addEventListener('mousemove', (e) => {
      const index = this.slotOf(e);
      if (index === null) return this.tooltip.hide();
      const [top, ...rest] = this.options(index);
      this.tooltip.show({ ...top, moreOptions: rest.length }, e.clientX, e.clientY);
    });
    this.el.addEventListener('mouseleave', () => this.tooltip.hide());

    // Drag to rearrange (swap), shown immediately and confirmed on the next tick.
    this.el.addEventListener('dragstart', (e) => {
      const index = this.slotOf(e);
      if (index === null || !e.dataTransfer) return;
      e.dataTransfer.setData(DRAG_TYPE, String(index));
      e.dataTransfer.effectAllowed = 'move';
      this.tooltip.hide();
    });
    this.el.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes(DRAG_TYPE)) e.preventDefault();
    });
    this.el.addEventListener('drop', (e) => {
      const from = Number(e.dataTransfer?.getData(DRAG_TYPE));
      const target = (e.target as HTMLElement).closest<HTMLElement>('.inv-slot');
      if (!target || !Number.isInteger(from)) return;
      e.preventDefault();
      const to = Number(target.dataset.slot);
      if (from === to) return;
      this.h.move(from, to);
      const preview = [...this.items];
      [preview[from], preview[to]] = [preview[to], preview[from]];
      this.render(preview);
    });
  }

  update(inventory: Inventory): void {
    const key = JSON.stringify(inventory);
    if (key === this.key) return;
    this.key = key;
    this.render(inventory);
  }

  private render(inventory: Inventory): void {
    this.items = inventory;
    inventory.forEach((item, i) => {
      const slot = this.slots[i];
      slot.replaceChildren();
      if (!item) return;
      const def = this.content.items.get(item.itemId);
      const img = document.createElement('img');
      img.src = this.iconUrl(def?.model ?? '');
      img.alt = def?.name ?? item.itemId;
      img.draggable = true;
      slot.append(img);
      if (item.qty > 1) slot.append(qtyBadge(item.qty));
    });
  }

  /** Menu options for a slot, default (left-click) option first. */
  private options(index: number): MenuOption[] {
    const item = this.items[index]!;
    const name = this.content.items.get(item.itemId)?.name ?? item.itemId;
    const examine: MenuOption = {
      action: 'Examine',
      target: name,
      targetKind: 'item',
      run: () => this.h.examine(item.itemId),
    };
    const bankQty = this.h.bankQuantity();
    if (bankQty !== null) {
      const deposit = (q: Quantity): MenuOption => ({
        action: `Deposit-${qtyLabel(q)}`,
        target: name,
        targetKind: 'item',
        run: () => this.h.deposit(index, q),
      });
      return [deposit(bankQty), ...QUANTITIES.filter((q) => q !== bankQty).map(deposit), examine];
    }
    return [
      examine,
      { action: 'Drop', target: name, targetKind: 'item', run: () => this.h.drop(index) },
    ];
  }

  private slotOf(e: MouseEvent): number | null {
    const slot = (e.target as HTMLElement).closest<HTMLElement>('.inv-slot');
    const index = slot ? Number(slot.dataset.slot) : -1;
    return this.items[index] ? index : null;
  }
}
