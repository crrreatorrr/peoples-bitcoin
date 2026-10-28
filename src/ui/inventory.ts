/**
 * 28-slot inventory grid. Left-click examines, shift-click drops, right-click
 * opens Drop / Examine. Changes go out as intents; the grid re-renders from state.
 */
import type { Content } from '../sim/content';
import type { Inventory } from '../sim/state';
import type { MenuOption } from './contextmenu';

export interface InventoryHandlers {
  examine(itemId: string): void;
  drop(slot: number): void;
  openMenu(options: MenuOption[], x: number, y: number): void;
}

export class InventoryPanel {
  readonly el = document.createElement('div');
  private readonly slots: HTMLElement[] = [];
  private items: Inventory = [];
  private key = '';

  constructor(
    private readonly content: Content,
    private readonly iconUrl: (modelId: string) => string,
    size: number,
    handlers: InventoryHandlers,
  ) {
    this.el.className = 'inventory';
    for (let i = 0; i < size; i++) {
      const slot = document.createElement('div');
      slot.className = 'inv-slot';
      slot.dataset.slot = String(i);
      this.slots.push(slot);
    }
    this.el.append(...this.slots);

    const slotOf = (e: MouseEvent): number | null => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('.inv-slot');
      const index = slot ? Number(slot.dataset.slot) : -1;
      return this.items[index] ? index : null;
    };
    this.el.addEventListener('click', (e) => {
      const index = slotOf(e);
      if (index === null) return;
      if (e.shiftKey) handlers.drop(index);
      else handlers.examine(this.items[index]!.itemId);
    });
    this.el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const index = slotOf(e);
      if (index === null) return;
      const item = this.items[index]!;
      const name = this.content.items.get(item.itemId)?.name ?? item.itemId;
      handlers.openMenu(
        [
          { action: 'Drop', target: name, targetKind: 'item', run: () => handlers.drop(index) },
          {
            action: 'Examine',
            target: name,
            targetKind: 'item',
            run: () => handlers.examine(item.itemId),
          },
        ],
        e.clientX,
        e.clientY,
      );
    });
  }

  update(inventory: Inventory): void {
    const key = JSON.stringify(inventory);
    if (key === this.key) return;
    this.key = key;
    this.items = inventory;
    inventory.forEach((item, i) => {
      const slot = this.slots[i];
      slot.replaceChildren();
      slot.title = '';
      if (!item) return;
      const def = this.content.items.get(item.itemId);
      const img = document.createElement('img');
      img.src = this.iconUrl(def?.model ?? '');
      img.alt = def?.name ?? item.itemId;
      img.draggable = false;
      slot.title = def?.name ?? item.itemId;
      slot.append(img);
      if (item.qty > 1) {
        const qty = document.createElement('span');
        qty.className = 'inv-qty';
        qty.textContent = String(item.qty);
        slot.append(qty);
      }
    });
  }
}
