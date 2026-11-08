import type { CrashReport } from '../game/crash';

/**
 * The small "Something broke" panel, in the stone-panel style of world select. It opens when the
 * game pauses after repeated errors (Reload) or when boot fails, for example a missing asset
 * (Retry). Every error string is set as text, never as markup.
 */
export function showCrashPanel(
  report: CrashReport,
  opts: { parent?: HTMLElement; reload?: () => void } = {},
): HTMLElement {
  const parent = opts.parent ?? document.body;
  const doc = parent.ownerDocument;
  parent.querySelector(':scope > .crash-overlay')?.remove();
  const boot = report.source === 'boot';

  const overlay = doc.createElement('div');
  overlay.className = 'crash-overlay';
  const panel = doc.createElement('div');
  panel.className = 'panel crash-panel';
  panel.setAttribute('role', 'alertdialog');
  panel.setAttribute('aria-labelledby', 'crash-title');

  const title = doc.createElement('h2');
  title.id = 'crash-title';
  title.textContent = 'Something broke';
  const note = doc.createElement('p');
  note.textContent = boot
    ? 'The game failed to start.'
    : 'The game hit an error and paused. Reload to carry on.';
  const message = doc.createElement('p');
  message.className = 'crash-message';
  message.textContent = report.message;
  const details = doc.createElement('details');
  const summary = doc.createElement('summary');
  summary.textContent = 'Details';
  const pre = doc.createElement('pre');
  pre.textContent = report.stack || report.message;
  details.append(summary, pre);

  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = boot ? 'Retry' : 'Reload';
  button.addEventListener('click', opts.reload ?? (() => location.reload()));

  panel.append(title, note, message, details, button);
  overlay.append(panel);
  parent.append(overlay);
  button.focus();
  return overlay;
}
