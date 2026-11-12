/**
 * The options every menu screen has (owner, 2026-11-12): Main menu (not on the main menu
 * itself), Exit to Hub, Controller settings and Full screen, next to what the menu already had.
 * The main menu is world select (with a hub session) or, offline, the same screen with a Play
 * button; "Main menu" from the game reloads the page into it (`requestMainMenu`).
 */
import { fullscreenButton } from './fullscreen';

export type StandardOption = 'mainMenu' | 'hub' | 'controls' | 'fullscreen';

/** Main menu (world select), the game menu (Esc / Menu), the Settings tab, the disconnect screen. */
export type MenuKind = 'main' | 'game' | 'settings' | 'disconnected';

export const OPTION_LABELS: Record<Exclude<StandardOption, 'fullscreen'>, string> = {
  mainMenu: 'Main menu',
  hub: 'Exit to Hub',
  controls: 'Controller settings',
};

/** The standard options a menu shows, in order. */
export function standardOptions(kind: MenuKind): StandardOption[] {
  const all: StandardOption[] = ['mainMenu', 'hub', 'controls', 'fullscreen'];
  return kind === 'main' ? all.filter((o) => o !== 'mainMenu') : all;
}

export interface StandardActions {
  mainMenu?(): void;
  hub(): void;
  controls(): void;
}

/** Buttons for `standardOptions(kind)`, each tagged `data-option` (the browser check reads it). */
export function standardButtons(
  kind: MenuKind,
  actions: StandardActions,
  className = '',
): HTMLButtonElement[] {
  return standardOptions(kind).map((option) => {
    if (option === 'fullscreen') return fullscreenButton(className);
    const b = document.createElement('button');
    if (className) b.className = className;
    b.dataset.option = option;
    b.textContent = OPTION_LABELS[option];
    const run = option === 'mainMenu' ? actions.mainMenu : actions[option];
    b.addEventListener('click', () => run?.());
    return b;
  });
}

type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const MAIN_MENU_KEY = 'peoples-bitcoin.mainMenu';

/** Asks the next page load to stop at the main menu. False when the store is blocked. */
export function requestMainMenu(store: SessionStore | null): boolean {
  try {
    if (!store) return false;
    store.setItem(MAIN_MENU_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** Whether this load should stop at the main menu; reading the request clears it. */
export function takeMainMenuRequest(store: SessionStore | null): boolean {
  try {
    if (!store) return false;
    const wanted = store.getItem(MAIN_MENU_KEY) === '1';
    store.removeItem(MAIN_MENU_KEY);
    return wanted;
  } catch {
    return false;
  }
}

/** The tab's sessionStorage, or null where the browser blocks it. */
export function sessionStore(): SessionStore | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
