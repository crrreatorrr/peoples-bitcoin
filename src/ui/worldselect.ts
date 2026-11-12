/**
 * World select (RuneScape-style list): world number, players out of 100, and
 * a full state, with Quick join (the least full world) and Play offline. The
 * parody notice shows here too. The last world is remembered locally.
 *
 * It is also the game's main menu: Exit to Hub, Controller settings and Full
 * screen sit under the list. With no way online (`list` null: standalone play
 * after "Main menu") it shows only Play and those options.
 */
import { NET } from '../config/balance';
import { GAME_TITLE, PARODY_NOTICE } from '../config/branding';
import type { WorldInfo } from '../net/transport';
import { standardButtons, type StandardActions } from './menuOptions';

const LAST_WORLD_KEY = 'peoples-bitcoin.lastWorld';

export type WorldChoice = { kind: 'world'; world: WorldInfo } | { kind: 'offline' };

function lastWorld(): number | null {
  try {
    const n = Number(localStorage.getItem(LAST_WORLD_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function rememberWorld(n: number): void {
  try {
    localStorage.setItem(LAST_WORLD_KEY, String(n));
  } catch {
    // a convenience only
  }
}

export function leastFull(worlds: WorldInfo[], sim: string): WorldInfo | null {
  const open = worlds.filter((w) => w.sim === sim && w.players < w.max);
  return open.sort((a, b) => a.players - b.players || a.world - b.world)[0] ?? null;
}

export class WorldSelect {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly status: HTMLElement;
  private resolve: ((c: WorldChoice) => void) | null = null;
  private worlds: WorldInfo[] = [];

  constructor(
    private readonly list: (() => Promise<WorldInfo[]>) | null,
    private readonly sim: string,
    menu?: StandardActions,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'world-select main-menu';
    const panel = document.createElement('div');
    panel.className = 'panel';
    const title = document.createElement('h2');
    title.textContent = list ? `${GAME_TITLE}: select a world` : GAME_TITLE;
    const notice = document.createElement('p');
    notice.className = 'notice';
    notice.textContent = PARODY_NOTICE;
    const table = document.createElement('table');
    const head = document.createElement('thead');
    head.innerHTML = '<tr><th>World</th><th>Players</th><th></th></tr>';
    this.body = document.createElement('tbody');
    table.append(head, this.body);
    this.status = document.createElement('p');
    this.status.className = 'status';
    const actions = document.createElement('div');
    actions.className = 'actions';
    const quick = button('Quick join', () => {
      const w = leastFull(this.worlds, this.sim);
      if (w) this.pick({ kind: 'world', world: w });
      else this.setStatus('Every world is full. Try again in a moment.');
    });
    const refresh = button('Refresh', () => void this.refresh());
    const offline = button(list ? 'Play offline' : 'Play', () => this.pick({ kind: 'offline' }));
    offline.dataset.option = 'play';
    if (list) actions.append(quick, refresh, offline);
    else actions.append(offline);
    panel.append(title, notice, ...(list ? [table] : []), this.status, actions);
    if (menu) {
      const options = document.createElement('div');
      options.className = 'actions menu-standard';
      options.append(...standardButtons('main', menu));
      panel.append(options);
    }
    this.root.append(panel);
  }

  /** Shows the list until the player picks. */
  choose(message?: string): Promise<WorldChoice> {
    document.body.append(this.root);
    this.setStatus(message ?? '');
    void this.refresh();
    return new Promise((resolve) => (this.resolve = resolve));
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  close(): void {
    this.root.remove();
  }

  private pick(choice: WorldChoice): void {
    const r = this.resolve;
    this.resolve = null;
    if (choice.kind === 'world') rememberWorld(choice.world.world);
    r?.(choice);
  }

  private async refresh(): Promise<void> {
    if (!this.list) return;
    this.setStatus('Loading worlds...');
    try {
      this.worlds = await this.list();
      this.setStatus('');
    } catch (err) {
      this.worlds = [];
      this.setStatus(`Worlds are unavailable (${err instanceof Error ? err.message : 'offline'}).`);
    }
    const last = lastWorld();
    this.body.replaceChildren(
      ...this.worlds.map((w) => {
        const tr = document.createElement('tr');
        const full = w.players >= w.max;
        const other = w.sim !== this.sim;
        tr.className = `world-row${full || other ? ' full' : ''}`;
        const cells = [
          `World ${w.world}${w.world === last ? ' (last)' : ''}`,
          `${w.players} / ${w.max}`,
          other
            ? 'Update needed'
            : full
              ? 'Full'
              : w.players >= w.max * NET.overflowAt
                ? 'Busy'
                : '',
        ];
        for (const c of cells) {
          const td = document.createElement('td');
          td.textContent = c;
          tr.append(td);
        }
        if (!full && !other)
          tr.addEventListener('click', () => this.pick({ kind: 'world', world: w }));
        return tr;
      }),
    );
  }
}

function button(label: string, run: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', run);
  return b;
}
