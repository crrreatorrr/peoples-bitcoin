/**
 * Ticket → Verse window. Amounts are steps of 10 up to 500, limited by the
 * server balance when we know it. An unacked exchange blocks new amounts.
 */
import { span } from './tooltips';

export class ExchangeWindow {
  readonly el = document.createElement('div');
  private readonly amounts = document.createElement('div');
  private readonly status = span('exchange-status', '');
  private readonly wallet = span('terminal-wallet', '');
  private closing = false;
  private key = '';

  constructor(
    root: HTMLElement,
    private readonly onExchange: (tickets: number) => void,
    private readonly onClose: () => void,
  ) {
    this.el.className = 'terminal-window panel exchange-window';
    this.el.hidden = true;
    const header = document.createElement('div');
    header.className = 'window-header';
    const title = document.createElement('h2');
    title.textContent = 'Exchange';
    const close = document.createElement('button');
    close.className = 'window-close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.close());
    header.append(title, this.wallet, close);
    this.amounts.className = 'exchange-amounts';
    const footer = document.createElement('div');
    footer.className = 'terminal-footer';
    footer.append(this.status, span('terminal-hint', '10 Tickets become 1 Verse.'));
    this.el.append(header, this.amounts, footer);
    root.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  close(): void {
    if (!this.isOpen) return;
    this.closing = true;
    this.el.hidden = true;
    this.onClose();
  }

  update(
    open: boolean,
    wallet: number,
    amounts: number[],
    pending: boolean,
    verseLeft: number | null,
    hub: boolean,
  ): void {
    if (!open) this.closing = false;
    this.el.hidden = !open || this.closing;
    if (!open || this.el.hidden) return;
    const key = `${wallet}|${amounts.join(',')}|${pending}|${verseLeft}|${hub}`;
    if (key === this.key) return;
    this.key = key;
    this.wallet.textContent = `Tickets: ${wallet.toLocaleString('en-US')}`;
    this.amounts.replaceChildren();
    if (!hub) {
      this.status.textContent = 'The exchange needs the hub.';
      return;
    }
    if (pending) {
      this.status.textContent = 'Exchange pending';
      return;
    }
    const parts = ['Choose an amount.'];
    if (verseLeft != null) parts.push(`Verse left today: ${verseLeft}`);
    this.status.textContent = parts.join(' ');
    for (const amount of amounts) {
      const button = document.createElement('button');
      button.className = 'stone-btn';
      button.textContent = amount.toLocaleString('en-US');
      button.addEventListener('click', () => this.onExchange(amount));
      this.amounts.append(button);
    }
    if (amounts.length === 0) this.status.textContent = 'Not enough Tickets.';
  }
}
