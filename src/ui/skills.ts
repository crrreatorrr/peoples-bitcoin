/** Skills tab: level per skill, total level, XP details on hover, click for the skill guide. */
import type { Content } from '../sim/content';
import { levelForXp, xpForLevel } from '../sim/xp';
import { XP_CURVE } from '../config/balance';
import { span, type Tooltip } from './tooltips';

const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export class SkillsPanel {
  readonly el = document.createElement('div');
  private readonly levels = new Map<string, HTMLElement>();
  private readonly cells = new Map<string, { cell: HTMLElement; locked?: string }>();
  private unlocks: string[] = [];
  private readonly total = span('skills-total', '');
  private xp: Record<string, number> = {};
  private key = '';

  constructor(
    content: Content,
    glyph: (assetId: string) => string,
    tooltip: Tooltip,
    openGuide: (skillId: string) => void,
  ) {
    this.el.className = 'skills';
    const grid = document.createElement('div');
    grid.className = 'skills-grid';
    for (const skill of content.skills.values()) {
      const cell = document.createElement('div');
      cell.className = 'skill-cell';
      const level = span('skill-level', '1');
      cell.append(span('skill-icon', glyph(`skill_${skill.id}`)), level);
      cell.addEventListener('mousemove', (e) => {
        const xp = this.xp[skill.id] ?? 0;
        const lvl = levelForXp(xp);
        const next = lvl < XP_CURVE.maxLevel ? xpForLevel(lvl + 1) : null;
        const detail =
          next === null
            ? `XP: ${fmt.format(xp)}`
            : `XP: ${fmt.format(xp)}\nNext level at: ${fmt.format(next)}\nRemaining: ${fmt.format(next - xp)}`;
        const locked = skill.locked && !this.unlocks.includes(skill.locked);
        const note = locked
          ? '\nLocked: finish the Bunker Down quest'
          : '\nClick for the skill guide';
        tooltip.show({ action: skill.name, detail: `${detail}${note}` }, e.clientX, e.clientY);
      });
      cell.addEventListener('mouseleave', () => tooltip.hide());
      cell.addEventListener('click', () => openGuide(skill.id));
      this.levels.set(skill.id, level);
      this.cells.set(skill.id, { cell, locked: skill.locked });
      grid.append(cell);
    }
    this.el.append(grid, this.total);
  }

  update(skills: Record<string, number>, unlocks: string[]): void {
    const key = JSON.stringify([skills, unlocks]);
    if (key === this.key) return;
    this.key = key;
    this.unlocks = unlocks;
    for (const { cell, locked } of this.cells.values()) {
      cell.classList.toggle('locked', !!locked && !unlocks.includes(locked));
    }
    this.xp = skills;
    let total = 0;
    for (const [id, el] of this.levels) {
      const lvl = levelForXp(skills[id] ?? 0);
      total += lvl;
      el.textContent = String(lvl);
    }
    this.total.textContent = `Total level: ${total}`;
  }
}
