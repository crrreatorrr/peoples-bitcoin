/**
 * Controller settings: what every key and controller button does, with press-to-bind remapping
 * (a key or button another action had swaps over), the left-stick dead zone and Reset to
 * defaults. Bindings are saved by Controls (src/input/controls.ts) and apply at once. This screen
 * also holds the controls list that used to sit in the Settings tab.
 *
 * Usable with the mouse, the keyboard (arrows / Enter, Esc back) and a controller (D-pad, A, B
 * back). While a binding waits for its key or button, Esc or the Cancel / back button cancels.
 */
import {
  buttonLabel,
  KEY_ACTIONS,
  keyLabel,
  PAD_ACTIONS,
  type KeyAction,
  type PadAction,
} from '../input/bindings';
import type { Controls } from '../input/controls';
import type { GamepadInput } from '../input/gamepad';
import { fullscreenButton } from './fullscreen';
import type { Overlay, OverlayStack } from './overlay';

/** Keys and buttons that keep their job, shown so the screen lists every action. */
const FIXED_KEYS: readonly [string, string][] = [
  ['Left-click', 'Walk / default action'],
  ['Right-click', 'All options'],
  ['Middle-drag, sideways swipe', 'Camera'],
  ['Mouse wheel', 'Zoom'],
  ['Shift-click item', 'Drop'],
  ['Enter', 'Chat line; continue dialogue'],
  ['Typing a letter', 'Starts a chat message'],
  ['1-5', 'Pick a dialogue option'],
  ['Arrows, Enter / Space', 'Move and choose in menus and windows'],
  ['Esc', 'Close windows, then the game menu'],
  ['N twice (not typing)', 'Send feedback'],
];

const FIXED_PAD: readonly [string, string][] = [
  ['Left stick / D-pad', 'Walk; move in menus'],
  ['Right stick', 'Camera'],
  ['LT / RT', 'Zoom out / in'],
];

type Waiting = { kind: 'key'; action: KeyAction } | { kind: 'pad'; action: PadAction } | null;

export interface ControlsScreenDeps {
  controls: Controls;
  pad: GamepadInput;
  overlays: OverlayStack;
  /** Called after the screen closes (the game menu takes focus back). */
  onClose?(): void;
}

export class ControlsScreen implements Overlay {
  readonly root = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly keyButtons = new Map<KeyAction, HTMLButtonElement>();
  private readonly padButtons = new Map<PadAction, HTMLButtonElement>();
  private readonly deadzoneValue = document.createElement('span');
  private waiting: Waiting = null;

