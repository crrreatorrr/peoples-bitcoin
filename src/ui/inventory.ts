/**
 * 28-slot inventory grid. Left-click runs the top option, right-click lists
 * them all, shift-click drops, dragging swaps slots. Options depend on context:
 * normally the item's verb (Wield/Wear/Recite/Drink/Teleport/Summon), Use, Drop,
 * Examine; with the bank open, Deposit-1/5/10/All; at the Terminal, Value and
 * Sell-1/5/10/All. "Use" selects the item; the next click uses it on something.
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
export type UseKind = 'equip' | 'eat' | 'summon' | 'drink' | 'teleport';

export interface InventoryHandlers {
  examine(itemId: string): void;
  drop(slot: number): void;
  move(from: number, to: number): void;
  use(slot: number, kind: UseKind): void;
  /** OSRS "Use": select this slot (null clears) so the next click uses it on something. */
  select(slot: number | null): void;
  /** The slot selected with "Use", if any. */
  selected(): number | null;
  deposit(slot: number, qty: Quantity): void;
  sell(slot: number, qty: Quantity): void;
  /** False hides Sell. Shop goods worth 0 Tickets use this. */
  canSell(itemId: string): boolean;
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
  if (def.drink) return { verb: def.drink.verb, kind: 'drink' };
  if (def.teleport) return { verb: def.teleport.verb, kind: 'teleport' };
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
      const selected = this.h.selected();
      if (selected !== null) {
        // Item-on-item uses aren't a thing yet.
        this.h.select(null);
        if (selected !== index) this.h.examine('');
        return;
      }
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
      const selected = this.h.selected();
      if (selected !== null && this.items[selected]) {
        const using = this.content.items.get(this.items[selected]!.itemId)?.name ?? '';
        const target = this.content.items.get(this.items[index]!.itemId)?.name ?? '';
        // OSRS mouseover text sits top-left: white action, orange items.
        this.tooltip.showFixed({ action: 'Use', using, target, targetKind: 'item' });
        return;
      }
      const [top, ...rest] = this.options(index);
      this.tooltip.showFixed({ ...top, moreOptions: rest.length });
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
    const selected = this.h.selected();
    const key = JSON.stringify([inventory, selected]);
    if (key === this.key) return;
    this.key = key;
    this.render(inventory);
    this.slots.forEach((slot, i) => slot.classList.toggle('selected', i === selected));
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
      const sells = this.h.canSell(item.itemId)
        ? QUANTITIES.map((q) => opt(`Sell-${qtyLabel(q)}`, () => this.h.sell(index, q)))
        : [];
      return [opt('Value', () => this.h.value(item.itemId)), ...sells, examine];
    }
    const main = primaryUse(def);
    const use = opt('Use', () => this.h.select(index));
    const drop = opt('Drop', () => this.h.drop(index));
    return main
      ? [opt(main.verb, () => this.h.use(index, main.kind)), use, drop, examine]
      : [use, drop, examine];
  }

  private slotOf(e: MouseEvent): number | null {
    const slot = (e.target as HTMLElement).closest<HTMLElement>('.inv-slot');
    const index = slot ? Number(slot.dataset.slot) : -1;
    return this.items[index] ? index : null;
  }
}
