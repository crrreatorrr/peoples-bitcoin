/**
 * A shop window (the Trading Terminal, the Staffwright's stall...): the stock
 * list with live $BITCOIN prices. Like an OSRS shop, left-click checks the
 * price (Value) and right-click buys. Selling happens from the inventory
 * while this window is open.
 */
import type { Content } from '../sim/content';
import type { MenuOption } from './contextmenu';
import { formatUsd } from './hud';
import { span, type Tooltip } from './tooltips';

export interface TerminalHandlers {
  buy(itemId: string, qty: number): void;
  /** Prints a line in the chat box. */
  message(text: string): void;
  close(): void;
  examine(itemId: string): void;
  openMenu(options: MenuOption[], x: number, y: number): void;
  /** $BITCOIN for `qty` at the live price. */
  priceOf(itemId: string, qty: number): number | null;
}

const amount = new Intl.NumberFormat('en-US');

export class TerminalWindow {
  readonly el = document.createElement('div');
  private readonly grid = document.createElement('div');
  private readonly wallet = span('terminal-wallet', '');
  private readonly rate = span('terminal-rate', '');
  private readonly title = document.createElement('h2');
  private readonly priceLabels = new Map<string, HTMLElement>();
  private closing = false;
  private key = '';
  private shopId: string | null = null;

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
    this.el.append(header, this.grid, footer);
    root.append(this.el);
  }

  /** Fills the window with a shop's stock. */
  private build(shopId: string): void {
    const { content, iconUrl, tooltip, h } = this;
    this.shopId = shopId;
    this.key = '';
    this.grid.replaceChildren();
    this.priceLabels.clear();
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
      this.priceLabels.set(def.id, price);
      cell.append(img, price);
      const reqs = def.requires
        .map((r) => `${content.skills.get(r.skill)?.name ?? r.skill} ${r.level}`)
        .join(', ');
      const usd = `$${entry.priceUsd.toLocaleString('en-US')}`;
      const value = () =>
        h.message(
          `${def.name}: currently costs ${amount.format(h.priceOf(def.id, 1) ?? 0)} $BITCOIN (${usd}). Right-click to buy.`,
        );
      cell.addEventListener('click', value);
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const qtys = def.stackable ? [1, 10, 50, 100, 500] : [1, 5, 10];
        h.openMenu(
          [
            { action: 'Value', target: def.name, targetKind: 'item' as const, run: value },
            ...qtys.map((q) => ({
              action: `Buy-${q}`,
              target: def.name,
              targetKind: 'item' as const,
              run: () => h.buy(def.id, q),
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
        tooltip.show(
          {
            action: 'Value',
            target: def.name,
            targetKind: 'item',
            detail: `${usd} = ${amount.format(coins)} $BITCOIN${reqs ? `\nRequires ${reqs}` : ''}`,
          },
          e.clientX,
          e.clientY,
        );
      });
      cell.addEventListener('mouseleave', () => tooltip.hide());
      this.grid.append(cell);
    }
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
  update(shopId: string | null, wallet: number, priceUsd: number): void {
    if (!shopId) this.closing = false;
    this.el.hidden = !shopId || this.closing;
    if (!shopId || this.el.hidden) return;
    if (shopId !== this.shopId) this.build(shopId);
    const key = `${wallet}|${priceUsd}`;
    if (key === this.key) return;
    this.key = key;
    this.wallet.textContent = `Wallet: ${amount.format(wallet)} $BITCOIN`;
    this.rate.textContent = `1 $BITCOIN = ${formatUsd(priceUsd)}`;
    for (const [itemId, label] of this.priceLabels) {
      const price = this.h.priceOf(itemId, 1) ?? 0;
      label.textContent = compact(price);
      label.classList.toggle('too-expensive', price > wallet);
    }
  }
}

function compact(n: number): string {
  if (n >= 10_000_000) return `${Math.floor(n / 1_000_000)}M`;
  if (n >= 100_000) return `${Math.floor(n / 1000)}K`;
  return amount.format(n);
}
