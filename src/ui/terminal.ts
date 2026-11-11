/**
 * A shop window. Prices come from the Ticket table, per pack. Like an OSRS
 * shop, left-click checks the price and right-click buys. Selling happens
 * from the inventory while this window is open.
 *
 * Stock is sorted into tabs (weapons, armor, tools...). Each item shows its name,
 * its price and the skill level it needs; items the player can't use yet are dimmed.
 */
import type { Content } from '../sim/content';
import type { MenuOption } from './contextmenu';
import { requirements, SHOP_CATEGORIES, shopCategory, type ShopCategoryId } from './shopCategories';
import { span, type Tooltip } from './tooltips';

export type ShopStatus = 'local' | 'ready' | 'offline' | 'pending';

export interface TerminalHandlers {
  buy(itemId: string, packs: number): void;
  /** Prints a line in the chat box. */
  message(text: string): void;
  close(): void;
  examine(itemId: string): void;
  openMenu(options: MenuOption[], x: number, y: number): void;
  /** Tickets for `packs` packs, or null if this shop doesn't stock it. */
  priceOf(itemId: string, packs: number): number | null;
  packSize(itemId: string): number;
  /** The player's level in a skill, for the "needs level" labels. */
  levelOf(skillId: string): number;
}

interface Row {
  itemId: string;
  cell: HTMLElement;
  price: HTMLElement;
  req: HTMLElement | null;
  category: ShopCategoryId;
}

const amount = new Intl.NumberFormat('en-US');

export class TerminalWindow {
  readonly el = document.createElement('div');
  private readonly grid = document.createElement('div');
  private readonly wallet = span('terminal-wallet', '');
  private readonly rate = span('terminal-rate', '');
  private readonly title = document.createElement('h2');
  private readonly tabs = document.createElement('div');
  private readonly tabButtons = new Map<ShopCategoryId, HTMLButtonElement>();
  private rows: Row[] = [];
  private closing = false;
  private key = '';
  private shopId: string | null = null;
  private status: ShopStatus = 'local';

  constructor(
    root: HTMLElement,
    private readonly content: Content,
    private readonly iconUrl: (modelId: string) => string,
    private readonly tooltip: Tooltip,
    private readonly h: TerminalHandlers,
  ) {
    this.el.className = 'terminal-window panel';
    this.el.hidden = true;
    const header = document.createElement('div');
    header.className = 'window-header';
    const close = document.createElement('button');
    close.className = 'window-close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.close());
    header.append(this.title, this.wallet, close);
    this.grid.className = 'terminal-grid';

    const footer = document.createElement('div');
    footer.className = 'terminal-footer';
    footer.append(
      this.rate,
      span('terminal-hint', 'Buy: right-click an item. Sell: click items in your inventory.'),
    );
    this.tabs.className = 'terminal-tabs';
    for (const c of SHOP_CATEGORIES) {
      const tab = document.createElement('button');
      tab.className = 'terminal-tab';
      tab.textContent = c.name;
      tab.addEventListener('click', () => this.showCategory(c.id));
      this.tabButtons.set(c.id, tab);
      this.tabs.append(tab);
    }
    this.el.append(header, this.tabs, this.grid, footer);
    root.append(this.el);
  }

