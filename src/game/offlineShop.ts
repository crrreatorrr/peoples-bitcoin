/**
 * The Terminal, the exchange and saving for offline play.
 *
 * Offline play is practice: it never reports to the hub, even when the page came from a hub
 * visit. The whole game runs in this browser against a save anyone can edit, so it cannot be
 * trusted to bank Tickets, exchange them for Verse, claim the tutorial relic or post XP to the
 * leaderboard. Online worlds do all of that on the server (src/server/host.ts). See DECISIONS.md
 * "Offline practice (2026-11-19)".
 */
import { TERMINAL_SHOP_ID, TICKETS } from '../config/balance';
import { countItem } from '../sim/inventory';
import { sellListing, shopStocks } from '../sim/prices';
import type { GameState, Intent, MessageKind, Quantity, SimContext } from '../sim/state';
import type { HubBridge } from '../hub/bridge';

/** Shown in chat when offline play starts from a hub visit, and on world select. */
export const PRACTICE_NOTICE =
  'Offline Practice: does not earn Hub Tickets, Relics, or Leaderboard XP. Join a world to play for real.';

export class OfflineShop {
  constructor(
    private readonly state: GameState,
    private readonly ctx: SimContext,
    private readonly say: (text: string, kind?: MessageKind) => void,
    private readonly queue: (intent: Intent) => void,
    private readonly save: () => boolean,
    private readonly bridge: HubBridge,
  ) {}

  /** The Terminal window's status: offline it is always the local shop. */
  shopStatus(): 'local' {
    return 'local';
  }

  /** Saves the game. */
  checkpoint(): void {
    this.save();
  }

  buy(shopId: string, itemId: string, packs: number): void {
    if (!shopStocks(this.ctx.content, shopId, itemId)) {
      this.say('Unavailable');
      return;
    }
    this.queue({ type: 'buy', itemId, qty: packs });
  }

  sell(slot: number, qty: Quantity): void {
    const inventory = this.state.player.inventory;
    const stack = inventory[slot];
    const item = stack && this.ctx.content.items.get(stack.itemId);
    if (!stack || !item) return;
    const wanted = qty === 'all' ? countItem(inventory, item.id) : Math.floor(qty);
    if (!(wanted > 0)) return;
    const row = sellListing(this.ctx.content, this.openShopId(), item.id);
    if (row) {
      const packs = Math.floor(Math.min(wanted, countItem(inventory, item.id)) / row.packSize);
      if (packs < 1) {
        this.say(`You need a full pack of ${row.packSize}.`);
        return;
      }
      if (row.sellPrice * packs === 0) {
        this.say('Worth 0 Tickets');
        return;
      }
    }
    this.queue({ type: 'sell', slot, qty });
  }

  canSell(itemId: string): boolean {
    const row = sellListing(this.ctx.content, this.openShopId(), itemId);
    if (row) return row.sellPrice > 0;
    return (this.ctx.content.items.get(itemId)?.value ?? 0) > 0;
  }

  describeValue(itemId: string): void {
    const name = this.ctx.content.items.get(itemId)?.name ?? itemId;
    const row = sellListing(this.ctx.content, this.openShopId(), itemId);
    if (row) {
      if (row.sellPrice <= 0) {
        this.say('Worth 0 Tickets');
        return;
      }
      const pack = row.packSize > 1 ? `a pack of ${row.packSize} ` : 'a ';
      this.say(
        `The Terminal will pay ${row.sellPrice.toLocaleString('en-US')} Tickets for ${pack}${name}.`,
      );
      return;
    }
    const value = this.ctx.content.items.get(itemId)?.value ?? 0;
    const whole = Math.floor(value / TICKETS.usdPerTicket);
    if (whole <= 0) this.say('Worth 0 Tickets');
    else this.say(`The Terminal will pay ${whole.toLocaleString('en-US')} Tickets for a ${name}.`);
  }

  /** Offline there is nothing to exchange: Verse comes only from Tickets the hub banked. */
  exchangeAmounts(): number[] {
    return [];
  }

  requestExchange(): void {
    this.say('The exchange needs an online world.');
  }

  /** Saves, then leaves for the hub. */
  exitToHub(): void {
    this.save();
    this.bridge.exit('exit_to_hub');
  }

  private openShopId(): string {
    const ui = this.state.player.interface;
    return ui?.kind === 'terminal' ? ui.shopId : TERMINAL_SHOP_ID;
  }
}
