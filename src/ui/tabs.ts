/**
 * Side-panel tabs that read game state: Combat (styles, Auto Retaliate),
 * Equipment (OSRS paperdoll, Equipment Stats, Items Kept on Death) and
 * Summoning (the active Sproto and its special). Quests live in quests.ts.
 */
import { DEATH, SUMMONING, TICK_MS } from '../config/balance';
import { combatLevel } from '../sim/combat';
import type { Content } from '../sim/content';
import {
  armorTotals,
  attackProfile,
  GUN_STYLES,
  MELEE_STYLES,
  xpMultiplier,
} from '../sim/equipment';
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

/** OSRS worn-equipment slots PB doesn't have; drawn greyed to keep the paperdoll shape. */
const UNUSED_SLOTS = ['cape', 'shield', 'ring'] as const;
type PaperdollSlot = EquipSlot | (typeof UNUSED_SLOTS)[number];

/**
 * Empty-slot silhouettes (original 24×24 shapes, drawn for PB). They're
 * rendered as a faint dark mask inside the slot, like OSRS's empty slots.
 */
const SILHOUETTE: Record<PaperdollSlot, string> = {
  head: 'M12 3C7 3 4 7 4 12v5h3v-4h10v4h3v-5c0-5-3-9-8-9zM8 13v6h8v-6z',
  cape: 'M7 3h10l1 3-2 1 3 14H5L8 7 6 6z',
  neck: 'M5 3c0 6 3 10 7 10s7-4 7-10h-2c0 5-2 8-5 8S7 8 7 3zM9 14h6l-3 7z',
  ammo: 'M6 21l2-12 1-5 1 5 2 12zM12 21l2-12 1-5 1 5 2 12z',
  weapon: 'M17 2l5 1 1 5-11 11 1 2-2 2-3-3-3 3-2-2 3-3-3-3 2-2 2 1z',
  body: 'M8 3l-5 3 2 6 2-1v10h10V11l2 1 2-6-5-3c-1 2-2 3-4 3s-3-1-4-3z',
  shield: 'M12 2l8 3v6c0 6-4 9-8 11-4-2-8-5-8-11V5z',
  legs: 'M6 3h12l1 18h-5l-2-12-2 12H5z',
  hands: 'M7 21v-6L4 10l2-1 2 3V4h2v7h1V3h2v8h1V4h2v8l1-3h2l-2 7v5z',
  feet: 'M7 3h5v11l7 3 1 4H4l1-6z',
  ring: 'M12 6a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 2h4l1 3H9z',
};

function silhouette(slot: PaperdollSlot): HTMLElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'equip-silhouette');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', SILHOUETTE[slot]);
  svg.append(path);
  return svg as unknown as HTMLElement;
}

/** Thin connector lines behind the paperdoll, as on the OSRS equipment tab. */
function paperdollLines(): HTMLElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'equip-lines');
  svg.setAttribute('viewBox', '0 0 148 196');
  svg.setAttribute('aria-hidden', 'true');
  // Slot centres: columns x = 18 / 74 / 130, rows y = 18 / 58 / 98 / 138 / 178.
  for (const [x1, y1, x2, y2] of [
    [74, 18, 74, 178], // head → neck → body → legs → feet
    [18, 58, 130, 58], // cape - neck - ammo
    [18, 98, 130, 98], // weapon - body - shield
    [18, 98, 18, 178], // weapon ↓ hands
    [130, 98, 130, 178], // shield ↓ ring
  ]) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    svg.append(line);
  }
  return svg as unknown as HTMLElement;
}

function formatSpeed(ticks: number): string {
  return `${((ticks * TICK_MS) / 1000).toFixed(1)}s`;
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** A label/value row, like the bonus lines on OSRS's Equipment Stats screen. */
function statRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stat-row';
  row.append(span('stat-label', label), span('stat-value', value));
  return row;
}

function heading(text: string): HTMLElement {
  return span('panel-heading', text);
}

export interface CombatHandlers {
  setStyle(style: CombatStyle): void;
  toggleRetaliate(): void;
}

/**
 * OSRS Combat Options: weapon name, combat level, attack styles and Auto
 * Retaliate. Buttons are built once (styles: when the weapon type changes)
 * and updated in place, so a click never lands on a button being replaced
 * mid-fight.
 */
