/**
 * 28-slot inventory grid. Left-click runs the top option, right-click lists
 * them all, shift-click drops, dragging swaps slots. Options depend on context:
 * normally Wield/Wear/Recite/Summon, Drop, Examine; with the bank open,
 * Deposit-1/5/10/All; at the Terminal, Value and Sell-1/5/10/All.
 * Changes go out as intents; the grid re-renders from state.
 */
import type { Content } from '../sim/content';
import type { ItemDef } from '../sim/schemas';
import type { Inventory, Quantity } from '../sim/state';
import { QUANTITIES, qtyLabel } from './bank';
import type { MenuOption } from './contextmenu';
import { qtyBadge } from './format';
import type { Tooltip } from './tooltips';

export type InventoryMode =
  { kind: 'normal' } | { kind: 'bank'; qty: Quantity } | { kind: 'terminal' };
export type UseKind = 'equip' | 'eat' | 'summon';

export interface InventoryHandlers {
  examine(itemId: string): void;
  drop(slot: number): void;
  move(from: number, to: number): void;
  use(slot: number, kind: UseKind): void;
  deposit(slot: number, qty: Quantity): void;
  sell(slot: number, qty: Quantity): void;
  value(itemId: string): void;
  openMenu(options: MenuOption[], x: number, y: number): void;
  mode(): InventoryMode;
}

const DRAG_TYPE = 'text/x-inventory-slot';

/** The item's main action verb and what it does, if any. */
export function primaryUse(def: ItemDef | undefined): { verb: string; kind: UseKind } | null {
  if (!def) return null;
  if (def.equip)
    return {
      verb: def.weapon ? 'Wield' : def.equip.slot === 'ammo' ? 'Equip' : 'Wear',
      kind: 'equip',
    };
  if (def.food) return { verb: def.food.verb, kind: 'eat' };
  if (def.summon) return { verb: 'Summon', kind: 'summon' };
  return null;
}

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
      if (e.shiftKey && this.h.mode().kind === 'normal') this.h.drop(index);
      else this.options(index)[0].run?.();
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
    const def = this.content.items.get(item.itemId);
    const name = def?.name ?? item.itemId;
    const opt = (action: string, run: () => void): MenuOption => ({
      action,
      target: name,
      targetKind: 'item',
      run,
    });
    const examine = opt('Examine', () => this.h.examine(item.itemId));
    const mode = this.h.mode();
    if (mode.kind === 'bank') {
      const deposit = (q: Quantity) =>
        opt(`Deposit-${qtyLabel(q)}`, () => this.h.deposit(index, q));
      return [deposit(mode.qty), ...QUANTITIES.filter((q) => q !== mode.qty).map(deposit), examine];
    }
    if (mode.kind === 'terminal') {
      return [
        opt('Value', () => this.h.value(item.itemId)),
        ...QUANTITIES.map((q) => opt(`Sell-${qtyLabel(q)}`, () => this.h.sell(index, q))),
        examine,
      ];
    }
    const use = primaryUse(def);
    const drop = opt('Drop', () => this.h.drop(index));
    return use
      ? [opt(use.verb, () => this.h.use(index, use.kind)), drop, examine]
      : [examine, drop];
  }

  private slotOf(e: MouseEvent): number | null {
    const slot = (e.target as HTMLElement).closest<HTMLElement>('.inv-slot');
    const index = slot ? Number(slot.dataset.slot) : -1;
    return this.items[index] ? index : null;
  }
}
