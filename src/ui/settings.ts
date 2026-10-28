/** Settings tab: manual save, reset progress, and a controls cheat sheet. */
export function buildSettingsPanel(onSave: () => void, onReset: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'settings';

  const save = document.createElement('button');
  save.className = 'stone-btn';
  save.textContent = 'Save now';
  save.addEventListener('click', onSave);

  const reset = document.createElement('button');
  reset.className = 'stone-btn danger';
  reset.textContent = 'Reset progress';
  reset.addEventListener('click', () => {
    if (confirm('Start a new term? All progress in this browser will be lost.')) onReset();
  });

  const help = document.createElement('ul');
  help.className = 'controls-help';
  for (const line of [
    'Left-click: walk / default action',
    'Right-click: all options',
    'Right- or middle-drag, arrow keys: camera',
    'Mouse wheel: zoom',
    'Shift-click item: drop',
    'Run orb (top right): toggle run',
  ]) {
    const li = document.createElement('li');
    li.textContent = line;
    help.append(li);
  }

  el.append(save, reset, help);
  return el;
}
