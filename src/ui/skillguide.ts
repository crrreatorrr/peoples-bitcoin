/**
 * Skill guide: what each level of a skill unlocks, built from the data files:
 * gathering nodes, Spin recipes, bunker builds, Sprotos, and any item that
 * needs the skill to wield, wear or use.
 */
import type { Content } from '../sim/content';
import { span } from './tooltips';

interface GuideRow {
  level: number;
  icon: string;
  name: string;
  detail: string;
}

export class SkillGuide {
  readonly el = document.createElement('div');
  private readonly title = document.createElement('h2');
  private readonly list = document.createElement('div');

  constructor(
    root: HTMLElement,
    private readonly content: Content,
    private readonly glyph: (id: string) => string,
    private readonly iconUrl: (modelId: string) => string,
  ) {
    this.el.className = 'skill-guide panel';
    this.el.hidden = true;
    const header = document.createElement('div');
    header.className = 'window-header';
    const close = document.createElement('button');
    close.className = 'window-close';
    close.textContent = '✕';
    close.title = 'Close';
    close.addEventListener('click', () => this.close());
    header.append(this.title, close);
    this.list.className = 'guide-list';
    this.el.append(header, this.list);
    root.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(skillId: string, level: number): void {
    const skill = this.content.skills.get(skillId);
    if (!skill) return;
    this.title.textContent = `${this.glyph(`skill_${skillId}`)} ${skill.name} guide`;
    const rows = this.rowsFor(skillId).sort((a, b) => a.level - b.level);
    this.list.replaceChildren(
      ...(rows.length === 0
        ? [
            span(
              'guide-empty',
              `${skill.name} rises as you fight. There is nothing to unlock with it.`,
            ),
          ]
        : rows.map((r) => {
            const row = document.createElement('div');
            row.className = `guide-row${level >= r.level ? '' : ' locked'}`;
            const icon = document.createElement('img');
            icon.src = this.iconUrl(r.icon);
            icon.alt = '';
            row.append(
              span('guide-level', String(r.level)),
              icon,
              span('guide-name', r.name),
              span('guide-detail', r.detail),
            );
            return row;
          })),
    );
    this.el.hidden = false;
  }

  close(): void {
    this.el.hidden = true;
  }

  private rowsFor(skillId: string): GuideRow[] {
    const c = this.content;
    const skill = c.skills.get(skillId)!;
    const rows: GuideRow[] = [];
    for (const a of skill.actions) {
      const obj = c.objects.get(a.objectId);
      const out = a.output ? c.items.get(a.output) : undefined;
      const gives = out ? out.name : a.payUsd ? `$${a.payUsd[0]}–${a.payUsd[1]} per favor` : '';
      rows.push({
        level: a.levelReq,
        icon: obj?.model ?? '',
        name: obj?.name ?? a.objectId,
        detail: `${gives} · ${a.xp} XP`,
      });
    }
    for (const r of skill.recipes) {
      const input = c.items.get(r.input);
      const out = c.items.get(r.output);
      rows.push({
        level: r.levelReq,
        icon: out?.model ?? '',
        name: out?.name ?? r.output,
        detail: `from ${input?.name} · ${r.xp} XP`,
      });
    }
    if (skillId === 'construction') {
      for (const o of c.objects.values()) {
        for (const b of o.builds) {
          rows.push({
            level: b.levelReq,
            icon: b.model,
            name: b.name,
            detail: `Toolkit tier ${b.toolTier} · ${b.xp} XP`,
          });
        }
      }
    }
    if (skillId === 'summoning') {
      for (const s of c.sprotos.values()) {
        rows.push({
          level: s.levelReq,
          icon: s.model,
          name: s.name,
          detail: `Special: ${s.special.name}`,
        });
      }
    }
    for (const item of c.items.values()) {
      const req = item.requires.find((r) => r.skill === skillId);
      if (!req) continue;
      const kind = item.weapon ? 'Wield' : item.armor ? 'Wear' : item.tool ? 'Tool' : 'Use';
      rows.push({ level: req.level, icon: item.model, name: item.name, detail: kind });
    }
    return rows;
  }
}
