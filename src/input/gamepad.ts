/**
 * Controller support (the Sproto controller convention): polls navigator.getGamepads() every
 * frame on its own animation loop, so world select works before the game starts, and turns the
 * pad into the same clicks a mouse makes.
 *
 * Screens with buttons (the right-click menu, world select, bank / Terminal / other windows, the
 * side panel, NPC dialogue) get a focus ring: D-pad or left stick moves it (spatial navigation
 * with key-repeat), A left-clicks the focused element, X right-clicks it, B goes back. The arrow
 * keys (and W / A / S / D in menus) move the same ring, and Enter or Space confirms. In the 3D
 * world, PadWorld walks and acts on a soft target. Mouse, keyboard and touch are untouched: the
 * pad only dispatches the events they would, and its ring and target marker hide as soon as the
 * mouse is used again.
 */
import { PAD } from './config';
import {
  BTN,
  dpadStick,
  keyNav,
  menuDirection,
  nearestBox,
  nextFocus,
  PadTracker,
  RepeatTimer,
  type Box,
  type Dir,
  type GamepadLike,
  type PadFrame,
  type Stick,
} from './padlogic';
import type { PadWorld } from './padworld';

/**
 * Everything the ring can left- or right-click. Text fields are left out: they need a keyboard.
 * The pad also skips `[data-pad-skip]` (buttons that ask with a browser dialog it can't answer).
 */
const FOCUSABLE = [
  'button:not(:disabled)',
  '.menu-row',
  '.inv-slot',
  '.bank-slot',
  '.equip-slot:not(.equip-unused)',
  '.skill-cell',
  '.terminal-item',
  '.trade-window li',
  '.friends-list li',
  '.world-row:not(.full)',
  '.dialogue:not(.choosing)',
  '.compass',
  '.orb',
].join(', ');

/** The side panel and the HUD around it: what View, Start and open windows give focus to. */
const PANEL_ROOTS = ['#sidepanel', '#orbs', '#minimap', '#chatbox'];

type ScopeKind = 'none' | 'menu' | 'overlay' | 'window' | 'panel' | 'dialogue' | 'world';

interface Scope {
  kind: ScopeKind;
  roots: HTMLElement[];
}

/** The last device used: a controller, the keyboard's menu keys, or mouse / touch. */
export type InputDevice = 'pad' | 'keys' | 'pointer';

/** What the game lends the pad once it is running (world select needs none of it). */
export interface PadGameHooks {
  world: PadWorld;
  /** Esc: close windows, drop a pending "Use", return the side panel to Inventory. */
  escape(): void;
  selectTab(id: string): void;
  /** LB / RB in the side panel: the previous / next tab. */
  cycleTab(step: number): void;
  currentTab(): string;
  toggleRun(): void;
  faceNorth(): void;
  /** B in a dialogue with choices: walk away (a walk to the player's own tile). */
  leaveDialogue(): void;
  hideTooltip(): void;
  /** The last device changed (prompts and hover text follow it). */
  deviceChanged(device: InputDevice): void;
}

const visible = (el: Element) => el.isConnected && el.getClientRects().length > 0;

