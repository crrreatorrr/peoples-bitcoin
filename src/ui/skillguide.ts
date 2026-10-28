/** Skill guide: what each level of a skill unlocks, built from skills.json. */
import type { Content } from '../sim/content';
import { span } from './tooltips';

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
    const actions = [...skill.actions].sort((a, b) => a.levelReq - b.levelReq);
    if (actions.length === 0) {
      this.list.replaceChildren(
        span('guide-empty', `Nothing to train in ${skill.name} yet. Watch this space.`),
      );
    } else {
      this.list.replaceChildren(
        ...actions.map((a) => {
          const item = this.content.items.get(a.output);
          const row = document.createElement('div');
          row.className = `guide-row${level >= a.levelReq ? '' : ' locked'}`;
          const icon = document.createElement('img');
          icon.src = this.iconUrl(item?.model ?? '');
          icon.alt = '';
          row.append(
            span('guide-level', String(a.levelReq)),
            icon,
            span('guide-name', this.content.objects.get(a.objectId)?.name ?? a.objectId),
            span('guide-detail', `${item?.name ?? a.output} · ${a.xp} XP`),
          );
          return row;
        }),
      );
    }
    this.el.hidden = false;
  }

  close(): void {
    this.el.hidden = true;
  }
}
