/**
 * Controller and keyboard tunables. Client-only, like the walk glide in render/stepping.ts: they
 * live here and not in config/balance.ts because src/config feeds the sim version hash, and a
 * change there would need a world server rebuild for online play (DECISIONS.md "Controller and
 * keyboard (2026-11-09)").
 */
export const PAD = {
  /** Radial deadzone of the left stick (walking); motion is rescaled to start from 0 past it. */
  leftDeadzone: 0.2,
  /** Radial deadzone of the right stick (camera). */
  rightDeadzone: 0.15,
  /** LT / RT count as pressed past this value. */
  triggerThreshold: 0.5,
  /** Triggers zoom only past this value, so a resting finger doesn't drift the camera. */
  triggerDeadzone: 0.05,
  /** The left stick moves menu focus once pushed this far on its dominant axis. */
  menuStickThreshold: 0.5,
  /** Held direction in menus: first repeat after this long, then every `menuRepeatMs`. */
  menuFirstRepeatMs: 350,
  menuRepeatMs: 120,
  /** Stick walking aims this many tiles ahead of the player, re-aimed every tick. */
  walkLookaheadTiles: 2,
  /** Soft targeting considers entities within this many tiles. */
  targetRangeTiles: 10,
  /**
   * How much soft targeting prefers what is ahead (the camera's view, or the walk direction):
   * a target straight behind counts as (1 + weight) times as far away.
   */
  targetFacingWeight: 1,
  /** Full trigger pull zooms like this many mouse-wheel units per second. */
  zoomWheelPerSec: 900,
} as const;

export const KEYS = {
  /** A Shift press and release with nothing else in between, within this long, toggles run. */
  shiftTapMaxMs: 400,
} as const;
