/**
 * Full-screen menus over the game (the game menu, Controller settings): a stack, topmost last.
 * Esc and the controller's B (gamepad.ts sends `PAD_BACK_EVENT` to the topmost one) call the top
 * menu's `back`. Esc while the browser is in full screen is left to the browser, which leaves full
 * screen with it; the menu stays (fullscreen.ts `escapeLeavesFullscreen`).
 */
import { PAD_BACK_EVENT } from '../input/gamepad';
import { escapeLeavesFullscreen } from './fullscreen';

export interface Overlay {
  readonly root: HTMLElement;
  back(): void;
}

export class OverlayStack {
  private readonly stack: Overlay[] = [];
  private listening = false;

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  has(overlay: Overlay): boolean {
    return this.stack.includes(overlay);
  }

  open(overlay: Overlay): void {
    if (this.has(overlay)) return;
    this.listen();
    // A focused chat line would keep the keys; the menu takes them.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    overlay.root.addEventListener(PAD_BACK_EVENT, () => {
      if (this.stack.at(-1) === overlay) overlay.back();
    });
    this.stack.push(overlay);
    document.body.append(overlay.root);
  }

  close(overlay: Overlay): void {
    const at = this.stack.indexOf(overlay);
    if (at < 0) return;
    this.stack.splice(at, 1);
    overlay.root.remove();
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    // Capture phase, so the game's own Esc (close windows, the right-click menu) never sees it.
    window.addEventListener(
      'keydown',
      (e) => {
        const top = this.stack.at(-1);
        if (!top || e.key !== 'Escape') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat && !escapeLeavesFullscreen(document)) top.back();
      },
      { capture: true },
    );
  }
}