function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export class GamepadInput {
  private readonly tracker = new PadTracker(PAD);
  private readonly repeat = new RepeatTimer(PAD.menuFirstRepeatMs, PAD.menuRepeatMs);
  private frameState: PadFrame | null = null;
  private hooks: PadGameHooks | null = null;
  private device: InputDevice = 'pointer';
  private scopeKind: ScopeKind = 'none';
  private focused: HTMLElement | null = null;
  private lastFocusBox: Box | null = null;
  /** View / Start put focus in the side panel until B (or the same button) takes it back. */
  private panelMode = false;
  /** Where focus goes the next time it is placed: a selector tried before the scope's default. */
  private preferred: string | null = null;
  /** Inventory slot to return to when View opens the inventory again. */
  private lastInvSlot = 0;
  /** Set while the feedback window is up: B calls it, and nothing else reaches the game. */
  private suspendedBack: (() => void) | null = null;

  /**
   * Hand the controller and the menu keys to an overlay outside the game (the feedback window).
   * While suspended the pad moves nothing in the game; B calls `onBack`. `resume()` ends it.
   */
  suspend(onBack: () => void): void {
    this.suspendedBack = onBack;
    this.frameState = null;
    this.hooks?.world.hide();
  }

  resume(): void {
    this.suspendedBack = null;
  }

  start(): void {
    const loop = () => {
      requestAnimationFrame(loop);
      this.poll(performance.now());
    };
    requestAnimationFrame(loop);
    // Real (trusted) mouse or touch use hands prompts back to them. The pad's own synthetic
    // events are untrusted, so they don't count.
    const toPointer = (e: Event) => e.isTrusted && this.setDevice('pointer');
    for (const type of ['pointerdown', 'pointermove', 'wheel']) {
      window.addEventListener(type, toPointer, { capture: true, passive: true });
    }
    // Capture phase: menu keys are handled before the game's own shortcuts see them.
    window.addEventListener('keydown', (e) => this.onKey(e), { capture: true });
    window.addEventListener('gamepadconnected', () => this.poll(performance.now()));
  }

  get lastDevice(): InputDevice {
    return this.device;
  }

  attach(hooks: PadGameHooks): void {
    this.hooks = hooks;
    hooks.deviceChanged(this.device);
  }

  /** Camera input for this frame: right stick turns and tilts, RT / LT zoom in / out. */
  camera(): { yaw: number; pitch: number; zoom: number } {
    const f = this.frameState;
    if (!f || this.scopeKind === 'overlay' || this.scopeKind === 'none') {
      return { yaw: 0, pitch: 0, zoom: 0 };
    }
    const trig = (v: number) => (v > PAD.triggerDeadzone ? v : 0);
    return { yaw: f.right.x, pitch: f.right.y, zoom: trig(f.lt) - trig(f.rt) };
  }

  private setDevice(device: InputDevice): void {
    if (device === this.device) return;
    this.device = device;
    document.body.dataset.input = device;
    if (device !== 'pad') this.hooks?.world.hide();
    // The focus ring now shows: give its element the mouseover text a hover would.
    if (device !== 'pointer' && this.focused) this.present(this.focused);
    this.hooks?.deviceChanged(device);
  }

  /** The ring is drawn (CSS) and its element hovered only for the pad and the menu keys. */
  private get ringShown(): boolean {
    return this.device !== 'pointer';
  }

  /**
   * Keyboard menu navigation while a menu, window or "Select an Option" is up. Arrow keys (and
   * W / A / S / D in the modal menus) move the ring; Enter or Space then confirms, once the ring
   * is showing, so a mouse player's Space or Enter keeps doing what it did. Never while typing.
   */
  private onKey(e: KeyboardEvent): void {
    if (this.suspendedBack) return;
    if (!e.isTrusted || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      (t instanceof HTMLElement && t.isContentEditable)
    )
      return;
    if (e.key === 'Escape') {
      this.panelMode = false; // Esc also ends the pad's side-panel focus
      return;
    }
    const scope = this.scope();
    const choosing = scope.kind === 'dialogue' && this.choosing();
    const navigable =
      scope.kind === 'menu' ||
      scope.kind === 'overlay' ||
      scope.kind === 'window' ||
      scope.kind === 'panel' ||
      choosing;
    if (!navigable) return;
    const modal = scope.kind === 'menu' || scope.kind === 'overlay' || choosing;
    const nav = keyNav(e.key, modal);
    if (!nav) return;
    if (scope.kind !== this.scopeKind) this.enterScope(scope);
    this.keepFocus(scope);
    if (nav === 'confirm') {
      if (!this.ringShown || !this.focused) return;
      this.click(this.focused);
    } else {
      this.setDevice('keys');
      this.move(scope, nav);
    }
    e.preventDefault();
    e.stopPropagation();
  }

  private choosing(): boolean {
    return document.querySelector('.dialogue.choosing') !== null;
  }

  private readPads(): (GamepadLike | null)[] {
    try {
      return navigator.getGamepads ? [...navigator.getGamepads()] : [];
    } catch {
      return []; // a permissions policy can forbid the Gamepad API
    }
  }

  private poll(now: number): void {
    const f = this.tracker.update(this.readPads());
    if (this.suspendedBack) {
      // Presses are still tracked, so a button held now is not a fresh press afterwards.
      if (f.connected && f.pressed[BTN.B]) this.suspendedBack();
      return;
    }
    this.frameState = f;
    if (f.active) this.setDevice('pad');
    const scope = this.scope();
    if (scope.kind !== this.scopeKind) this.enterScope(scope);
    if (!f.connected) {
      // The keyboard may still be moving the ring: keep it on a live element.
      if (this.focused && scope.kind !== 'world' && scope.kind !== 'none') this.keepFocus(scope);
      return;
    }
    const pressed = (b: number) => f.pressed[b];
    const hooks = this.hooks;

    // Buttons that work the same everywhere in the game.
    if (hooks && scope.kind !== 'overlay' && scope.kind !== 'none') {
      if (pressed(BTN.MENU)) return this.onMenu(scope.kind, hooks);
      if (pressed(BTN.VIEW)) return this.onView(scope.kind, hooks);
      if (pressed(BTN.Y) && scope.kind !== 'menu') hooks.toggleRun();
      if (pressed(BTN.R3)) hooks.faceNorth();
    }

    if (scope.kind === 'world') {
      if (!hooks) return;
      const world = hooks.world;
      const stick = f.left.x !== 0 || f.left.y !== 0 ? f.left : dpadStick(f);
      world.frame(stick, this.device === 'pad');
      if (pressed(BTN.A)) world.act();
      else if (pressed(BTN.X)) world.menu();
      if (pressed(BTN.LB)) world.cycle(-1);
      if (pressed(BTN.RB)) world.cycle(1);
      if (pressed(BTN.B)) hooks.escape();
      return;
    }
    hooks?.world.hide();
    if (scope.kind === 'none') return;

    this.keepFocus(scope);
    const choosing = scope.kind === 'dialogue' && this.choosing();
    if (scope.kind === 'dialogue' && !choosing && hooks) {
      // A line with "Click to continue": the stick walks away, as clicking the ground does.
      hooks.world.walk(f.left.x !== 0 || f.left.y !== 0 ? f.left : dpadStick(f));
      if (pressed(BTN.A) && this.focused) this.click(this.focused);
      if (pressed(BTN.B)) hooks.leaveDialogue();
      return;
    }
    const dir = this.repeat.update(menuDirection(f, PAD.menuStickThreshold), now);
    if (dir) this.move(scope, dir);
    if (pressed(BTN.A) && this.focused) this.click(this.focused);
    else if (pressed(BTN.X) && this.focused) this.rightClick(this.focused);
    if (pressed(BTN.B)) this.back(scope.kind);
    if ((scope.kind === 'panel' || scope.kind === 'window') && hooks) {
      const step = Number(pressed(BTN.RB)) - Number(pressed(BTN.LB));
      if (step !== 0) {
        hooks.cycleTab(step);
        this.preferred = '.tab-body';
      }
    }
  }

  /** Menu / Start: the main menu (Settings: Exit to Hub, save, controls), or back to the game. */
  private onMenu(kind: ScopeKind, hooks: PadGameHooks): void {
    if (kind === 'panel' && hooks.currentTab() === 'settings') {
      this.panelMode = false;
      return;
    }
    this.closeMenus();
    hooks.escape();
    hooks.selectTab('settings');
    this.panelMode = true;
    this.preferred = '.tab-body';
    this.enterScope(this.scope());
  }

  /** View / Back: the inventory (with the bank or a shop open too), or back to the game. */
  private onView(kind: ScopeKind, hooks: PadGameHooks): void {
    if (kind === 'panel' && hooks.currentTab() === 'inventory') {
      this.panelMode = false;
      return;
    }
    this.closeMenus();
    hooks.selectTab('inventory');
    this.panelMode = true;
    this.preferred = `.inv-slot[data-slot="${this.lastInvSlot}"]`;
    this.enterScope(this.scope());
  }

  private back(kind: ScopeKind): void {
    if (kind === 'menu') this.closeMenus();
    else if (kind === 'window') {
      this.panelMode = false;
      this.hooks?.escape();
    } else if (kind === 'panel') this.panelMode = false;
    else if (kind === 'dialogue') this.hooks?.leaveDialogue();
  }

  /** Closes the right-click menu and the quick-chat menu the way a click elsewhere does. */
  private closeMenus(): void {
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    if (document.querySelector('.quickchat-menu')) {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    }
  }

  /** The topmost screen that takes pad focus, or the world. */
  private scope(): Scope {
    const one = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel);
      return el && visible(el) ? el : null;
    };
    const lock = one('#tab-lock');
    if (lock) return { kind: 'none', roots: [] };
    const menu = one('#contextmenu') ?? one('.quickchat-menu');
    if (menu) return { kind: 'menu', roots: [menu] };
    const overlay = [...document.querySelectorAll<HTMLElement>('.world-select')].filter(visible);
    if (overlay.length > 0) return { kind: 'overlay', roots: [overlay.at(-1)!] };
    if (!this.hooks) return { kind: 'none', roots: [] };
    const panels = PANEL_ROOTS.map(one).filter((el): el is HTMLElement => el !== null);
    const windows = [...document.querySelectorAll<HTMLElement>('#hud > div.panel')].filter(
      (el) => el.id !== 'xpcounter' && visible(el),
    );
    if (windows.length > 0) return { kind: 'window', roots: [...windows, ...panels] };
    if (this.panelMode) return { kind: 'panel', roots: panels };
    const dialogue = one('.dialogue');
    if (dialogue) return { kind: 'dialogue', roots: [dialogue] };
    return { kind: 'world', roots: [] };
  }

  private candidates(scope: Scope): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const root of scope.roots) {
      if (root.matches(FOCUSABLE)) out.push(root);
      out.push(...root.querySelectorAll<HTMLElement>(FOCUSABLE));
    }
    const pad = this.device === 'pad';
    return out.filter((el) => visible(el) && !(pad && el.matches('[data-pad-skip]')));
  }

  private enterScope(scope: Scope): void {
    this.scopeKind = scope.kind;
    if (scope.kind === 'world' || scope.kind === 'none') {
      this.setFocus(null);
      return;
    }
    this.setFocus(this.initialFocus(scope));
  }

  private initialFocus(scope: Scope): HTMLElement | null {
    const list = this.candidates(scope);
    const pref = this.preferred;
    this.preferred = null;
    if (pref) {
      const hit = list.find((el) => el.matches(pref) || el.closest(pref) !== null);
      if (hit) return hit;
    }
    if (scope.kind === 'overlay') {
      return list.find((el) => el.matches('.world-row')) ?? list[0] ?? null;
    }
    if (scope.kind === 'window') {
      const inWindow = list.filter((el) => scope.roots[0].contains(el));
      return inWindow.find((el) => !el.matches('.window-close')) ?? inWindow[0] ?? list[0] ?? null;
    }
    if (scope.kind === 'panel') {
      return list.find((el) => el.closest('.tab-body')) ?? list[0] ?? null;
    }
    return list[0] ?? null;
  }

  /** Keeps focus on a live element of the scope: a re-rendered list keeps the same spot. */
  private keepFocus(scope: Scope): void {
    const el = this.focused;
    const ok = el && visible(el) && scope.roots.some((r) => r.contains(el));
    if (ok && !this.preferred) return;
    const list = this.candidates(scope);
    if (this.preferred) {
      this.setFocus(this.initialFocus(scope));
      return;
    }
    const at = this.lastFocusBox;
    const i = at ? nearestBox(list.map(boxOf), { x: at.x + at.w / 2, y: at.y + at.h / 2 }) : -1;
    this.setFocus(i >= 0 ? list[i] : this.initialFocus(scope));
  }

  private move(scope: Scope, dir: Dir): void {
    const list = this.candidates(scope);
    const from = this.focused ? list.indexOf(this.focused) : -1;
    const to = nextFocus(list.map(boxOf), from, dir);
    if (to >= 0) this.setFocus(list[to]);
  }

  private setFocus(el: HTMLElement | null): void {
    if (el === this.focused) return;
    this.focused?.classList.remove('pad-focus');
    this.focused = el;
    // A mouse player's own hover text is left alone: the ring isn't showing for them.
    if (this.ringShown) this.hooks?.hideTooltip();
    if (!el) return;
    el.classList.add('pad-focus');
    this.lastFocusBox = boxOf(el);
    if (el.matches('.inv-slot')) this.lastInvSlot = Number(el.dataset.slot) || 0;
    if (this.ringShown) this.present(el);
  }

  /** Scrolls the ring into view and shows the mouseover text ("Wield Pistol / 3 more options"). */
  private present(el: HTMLElement): void {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.dispatch(el, 'mousemove', 0);
  }

  /** Left click, as the mouse does it (OSRS-style menus act on press). */
  private click(el: HTMLElement): void {
    if (el.matches('.menu-row')) {
      this.dispatch(el, 'pointerdown', 0);
      return;
    }
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      this.dispatch(el, type, 0);
    }
  }

  private rightClick(el: HTMLElement): void {
    this.dispatch(el, 'contextmenu', 2);
  }

  private dispatch(el: HTMLElement, type: string, button: number): void {
    const b = boxOf(el);
    const init: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      button,
      buttons: type.endsWith('down') ? 1 << button : 0,
      clientX: b.x + b.w / 2,
      clientY: b.y + b.h / 2,
      pointerType: 'mouse',
      isPrimary: true,
    };
    el.dispatchEvent(
      type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init),
    );
  }
}

export type { Stick };
