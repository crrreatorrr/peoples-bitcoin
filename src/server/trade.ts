/**
 * Player trades, RuneScape-style: request, an offer screen where any change
 * resets both accepts (and locks Accept for a moment), a read-only confirm
 * screen with each side's Terminal value, then an atomic swap that is saved
 * for both players at once (rolled back if the save fails). Items only, never
 * Tickets (DESIGN.md §0 rule 1). Pure.
 */
import { TICKETS, TRADE } from '../config/balance';
import type { Content } from '../sim/content';
import { chebyshev } from '../sim/grid';
import { addItem, countItem, removeItem } from '../sim/inventory';
import type { GameState, InventorySlot } from '../sim/state';
import type { Quantity } from '../sim/state';
import type { TradeOfferRow, TradeOut } from '../net/protocol';
import { ignores, isFriend } from './chat';

export interface TradeMember {
  uid: string;
  name: string;
  view: GameState;
}

export interface TradeEnv {
  tick: number;
  content: Content;
  member(uid: string): TradeMember | undefined;
  send(uid: string, out: TradeOut): void;
  /** A line in the Trade chat tab. */
  notice(uid: string, text: string): void;
  /** Saves both characters in one write. False rolls the swap back. */
  persistPair(a: string, b: string): boolean;
  log(level: 'info' | 'warn', msg: string): void;
}

interface Trade {
  a: string;
  b: string;
  stage: 'offer' | 'confirm';
  offers: Record<string, InventorySlot[]>;
  accepted: Record<string, boolean>;
  lockedUntil: number;
  modifiedBy: string | null;
}

export class TradeBook {
  private readonly trades = new Map<string, Trade>();
  private readonly requests = new Map<string, { to: string; tick: number }>();

  inTrade(uid: string): boolean {
    return this.trades.has(uid);
  }

  partnerOf(uid: string): string | null {
    const t = this.trades.get(uid);
    return t ? (t.a === uid ? t.b : t.a) : null;
  }

  request(env: TradeEnv, from: TradeMember, toUid: string): void {
    const to = env.member(toUid);
    if (!to || to.uid === from.uid) return;
    const refuse = (text: string) => env.notice(from.uid, text);
    if (this.inTrade(from.uid)) return refuse("You're already trading.");
    if (this.inTrade(to.uid)) return refuse('Other player is busy at the moment.');
    if (from.view.zone !== to.view.zone) return;
    if (chebyshev(from.view.player.pos, to.view.player.pos) > TRADE.requestRange) {
      return refuse('That player is too far away.');
    }
    if (busy(from.view) || busy(to.view)) return refuse('Other player is busy at the moment.');
    const filter = to.view.player.social.tradeFilter;
    const allowed = filter === 'on' || (filter === 'friends' && isFriend(to.view, from.uid));
    if (ignores(to.view, from.uid) || !allowed)
      return refuse('Other player is busy at the moment.');
    const theirs = this.requests.get(to.uid);
    if (theirs && theirs.to === from.uid && env.tick - theirs.tick <= TRADE.requestExpiryTicks) {
      this.requests.delete(to.uid);
      this.requests.delete(from.uid);
      this.open(env, to, from);
      return;
    }
    this.requests.set(from.uid, { to: to.uid, tick: env.tick });
    refuse('Sending trade offer...');
    env.notice(to.uid, `${from.name} wishes to trade with you.`);
    env.send(to.uid, {
      stage: 'request',
      with: from.name,
      withId: from.view.selfId,
      mine: [],
      theirs: [],
      accepted: { me: false, them: false },
    });
  }

  private open(env: TradeEnv, a: TradeMember, b: TradeMember): void {
    const trade: Trade = {
      a: a.uid,
      b: b.uid,
      stage: 'offer',
      offers: { [a.uid]: [], [b.uid]: [] },
      accepted: { [a.uid]: false, [b.uid]: false },
      lockedUntil: env.tick,
      modifiedBy: null,
    };
    this.trades.set(a.uid, trade);
    this.trades.set(b.uid, trade);
    for (const m of [a, b]) m.view.player.interface = null;
    this.push(env, trade);
  }

