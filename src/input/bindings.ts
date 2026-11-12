/**
 * Remappable keys and controller buttons (Controller settings), pure and DOM-free. The game's
 * input layer reads these maps before anything reaches the sim: a key or button only ever picks
 * which existing action runs, so the sim, its intents and the online protocol are unchanged.
 *
 * Keys are stored as `KeyboardEvent.key` values, with letters lower-cased (`normalizeKey`).
 * Controller buttons use the W3C standard mapping (padlogic `BTN`): each action names the
 * physical button that triggers it, and `remapButtons` turns a frame of physical buttons into
 * the logical ones the rest of the controller code reads.
 */
import { BTN, BUTTON_COUNT } from './padlogic';

// ── Keyboard ────────────────────────────────────────────────────────────────

export type KeyAction =
  | 'cameraLeft'
  | 'cameraRight'
  | 'cameraUp'
  | 'cameraDown'
  | 'run'
  | 'continue'
  | 'tabCombat'
  | 'tabSkills'
  | 'tabQuests'
  | 'tabInventory'
  | 'tabEquipment'
  | 'tabSummoning'
  | 'tabSettings';

export interface KeyActionDef {
  id: KeyAction;
  label: string;
  /** Default key, or null for none. */
  key: string | null;
}

export const KEY_ACTIONS: readonly KeyActionDef[] = [
  { id: 'cameraLeft', label: 'Camera left', key: 'ArrowLeft' },
  { id: 'cameraRight', label: 'Camera right', key: 'ArrowRight' },
  { id: 'cameraUp', label: 'Camera up', key: 'ArrowUp' },
  { id: 'cameraDown', label: 'Camera down', key: 'ArrowDown' },
  { id: 'run', label: 'Toggle run', key: 'Shift' },
  { id: 'continue', label: 'Continue dialogue', key: ' ' },
  { id: 'tabCombat', label: 'Combat tab', key: 'F1' },
  { id: 'tabSkills', label: 'Skills tab', key: 'F2' },
  { id: 'tabQuests', label: 'Quests tab', key: 'F3' },
  { id: 'tabInventory', label: 'Inventory tab', key: null },
  { id: 'tabEquipment', label: 'Equipment tab', key: 'F4' },
  { id: 'tabSummoning', label: 'Summoning tab', key: 'F6' },
  { id: 'tabSettings', label: 'Settings tab', key: 'F10' },
];

/** The side-panel tab each tab action opens. */
export const TAB_OF_ACTION: Partial<Record<KeyAction, string>> = {
  tabCombat: 'combat',
  tabSkills: 'skills',
  tabQuests: 'quests',
  tabInventory: 'inventory',
  tabEquipment: 'equipment',
  tabSummoning: 'summoning',
  tabSettings: 'settings',
};

export type KeyMap = Record<KeyAction, string | null>;

export function defaultKeys(): KeyMap {
  return Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.key])) as KeyMap;
}

/** Letters and other printable keys compare lower-case (Shift+Q is still Q). */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * Keys that stay fixed, and why. Esc is the menu and cancel key, Enter and Tab belong to chat,
 * N twice opens the feedback window, 1-5 pick dialogue options, F11 / F12 are the browser's.
 */
const RESERVED: Record<string, string> = {
  Escape: 'Esc opens the menu and cancels.',
  Enter: 'Enter opens the chat line.',
  Tab: 'Tab replies to a private message.',
  n: 'N twice sends feedback.',
  '1': '1-5 pick dialogue options.',
  '2': '1-5 pick dialogue options.',
  '3': '1-5 pick dialogue options.',
  '4': '1-5 pick dialogue options.',
  '5': '1-5 pick dialogue options.',
  F11: 'F11 is the browser’s full screen key.',
  F12: 'F12 is the browser’s.',
  Alt: 'Alt is the browser’s.',
  Meta: 'That key is the system’s.',
  OS: 'That key is the system’s.',
  ContextMenu: 'That key is the system’s.',
  CapsLock: 'Caps Lock cannot be bound.',
  NumLock: 'Num Lock cannot be bound.',
  Dead: 'That key cannot be bound.',
  Unidentified: 'That key cannot be bound.',
  Process: 'That key cannot be bound.',
};

/** Why `key` can't be bound, or null when it can. */
export function reservedReason(key: string): string | null {
  return RESERVED[normalizeKey(key)] ?? null;
}

