/**
 * Always-visible HUD: the Ticket wallet (top-left), the orbs beside the
 * minimap (XP counter toggle, Hitpoints, run), the XP counter, floating XP
 * drops and the level-up banner.
 */
import { MOVEMENT, SUMMONING, UI } from '../config/balance';
import { COIN_TICKER } from '../config/branding';
import { maxHp, type GameState } from '../sim/state';
import { span } from './tooltips';

const amount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export class Hud {
  private readonly wallet = document.createElement('div');
  private readonly runOrb = document.createElement('button');
  private readonly runValue = span('orb-value', '');
  private readonly hpOrb = document.createElement('div');
  private readonly hpValue = span('orb-value', '');
  private readonly specialOrb = document.createElement('button');
  private readonly specialValue = span('orb-value', '');
  private specialKey = '';
  private readonly xpButton = document.createElement('button');
  private readonly xpTotal = span('xp-total', '');
  private walletKey = '';
  private orbKey = '';
  private hpKey = '';
  private xpKey = '';

  constructor(
    ticker: HTMLElement,
    orbs: HTMLElement,
    private readonly xpCounter: HTMLElement,
    private readonly xpDrops: HTMLElement,
    private readonly bannerEl: HTMLElement,
    glyph: (id: string) => string,
    onToggleRun: () => void,
    onSpecial: () => void,
  ) {
    const head = document.createElement('div');
    head.className = 'ticker-head';
    head.append(span('ticker-symbol', COIN_TICKER));
    this.wallet.className = 'ticker-wallet';
    ticker.replaceChildren(head, this.wallet);

    this.xpButton.className = 'orb orb-xp';
    this.xpButton.title = 'Toggle XP counter';
    this.xpButton.textContent = glyph('orb_xp');
    this.xpButton.addEventListener('click', () => {
      this.xpCounter.hidden = !this.xpCounter.hidden;
      this.xpButton.classList.toggle('on', !this.xpCounter.hidden);
    });
    this.xpCounter.replaceChildren(span('xp-label', 'Total XP'), this.xpTotal);

    this.hpOrb.className = 'orb orb-hp';
    this.hpOrb.title = 'Hitpoints';
    this.hpOrb.append(span('orb-icon', glyph('orb_hp')), this.hpValue);

    this.runOrb.className = 'orb orb-run';
    this.runOrb.title = 'Motion (run energy): toggle run';
    this.runOrb.append(span('orb-icon', glyph('orb_run')), this.runValue);
    this.runOrb.addEventListener('click', onToggleRun);
    this.specialOrb.className = 'orb orb-special';
    this.specialOrb.title = "Use your Sproto's special";
    this.specialOrb.append(span('orb-icon', glyph('orb_special')), this.specialValue);
    this.specialOrb.addEventListener('click', onSpecial);
    orbs.replaceChildren(this.xpButton, this.hpOrb, this.runOrb, this.specialOrb);
  }

  update(state: GameState): void {
    const tickets = state.player.currencies.tickets;
    const walletKey = `${tickets}`;
    if (walletKey !== this.walletKey) {
      this.walletKey = walletKey;
      this.wallet.textContent = `Wallet: ${amount.format(tickets)} ${COIN_TICKER}`;
    }

    const hp = state.player.hp;
    const max = maxHp(state.player);
    const hpKey = `${hp}|${max}`;
    if (hpKey !== this.hpKey) {
      this.hpKey = hpKey;
      this.hpValue.textContent = String(hp);
      this.hpOrb.style.setProperty('--fill', `${(hp / max) * 100}%`);
      this.hpOrb.classList.toggle('low', hp <= max * 0.3);
    }

    const points = Math.floor(state.player.summoning.points);
    const specialKey = `${points}|${state.player.sproto !== null}`;
    if (specialKey !== this.specialKey) {
      this.specialKey = specialKey;
      this.specialValue.textContent = String(points);
      this.specialOrb.style.setProperty('--fill', `${(points / SUMMONING.pointsMax) * 100}%`);
      this.specialOrb.classList.toggle('on', state.player.sproto !== null);
    }

    const totalXp = Object.values(state.player.skills).reduce((a, b) => a + b, 0);
    const xpKey = String(totalXp);
    if (xpKey !== this.xpKey) {
      this.xpKey = xpKey;
      this.xpTotal.textContent = Math.floor(totalXp).toLocaleString('en-US');
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

  /** One OSRS-style drop per tick: each skill's icon and the XP it gained. */
  xpDrop(drops: { icon: string; amount: number }[]): void {
    const drop = document.createElement('div');
    drop.className = 'xp-drop';
    for (const d of drops) {
      drop.append(
        span('xp-drop-icon', d.icon),
        span('xp-drop-amount', `+${Math.round(d.amount * 10) / 10}`),
      );
    }
    this.xpDrops.append(drop);
    setTimeout(() => drop.remove(), UI.xpDropMs);
  }

  banner(text: string): void {
    const el = span('banner-text', text);
    this.bannerEl.replaceChildren(el);
    setTimeout(() => el.remove(), UI.bannerMs);
  }
}
