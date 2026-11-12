/**
 * The game menu: Esc (once nothing else is open), the Menu orb by the minimap, or Menu / Start on
 * a controller. Offline it pauses the game; an online world cannot stop, and the menu says so.
 * Resume, Settings, then the standard options (menuOptions.ts). Leaving a test world (loopback)
 * throws it away, so Main menu and Exit to Hub ask first there, inside the menu so a controller
 * can answer.
 */
import { standardButtons, type StandardActions } from './menuOptions';
import type { Overlay, OverlayStack } from './overlay';

export interface PauseMenuDeps extends StandardActions {
  overlays: OverlayStack;
  /** True when the world keeps running (online): the menu doesn't pause it. */
  online: boolean;
  /** Set when leaving loses something (the test world): the question to ask first. */
  leaveWarning: string | null;
  /** Pause the game; returns the release. Offline only. */
  pause(): () => void;
  /** Open the Settings tab. */
  settings(): void;
  /** After the menu closes (the controller takes the game back). */
  closed?(): void;
}

export class PauseMenu implements Overlay {
  readonly root = document.createElement('div');
  private readonly options = document.createElement('div');
  private readonly confirm = document.createElement('div');
  private readonly question = document.createElement('p');
  private leave: (() => void) | null = null;
  private release: (() => void) | null = null;

  constructor(private readonly deps: PauseMenuDeps) {
    this.root.className = 'world-select menu-screen pause-menu';
    const panel = document.createElement('div');
    panel.className = 'panel';
    const title = document.createElement('h2');
    title.textContent = deps.online ? 'Menu' : 'Paused';
    const note = document.createElement('p');
    note.className = 'notice';
    note.textContent = deps.online
      ? 'This is an online world: it keeps running while the menu is open.'
      : 'The game is paused.';

    this.options.className = 'menu-options';
    const ask = (run: (() => void) | undefined) => () => run && this.leaveVia(run);
    this.options.append(
      button('Resume', () => this.close(), 'resume'),
      button(
        'Settings',
        () => {
          this.close();
          deps.settings();
        },
        'settings',
      ),
      ...standardButtons('game', {
        mainMenu: ask(deps.mainMenu),
        hub: ask(deps.hub),
        controls: deps.controls,
      }),
    );

    this.confirm.className = 'menu-options';
    this.confirm.append(
      this.question,
      button('Leave', () => this.leave?.(), 'leave'),
      button('Stay', () => this.showConfirm(false), 'stay'),
    );
    this.confirm.hidden = true;
    panel.append(title, note, this.options, this.confirm);
    this.root.append(panel);
  }

  get isOpen(): boolean {
    return this.deps.overlays.has(this);
  }

  open(): void {
    if (this.isOpen) return;
    this.showConfirm(false);
    if (!this.deps.online) this.release = this.deps.pause();
    this.deps.overlays.open(this);
  }

  close(): void {
    if (!this.isOpen) return;
    this.deps.overlays.close(this);
    this.release?.();
    this.release = null;
    this.deps.closed?.();
  }

  /**
   * Runs `run` (Main menu, Exit to Hub), first asking in the open menu when leaving loses
   * something. The Settings tab's buttons come through here too.
   */
  leaveVia(run: () => void): void {
    if (!this.deps.leaveWarning) return run();
    this.open();
    this.leave = run;
    this.question.textContent = this.deps.leaveWarning;
    this.showConfirm(true);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Esc / B: out of the question, else Resume. */
  back(): void {
    if (!this.confirm.hidden) this.showConfirm(false);
    else this.close();
  }

  private showConfirm(on: boolean): void {
    this.confirm.hidden = !on;
    this.options.hidden = on;
  }
}

function button(label: string, run: () => void, option: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.option = option;
  b.addEventListener('click', run);
  return b;
}
