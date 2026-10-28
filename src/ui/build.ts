/** Bunker build window: what can go on this hotspot, and what each build needs. */
import type { Content } from '../sim/content';
import type { BuildOption } from '../sim/schemas';
import { span } from './tooltips';

export interface BuildChoice {
  option: BuildOption;
  /** Why it can't be built now, or null. */
  problem: string | null;
  built: boolean;
}

export class BuildWindow {
  readonly el = document.createElement('div');
  private readonly title = document.createElement('h2');
  private readonly list = document.createElement('div');
  private key = '';

  constructor(
    root: HTMLElement,
    private readonly content: Content,
    private readonly iconUrl: (modelId: string) => string,
    private readonly h: { build(buildId: string): void; close(): void },
  ) {
    this.el.className = 'build-window panel';
    this.el.hidden = true;
    const header = document.createElement('div');
    header.className = 'window-header';
    const close = document.createElement('button');
    close.className = 'window-close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.close());
    header.append(this.title, close);
    this.list.className = 'build-list';
    this.el.append(header, this.list);
    root.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.h.close();
  }

  update(spotName: string | null, choices: BuildChoice[]): void {
    this.el.hidden = spotName === null;
    if (spotName === null) {
      this.key = '';
      return;
    }
    const key = JSON.stringify([spotName, choices.map((c) => [c.option.id, c.problem, c.built])]);
    if (key === this.key) return;
    this.key = key;
    this.title.textContent = `Build: ${spotName}`;
    this.list.replaceChildren(
      ...choices.map(({ option, problem, built }) => {
        const row = document.createElement('div');
        row.className = `build-row${problem ? ' locked' : ''}`;
        const img = document.createElement('img');
        img.src = this.iconUrl(option.model);
        img.alt = '';
        const mats = option.materials
          .map((m) => `${m.qty} × ${this.content.items.get(m.item)?.name ?? m.item}`)
          .join(', ');
        const info = document.createElement('div');
        info.className = 'build-info';
        info.append(
          span('build-name', `${option.name}${built ? ' (built)' : ''}`),
          span('build-detail', option.examine),
          span(
            'build-detail',
            `Lvl ${option.levelReq} · Toolkit tier ${option.toolTier} · ${option.xp} XP`,
          ),
          span('build-detail', mats),
        );
        const btn = document.createElement('button');
        btn.className = 'stone-btn';
        btn.textContent = built ? 'Rebuild' : 'Build';
        btn.disabled = problem !== null;
        btn.title = problem ?? `Build the ${option.name}`;
        btn.addEventListener('click', () => this.h.build(option.id));
        row.append(img, info, btn);
        return row;
      }),
    );
  }
}