  /** Fills the window with a shop's stock. */
  private build(shopId: string): void {
    const { content, iconUrl, tooltip, h } = this;
    this.shopId = shopId;
    this.key = '';
    this.grid.replaceChildren();
    this.rows = [];
    const shop = content.shops.get(shopId);
    this.title.textContent = shop?.name ?? 'Shop';
    for (const entry of shop?.stock ?? []) {
      const def = content.items.get(entry.item);
      if (!def) continue;
      const cell = document.createElement('div');
      cell.className = 'terminal-item';
      const img = document.createElement('img');
      img.src = iconUrl(def.model);
      img.alt = def.name;
      img.draggable = false;
      const price = span('terminal-price', '');
      const text = document.createElement('div');
      text.className = 'terminal-text';
      text.append(span('terminal-name', def.name));
      const req = def.requires.length > 0 ? span('terminal-req', '') : null;
      if (req) text.append(req);
      cell.append(img, text, price);
      this.rows.push({ itemId: def.id, cell, price, req, category: shopCategory(def) });
      const reqs = def.requires
        .map((r) => `${content.skills.get(r.skill)?.name ?? r.skill} ${r.level}`)
        .join(', ');
      const pack = h.packSize(def.id);
      const value = () => {
        const cost = h.priceOf(def.id, 1) ?? 0;
        const each = pack > 1 ? ` per pack of ${pack}` : '';
        h.message(`${def.name}: ${amount.format(cost)} Tickets${each}. Right-click to buy.`);
      };
      cell.addEventListener('click', value);
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const qtys = def.stackable ? [1, 10, 50, 100, 500] : [1, 5, 10];
        h.openMenu(
          [
            { action: 'Value', target: def.name, targetKind: 'item' as const, run: value },
            ...qtys.map((q) => ({
              action: pack > 1 ? `Buy ${q} pack${q === 1 ? '' : 's'}` : `Buy-${q}`,
              target: def.name,
              targetKind: 'item' as const,
              run: () => {
                if (this.status === 'offline') h.message('Offline');
                else if (this.status === 'pending') h.message('Purchase pending');
                else h.buy(def.id, q);
              },
            })),
            {
              action: 'Examine',
              target: def.name,
              targetKind: 'item',
              run: () => h.examine(def.id),
            },
          ],
          e.clientX,
          e.clientY,
        );
      });
      cell.addEventListener('mousemove', (e) => {
        const coins = h.priceOf(def.id, 1) ?? 0;
        const each = pack > 1 ? ` / pack of ${pack}` : '';
        tooltip.show(
          {
            action: 'Value',
            target: def.name,
            targetKind: 'item',
            detail: `${amount.format(coins)} Tickets${each}${reqs ? `\nRequires ${reqs}` : ''}`,
          },
          e.clientX,
          e.clientY,
        );
      });
      cell.addEventListener('mouseleave', () => tooltip.hide());
      this.grid.append(cell);
    }
    // Tabs with nothing in this shop are hidden; a small shop shows no tabs at all.
    const used = new Set(this.rows.map((r) => r.category));
    for (const [id, tab] of this.tabButtons) tab.hidden = id !== 'all' && !used.has(id);
    this.tabs.hidden = used.size < 2;
    this.showCategory('all');
  }

  private showCategory(id: ShopCategoryId): void {
    for (const [tabId, tab] of this.tabButtons) tab.classList.toggle('on', tabId === id);
    for (const row of this.rows) row.cell.hidden = id !== 'all' && row.category !== id;
    this.grid.scrollTop = 0;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  close(): void {
    if (!this.isOpen) return;
    this.closing = true;
    this.el.hidden = true;
    this.tooltip.hide();
    this.h.close();
  }

  /** `shopId` is the open shop, or null when none is. */
  update(shopId: string | null, wallet: number, status: ShopStatus): void {
    this.status = status;
    if (!shopId) this.closing = false;
    this.el.hidden = !shopId || this.closing;
    if (!shopId || this.el.hidden) return;
    if (shopId !== this.shopId) this.build(shopId);
    const levels = this.rows
      .flatMap((r) => this.content.items.get(r.itemId)?.requires ?? [])
      .map((r) => this.h.levelOf(r.skill))
      .join(',');
    const key = `${wallet}|${status}|${levels}`;
    if (key === this.key) return;
    this.key = key;
    this.wallet.textContent = `Wallet: ${amount.format(wallet)} Tickets`;
    this.rate.textContent =
      status === 'offline'
        ? 'Offline'
        : status === 'pending'
          ? 'Purchase pending'
          : 'Prices in Tickets';
    for (const row of this.rows) {
      const price = this.h.priceOf(row.itemId, 1) ?? 0;
      row.price.textContent = compact(price);
      row.price.classList.toggle('too-expensive', price > wallet);
      const def = this.content.items.get(row.itemId);
      if (!def || !row.req) continue;
      const reqs = requirements(def, this.h.levelOf);
      row.req.textContent = reqs
        .map((r) => `${this.content.skills.get(r.skill)?.name ?? r.skill} ${r.level}`)
        .join(', ');
      const locked = reqs.some((r) => !r.met);
      row.cell.classList.toggle('locked', locked);
      row.req.classList.toggle('unmet', locked);
    }
  }
}

function compact(n: number): string {
  if (n >= 10_000_000) return `${Math.floor(n / 1_000_000)}M`;
  if (n >= 100_000) return `${Math.floor(n / 1000)}K`;
  return amount.format(n);
}