  constructor(private readonly deps: ControlsScreenDeps) {
    this.root.className = 'world-select menu-screen controls-screen';
    const panel = document.createElement('div');
    panel.className = 'panel';
    const title = document.createElement('h2');
    title.textContent = 'Controller settings';
    this.status.className = 'status';
    const scroll = document.createElement('div');
    scroll.className = 'menu-scroll';

    scroll.append(heading('Keyboard'));
    const keys = table();
    for (const def of KEY_ACTIONS) {
      const b = bindButton(() => this.wait({ kind: 'key', action: def.id }));
      b.dataset.bind = `key:${def.id}`;
      this.keyButtons.set(def.id, b);
      keys.append(row(def.label, b));
    }
    for (const [what, does] of FIXED_KEYS) keys.append(row(does, fixed(what)));
    scroll.append(keys);

    scroll.append(heading('Controller'));
    const pads = table();
    for (const def of PAD_ACTIONS) {
      const b = bindButton(() => this.wait({ kind: 'pad', action: def.id }));
      b.dataset.bind = `pad:${def.id}`;
      this.padButtons.set(def.id, b);
      pads.append(row(def.label, b));
    }
    for (const [what, does] of FIXED_PAD) pads.append(row(does, fixed(what)));
    scroll.append(pads);

    const dz = document.createElement('div');
    dz.className = 'deadzone-row';
    const less = button('−', () => this.nudge(-1));
    less.title = 'Smaller dead zone';
    const more = button('+', () => this.nudge(1));
    more.title = 'Larger dead zone';
    const dzLabel = document.createElement('span');
    dzLabel.textContent = 'Left stick dead zone';
    dz.append(dzLabel, less, this.deadzoneValue, more);
    scroll.append(dz);
    const note = document.createElement('p');
    note.className = 'notice';
    note.textContent =
      'Saved in this browser. Shift or Ctrl for run act on a tap of the key on its own. A letter bound here no longer starts a chat message: press Enter to chat. There is no vibration in this game.';
    scroll.append(note);

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      button('Reset to defaults', () => {
        this.stopWaiting();
        deps.controls.reset();
        this.say('Controls reset to the defaults.');
      }),
      fullscreenButton(''),
      button('Back', () => this.back()),
    );
    panel.append(title, this.status, scroll, actions);
    this.root.append(panel);
    deps.controls.onChange(() => this.paint());
    this.paint();
  }

  open(): void {
    this.say('Choose an action, then press its new key or button.');
    this.deps.overlays.open(this);
  }

  back(): void {
    if (this.waiting) {
      this.stopWaiting();
      this.say('Cancelled.');
      return;
    }
    this.deps.overlays.close(this);
    this.deps.onClose?.();
  }

  private say(text: string): void {
    this.status.textContent = text;
  }

  private nudge(steps: number): void {
    this.stopWaiting();
    this.deps.controls.nudgeDeadzone(steps);
  }

  private paint(): void {
    const c = this.deps.controls;
    for (const [action, b] of this.keyButtons) b.textContent = keyLabel(c.keyOf(action));
    for (const [action, b] of this.padButtons) b.textContent = buttonLabel(c.pad[action]);
    this.deadzoneValue.textContent = `${Math.round(c.leftDeadzone * 100)}%`;
    const w = this.waiting;
    if (w) {
      const b = w.kind === 'key' ? this.keyButtons.get(w.action) : this.padButtons.get(w.action);
      if (b) b.textContent = 'Press…';
    }
  }

  private wait(next: NonNullable<Waiting>): void {
    const same =
      this.waiting && this.waiting.kind === next.kind && this.waiting.action === next.action;
    this.stopWaiting();
    if (same) {
      this.say('Cancelled.');
      return; // a second click on the same button cancels
    }
    this.waiting = next;
    const label = labelOf(next);
    const backButton = buttonLabel(this.deps.controls.pad.back);
    this.say(
      next.kind === 'key'
        ? `Press a key for "${label}" (Esc or ${backButton} cancels).`
        : `Press a controller button for "${label}" (Esc or ${backButton} cancels).`,
    );
    this.paint();
    this.deps.pad.beginCapture({
      key: (e) => this.onKey(e),
      button: (index) => this.onButton(index),
    });
  }

  private stopWaiting(): void {
    if (!this.waiting) return;
    this.waiting = null;
    this.deps.pad.endCapture();
    this.paint();
  }

  private onKey(e: KeyboardEvent): void {
    const w = this.waiting;
    if (!w) return;
    if (e.key === 'Escape') return this.back();
    if (w.kind !== 'key') return; // a controller row waits for a button
    const result = this.deps.controls.setKey(w.action, e.key);
    if (!result.ok) {
      this.say(`${result.error} Try another key, or Esc to cancel.`);
      return;
    }
    this.stopWaiting();
    const key = keyLabel(this.deps.controls.keyOf(w.action));
    const swapped = result.swapped as KeyAction | null;
    let text = `${labelOf(w)}: ${key}.`;
    if (swapped) {
      text += ` ${labelOf({ kind: 'key', action: swapped })} moved to ${keyLabel(this.deps.controls.keyOf(swapped))}.`;
    }
    if (e.key.length === 1 && e.key !== ' ') text += ' Press Enter first to chat with that letter.';
    this.say(text);
  }

  private onButton(index: number): void {
    const w = this.waiting;
    if (!w) return;
    const cancel = this.deps.controls.pad.back;
    if (index === cancel && !(w.kind === 'pad' && w.action === 'back')) return this.back();
    if (w.kind !== 'pad') return;
    const result = this.deps.controls.setButton(w.action, index);
    if (!result.ok) {
      this.say(`${result.error} Try another button.`);
      return;
    }
    this.stopWaiting();
    const swapped = result.swapped as PadAction | null;
    let text = `${labelOf(w)}: ${buttonLabel(index)}.`;
    if (swapped) {
      text += ` ${labelOf({ kind: 'pad', action: swapped })} moved to ${buttonLabel(this.deps.controls.pad[swapped])}.`;
    }
    this.say(text);
  }
}

function labelOf(w: NonNullable<Waiting>): string {
  const list = w.kind === 'key' ? KEY_ACTIONS : PAD_ACTIONS;
  return list.find((a) => a.id === w.action)?.label ?? w.action;
}

function heading(text: string): HTMLElement {
  const h = document.createElement('h3');
  h.textContent = text;
  return h;
}

function table(): HTMLTableElement {
  const t = document.createElement('table');
  t.className = 'bind-table';
  return t;
}

function row(label: string, control: HTMLElement): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const a = document.createElement('td');
  a.textContent = label;
  const b = document.createElement('td');
  b.append(control);
  tr.append(a, b);
  return tr;
}

function fixed(text: string): HTMLElement {
  const s = document.createElement('span');
  s.className = 'bind-fixed';
  s.textContent = text;
  return s;
}

function bindButton(run: () => void): HTMLButtonElement {
  const b = button('', run);
  b.className = 'bind-btn';
  return b;
}

function button(label: string, run: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', run);
  return b;
}
