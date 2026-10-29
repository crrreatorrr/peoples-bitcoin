/**
 * Keeps the save and the hub in step. Network calls happen here, never in src/sim.
 * Standalone play (no hub session) shops locally and never banks or exchanges.
 */
import { TERMINAL_SHOP_ID, TICKETS } from '../config/balance';
import { giveItem } from '../sim/ground';
import { countItem, removeItem } from '../sim/inventory';
import {
  ackStreamBatch,
  dropStreamBatch,
  openStreamBatch,
  setTicketBalance,
  undoStreamBatch,
} from '../sim/ledger';
import { sellListing } from '../sim/prices';
import { progressQuests } from '../sim/quests';
import {
  STREAM_REASONS,
  type GameState,
  type Intent,
  type MessageKind,
  type Quantity,
  type QuestEarn,
  type SimContext,
  type SimEvent,
  type StreamReason,
} from '../sim/state';
import {
  HubBridge,
  capRemaining,
  errorCode,
  ticketLimitMessage,
  type ExchangeCallResult,
  type TicketSnapshot,
} from './bridge';
import { HubSdkError } from '@metaverse/hub-sdk';
import { questEarnWireKey, uuidv7 } from './uuid';

const QUEST_REASON = 'pb_quest';

export class HubClient {
  private readonly bridge = new HubBridge();
  private readonly inflight = new Set<string>();

  constructor(
    private readonly state: GameState,
    private readonly ctx: SimContext,
    private readonly say: (text: string, kind?: MessageKind) => void,
    private readonly queue: (intent: Intent) => void,
    private readonly save: () => boolean,
  ) {}

