import { describe, expect, it } from 'vitest';
import {
  actionForKey,
  BINDABLE_BUTTONS,
  buttonLabel,
  clampDeadzone,
  defaultKeys,
  defaultPad,
  defaultSettings,
  isTapKey,
  KEY_ACTIONS,
  keyLabel,
  PAD_ACTIONS,
  parseSettings,
  physicalFor,
  rebindButton,
  rebindKey,
  remapButtons,
  serializeSettings,
  TAB_OF_ACTION,
} from '../src/input/bindings';
import { CONTROLS, PAD } from '../src/input/config';
import { Controls, type ControlsStore } from '../src/input/controls';
import { ShiftTap } from '../src/input/keyboard';
import { BTN, BUTTON_COUNT } from '../src/input/padlogic';
import { PauseClock } from '../src/game/pause';
import {
  escapeLeavesFullscreen,
  fullscreenLabel,
  fullscreenSupported,
  isFullscreen,
  toggleFullscreen,
  type FullscreenDoc,
} from '../src/ui/fullscreen';
import { requestMainMenu, standardOptions, takeMainMenuRequest } from '../src/ui/menuOptions';

const KEYS_MAX = 400;
const RANGE = { min: CONTROLS.deadzoneMin, max: CONTROLS.deadzoneMax, step: CONTROLS.deadzoneStep };

function memoryStore(): ControlsStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const brokenStore: ControlsStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('key bindings', () => {
  it('defaults match the keys the game always had', () => {
    const keys = defaultKeys();
    expect(keys.cameraLeft).toBe('ArrowLeft');
    expect(keys.run).toBe('Shift');
    expect(keys.continue).toBe(' ');
    expect(keys.tabCombat).toBe('F1');
    expect(keys.tabSettings).toBe('F10');
    expect(new Set(Object.values(keys).filter(Boolean)).size).toBe(
      Object.values(keys).filter(Boolean).length,
    );
    for (const def of KEY_ACTIONS.filter((a) => a.id.startsWith('tab'))) {
      expect(TAB_OF_ACTION[def.id]).toBeTruthy();
    }
  });

  it('binds a new key and finds the action by key, any case', () => {
    const r = rebindKey(defaultKeys(), 'cameraLeft', 'Q');
    expect(r.ok).toBe(true);
    expect(r.map.cameraLeft).toBe('q');
    expect(actionForKey(r.map, 'Q')).toBe('cameraLeft');
    expect(actionForKey(r.map, 'ArrowLeft')).toBeNull();
  });

  it('swaps a key another action had', () => {
    const r = rebindKey(defaultKeys(), 'cameraLeft', 'ArrowRight');
    expect(r.swapped).toBe('cameraRight');
    expect(r.map.cameraLeft).toBe('ArrowRight');
    expect(r.map.cameraRight).toBe('ArrowLeft');
    // An action with no key gives its taker nothing back.
    const t = rebindKey(defaultKeys(), 'tabInventory', 'F1');
    expect(t.map.tabInventory).toBe('F1');
    expect(t.map.tabCombat).toBeNull();
  });

  it('refuses reserved keys (Esc, Enter, N, 1-5, F11) and leaves the map alone', () => {
    const keys = defaultKeys();
    for (const k of ['Escape', 'Enter', 'n', 'N', '3', 'F11', 'Tab']) {
      const r = rebindKey(keys, 'run', k);
      expect(r.ok, k).toBe(false);
      expect(r.error).toBeTruthy();
      expect(r.map).toBe(keys);
    }
  });

  it('labels keys for the screen', () => {
    expect(keyLabel(' ')).toBe('Space');
    expect(keyLabel('q')).toBe('Q');
    expect(keyLabel('ArrowUp')).toBe('Up arrow');
    expect(keyLabel(null)).toBe('None');
    expect(isTapKey('Shift')).toBe(true);
    expect(isTapKey('r')).toBe(false);
  });

  it('a tap of another modifier toggles run once rebound', () => {
    const t = new ShiftTap(KEYS_MAX, 'Control');
    t.down('Control', false, false, 0);
    expect(t.up('Control', 100)).toBe(true);
    t.down('Shift', false, false, 200);
    expect(t.up('Shift', 250)).toBe(false);
  });
});

