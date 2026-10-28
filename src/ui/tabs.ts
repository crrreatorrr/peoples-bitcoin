/**
 * Side-panel tabs that read game state: Equipment (gear, bonuses, combat
 * styles), Summoning (the active Sproto and its special) and Quests.
 */
import { SUMMONING, TICK_MS } from '../config/balance';
import { combatLevel } from '../sim/combat';
import type { Content } from '../sim/content';
import { armorTotals, attackProfile, GUN_STYLES, MELEE_STYLES } from '../sim/equipment';
import type { QuestHint } from '../sim/quests';
import { EQUIP_SLOTS } from '../sim/schemas';
import type { CombatStyle, EquipSlot, GameState, SimContext } from '../sim/state';
import { levelForXp } from '../sim/xp';
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
  weapon: 'Weapon',
  body: 'Body',
  legs: 'Legs',
  ammo: 'Ammo',
};

export class EquipmentTab {
  readonly el = document.createElement('div');
  private readonly slots = new Map<EquipSlot, HTMLElement>();
  private readonly stats = document.createElement('div');
  private readonly styles = document.createElement('div');
  private key = '';

  constructor(
    private readonly ctx: SimContext,
    private readonly iconUrl: (modelId: string) => string,
    private readonly h: { unequip(slot: EquipSlot): void; setStyle(style: CombatStyle): void },
  ) {
    this.el.className = 'equipment';
    const grid = document.createElement('div');
    grid.className = 'equip-grid';
    for (const slot of EQUIP_SLOTS) {
      const cell = document.createElement('button');
      cell.className = `equip-slot equip-${slot}`;
      cell.title = `${SLOT_LABEL[slot]} (click to remove)`;
      cell.addEventListener('click', () => h.unequip(slot));
      this.slots.set(slot, cell);
      grid.append(cell);
    }
    this.stats.className = 'equip-stats';
    this.styles.className = 'style-buttons';
    this.el.append(grid, this.styles, this.stats);
  }

  update(state: GameState): void {
    const p = state.player;
    const key = JSON.stringify([p.equipment, p.style, p.skills, p.inventory.map((s) => s?.itemId)]);
    if (key === this.key) return;
    this.key = key;
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

    const profile = attackProfile(p, this.ctx);
    const armor = armorTotals(p, this.ctx);
    const styles = profile.weapon.weapon!.type === 'gun' ? GUN_STYLES : MELEE_STYLES;
    this.styles.replaceChildren(
      ...styles.map((style) => {
        const btn = document.createElement('button');
        btn.className = `stone-btn style-btn${p.style === style ? ' active' : ''}`;
        btn.textContent = style[0].toUpperCase() + style.slice(1);
        btn.title = STYLE_INFO[style];
        btn.addEventListener('click', () => this.h.setStyle(style));
        return btn;
      }),
    );
    const lines = [
      `Combat level: ${combatLevel(p.skills)}`,
      `Weapon: ${profile.weapon.name}${profile.outOfAmmo ? ' (out of ammo!)' : ''}`,
      `Accuracy +${profile.accuracyBonus} · Damage +${profile.damageBonus}`,
      `Range ${profile.range} · Speed ${((profile.speed * TICK_MS) / 1000).toFixed(1)}s`,
      `Defense +${armor.defense}`,
    ];
    if (profile.explosive) lines.push('Explosive: fires Hash from your inventory');
    this.stats.replaceChildren(...lines.map((l) => span('equip-line', l)));
  }
}

export class SummoningTab {
  readonly el = document.createElement('div');
  private readonly body = document.createElement('div');
  private key = '';

  constructor(
    private readonly content: Content,
    private readonly iconUrl: (modelId: string) => string,
    private readonly h: { special(): void; dismiss(): void },
  ) {
    this.el.className = 'summoning';
    this.el.append(this.body);
  }

  update(state: GameState): void {
    const p = state.player;
    const s = p.sproto;
    const ticksLeft = s ? s.expiresAt - state.tick : 0;
    const key = JSON.stringify([
      s?.defId,
      s?.hp,
      Math.floor(ticksLeft / 10),
      Math.floor(p.summoning.points),
      p.skills.summoning,
    ]);
    if (key === this.key) return;
    this.key = key;
    const level = levelForXp(p.skills.summoning ?? 0);
    const points = document.createElement('div');
    points.className = 'points-bar';
    points.style.setProperty('--fill', `${(p.summoning.points / SUMMONING.pointsMax) * 100}%`);
    points.textContent = `Summoning points: ${Math.floor(p.summoning.points)} / ${SUMMONING.pointsMax}`;
    const parts: Node[] = [span('summon-level', `Summoning level ${level}`), points];

    const def = s && this.content.sprotos.get(s.defId);
    if (!s || !def) {
      parts.push(
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
      const secs = Math.max(0, Math.round((ticksLeft * TICK_MS) / 1000));
      card.append(
        img,
        span('sproto-name', def.name),
        span(
          'sproto-line',
          `HP ${s.hp} / ${def.hp} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} left`,
        ),
      );
      const special = document.createElement('button');
      special.className = 'stone-btn';
      special.textContent = `${def.special.name} (${def.special.cost} pts)`;
      special.disabled = p.summoning.points < def.special.cost;
      special.addEventListener('click', () => this.h.special());
      const dismiss = document.createElement('button');
      dismiss.className = 'stone-btn danger';
      dismiss.textContent = 'Dismiss';
      dismiss.addEventListener('click', () => this.h.dismiss());
      parts.push(card, special, dismiss);
    }
    this.body.replaceChildren(...parts);
  }
}

export class QuestsTab {
  readonly el = document.createElement('div');
  private key = '';

  constructor(private readonly content: Content) {
    this.el.className = 'quests';
  }

  update(state: GameState, hint: QuestHint | null): void {
    const key = JSON.stringify([state.player.quests, hint?.text]);
    if (key === this.key) return;
    this.key = key;
    const blocks: Node[] = [];
    if (hint) blocks.push(span('quest-hint', `Next: ${hint.text}`));
    for (const quest of this.content.quests.values()) {
      const progress = state.player.quests[quest.id];
      const status = !progress ? 'not-started' : progress.complete ? 'complete' : 'started';
      const block = document.createElement('div');
      block.className = 'quest-block';
      block.append(span(`quest-name ${status}`, quest.name));
      if (!progress) {
        const npc = quest.startNpc ? this.content.npcs.get(quest.startNpc)?.name : null;
        block.append(span('quest-step', npc ? `Talk to ${npc} to begin.` : 'Not started.'));
      } else if (!progress.complete) {
        for (const step of quest.steps) {
          const done = progress.done.includes(step.id);
          block.append(
            span(`quest-step${done ? ' done' : ''}`, `${done ? '✔' : '•'} ${step.text}`),
          );
        }
      }
      blocks.push(block);
    }
    this.el.replaceChildren(...blocks);
  }
}