  async start(): Promise<void> {
    const outcome = await Promise.race([
      this.bridge.init().then(() => 'ok' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 8000)),
    ]);
    if (outcome === 'timeout') console.warn('[hub] init timed out; running standalone');
    this.applyLink();
    if (this.state.hubSession.mode !== 'hub') return;
    // Server wallet replaces the save, including a v7 1:1 bitcoin migration.
    // That migrated number is not in any earn batch, so it is not banked.
    const balance = await this.bridge.getTicketBalance();
    if (balance != null) this.applySnapshot(balance);
    const opened = this.sealSync();
    if (!this.save()) {
      this.undo(opened);
      return;
    }
    await this.sendPending('session');
    if (this.state.player.quests.quest_tutorial?.complete) await this.reportRelic(this.state.tick);
    await this.flushScore();
  }

  /** Shop window status. `local` is the standalone shop. */
  shopStatus(): 'local' | 'ready' | 'offline' | 'pending' {
    if (this.state.hubSession.mode !== 'hub') return 'local';
    if (this.state.player.ledger.purchase) return 'pending';
    return this.bridge.shopReady() ? 'ready' : 'offline';
  }

  onEvents(events: SimEvent[]): void {
    let bank = false;
    for (const event of events) {
      if (event.type === 'questComplete' && event.questId === 'quest_tutorial') {
        void this.reportRelic(event.tick);
      } else if (event.type === 'questEarn') {
        void this.sendQuestNamed(event.name);
      } else if (event.type === 'autosave' || event.type === 'zoneChanged') {
        bank = true;
      }
    }
    if (bank) this.checkpoint();
  }

  checkpoint(): void {
    const opened = this.sealSync();
    if (!this.save()) {
      this.undo(opened);
      return;
    }
    void this.sendPending('checkpoint');
  }

  /** Opens batches and assigns quest keys. Caller saves before any send. */
  sealSync(): { reason: StreamReason; id: string }[] {
    const opened: { reason: StreamReason; id: string }[] = [];
    if (this.state.hubSession.mode !== 'hub') return opened;
    for (const reason of STREAM_REASONS) {
      if (this.state.player.ledger.batches[reason]) continue;
      const id = uuidv7();
      if (openStreamBatch(this.state, reason, id)) opened.push({ reason, id });
    }
    for (const row of this.state.player.ledger.questEarns) {
      if ((row.status === 'pending' || row.status === 'capped') && !row.key) {
        row.key = questEarnWireKey(row.name);
      }
    }
    return opened;
  }

  buy(shopId: string, itemId: string, packs: number): void {
    const status = this.shopStatus();
    if (status === 'offline') {
      this.say('Offline');
      return;
    }
    if (status === 'pending') {
      this.say('Purchase pending');
      return;
    }
    if (status === 'local') {
      this.queue({ type: 'buy', itemId, qty: packs });
      return;
    }
    const row = this.ctx.content.ticketPrices.find(
      (r) => r.shopId === shopId && r.itemId === itemId,
    );
    if (!row || packs < 1) {
      this.say('Unavailable');
      return;
    }
    const key = uuidv7();
    this.state.player.ledger.purchase = { key, shopId, itemId, packs };
    if (!this.save()) {
      this.state.player.ledger.purchase = null;
      this.say('Saving is unavailable in this browser.');
      return;
    }
    void this.sendPurchase();
  }

  sell(slot: number, qty: Quantity): void {
    const player = this.state.player;
    if (player.ledger.sale) {
      this.say('Sale pending');
      return;
    }
    const stack = player.inventory[slot];
    const item = stack && this.ctx.content.items.get(stack.itemId);
    if (!stack || !item) return;
    const wanted = qty === 'all' ? countItem(player.inventory, item.id) : Math.floor(qty);
    if (!(wanted > 0)) return;
    const row = sellListing(this.ctx.content, this.openShopId(), item.id);
    if (row) {
      const packs = Math.floor(wanted / row.packSize);
      if (packs < 1) {
        this.say(`You need a full pack of ${row.packSize}.`);
        return;
      }
      if (row.sellPrice * packs === 0) {
        this.say('Worth 0 Tickets');
        return;
      }
      if (this.shopStatus() === 'local') {
        this.queue({ type: 'sell', slot, qty });
        return;
      }
      if (!this.bridge.shopReady()) {
        this.say('Offline');
        return;
      }
      const key = uuidv7();
      player.ledger.sale = { key, shopId: row.shopId, itemId: item.id, packs, slot };
      if (!this.save()) {
        player.ledger.sale = null;
        this.say('Saving is unavailable in this browser.');
        return;
      }
      void this.sendSale();
      return;
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
    const whole = Math.floor((value * 1) / TICKETS.usdPerTicket);
    if (whole <= 0) this.say('Worth 0 Tickets');
    else this.say(`The Terminal will pay ${whole.toLocaleString('en-US')} Tickets for a ${name}.`);
  }

  exchangeAmounts(): number[] {
    if (this.state.hubSession.mode !== 'hub') return [];
    if (this.state.player.ledger.exchange) return [];
    const server = this.state.hubSession.serverBalance;
    const cap = server == null ? TICKETS.exchangeMax : Math.min(TICKETS.exchangeMax, server);
    const amounts: number[] = [];
    for (let n = TICKETS.exchangeStep; n <= cap; n += TICKETS.exchangeStep) amounts.push(n);
    return amounts;
  }

  requestExchange(tickets: number): void {
    if (this.state.hubSession.mode !== 'hub') {
      this.say('The exchange needs the hub.');
      return;
    }
    if (this.state.player.ledger.exchange) {
      this.say('Exchange pending');
      return;
    }
    const amount = Math.floor(tickets / TICKETS.exchangeStep) * TICKETS.exchangeStep;
    if (amount < TICKETS.exchangeStep || amount > TICKETS.exchangeMax) return;
    const server = this.state.hubSession.serverBalance;
    if (server != null && amount > server) {
      this.say('Not enough Tickets.');
      return;
    }
    const id = uuidv7();
    this.state.player.ledger.exchange = { id, tickets: amount };
    if (!this.save()) {
      this.state.player.ledger.exchange = null;
      this.say('Saving is unavailable in this browser.');
      return;
    }
    void this.sendExchange();
  }

  async exitToHub(): Promise<void> {
    const opened = this.sealSync();
    if (!this.save()) this.undo(opened);
    await this.sendPending('checkpoint');
    await this.flushScore();
    this.bridge.exit('exit_to_hub');
  }

  logReset(): void {
    const ledger = this.state.player.ledger;
    const quests = ledger.questEarns.filter(
      (row) => row.status === 'pending' || row.status === 'capped',
    );
    const pending = STREAM_REASONS.filter((reason) => ledger.streams[reason].pending > 0);
    if (
      Object.keys(ledger.batches).length > 0 ||
      ledger.exchange ||
      ledger.purchase ||
      ledger.sale ||
      quests.length > 0 ||
      pending.length > 0
    ) {
      console.warn('[hub] reset dropping unacked writes', {
        batches: ledger.batches,
        pending,
        exchange: ledger.exchange,
        purchase: ledger.purchase,
        sale: ledger.sale,
        quests,
      });
    }
  }

  private applySnapshot(snap: TicketSnapshot): void {
    setTicketBalance(this.state, snap.balance);
    this.state.hubSession.sessionCapLeft = snap.sessionCapLeft;
    this.state.hubSession.dailyCapLeft = snap.dailyCapLeft;
  }

  /** Shrink the rooms we last heard from the server after a credit lands. */
  private noteCredit(amount: number): void {
    if (!(amount > 0)) return;
    const link = this.state.hubSession;
    if (link.sessionCapLeft != null)
      link.sessionCapLeft = Math.max(0, link.sessionCapLeft - amount);
    if (link.dailyCapLeft != null) link.dailyCapLeft = Math.max(0, link.dailyCapLeft - amount);
  }

  private rememberCaps(err: unknown): void {
    if (!(err instanceof HubSdkError)) return;
    const link = this.state.hubSession;
    if (typeof err.sessionCapLeft === 'number') link.sessionCapLeft = err.sessionCapLeft;
    if (typeof err.dailyCapLeft === 'number') link.dailyCapLeft = err.dailyCapLeft;
    if (typeof err.capLeft === 'number' && err.code === 'session_ticket_cap') {
      link.sessionCapLeft = err.capLeft;
    }
    if (typeof err.capLeft === 'number' && err.code === 'daily_ticket_cap') {
      link.dailyCapLeft = err.capLeft;
    }
  }

  private applyLink(): void {
    const link = this.state.hubSession;
    link.mode = this.bridge.mode;
    link.reachable = this.bridge.reachable;
    // Effects apply for this session only. They are not part of the save.
    link.effects = { ...this.bridge.effects };
  }

  private openShopId(): string {
    const ui = this.state.player.interface;
    return ui?.kind === 'terminal' ? ui.shopId : TERMINAL_SHOP_ID;
  }

  private undo(opened: { reason: StreamReason; id: string }[]): void {
    for (const row of opened) undoStreamBatch(this.state, row.reason, row.id);
  }

  private async sendPending(when: 'checkpoint' | 'session'): Promise<void> {
    if (this.state.hubSession.mode !== 'hub') return;
    const sid = this.bridge.sessionId();
    for (const reason of STREAM_REASONS) {
      const batch = this.state.player.ledger.batches[reason];
      if (batch) await this.sendBatch(reason, batch.id, batch.amount);
    }
    for (const row of this.state.player.ledger.questEarns) {
      const newSession = sid !== '' && sid !== row.cappedSessionId;
      if (
        row.status === 'pending' ||
        (when === 'session' && row.status === 'capped' && newSession)
      ) {
        await this.sendQuest(row);
      }
    }
    if (this.state.player.ledger.exchange) await this.sendExchange();
    if (this.state.player.ledger.purchase) await this.sendPurchase();
    if (this.state.player.ledger.sale) await this.sendSale();
  }

  private async sendBatch(reason: StreamReason, id: string, amount: number): Promise<void> {
    const token = `earn:${id}`;
    if (this.inflight.has(token)) return;
    this.inflight.add(token);
    try {
      const result = await this.bridge.earnTickets(amount, reason, id);
      if (result.capped) {
        console.warn('[hub] earn batch hit the cap; dropping it', { reason, id, amount });
        dropStreamBatch(this.state, reason, id, result.balance);
        this.say(ticketLimitMessage());
      } else {
        ackStreamBatch(this.state, reason, id, result.balance);
        this.noteCredit(amount);
      }
      this.save();
    } catch (err) {
      const code = errorCode(err);
      this.rememberCaps(err);
      if (isStreamTerminal(code)) {
        console.warn('[hub] earn batch dropped', { reason, id, amount, code });
        dropStreamBatch(this.state, reason, id, null);
        this.say(isCap(code) ? ticketLimitMessage(capRemaining(err)) : 'Could not bank Tickets.');
        this.save();
      } else {
        this.bridge.noteFailure(err);
        console.warn('[hub] earn batch will retry', { reason, id, code });
      }
    } finally {
      this.inflight.delete(token);
    }
  }

  private async sendQuestNamed(name: string): Promise<void> {
    const row = this.state.player.ledger.questEarns.find((earn) => earn.name === name);
    if (!row) return;
    if (!row.key) row.key = questEarnWireKey(row.name);
    if (!this.save()) return;
    await this.sendQuest(row);
  }

  private async sendQuest(row: QuestEarn): Promise<void> {
    if (this.state.hubSession.mode !== 'hub') return;
    if (!row.key) row.key = questEarnWireKey(row.name);
    const token = `quest:${row.key}`;
    if (this.inflight.has(token)) return;
    if (!this.save()) return;
    this.inflight.add(token);
    try {
      const result = await this.bridge.earnTickets(row.amount, QUEST_REASON, row.key);
      row.status = 'acked';
      row.cappedSessionId = null;
      if (result.balance != null) setTicketBalance(this.state, result.balance);
      if (!result.capped) this.noteCredit(row.amount);
      this.save();
    } catch (err) {
      const code = errorCode(err);
      this.rememberCaps(err);
      if (code === 'session_ticket_cap') {
        row.status = 'capped';
        row.cappedSessionId = this.bridge.sessionId() || row.cappedSessionId;
        console.warn('[hub] quest earn session_ticket_cap; resend on the next session', {
          name: row.name,
          key: row.key,
          cappedSessionId: row.cappedSessionId,
        });
        this.say(ticketLimitMessage(capRemaining(err)));
        this.save();
      } else if (isQuestTerminal(code)) {
        row.status = 'acked';
        row.cappedSessionId = null;
        console.warn('[hub] quest earn acked and dropped', { name: row.name, code });
        this.save();
      } else {
        this.bridge.noteFailure(err);
        console.warn('[hub] quest earn will retry', { name: row.name, code });
      }
    } finally {
      this.inflight.delete(token);
    }
  }

  private async sendPurchase(): Promise<void> {
    const order = this.state.player.ledger.purchase;
    if (!order) return;
    const token = `buy:${order.key}`;
    if (this.inflight.has(token)) return;
    this.inflight.add(token);
    try {
      const result = await this.bridge.spendTickets(
        order.shopId,
        order.itemId,
        order.packs,
        order.key,
      );
      this.finishPurchase(order.key, order.itemId, result.units, result.balance);
    } catch (err) {
      this.failPurchase(order.key, err);
    } finally {
      this.inflight.delete(token);
    }
  }

  private finishPurchase(key: string, itemId: string, units: number, balance: number): void {
    const ledger = this.state.player.ledger;
    if (ledger.purchase?.key === key) ledger.purchase = null;
    if (!ledger.fulfilledKeys.includes(key)) {
      ledger.fulfilledKeys = [...ledger.fulfilledKeys, key].slice(-100);
      setTicketBalance(this.state, balance);
      const events: SimEvent[] = [];
      giveItem(this.state, this.ctx, itemId, units, events);
      progressQuests(this.state, this.ctx, { type: 'buy', item: itemId }, events);
      this.play(events);
    }
    this.save();
  }

  private failPurchase(key: string, err: unknown): void {
    const code = errorCode(err);
    this.rememberCaps(err);
    if (isShopTerminal(code)) {
      if (this.state.player.ledger.purchase?.key === key) this.state.player.ledger.purchase = null;
      this.save();
      if (code === 'insufficient_tickets') this.say('Not enough Tickets.');
      else if (code === 'unknown_item') this.say('Unavailable');
      else if (code === 'zero_value') this.say('Worth 0 Tickets');
      else if (isCap(code) || code === 'amount_over_rule') {
        console.warn('[hub] purchase refused', { key, code });
        this.say(ticketLimitMessage(capRemaining(err)));
      } else console.warn('[hub] purchase idempotency_mismatch', { key });
      return;
    }
    this.bridge.noteFailure(err);
    this.say('Purchase pending');
  }

  private async sendSale(): Promise<void> {
    const order = this.state.player.ledger.sale;
    if (!order) return;
    const token = `sell:${order.key}`;
    if (this.inflight.has(token)) return;
    const row = this.ctx.content.ticketPrices.find(
      (price) => price.shopId === order.shopId && price.itemId === order.itemId,
    );
    if (row && row.sellPrice * order.packs === 0) {
      this.state.player.ledger.sale = null;
      this.save();
      this.say('Worth 0 Tickets');
      return;
    }
    this.inflight.add(token);
    try {
      const result = await this.bridge.sellItem(order.shopId, order.itemId, order.packs, order.key);
      if (result.credited != null) this.noteCredit(result.credited);
      this.finishSale(order.key, order.itemId, order.slot, result.units, result.balance);
    } catch (err) {
      this.failSale(order.key, err);
    } finally {
      this.inflight.delete(token);
    }
  }

  private finishSale(
    key: string,
    itemId: string,
    slot: number,
    units: number,
    balance: number,
  ): void {
    const ledger = this.state.player.ledger;
    if (ledger.sale?.key === key) ledger.sale = null;
    if (!ledger.fulfilledKeys.includes(key)) {
      ledger.fulfilledKeys = [...ledger.fulfilledKeys, key].slice(-100);
      takeUnits(this.state, itemId, units, slot);
      setTicketBalance(this.state, balance);
      const events: SimEvent[] = [];
      progressQuests(this.state, this.ctx, { type: 'sell' }, events);
      this.play(events);
      const name = this.ctx.content.items.get(itemId)?.name ?? itemId;
      this.say(`You sell ${units.toLocaleString('en-US')} × ${name}.`);
    }
    this.save();
  }

  private failSale(key: string, err: unknown): void {
    const code = errorCode(err);
    this.rememberCaps(err);
    if (!isShopTerminal(code)) {
      this.bridge.noteFailure(err);
      this.say('Sale pending');
      return;
    }
    if (this.state.player.ledger.sale?.key === key) this.state.player.ledger.sale = null;
    this.save();
    if (code === 'zero_value') this.say('Worth 0 Tickets');
    else if (code === 'unknown_item') this.say('Unavailable');
    else if (isCap(code) || code === 'amount_over_rule') {
      console.warn('[hub] sale refused', { key, code });
      this.say(ticketLimitMessage(capRemaining(err)));
    } else if (code === 'idempotency_mismatch') {
      console.warn('[hub] sale idempotency_mismatch', { key });
    } else this.say('Not enough Tickets.');
  }

  private async sendExchange(): Promise<void> {
    const order = this.state.player.ledger.exchange;
    if (!order) return;
    const token = `exchange:${order.id}`;
    if (this.inflight.has(token)) return;
    this.inflight.add(token);
    try {
      const result = await this.bridge.exchange(order.tickets, order.id);
      this.applyExchange(order.id, result);
    } catch (err) {
      const code = errorCode(err);
      if (
        isCap(code) ||
        code === 'insufficient_tickets' ||
        code === 'idempotency_mismatch' ||
        code === 'below_rate'
      ) {
        if (this.state.player.ledger.exchange?.id === order.id)
          this.state.player.ledger.exchange = null;
        this.save();
        console.warn('[hub] exchange dropped', { id: order.id, code });
        this.say(isCap(code) ? ticketLimitMessage(capRemaining(err)) : 'Not enough Tickets.');
      } else {
        this.bridge.noteFailure(err);
        this.say('Exchange pending');
      }
    } finally {
      this.inflight.delete(token);
    }
  }

  private applyExchange(id: string, result: ExchangeCallResult): void {
    const ledger = this.state.player.ledger;
    const receipt = result.receiptId;
    if (receipt && ledger.appliedReceipts.includes(receipt)) {
      if (ledger.exchange?.id === id) ledger.exchange = null;
      this.save();
      return;
    }
    if (receipt) ledger.appliedReceipts = [...ledger.appliedReceipts, receipt].slice(-100);
    if (result.balance != null) setTicketBalance(this.state, result.balance);
    else if (result.ticketsDebited != null) {
      this.state.player.currencies.tickets = Math.max(
        0,
        this.state.player.currencies.tickets - result.ticketsDebited,
      );
    }
    if (result.verseCapLeft != null) this.state.hubSession.verseCapLeft = result.verseCapLeft;
    if (ledger.exchange?.id === id) ledger.exchange = null;
    this.save();
    if (result.verseCapLeft != null) this.say(`Verse left today: ${result.verseCapLeft}`);
  }

  private async reportRelic(tick: number): Promise<void> {
    if (this.state.hubSession.mode !== 'hub') return;
    const ledger = this.state.player.ledger;
    if (ledger.relicAcked) return;
    if (!ledger.relicKey) {
      ledger.relicKey = uuidv7();
      ledger.relicTick = tick;
    }
    if (!this.save()) return;
    const key = ledger.relicKey;
    const sentTick = ledger.relicTick ?? tick;
    const token = `relic:${key}`;
    if (this.inflight.has(token)) return;
    this.inflight.add(token);
    try {
      await this.bridge.reportQuest(key, sentTick);
      ledger.relicAcked = true;
      this.save();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'idempotency_mismatch') {
        console.warn('[hub] relic event dropped', { key, code });
        ledger.relicAcked = true;
        this.save();
      } else {
        this.bridge.noteFailure(err);
        console.warn('[hub] relic event will retry', { key, code });
      }
    } finally {
      this.inflight.delete(token);
    }
  }

  private async flushScore(): Promise<void> {
    if (this.state.hubSession.mode !== 'hub') return;
    const xp = Math.floor(Object.values(this.state.player.skills).reduce((sum, n) => sum + n, 0));
    if (xp <= this.state.player.ledger.submittedXp) return;
    try {
      await this.bridge.submitXp(xp);
      this.state.player.ledger.submittedXp = xp;
      this.save();
    } catch (err) {
      console.warn('[hub] score will retry', err);
    }
  }

  private play(events: SimEvent[]): void {
    for (const event of events) {
      if (event.type === 'message') this.say(event.text, event.kind);
      else if (event.type === 'questComplete' && event.questId === 'quest_tutorial')
        void this.reportRelic(event.tick);
      else if (event.type === 'questEarn') void this.sendQuestNamed(event.name);
    }
  }
}

