/**
 * The "Full screen" option every menu has. The game already fills the browser window; this puts
 * the browser itself in full screen with the Fullscreen API. The request must come from the
 * click, key or controller press that chose the option (a user gesture), so buttons call
 * `toggleFullscreen` straight from their click handler. Every toggle on the page relabels on
 * `fullscreenchange`, so F11, Esc or the browser's own exit leave the labels right.
 */

/** The parts of `document` this uses (a fake in tests). */
export interface FullscreenDoc {
  readonly fullscreenEnabled: boolean;
  readonly fullscreenElement: Element | null;
  readonly documentElement: { requestFullscreen(): Promise<void> };
  exitFullscreen(): Promise<void>;
}

export function fullscreenSupported(doc: FullscreenDoc): boolean {
  return doc.fullscreenEnabled === true;
}

export function isFullscreen(doc: FullscreenDoc): boolean {
  return doc.fullscreenElement !== null && doc.fullscreenElement !== undefined;
}

export function fullscreenLabel(on: boolean): string {
  return on ? 'Full screen: on' : 'Full screen: off';
}

/** Enters or leaves full screen. A refusal (no gesture, a policy) is ignored: the label stays. */
export function toggleFullscreen(doc: FullscreenDoc): Promise<void> {
  const call = isFullscreen(doc) ? doc.exitFullscreen() : doc.documentElement.requestFullscreen();
  return Promise.resolve(call).catch(() => undefined);
}

const TOGGLE_CLASS = 'fullscreen-toggle';
let listening = false;

function relabelAll(): void {
  const label = fullscreenLabel(isFullscreen(document));
  for (const el of document.querySelectorAll<HTMLButtonElement>(`.${TOGGLE_CLASS}`)) {
    el.textContent = label;
    el.setAttribute('aria-pressed', String(isFullscreen(document)));
  }
}

/**
 * A "Full screen: on/off" button, hidden where the browser has no Fullscreen API (an iframe
 * without permission, iOS Safari on iPhone).
 */
export function fullscreenButton(className: string): HTMLButtonElement {
  if (!listening) {
    listening = true;
    document.addEventListener('fullscreenchange', relabelAll);
  }
  const b = document.createElement('button');
  b.className = `${className} ${TOGGLE_CLASS}`.trim();
  b.dataset.option = 'fullscreen';
  b.textContent = fullscreenLabel(isFullscreen(document));
  b.setAttribute('aria-pressed', String(isFullscreen(document)));
  b.hidden = !fullscreenSupported(document);
  b.addEventListener('click', () => void toggleFullscreen(document));
  return b;
}

/**
 * Esc pressed while the page is in browser full screen belongs to the browser: it leaves full
 * screen. Browsers usually keep that key from the page; when one passes it on, the game must
 * not also close a window or open its menu with the same press.
 */
export function escapeLeavesFullscreen(doc: Pick<FullscreenDoc, 'fullscreenElement'>): boolean {
  return doc.fullscreenElement !== null && doc.fullscreenElement !== undefined;
}
