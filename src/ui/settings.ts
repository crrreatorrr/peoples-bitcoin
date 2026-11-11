import { PARODY_NOTICE } from '../config/branding';
import { buildTestWorldPanel } from './testworld';
/** Settings tab: manual save, feedback, reset progress, a test world with AI players, and controls. */
export function buildSettingsPanel(
  onSave: () => void,
  onReset: () => void,
  onExit: () => void,
  online = false,
  onFeedback?: () => void,
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

  const exit = document.createElement('button');
  exit.className = 'stone-btn';
  exit.textContent = 'Exit to Hub';
  exit.addEventListener('click', onExit);

  const feedback = document.createElement('button');
  feedback.className = 'stone-btn';
  feedback.textContent = 'Send feedback';
  feedback.addEventListener('click', () => onFeedback?.());

  const help = document.createElement('ul');
  help.className = 'controls-help';
  for (const line of [
    'Left-click: walk / default action',
    'Right-click: all options',
    'Middle-drag, arrow keys, sideways swipe: camera',
    'Mouse wheel: zoom',
    'Shift-click item: drop',
    'Tap Shift, or the Motion orb (top right): toggle run',
    'Space / Enter: continue dialogue; 1-5: pick an option',
    'Menus and windows: arrow keys move, Enter / Space choose, Esc closes',
    'F1-F4, F6, F10: tabs; Esc: Inventory; Enter or typing: chat',
    'N twice (not while typing): send feedback',
    'Controller: left stick / D-pad walk, A act, X options, LB / RB target',
    'Controller: right stick camera, LT / RT zoom, Y run, B cancel',
    'Controller: View inventory, Menu this tab (Exit to Hub)',
  ]) {
    const li = document.createElement('li');
    li.textContent = line;
    help.append(li);
  }

  const notice = document.createElement('p');
  notice.className = 'parody-notice';
  notice.textContent = PARODY_NOTICE;

  el.append(
    save,
    exit,
    ...(onFeedback ? [feedback] : []),
    reset,
    buildTestWorldPanel(online),
    help,
    notice,
  );
  return el;
}
