/**
 * The in-game feedback window: press N twice (or Settings → Send feedback). The window, the
 * screenshot and the sending live in the hub SDK (`installFeedback`); this is the game's adapter.
 *
 * It is installed at the very start of boot, before any of the game's own key listeners, so the
 * SDK's capture listener sees N first and the game never does: one N does not start a chat line.
 * The game attaches its hooks (state, pause, one render) later, once it is running.
 */
import {
  feedbackTransportFromSdk,
  installFeedback,
  type FeedbackHandle,
  type FeedbackTheme,
  type HubSdk,
} from '@metaverse/hub-sdk';
import { GAME_TITLE } from '../config/branding';
import { FEEDBACK } from '../input/config';
import { SIM_VERSION } from '../net/simVersion';
import { BUILD_ID } from './buildInfo';
import { crashGuard, type CrashGuard } from './crash';
import { buildFeedbackContext } from './feedbackContext';
import type { GameState } from '../sim/state';

/** What the running game lends the window. */
export interface FeedbackGameHooks {
  state: GameState;
  mode: 'offline' | 'online';
  world: number | null;
  /**
   * Freeze the world. Returns false when it cannot stop (an online world); any other value goes
   * back to `resume`.
   */
  pause(): unknown;
  resume(token: unknown): void;
  /** Draw one frame, so the WebGL canvas is not blank when the loop is not running. */
  render(): void;
  /** The window opened or closed: drop held keys, stop the controller acting on the world. */
  inputHeld(held: boolean): void;
}

export interface GameFeedback {
  readonly handle: FeedbackHandle;
  attach(hooks: FeedbackGameHooks): void;
}

/**
 * The game's look: stone panel, parchment text, gold accent, square corners. The window sits in a
 * shadow root, which still inherits the page's CSS variables and web fonts (src/styles.css).
 */
export const FEEDBACK_THEME: Partial<FeedbackTheme> = {
  font: "var(--font-body, 'VT323', monospace)",
  titleFont: "var(--font-display, 'Press Start 2P', monospace)",
  background: 'rgba(12, 9, 6, 0.66)',
  panel: 'var(--stone, #463d32)',
  text: 'var(--text, #f3e9d2)',
  muted: 'var(--parchment, #d6c69c)',
  accent: 'var(--gold, #f2c14e)',
  accentText: 'var(--ink, #1d1a14)',
  border: 'var(--edge-dark, #15110d)',
  radius: '0',
  css: `
.root { font-size: 19px; line-height: 1.15; }
.panel { border-width: 2px; box-shadow: inset 0 0 0 1px var(--edge-light, #7a6a52), 0 10px 0 rgba(0, 0, 0, 0.35); background: linear-gradient(180deg, var(--stone-hi, #5a4f41), var(--stone, #463d32) 36px); }
.title { font-size: 12px; color: var(--gold, #f2c14e); text-shadow: 1px 1px 0 var(--edge-dark, #15110d); }
.sub, .hint, .shotbar, .mini, .chip kbd { font-size: 16px; }
.msg, .toast, .toast button { font-size: 18px; }
.chip, .btn, .mini { border-width: 2px; background: linear-gradient(180deg, #5d4a33, #3c2f20); box-shadow: inset 0 0 0 1px var(--edge-light, #7a6a52); }
.chip:hover, .btn:hover, .mini:hover { box-shadow: inset 0 0 0 1px var(--gold, #f2c14e); }
.chip[aria-pressed="true"], .btn.primary { background: var(--gold, #f2c14e); box-shadow: inset 0 0 0 1px #fff3c4; }
textarea { background: var(--stone-lo, #332c24); border-width: 2px; }
.shot { border-width: 2px; }
.toast { border-width: 2px; box-shadow: inset 0 0 0 1px var(--edge-light, #7a6a52); }
`,
};

/** The crash guard's recent errors, newest last, as the SDK's `errors` option wants them. */
export function recentErrors(guard: CrashGuard, max: number): () => unknown[] {
  const list: { message: string; stack: string; source: string; at: number }[] = [];
  guard.onCrash((report) => {
    if (report.fatal) return; // the same error was reported just before, without the flag
    list.push({
      message: report.message,
      stack: report.stack,
      source: report.source,
      at: Math.round(performance.now()),
    });
    if (list.length > max) list.shift();
  });
  return () => list.slice();
}

/** Install the shortcut and the window. Call once, before the game adds its key listeners. */
export function createFeedback(sdk: HubSdk): GameFeedback {
  let hooks: FeedbackGameHooks | null = null;
  const errors = recentErrors(crashGuard, FEEDBACK.recentErrors);
  const handle = installFeedback({
    title: GAME_TITLE,
    version: BUILD_ID,
    transport: feedbackTransportFromSdk(sdk),
    doubleTapMs: FEEDBACK.doubleTapMs,
    theme: FEEDBACK_THEME,
    pause: () => (hooks ? hooks.pause() : false),
    resume: (token) => hooks?.resume(token),
    context: () =>
      buildFeedbackContext({
        state: hooks?.state ?? null,
        mode: hooks?.mode ?? 'offline',
        world: hooks?.world ?? null,
        simVersion: SIM_VERSION,
      }),
    beforeCapture: () => hooks?.render(),
    errors,
    onOpen: () => hooks?.inputHeld(true),
    onClose: () => hooks?.inputHeld(false),
  });
  return {
    handle,
    attach(next) {
      hooks = next;
    },
  };
}