function isCap(code: string): boolean {
  return code.endsWith('_cap');
}

/** Stream batches are not resent after a terminal rejection. */
function isStreamTerminal(code: string): boolean {
  return code === 'idempotency_mismatch' || code === 'amount_over_rule' || code.endsWith('_cap');
}

/**
 * Quest earns: session_ticket_cap stays pending. These codes are finished
 * (acked) and not resent.
 */
function isShopTerminal(code: string): boolean {
  return (
    code === 'unknown_item' ||
    code === 'insufficient_tickets' ||
    code === 'zero_value' ||
    code === 'amount_over_rule' ||
    code === 'idempotency_mismatch' ||
    code.endsWith('_cap')
  );
}

function isQuestTerminal(code: string): boolean {
  if (code === 'session_ticket_cap') return false;
  return code === 'idempotency_mismatch' || code === 'amount_over_rule' || code.endsWith('_cap');
}

function takeUnits(state: GameState, itemId: string, units: number, slot: number): void {
  let left = units;
  const stack = state.player.inventory[slot];
  if (stack?.itemId === itemId) {
    const take = Math.min(stack.qty, left);
    stack.qty -= take;
    left -= take;
    if (stack.qty === 0) state.player.inventory[slot] = null;
  }
  if (left > 0) removeItem(state.player.inventory, itemId, left);
}
