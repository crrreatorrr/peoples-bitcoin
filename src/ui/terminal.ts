/**
 * The Trading Terminal window: the stock list with live $BITCOIN prices.
 * Like an OSRS shop, left-click checks the price (Value) and right-click buys.
 * Selling happens from the inventory while this window is open.
 */
import { TERMINAL_SHOP_ID } from '../config/balance';
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
  private readonly priceLabels = new Map<string, HTMLElement>();
  private closing = false;
  private key = '';

  constructor(
    root: HTMLElement,
    content: Content,
    iconUrl: (modelId: string) => string,
    private readonly tooltip: Tooltip,
    private readonly h: TerminalHandlers,
  ) {
    this.el.className = 'terminal-window panel';
    this.el.hidden = true;
    const header = document.createElement('div');
    header.className = 'window-header';
    const title = document.createElement('h2');
    title.textContent = 'Trading Terminal';
    const close = document.createElement('button');
    close.className = 'window-close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.close());
    header.append(title, this.wallet, close);

    this.grid.className = 'terminal-grid';
    for (const entry of content.shops.get(TERMINAL_SHOP_ID)?.stock ?? []) {
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
        const btc = h.priceOf(def.id, 1) ?? 0;
        tooltip.show(
          {
            action: 'Value',
            target: def.name,
            targetKind: 'item',
            detail: `${usd} = ${amount.format(btc)} $BITCOIN${reqs ? `\nRequires ${reqs}` : ''}`,
          },
          e.clientX,
          e.clientY,
        );
      });
      cell.addEventListener('mouseleave', () => tooltip.hide());
      this.grid.append(cell);
    }

    const footer = document.createElement('div');
    footer.className = 'terminal-footer';
    footer.append(this.rate, span('terminal-hint', 'Sell: click items in your inventory.'));
    this.el.append(header, this.grid, footer);
    root.append(this.el);
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

  update(open: boolean, wallet: number, priceUsd: number): void {
    if (!open) this.closing = false;
    this.el.hidden = !open || this.closing;
    if (this.el.hidden) return;
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
