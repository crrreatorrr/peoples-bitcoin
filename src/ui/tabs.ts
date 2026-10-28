/**
 * Side-panel tabs that read game state: Equipment (gear, bonuses, combat
 * styles) and Summoning (the active Sproto and its special). Quests live in
 * quests.ts.
 */
import { SUMMONING, TICK_MS } from '../config/balance';
import { combatLevel } from '../sim/combat';
import type { Content } from '../sim/content';
import { armorTotals, attackProfile, GUN_STYLES, MELEE_STYLES } from '../sim/equipment';
import { EQUIP_SLOTS } from '../sim/schemas';
import type { CombatStyle, EquipSlot, GameState, SimContext } from '../sim/state';
import { levelForXp } from '../sim/xp';
import type { MenuOption } from './contextmenu';
import { qtyBadge } from './format';
import { span } from './tooltips';

const STYLE_INFO: Record<CombatStyle, string> = {
  accurate: 'Accurate: +accuracy and damage. Shooting XP.',
  rapid: 'Rapid: shoots a tick faster. Shooting XP.',
  longrange: 'Longrange: +2 range, +defense. Shooting and Defense XP.',
  bash: 'Bash: +accuracy and damage. Melee XP.',
  block: 'Block: +defense. Defense XP.',
};

const SLOT_LABEL: Record<EquipSlot, string> = {
  head: 'Head',
  neck: 'Neck',
  weapon: 'Weapon',
  body: 'Body',
  legs: 'Legs',
  hands: 'Hands',
  feet: 'Feet',
  ammo: 'Ammo',
};

export interface EquipmentHandlers {
  unequip(slot: EquipSlot): void;
  setStyle(style: CombatStyle): void;
  toggleRetaliate(): void;
  openMenu(options: MenuOption[], x: number, y: number): void;
  examine(itemId: string): void;
}

/**
 * Worn gear, combat styles, Auto Retaliate and stats. Buttons are built once
 * (styles: when the weapon type changes) and updated in place, so a click
 * never lands on a button that's being replaced mid-fight.
 */
export class EquipmentTab {
  readonly el = document.createElement('div');
  private readonly slots = new Map<EquipSlot, HTMLElement>();
  private readonly stats = document.createElement('div');
  private readonly styles = document.createElement('div');
  private readonly styleButtons = new Map<CombatStyle, HTMLButtonElement>();
  private readonly retaliate = document.createElement('button');
  private gun: boolean | null = null;
  private key = '';
  private worn: GameState['player']['equipment'] | null = null;

  constructor(
    private readonly ctx: SimContext,
    private readonly iconUrl: (modelId: string) => string,
    private readonly h: EquipmentHandlers,
  ) {
    this.el.className = 'equipment';
    const grid = document.createElement('div');
    grid.className = 'equip-grid';
    for (const slot of EQUIP_SLOTS) {
      const cell = document.createElement('button');
      cell.className = `equip-slot equip-${slot}`;
      cell.addEventListener('click', () => h.unequip(slot));
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const item = this.worn?.[slot];
        const def = item && this.ctx.content.items.get(item.itemId);
        if (!def) return;
        const target = { target: def.name, targetKind: 'item' as const };
        h.openMenu(
          [
            { action: 'Remove', ...target, run: () => h.unequip(slot) },
            { action: 'Examine', ...target, run: () => h.examine(def.id) },
          ],
          e.clientX,
          e.clientY,
        );
      });
      this.slots.set(slot, cell);
      grid.append(cell);
    }
    this.styles.className = 'style-buttons';
    this.retaliate.className = 'stone-btn retaliate-btn';
    this.retaliate.title = 'Fight back automatically when something attacks you';
    this.retaliate.addEventListener('click', () => h.toggleRetaliate());
    this.stats.className = 'equip-stats';
    this.el.append(grid, this.styles, this.retaliate, this.stats);
  }

  update(state: GameState): void {
    const p = state.player;
    const profile = attackProfile(p, this.ctx);
    const gun = profile.weapon.weapon!.type === 'gun';
    if (gun !== this.gun) this.buildStyles(gun);
    for (const [style, btn] of this.styleButtons) btn.classList.toggle('active', p.style === style);
    this.retaliate.textContent = `Auto Retaliate: ${p.autoRetaliate ? 'On' : 'Off'}`;
    this.retaliate.classList.toggle('active', p.autoRetaliate);

    const level = combatLevel(p.skills);
    const key = JSON.stringify([p.equipment, level, p.style, p.inventory.map((s) => s?.itemId)]);
    if (key === this.key) return;
    this.key = key;
    this.worn = p.equipment;
    const content: Content = this.ctx.content;

    for (const [slot, cell] of this.slots) {
      const item = p.equipment[slot];
      const def = item && content.items.get(item.itemId);
      cell.replaceChildren();
      if (def) {
        const img = document.createElement('img');
        img.src = this.iconUrl(def.model);
        img.alt = def.name;
        cell.append(img);
        if (item.qty > 1) cell.append(qtyBadge(item.qty));
        cell.title = `${def.name} (click to remove)`;
      } else {
        cell.append(span('equip-empty', SLOT_LABEL[slot]));
        cell.title = SLOT_LABEL[slot];
      }
    }

    const armor = armorTotals(p, this.ctx);
    const lines = [
      `Combat level: ${level}`,
      `Weapon: ${profile.weapon.name}${profile.outOfAmmo ? ' (out of ammo!)' : ''}`,
      `Accuracy +${profile.accuracyBonus} · Damage +${profile.damageBonus}`,
      `Range ${profile.range} · Speed ${((profile.speed * TICK_MS) / 1000).toFixed(1)}s`,
      `Defense +${armor.defense}`,
    ];
    if (profile.explosive) lines.push('Explosive: fires Hash from your inventory');
    this.stats.replaceChildren(...lines.map((l) => span('equip-line', l)));
  }

  private buildStyles(gun: boolean): void {
    this.gun = gun;
    this.styleButtons.clear();
    const buttons = (gun ? GUN_STYLES : MELEE_STYLES).map((style) => {
      const btn = document.createElement('button');
      btn.className = 'stone-btn style-btn';
      btn.textContent = style[0].toUpperCase() + style.slice(1);
      btn.title = STYLE_INFO[style];
      btn.addEventListener('click', () => this.h.setStyle(style));
      this.styleButtons.set(style, btn);
      return btn;
    });
    this.styles.replaceChildren(...buttons);
  }
}