describe('controller bindings', () => {
  it('defaults to the standard layout', () => {
    const pad = defaultPad();
    for (const def of PAD_ACTIONS) expect(pad[def.id]).toBe(def.logical);
    const pressed = Array.from({ length: BUTTON_COUNT }, (_, i) => i === BTN.A);
    expect(remapButtons(pressed, pad)).toEqual(pressed);
  });

  it('swaps a button another action had', () => {
    const r = rebindButton(defaultPad(), 'act', BTN.X);
    expect(r.ok).toBe(true);
    expect(r.swapped).toBe('options');
    expect(r.map.act).toBe(BTN.X);
    expect(r.map.options).toBe(BTN.A);
    expect(physicalFor(r.map, BTN.A)).toBe(BTN.X);
    expect(buttonLabel(physicalFor(r.map, BTN.A))).toBe('X');
  });

  it('keeps the triggers and the D-pad fixed', () => {
    for (const b of [BTN.LT, BTN.RT, BTN.UP, BTN.LEFT]) {
      const r = rebindButton(defaultPad(), 'act', b);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/fixed/);
    }
  });

  it('turns physical presses into the logical buttons the game reads', () => {
    const map = rebindButton(defaultPad(), 'act', BTN.X).map;
    const physical = new Array<boolean>(BUTTON_COUNT).fill(false);
    physical[BTN.X] = true;
    physical[BTN.LT] = true; // passes through
    const logical = remapButtons(physical, map);
    expect(logical[BTN.A]).toBe(true);
    expect(logical[BTN.X]).toBe(false);
    expect(logical[BTN.LT]).toBe(true);
    // A now means All options.
    physical.fill(false);
    physical[BTN.A] = true;
    expect(remapButtons(physical, map)[BTN.X]).toBe(true);
    // L3 has no action: it reads as up wherever it lands.
    const l3 = rebindButton(defaultPad(), 'north', BTN.L3).map;
    physical.fill(false);
    physical[BTN.R3] = true;
    expect(remapButtons(physical, l3).some(Boolean)).toBe(false);
    physical[BTN.L3] = true;
    expect(remapButtons(physical, l3)[BTN.R3]).toBe(true);
  });

  it('every bindable button is a real standard-mapping index', () => {
    for (const b of BINDABLE_BUTTONS) expect(b).toBeLessThan(BUTTON_COUNT);
  });
});

describe('saved control settings', () => {
  it('round-trips through JSON', () => {
    const s = defaultSettings(0.3);
    s.keys = rebindKey(s.keys, 'run', 'r').map;
    s.pad = rebindButton(s.pad, 'menu', BTN.VIEW).map;
    const back = parseSettings(serializeSettings(s), PAD.leftDeadzone, RANGE);
    expect(back).toEqual(s);
  });

  it('falls back to defaults for missing, broken or unsafe saves', () => {
    const d = defaultSettings(PAD.leftDeadzone);
    expect(parseSettings(null, PAD.leftDeadzone, RANGE)).toEqual(d);
    expect(parseSettings('{oops', PAD.leftDeadzone, RANGE)).toEqual(d);
    expect(parseSettings('{"v":99}', PAD.leftDeadzone, RANGE)).toEqual(d);
    // One key bound twice, or a reserved key: the key map is dropped whole.
    const twice = JSON.stringify({ v: 1, keys: { cameraLeft: 'q', cameraRight: 'q' } });
    expect(parseSettings(twice, PAD.leftDeadzone, RANGE).keys).toEqual(d.keys);
    const reserved = JSON.stringify({ v: 1, keys: { run: 'Escape' } });
    expect(parseSettings(reserved, PAD.leftDeadzone, RANGE).keys).toEqual(d.keys);
    // Two actions on one button, or a fixed button: the button map is dropped whole.
    const dup = JSON.stringify({ v: 1, pad: { act: BTN.B } });
    expect(parseSettings(dup, PAD.leftDeadzone, RANGE).pad).toEqual(d.pad);
    const fixed = JSON.stringify({ v: 1, pad: { act: BTN.LT, options: BTN.A } });
    expect(parseSettings(fixed, PAD.leftDeadzone, RANGE).pad).toEqual(d.pad);
    // Dead zone out of range is clamped.
    const dz = JSON.stringify({ v: 1, leftDeadzone: 5 });
    expect(parseSettings(dz, PAD.leftDeadzone, RANGE).leftDeadzone).toBe(CONTROLS.deadzoneMax);
  });

  it('snaps the dead zone to its step', () => {
    expect(clampDeadzone(0.2 + 0.05 + 0.05, RANGE, 0.2)).toBe(0.3);
    expect(clampDeadzone(Number.NaN, RANGE, 0.2)).toBe(0.2);
    expect(clampDeadzone(0, RANGE, 0.2)).toBe(CONTROLS.deadzoneMin);
  });
});