/** Modifier keys act on a tap (pressed and released on their own); other keys on press. */
export function isTapKey(key: string | null): boolean {
  return key === 'Shift' || key === 'Control';
}

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  ArrowLeft: 'Left arrow',
  ArrowRight: 'Right arrow',
  ArrowUp: 'Up arrow',
  ArrowDown: 'Down arrow',
  Control: 'Ctrl',
  Escape: 'Esc',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Backspace: 'Backspace',
  Delete: 'Delete',
};

/** How a key is written on screen. */
export function keyLabel(key: string | null): string {
  if (key === null) return 'None';
  if (KEY_NAMES[key]) return KEY_NAMES[key];
  return key.length === 1 ? key.toUpperCase() : key;
}

export interface RebindResult<M> {
  map: M;
  /** False when the key or button can't be bound (`error` says why). */
  ok: boolean;
  /** The other action that held the key or button and now has this action's old one. */
  swapped: string | null;
  error: string | null;
}

/**
 * Binds `key` to `action`. A key another action had is swapped: that action gets this one's
 * old key (or none), so no key ever does two things.
 */
export function rebindKey(map: KeyMap, action: KeyAction, rawKey: string): RebindResult<KeyMap> {
  const key = normalizeKey(rawKey);
  const error = reservedReason(key);
  if (error) return { map, ok: false, swapped: null, error };
  const next = { ...map };
  const holder = (Object.keys(next) as KeyAction[]).find((a) => a !== action && next[a] === key);
  if (holder) next[holder] = map[action];
  next[action] = key;
  return { map: next, ok: true, swapped: holder ?? null, error: null };
}

/** The action `rawKey` is bound to, if any. */
export function actionForKey(map: KeyMap, rawKey: string): KeyAction | null {
  const key = normalizeKey(rawKey);
  return (Object.keys(map) as KeyAction[]).find((a) => map[a] === key) ?? null;
}

// ── Controller ──────────────────────────────────────────────────────────────

export type PadAction =
  'act' | 'back' | 'options' | 'run' | 'prev' | 'next' | 'inventory' | 'menu' | 'north';

export interface PadActionDef {
  id: PadAction;
  label: string;
  /** The logical (standard-layout) button the controller code reads for this action. */
  logical: number;
}

export const PAD_ACTIONS: readonly PadActionDef[] = [
  { id: 'act', label: 'Act / confirm', logical: BTN.A },
  { id: 'back', label: 'Cancel / back', logical: BTN.B },
  { id: 'options', label: 'All options', logical: BTN.X },
  { id: 'run', label: 'Toggle run', logical: BTN.Y },
  { id: 'prev', label: 'Previous target / tab', logical: BTN.LB },
  { id: 'next', label: 'Next target / tab', logical: BTN.RB },
  { id: 'inventory', label: 'Inventory', logical: BTN.VIEW },
  { id: 'menu', label: 'Menu', logical: BTN.MENU },
  { id: 'north', label: 'Face north', logical: BTN.R3 },
];

/**
 * Physical buttons that can take an action: the face buttons, bumpers, View, Menu and the stick
 * clicks. The triggers (analog zoom) and the D-pad (walking and menus) stay fixed.
 */
export const BINDABLE_BUTTONS: readonly number[] = [
  BTN.A,
  BTN.B,
  BTN.X,
  BTN.Y,
  BTN.LB,
  BTN.RB,
  BTN.VIEW,
  BTN.MENU,
  BTN.L3,
  BTN.R3,
];

export type PadMap = Record<PadAction, number>;

export function defaultPad(): PadMap {
  return Object.fromEntries(PAD_ACTIONS.map((a) => [a.id, a.logical])) as PadMap;
}

const BUTTON_NAMES = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'View',
  'Menu',
  'L3',
  'R3',
  'D-pad up',
  'D-pad down',
  'D-pad left',
  'D-pad right',
];

/** Xbox names for the standard layout (PlayStation and Switch pads match by position). */
export function buttonLabel(index: number): string {
  return BUTTON_NAMES[index] ?? `Button ${index}`;
}