export class CombatTab {
  readonly el = document.createElement('div');
  private readonly weapon = span('combat-weapon', '');
  private readonly level = span('combat-level', '');
  private readonly note = span('combat-note', '');
  private readonly styles = document.createElement('div');
  private readonly styleButtons = new Map<CombatStyle, HTMLButtonElement>();
  private readonly retaliate = document.createElement('button');
  private gun: boolean | null = null;

  constructor(
    private readonly ctx: SimContext,
    private readonly h: CombatHandlers,
  ) {
    this.el.className = 'combat-tab';
    this.styles.className = 'style-buttons';
    this.retaliate.className = 'stone-btn retaliate-btn';
    this.retaliate.title = 'Fight back automatically when something attacks you';
    this.retaliate.addEventListener('click', () => h.toggleRetaliate());
    this.el.append(this.weapon, this.level, this.styles, this.note, this.retaliate);
  }

  update(state: GameState): void {
    const p = state.player;
    const profile = attackProfile(p, this.ctx);
    const gun = profile.weapon.weapon!.type === 'gun';
    if (gun !== this.gun) this.buildStyles(gun);
    for (const [style, btn] of this.styleButtons) btn.classList.toggle('active', p.style === style);
    this.retaliate.textContent = `Auto Retaliate: ${p.autoRetaliate ? 'On' : 'Off'}`;
    this.retaliate.classList.toggle('active', p.autoRetaliate);
    this.weapon.textContent = profile.weapon.name;
    this.level.textContent = `Combat Lvl: ${combatLevel(p.skills)}`;
    this.note.textContent = profile.outOfAmmo
      ? 'Out of ammo! Swinging it as a club.'
      : profile.explosive
        ? 'Explosive: fires Hash from your inventory.'
        : '';
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

export interface EquipmentHandlers {
  unequip(slot: EquipSlot): void;
  openMenu(options: MenuOption[], x: number, y: number): void;
  examine(itemId: string): void;
}

type EquipView = 'worn' | 'stats' | 'death';

/**
 * OSRS Worn Equipment: the paperdoll, plus Equipment Stats and Items Kept on
 * Death views that open inside the same fixed box (a Back button returns).
 * Click an equipped item to remove it; right-click for Remove / Examine.
 */
export class EquipmentTab {
  readonly el = document.createElement('div');
  private readonly slots = new Map<EquipSlot, HTMLElement>();
  private readonly worn = document.createElement('div');
  private readonly stats = document.createElement('div');
  private readonly death = document.createElement('div');
  private view: EquipView = 'worn';
  private key = '';
  private equipment: GameState['player']['equipment'] | null = null;

  constructor(
    private readonly ctx: SimContext,
    private readonly iconUrl: (modelId: string) => string,
    h: EquipmentHandlers,
  ) {
    this.el.className = 'equipment';
    const grid = document.createElement('div');
    grid.className = 'equip-grid';
    grid.append(paperdollLines());
    for (const slot of EQUIP_SLOTS) {
      const cell = document.createElement('button');
      cell.className = `equip-slot equip-${slot}`;
      cell.addEventListener('click', () => h.unequip(slot));
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const item = this.equipment?.[slot];
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
    for (const slot of UNUSED_SLOTS) {
      const cell = document.createElement('div');
      cell.className = `equip-slot equip-unused equip-${slot}`;
      cell.title = `No ${slot} slot in The People's Bitcoin`;
      cell.append(silhouette(slot));
      grid.append(cell);
    }

    const buttons = document.createElement('div');
    buttons.className = 'equip-buttons';
    buttons.append(
      this.viewButton('Equipment Stats', 'stats', 'View your equipment bonuses'),
      this.viewButton('Items Kept on Death', 'death', 'What you keep and lose if you die'),
    );
    this.worn.className = 'equip-view equip-worn';
    this.worn.append(grid, buttons);
    this.stats.className = 'equip-view equip-statsview';
    this.death.className = 'equip-view equip-deathview';
    this.el.append(this.worn, this.stats, this.death);
    this.show('worn');
  }

  private viewButton(label: string, view: EquipView, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'stone-btn equip-view-btn';
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', () => this.show(view));
    return btn;
  }

  private backButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'stone-btn equip-back';
    btn.textContent = 'Back';
    btn.addEventListener('click', () => this.show('worn'));
    return btn;
  }

  private show(view: EquipView): void {
    this.view = view;
    this.worn.hidden = view !== 'worn';
    this.stats.hidden = view !== 'stats';
    this.death.hidden = view !== 'death';
    this.key = ''; // re-render the newly shown view on the next update
  }

  update(state: GameState): void {
    const p = state.player;
    const key = JSON.stringify([
      this.view,
      p.equipment,
      p.style,
      p.inventory.map((s) => s && [s.itemId, s.qty]),
    ]);
    if (key === this.key) return;
    this.key = key;
    this.equipment = p.equipment;
    const content: Content = this.ctx.content;

    for (const [slot, cell] of this.slots) {
      const item = p.equipment[slot];
      const def = item && content.items.get(item.itemId);
      cell.replaceChildren();
      cell.classList.toggle('filled', !!def);
      if (def) {
        const img = document.createElement('img');
        img.src = this.iconUrl(def.model);
        img.alt = def.name;
        cell.append(img);
        if (item.qty > 1) cell.append(qtyBadge(item.qty));
        cell.title = `${def.name} (click to remove)`;
      } else {
        cell.append(silhouette(slot));
        cell.title = SLOT_LABEL[slot];
      }
    }
    if (this.view === 'stats') this.renderStats(state);
    if (this.view === 'death') this.renderDeath(state);
  }

  /** OSRS Equipment Stats, using PB's real bonuses (accuracy, damage, defense, range, speed, XP). */
  private renderStats(state: GameState): void {
    const p = state.player;
    const profile = attackProfile(p, this.ctx);
    const armor = armorTotals(p, this.ctx);
    const rows: HTMLElement[] = [
      heading('Attack bonus'),
      statRow('Weapon', profile.weapon.name),
      statRow('Accuracy', signed(profile.accuracyBonus)),
      statRow('Damage', signed(profile.damageBonus)),
      heading('Defence bonus'),
      statRow('Defense', signed(armor.defense)),
      heading('Other bonuses'),
      statRow('Attack range', `${profile.range} tile${profile.range === 1 ? '' : 's'}`),
      statRow('Attack speed', formatSpeed(profile.speed)),
    ];
    if (profile.explosive) rows.push(statRow('Explosive', 'fires Hash'));
    if (profile.outOfAmmo) rows.push(statRow('Ammo', 'out of ammo!'));
    for (const skill of this.ctx.content.skills.values()) {
      const mult = xpMultiplier(p, this.ctx, skill.id);
      const pct = Math.round((mult - 1) * 1000) / 10;
      if (pct > 0) rows.push(statRow(`${skill.name} XP`, `+${pct}%`));
    }
    this.stats.replaceChildren(heading('Equipment Stats'), ...rows, this.backButton());
  }

  /**
   * OSRS Items Kept on Death, following PB's real death rules (zones.ts
   * handleDeath): worn gear always stays on you; with DEATH.dropInventory,
   * tradeable inventory items fall in a pile where you died and untradeables
   * (value 0, e.g. quest items) stay with you.
   */
  private renderDeath(state: GameState): void {
    const p = state.player;
    const items = this.ctx.content.items;
    const kept: { itemId: string; qty: number }[] = [];
    const lost: { itemId: string; qty: number }[] = [];
    for (const item of Object.values(p.equipment)) if (item) kept.push(item);
    for (const s of p.inventory) {
      if (!s) continue;
      const keep = !DEATH.dropInventory || items.get(s.itemId)?.value === 0;
      (keep ? kept : lost).push(s);
    }
    const grid = (list: { itemId: string; qty: number }[], empty: string) => {
      const el = document.createElement('div');
      el.className = 'death-grid';
      if (list.length === 0) el.append(span('death-none', empty));
      for (const s of list) {
        const def = items.get(s.itemId);
        if (!def) continue;
        const cell = document.createElement('div');
        cell.className = 'death-slot';
        cell.title = def.name;
        const img = document.createElement('img');
        img.src = this.iconUrl(def.model);
        img.alt = def.name;
        cell.append(img);
        if (s.qty > 1) cell.append(qtyBadge(s.qty));
        el.append(cell);
      }
      return el;
    };
    const mins = Math.round((DEATH.pileDespawnTicks * TICK_MS) / 60000);
    this.death.replaceChildren(
      heading('Items Kept on Death'),
      span('death-note', 'Worn gear and untradeable items always stay with you.'),
      grid(kept, 'Nothing.'),
      heading('Items lost on death'),
      span(
        'death-note',
        DEATH.dropInventory
          ? `Dropped in a pile where you fell; it lasts about ${mins} min.`
          : 'You keep everything.',
      ),
      grid(lost, 'Nothing.'),
      this.backButton(),
    );
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