/**
 * The active Sproto, its special and Summoning points. The card and buttons
 * are rebuilt only when a different Sproto is summoned; numbers update in place.
 */
export class SummoningTab {
  readonly el = document.createElement('div');
  private readonly level = span('summon-level', '');
  private readonly points = document.createElement('div');
  private readonly body = document.createElement('div');
  private readonly hpLine = span('sproto-line', '');
  private readonly special = document.createElement('button');
  private shown: string | null | undefined = undefined;

  constructor(
    private readonly content: Content,
    private readonly iconUrl: (modelId: string) => string,
    private readonly h: { special(): void; dismiss(): void },
  ) {
    this.el.className = 'summoning';
    this.points.className = 'points-bar';
    this.special.className = 'stone-btn';
    this.special.addEventListener('click', () => this.h.special());
    const top = document.createElement('div');
    top.append(this.level, this.points, this.body);
    this.el.append(top);
  }

  update(state: GameState): void {
    const p = state.player;
    const s = p.sproto;
    const def = s ? this.content.sprotos.get(s.defId) : undefined;
    this.level.textContent = `Summoning level ${levelForXp(p.skills.summoning ?? 0)}`;
    this.points.style.setProperty('--fill', `${(p.summoning.points / SUMMONING.pointsMax) * 100}%`);
    this.points.textContent = `Summoning points: ${Math.floor(p.summoning.points)} / ${SUMMONING.pointsMax}`;

    const id = s && def ? s.defId : null;
    if (id !== this.shown) {
      this.shown = id;
      if (!s || !def) {
        this.body.replaceChildren(
          span(
            'coming-soon',
            'No Sproto with you. Buy a contract at the Terminal, then click it in your inventory to summon.',
          ),
        );
      } else {
        const card = document.createElement('div');
        card.className = 'sproto-card';
        const img = document.createElement('img');
        img.src = this.iconUrl(def.model);
        img.alt = def.name;
        card.append(img, span('sproto-name', def.name), this.hpLine);
        this.special.textContent = `${def.special.name} (${def.special.cost} pts)`;
        const dismiss = document.createElement('button');
        dismiss.className = 'stone-btn danger';
        dismiss.textContent = 'Dismiss';
        dismiss.addEventListener('click', () => this.h.dismiss());
        this.body.replaceChildren(card, this.special, dismiss);
      }
    }
    if (!s || !def) return;
    const secs = Math.max(0, Math.round(((s.expiresAt - state.tick) * TICK_MS) / 1000));
    this.hpLine.textContent = `HP ${s.hp} / ${def.hp} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} left`;
    this.special.disabled = p.summoning.points < def.special.cost;
  }
}