/** Binds physical `button` to `action`; an action that had it swaps to this one's old button. */
export function rebindButton(map: PadMap, action: PadAction, button: number): RebindResult<PadMap> {
  if (!BINDABLE_BUTTONS.includes(button)) {
    return {
      map,
      ok: false,
      swapped: null,
      error: `${buttonLabel(button)} is fixed (zoom, walking and menus).`,
    };
  }
  const next = { ...map };
  const holder = (Object.keys(next) as PadAction[]).find((a) => a !== action && next[a] === button);
  if (holder) next[holder] = map[action];
  next[action] = button;
  return { map: next, ok: true, swapped: holder ?? null, error: null };
}

/**
 * Physical buttons to logical ones: each action's logical button reads its bound physical one.
 * Bindable buttons with no action read as up; the triggers and D-pad pass through.
 */
export function remapButtons(physical: readonly boolean[], map: PadMap): boolean[] {
  const out = Array.from({ length: BUTTON_COUNT }, (_, i) => physical[i] ?? false);
  for (const b of BINDABLE_BUTTONS) out[b] = false;
  for (const def of PAD_ACTIONS) out[def.logical] = physical[map[def.id]] ?? false;
  return out;
}

/** The physical button for an action's logical button (for prompts like "Press A"). */
export function physicalFor(map: PadMap, logical: number): number {
  const def = PAD_ACTIONS.find((a) => a.logical === logical);
  return def ? map[def.id] : logical;
}

// ── Saved settings ──────────────────────────────────────────────────────────

export interface ControlSettings {
  keys: KeyMap;
  pad: PadMap;
  /** Radial deadzone of the left stick, 0..1. */
  leftDeadzone: number;
}

export interface DeadzoneRange {
  min: number;
  max: number;
  step: number;
}

export function defaultSettings(leftDeadzone: number): ControlSettings {
  return { keys: defaultKeys(), pad: defaultPad(), leftDeadzone };
}

export function clampDeadzone(value: number, range: DeadzoneRange, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  // Snap to the step so repeated presses don't drift (0.1 + 0.05 + ...).
  const snapped = Math.round(value / range.step) * range.step;
  return Math.round(Math.min(range.max, Math.max(range.min, snapped)) * 1000) / 1000;
}

const SAVE_VERSION = 1;

export function serializeSettings(s: ControlSettings): string {
  return JSON.stringify({
    v: SAVE_VERSION,
    keys: s.keys,
    pad: s.pad,
    leftDeadzone: s.leftDeadzone,
  });
}

/**
 * Reads saved settings, falling back to the defaults for anything missing or broken: a key map
 * that binds a reserved key or one key twice, or a button map that is not one button per action,
 * is dropped whole rather than half-applied.
 */
export function parseSettings(
  raw: string | null,
  defaultDeadzone: number,
  range: DeadzoneRange,
): ControlSettings {
  const fallback = defaultSettings(defaultDeadzone);
  if (!raw) return fallback;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!data || typeof data !== 'object') return fallback;
  const d = data as { v?: unknown; keys?: unknown; pad?: unknown; leftDeadzone?: unknown };
  if (d.v !== SAVE_VERSION) return fallback;
  return {
    keys: parseKeys(d.keys) ?? fallback.keys,
    pad: parsePad(d.pad) ?? fallback.pad,
    leftDeadzone:
      typeof d.leftDeadzone === 'number'
        ? clampDeadzone(d.leftDeadzone, range, defaultDeadzone)
        : defaultDeadzone,
  };
}

function parseKeys(value: unknown): KeyMap | null {
  if (!value || typeof value !== 'object') return null;
  const src = value as Record<string, unknown>;
  const map = defaultKeys();
  const used = new Set<string>();
  for (const def of KEY_ACTIONS) {
    if (!(def.id in src)) continue;
    const k = src[def.id];
    if (k === null) map[def.id] = null;
    else if (typeof k === 'string' && k.length > 0 && !reservedReason(k)) {
      map[def.id] = normalizeKey(k);
    } else return null;
  }
  for (const k of Object.values(map)) {
    if (k === null) continue;
    if (used.has(k)) return null;
    used.add(k);
  }
  return map;
}

function parsePad(value: unknown): PadMap | null {
  if (!value || typeof value !== 'object') return null;
  const src = value as Record<string, unknown>;
  const map = defaultPad();
  for (const def of PAD_ACTIONS) {
    if (!(def.id in src)) continue;
    const b = src[def.id];
    if (typeof b !== 'number' || !BINDABLE_BUTTONS.includes(b)) return null;
    map[def.id] = b;
  }
  const buttons = Object.values(map);
  return new Set(buttons).size === buttons.length ? map : null;
}