describe('Controls (live bindings)', () => {
  it('saves every change under the game key and loads it back', () => {
    const store = memoryStore();
    const c = new Controls(store);
    let changes = 0;
    c.onChange(() => changes++);
    expect(c.setKey('cameraLeft', 'q').ok).toBe(true);
    expect(c.setButton('act', BTN.Y).ok).toBe(true);
    c.nudgeDeadzone(2);
    expect(changes).toBe(3);
    expect(store.data.has(CONTROLS.storageKey)).toBe(true);
    const again = new Controls(store);
    expect(again.keyOf('cameraLeft')).toBe('q');
    expect(again.actionForKey('Q')).toBe('cameraLeft');
    expect(again.pad.act).toBe(BTN.Y);
    expect(again.pad.run).toBe(BTN.A);
    expect(again.leftDeadzone).toBeCloseTo(PAD.leftDeadzone + 2 * CONTROLS.deadzoneStep);
    again.reset();
    expect(again.keyOf('cameraLeft')).toBe('ArrowLeft');
    expect(again.leftDeadzone).toBe(PAD.leftDeadzone);
    expect(new Controls(store).pad.act).toBe(BTN.A);
  });

  it('a refused key changes nothing and is not saved', () => {
    const store = memoryStore();
    const c = new Controls(store);
    expect(c.setKey('run', 'Escape').ok).toBe(false);
    expect(store.data.size).toBe(0);
  });

  it('works for the visit when storage is blocked', () => {
    const c = new Controls(brokenStore);
    expect(c.keyOf('run')).toBe('Shift');
    expect(c.setKey('run', 'r').ok).toBe(true);
    expect(c.keyOf('run')).toBe('r');
    expect(new Controls(null).keyOf('run')).toBe('Shift');
  });
});

describe('PauseClock (offline pause for the game menu and the feedback window)', () => {
  it('winds the game clock back by the paused time, once the last hold ends', () => {
    let now = 1000;
    let offset = 0;
    const p = new PauseClock(
      () => now,
      (ms) => (offset -= ms),
    );
    const menu = p.hold();
    expect(p.paused).toBe(true);
    now = 1500;
    const feedback = p.hold();
    now = 2000;
    feedback();
    expect(p.paused).toBe(true);
    expect(offset).toBe(0);
    now = 2600;
    menu();
    menu(); // a second release does nothing
    expect(p.paused).toBe(false);
    expect(offset).toBe(-1600);
  });
});

describe('full screen option', () => {
  function fakeDoc(enabled = true) {
    const calls: string[] = [];
    const doc: FullscreenDoc & { calls: string[]; fullscreenElement: Element | null } = {
      calls,
      fullscreenEnabled: enabled,
      fullscreenElement: null,
      documentElement: {
        requestFullscreen: () => {
          calls.push('request');
          doc.fullscreenElement = {} as Element;
          return Promise.resolve();
        },
      },
      exitFullscreen: () => {
        calls.push('exit');
        doc.fullscreenElement = null;
        return Promise.resolve();
      },
    };
    return doc;
  }

  it('enters, then leaves, and labels the state', async () => {
    const doc = fakeDoc();
    expect(fullscreenSupported(doc)).toBe(true);
    expect(fullscreenLabel(isFullscreen(doc))).toBe('Full screen: off');
    await toggleFullscreen(doc);
    expect(isFullscreen(doc)).toBe(true);
    expect(fullscreenLabel(isFullscreen(doc))).toBe('Full screen: on');
    expect(escapeLeavesFullscreen(doc)).toBe(true);
    await toggleFullscreen(doc);
    expect(doc.calls).toEqual(['request', 'exit']);
    expect(escapeLeavesFullscreen(doc)).toBe(false);
    expect(fullscreenSupported(fakeDoc(false))).toBe(false);
  });

  it('a refused request is swallowed', async () => {
    const doc = fakeDoc();
    doc.documentElement.requestFullscreen = () => Promise.reject(new Error('no gesture'));
    await expect(toggleFullscreen(doc)).resolves.toBeUndefined();
    expect(isFullscreen(doc)).toBe(false);
  });
});

describe('standard menu options', () => {
  it('every menu has Main menu, Exit to Hub, Controller settings and Full screen', () => {
    for (const kind of ['game', 'settings', 'disconnected'] as const) {
      expect(standardOptions(kind)).toEqual(['mainMenu', 'hub', 'controls', 'fullscreen']);
    }
    // The main menu (world select) leaves out Main menu.
    expect(standardOptions('main')).toEqual(['hub', 'controls', 'fullscreen']);
  });

  it('a Main menu request survives one reload only', () => {
    const store = memoryStore();
    expect(takeMainMenuRequest(store)).toBe(false);
    expect(requestMainMenu(store)).toBe(true);
    expect(takeMainMenuRequest(store)).toBe(true);
    expect(takeMainMenuRequest(store)).toBe(false);
    expect(requestMainMenu(brokenStore)).toBe(false);
    expect(takeMainMenuRequest(brokenStore)).toBe(false);
    expect(takeMainMenuRequest(null)).toBe(false);
  });
});