  offer(env: TradeEnv, who: TradeMember, slot: number, qty: Quantity): void {
    const t = this.trades.get(who.uid);
    if (!t || t.stage !== 'offer') return;
    const stack = who.view.player.inventory[slot];
    const item = stack && env.content.items.get(stack.itemId);
    if (!stack || !item) return;
    if (item.value <= 0) {
      env.notice(who.uid, "You can't trade that item.");
      return;
    }
    const mine = t.offers[who.uid];
    const offered = mine.filter((r) => r.itemId === item.id).reduce((n, r) => n + r.qty, 0);
    const available = countItem(who.view.player.inventory, item.id) - offered;
    const n = Math.min(qty === 'all' ? available : Math.floor(qty), available);
    if (!(n > 0)) return;
    const row = item.stackable ? mine.find((r) => r.itemId === item.id) : undefined;
    if (row) row.qty += n;
    else if (item.stackable) mine.push({ itemId: item.id, qty: n });
    else for (let i = 0; i < n; i++) mine.push({ itemId: item.id, qty: 1 });
    this.modified(env, t, who.uid);
  }

  remove(env: TradeEnv, who: TradeMember, index: number, qty: Quantity): void {
    const t = this.trades.get(who.uid);
    if (!t || t.stage !== 'offer') return;
    const mine = t.offers[who.uid];
    const row = mine[index];
    if (!row) return;
    const n = qty === 'all' ? row.qty : Math.min(row.qty, Math.floor(qty));
    if (!(n > 0)) return;
    const stackable = env.content.items.get(row.itemId)?.stackable ?? false;
    if (stackable) {
      row.qty -= n;
      if (row.qty <= 0) mine.splice(index, 1);
    } else {
      let left = n;
      for (let i = mine.length - 1; i >= 0 && left > 0; i--) {
        if (mine[i].itemId === row.itemId) {
          mine.splice(i, 1);
          left--;
        }
      }
    }
    this.modified(env, t, who.uid);
  }

  private modified(env: TradeEnv, t: Trade, by: string): void {
    t.accepted[t.a] = false;
    t.accepted[t.b] = false;
    t.lockedUntil = env.tick + TRADE.acceptLockTicks;
    t.modifiedBy = by;
    const other = by === t.a ? t.b : t.a;
    env.notice(other, 'Other player has modified their offer.');
    this.push(env, t);
    t.modifiedBy = null;
  }

  accept(env: TradeEnv, who: TradeMember): void {
    const t = this.trades.get(who.uid);
    if (!t || env.tick < t.lockedUntil) return;
    const other = t.a === who.uid ? t.b : t.a;
    if (t.stage === 'offer') {
      const them = env.member(other);
      if (!them) return;
      // Room check: will their offer fit in my bag, and mine in theirs?
      if (!fits(env, who.view, t.offers[other], t.offers[who.uid])) {
        env.notice(who.uid, "You don't have enough inventory space for this trade.");
        return;
      }
      if (!fits(env, them.view, t.offers[who.uid], t.offers[other])) {
        env.notice(who.uid, "Other player doesn't have enough inventory space for this trade.");
        return;
      }
    }
    t.accepted[who.uid] = true;
    if (!t.accepted[other]) {
      this.push(env, t);
      return;
    }
    if (t.stage === 'offer') {
      t.stage = 'confirm';
      t.accepted[t.a] = false;
      t.accepted[t.b] = false;
      this.push(env, t);
      return;
    }
    this.swap(env, t);
  }

  decline(env: TradeEnv, uid: string, reason = 'declined'): void {
    const t = this.trades.get(uid);
    this.requests.delete(uid);
    if (!t) return;
    this.close(env, t, reason, uid);
  }

  /** Drops a player from any trade or request (logout, death, teleport, walking off). */
  cancelFor(env: TradeEnv, uid: string, reason: string): void {
    this.decline(env, uid, reason);
  }

  /** Expires old requests and cancels trades whose players drifted apart or got busy. */
  tick(env: TradeEnv): void {
    for (const [from, r] of this.requests) {
      if (env.tick - r.tick > TRADE.requestExpiryTicks) this.requests.delete(from);
    }
    for (const t of new Set(this.trades.values())) {
      const a = env.member(t.a);
      const b = env.member(t.b);
      if (!a || !b) {
        this.close(env, t, 'left', a ? t.b : t.a);
        continue;
      }
      if (a.view.zone !== b.view.zone || busy(a.view) || busy(b.view)) {
        this.close(env, t, 'interrupted', null);
      }
    }
  }

  private close(env: TradeEnv, t: Trade, reason: string, by: string | null): void {
    this.trades.delete(t.a);
    this.trades.delete(t.b);
    for (const uid of [t.a, t.b]) {
      const other = uid === t.a ? t.b : t.a;
      const name = env.member(other)?.name ?? '';
      env.send(uid, {
        stage: 'closed',
        with: name,
        mine: [],
        theirs: [],
        accepted: { me: false, them: false },
        reason,
      });
      if (reason === 'done') env.notice(uid, 'Accepted trade.');
      else if (by !== null && uid !== by) env.notice(uid, 'Other player declined trade.');
    }
  }

