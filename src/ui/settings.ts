import { PARODY_NOTICE } from '../config/branding';
import { standardButtons } from './menuOptions';
import { buildTestWorldPanel } from './testworld';
/** What the Settings tab needs to show and change the sound. */
export interface SoundControls {
  readonly volume: number;
  readonly muted: boolean;
  /** One press of the volume buttons, 0..1. */
  readonly step: number;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Plays a sample so a change can be heard. */
  preview(): void;
}

/** A row of buttons (no slider, so a controller can use it): Sound on/off, quieter, louder. */
function buildSoundRow(sound: SoundControls): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-sound';
  const mute = document.createElement('button');
  mute.className = 'stone-btn';
  const down = document.createElement('button');
  down.className = 'stone-btn';
  down.textContent = 'Vol −';
  down.title = 'Quieter';
  const up = document.createElement('button');
  up.className = 'stone-btn';
  up.textContent = 'Vol +';
  up.title = 'Louder';
  const paint = () => {
    mute.textContent = sound.muted ? 'Sound: off' : `Sound: ${Math.round(sound.volume * 100)}%`;
    mute.title = sound.muted ? 'Turn sound on' : 'Turn sound off';
  };
  mute.addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    paint();
    sound.preview();
  });
  const nudge = (by: number) => () => {
    sound.setVolume(sound.volume + by);
    if (sound.muted) sound.setMuted(false);
    paint();
    sound.preview();
  };
  down.addEventListener('click', nudge(-sound.step));
  up.addEventListener('click', nudge(sound.step));
  paint();
  row.append(mute, down, up);
  return row;
}

/** Main menu and Controller settings, which the Settings tab offers next to Exit to Hub. */
export interface SettingsMenu {
  mainMenu(): void;
  controls(): void;
}

/**
 * Settings tab: manual save, the standard menu options (Exit to Hub, Main menu, Controller
 * settings, Full screen), feedback, sound, reset progress and a test world with AI players. The
 * controls list moved to Controller settings, which can also remap them.
 */
export function buildSettingsPanel(
  onSave: () => void,
  onReset: () => void,
  onExit: () => void,
  online = false,
  onFeedback?: () => void,
  sound?: SoundControls,
  menu?: SettingsMenu,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'settings';

  const save = document.createElement('button');
  save.className = 'stone-btn';
  save.textContent = 'Save now';
  save.addEventListener('click', onSave);

  const reset = document.createElement('button');
  reset.className = 'stone-btn danger';
  reset.textContent = 'Reset progress';
  // It asks with the browser's confirm(), which a controller can't answer: the pad skips it.
  reset.dataset.padSkip = '';
  reset.addEventListener('click', () => {
    if (confirm('Start a new term? All progress in this browser will be lost.')) onReset();
  });

  const standard = menu
    ? standardButtons(
        'settings',
        { mainMenu: menu.mainMenu, hub: onExit, controls: menu.controls },
        'stone-btn',
      )
    : [exitButton(onExit)];

  const feedback = document.createElement('button');
  feedback.className = 'stone-btn';
  feedback.textContent = 'Send feedback';
  feedback.addEventListener('click', () => onFeedback?.());

  const notice = document.createElement('p');
  notice.className = 'parody-notice';
  notice.textContent = PARODY_NOTICE;

  el.append(save, ...standard, ...(onFeedback ? [feedback] : []));
  if (sound) el.append(buildSoundRow(sound));
  el.append(reset, buildTestWorldPanel(online), notice);
  return el;
}

function exitButton(onExit: () => void): HTMLButtonElement {
  const exit = document.createElement('button');
  exit.className = 'stone-btn';
  exit.textContent = 'Exit to Hub';
  exit.addEventListener('click', onExit);
  return exit;
}
