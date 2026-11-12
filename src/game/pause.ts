/**
 * Offline pause, shared by the game menu and the feedback window. While any hold is out the game
 * loop skips its frames; when the last one is released the game clock is wound back by the time
 * it was held, so the game carries on from the exact moment it stopped (no catch-up ticks, and
 * tick phase, effects and click markers are where they were). Holds nest: the feedback window
 * opened from the menu, then closed, leaves the game paused until the menu closes too.
 */
export class PauseClock {
  private holds = 0;
  private since = 0;

  /** `shiftClock(ms)`: subtract `ms` from the game clock. */
  constructor(
    private readonly now: () => number,
    private readonly shiftClock: (ms: number) => void,
  ) {}

  get paused(): boolean {
    return this.holds > 0;
  }

  /** Pauses until the returned release is called (calling it again does nothing). */
  hold(): () => void {
    if (this.holds++ === 0) this.since = this.now();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.holds === 0) this.shiftClock(this.now() - this.since);
    };
  }
}