  private swap(env: TradeEnv, t: Trade): void {
    const a = env.member(t.a);
    const b = env.member(t.b);
    if (!a || !b) return this.close(env, t, 'left', null);
    const give = (from: TradeMember, rows: InventorySlot[]) =>
      totals(rows).every(([id, n]) => countItem(from.view.player.inventory, id) >= n);
    if (!give(a, t.offers[t.a]) || !give(b, t.offers[t.b])) {
      env.log('warn', `trade ${t.a}/${t.b}: offered items missing`);
      return this.close(env, t, 'failed', null);
    }
    const before = { a: snapshot(a.view), b: snapshot(b.view) };
    const ok = move(env, a.view, b.view, t.offers[t.a], t.offers[t.b]);
    if (!ok || !env.persistPair(t.a, t.b)) {
      a.view.player.inventory = before.a;
      b.view.player.inventory = before.b;
      env.log('warn', `trade ${t.a}/${t.b}: ${ok ? 'save failed' : 'no room'}; rolled back`);
      return this.close(env, t, 'failed', null);
    }
    env.log(
      'info',
      `trade ${t.a}->${t.b} ${JSON.stringify(t.offers[t.a])} ${t.b}->${t.a} ${JSON.stringify(t.offers[t.b])}`,
    );
    this.close(env, t, 'done', null);
  }

  private push(env: TradeEnv, t: Trade): void {
    for (const uid of [t.a, t.b]) {
      const other = uid === t.a ? t.b : t.a;
      const them = env.member(other);
      const out: TradeOut = {
        stage: t.stage,
        with: them?.name ?? '',
        withId: them?.view.selfId,
        mine: rows(env, t.offers[uid]),
        theirs: rows(env, t.offers[other]),
        accepted: { me: t.accepted[uid], them: t.accepted[other] },
        theirFree: them ? them.view.player.inventory.filter((s) => s === null).length : 0,
        lockedUntil: t.lockedUntil,
      };
      if (t.modifiedBy === other) out.modified = true;
      if (t.stage === 'confirm') {
        out.value = { mine: value(env, t.offers[uid]), theirs: value(env, t.offers[other]) };
      }
      env.send(uid, out);
    }
  }
}

function busy(view: GameState): boolean {
  const p = view.player;
  return p.dyingUntil !== null || p.teleport !== null;
}

function totals(rows: InventorySlot[]): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.itemId, (m.get(r.itemId) ?? 0) + r.qty);
  return [...m];
}

function rows(env: TradeEnv, offer: InventorySlot[]): TradeOfferRow[] {
  return offer.map((r) => ({ ...r, name: env.content.items.get(r.itemId)?.name ?? r.itemId }));
}

/** Terminal value in Tickets, a scam check on the confirm screen. */
function value(env: TradeEnv, offer: InventorySlot[]): number {
  const usd = offer.reduce(
    (sum, r) => sum + (env.content.items.get(r.itemId)?.value ?? 0) * r.qty,
    0,
  );
  return Math.floor(usd / TICKETS.usdPerTicket);
}

function snapshot(view: GameState) {
  return view.player.inventory.map((s) => (s ? { ...s } : null));
}

/** Would `incoming` fit after `outgoing` leaves? Checked on a copy. */
function fits(
  env: TradeEnv,
  view: GameState,
  incoming: InventorySlot[],
  outgoing: InventorySlot[],
): boolean {
  const bag = snapshot(view);
  for (const [id, n] of totals(outgoing)) removeItem(bag, id, n);
  for (const [id, n] of totals(incoming)) {
    const item = env.content.items.get(id);
    if (!item || !addItem(bag, item, n)) return false;
  }
  return true;
}

function move(
  env: TradeEnv,
  a: GameState,
  b: GameState,
  fromA: InventorySlot[],
  fromB: InventorySlot[],
): boolean {
  for (const [id, n] of totals(fromA)) removeItem(a.player.inventory, id, n);
  for (const [id, n] of totals(fromB)) removeItem(b.player.inventory, id, n);
  for (const [id, n] of totals(fromA)) {
    const item = env.content.items.get(id);
    if (!item || !addItem(b.player.inventory, item, n)) return false;
  }
  for (const [id, n] of totals(fromB)) {
    const item = env.content.items.get(id);
    if (!item || !addItem(a.player.inventory, item, n)) return false;
  }
  return true;
}
