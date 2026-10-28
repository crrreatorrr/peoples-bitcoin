/**
 * Always-visible HUD: the $BITCOIN ticker with sparkline (top-left), the run
 * orb (top-right), floating XP drops and the level-up banner.
 */
import { MOVEMENT, UI } from '../config/balance';
import { COIN_TICKER } from '../config/branding';
import { marketCapUsd } from '../sim/economy';
import type { GameState } from '../sim/state';
import { span } from './tooltips';

const SPARK_W = 150;
const SPARK_H = 34;
const SPARK_UP = '#3fdc5a';
const SPARK_DOWN = '#ff5a4d';

const compactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const amount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

export function formatUsd(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toPrecision(3)}`;
}

export class Hud {
  private readonly price = span('ticker-price', '');
  private readonly change = span('ticker-change', '');
  private readonly meta = document.createElement('div');
  private readonly wallet = document.createElement('div');
  private readonly spark: CanvasRenderingContext2D;
  private readonly runOrb = document.createElement('button');
  private readonly runValue = span('orb-value', '');
  private tickerKey = '';
  private walletKey = '';
  private orbKey = '';

  constructor(
    ticker: HTMLElement,
    orbs: HTMLElement,
    private readonly xpDrops: HTMLElement,
    private readonly bannerEl: HTMLElement,
    runIcon: string,
    onToggleRun: () => void,
  ) {
    const head = document.createElement('div');
    head.className = 'ticker-head';
    head.append(span('ticker-symbol', COIN_TICKER), this.price, this.change);
    const canvas = document.createElement('canvas');
    canvas.className = 'sparkline';
    canvas.width = SPARK_W;
    canvas.height = SPARK_H;
    this.spark = canvas.getContext('2d')!;
    this.meta.className = 'ticker-meta';
    this.wallet.className = 'ticker-wallet';
    ticker.replaceChildren(head, canvas, this.meta, this.wallet);

    this.runOrb.className = 'orb orb-run';
    this.runOrb.title = 'Toggle run';
    this.runOrb.append(span('orb-icon', runIcon), this.runValue);
    this.runOrb.addEventListener('click', onToggleRun);
    orbs.replaceChildren(this.runOrb);
  }

  update(state: GameState): void {
    const econ = state.economy;
    const tickerKey = `${econ.history.length}|${econ.priceUsd}|${econ.hopium}`;
    if (tickerKey !== this.tickerKey) {
      this.tickerKey = tickerKey;
      const first = econ.history[0];
      const pct = ((econ.priceUsd - first) / first) * 100;
      const up = pct >= 0;
      this.price.textContent = formatUsd(econ.priceUsd);
      this.change.textContent = `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(2)}%`;
      this.change.className = `ticker-change ${up ? 'up' : 'down'}`;
      this.meta.textContent = `MCAP ${compactUsd.format(marketCapUsd(econ))} · HOPIUM ${Math.round(econ.hopium)}`;
      this.drawSparkline(econ.history, up);
    }

    const { bitcoin, btc } = state.player.currencies;
    const walletKey = `${bitcoin}|${btc}`;
    if (walletKey !== this.walletKey) {
      this.walletKey = walletKey;
      this.wallet.textContent = `Wallet: ${amount.format(bitcoin)} ${COIN_TICKER} · ${amount.format(btc)} BTC`;
    }

    const energy = Math.floor(state.player.runEnergy);
    const orbKey = `${energy}|${state.player.running}`;
    if (orbKey !== this.orbKey) {
      this.orbKey = orbKey;
      this.runValue.textContent = String(energy);
      this.runOrb.classList.toggle('on', state.player.running);
      this.runOrb.style.setProperty('--fill', `${(energy / MOVEMENT.runEnergyMax) * 100}%`);
    }
  }

  xpDrop(skillName: string, xp: number): void {
    const drop = span('xp-drop', `+${xp} ${skillName} XP`);
    this.xpDrops.append(drop);
    setTimeout(() => drop.remove(), UI.xpDropMs);
  }

  banner(text: string): void {
    const el = span('banner-text', text);
    this.bannerEl.replaceChildren(el);
    setTimeout(() => el.remove(), UI.bannerMs);
  }

  private drawSparkline(history: number[], up: boolean): void {
    const ctx = this.spark;
    ctx.clearRect(0, 0, SPARK_W, SPARK_H);
    if (history.length < 2) return;
    const min = Math.min(...history);
    const range = Math.max(...history) - min || 1;
    const pad = 2;
    const x = (i: number) => Math.round((i / (history.length - 1)) * (SPARK_W - 1));
    const y = (v: number) =>
      Math.round(SPARK_H - 1 - pad - ((v - min) / range) * (SPARK_H - 1 - pad * 2));

    ctx.beginPath();
    history.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    ctx.lineTo(SPARK_W - 1, SPARK_H);
    ctx.lineTo(0, SPARK_H);
    ctx.closePath();
    ctx.fillStyle = up ? 'rgba(63, 220, 90, 0.18)' : 'rgba(255, 90, 77, 0.18)';
    ctx.fill();

    ctx.beginPath();
    history.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    ctx.strokeStyle = up ? SPARK_UP : SPARK_DOWN;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
