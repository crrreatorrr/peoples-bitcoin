/**
 * Gamepad play in the 3D world, where the mouse would click: the stick walks (a walk intent a
 * couple of tiles ahead, re-aimed every tick, exactly like clicking the ground), and a soft
 * target stands in for "what's under the cursor". A does its left-click option, X opens its
 * right-click menu, LB / RB pick the previous / next target. The sim sees the same intents as
 * from a mouse.
 */
import type { MenuOption } from '../ui/contextmenu';
import { PAD } from './config';
import {
  cycleTarget,
  rankTargets,
  stickToWorld,
  tileStep,
  type Stick,
  type TargetCandidate,
} from './padlogic';

export interface PadWorldDeps {
  /** The player's tile. */
  playerTile(): { x: number; y: number };
  /** Entities nearby that offer at least one action. */
  candidates(): TargetCandidate[];
  /** The menu for one entity, as a click on it would build it (first = left-click option). */
  options(entityId: string): MenuOption[];
  /** Where the entity is drawn on screen (client pixels), or null when off screen. */
  screenOf(entityId: string): { x: number; y: number } | null;
  cameraYaw(): number;
  /** Queue a walk to a tile (clamped to the zone), with no click cross. */
  walk(tile: { x: number; y: number }): void;
  /** Where the next click cross should show (the target, for A). */
  setClickAt(x: number, y: number): void;
  openMenu(options: MenuOption[], x: number, y: number): void;
  showTooltip(top: MenuOption, moreOptions: number): void;
  hideTooltip(): void;
}

export class PadWorld {
  private locked: string | null = null;
  private current: string | null = null;
  private lastWalk = '';
  private facing: Stick | null = null;
  private shown = false;

  constructor(
    private readonly deps: PadWorldDeps,
    private readonly marker: HTMLElement,
  ) {
    marker.hidden = true;
  }

  /** The soft target, if any. */
  get target(): string | null {
    return this.current;
  }

  /**
   * Every frame in world mode. `move` is the walk stick (deadzoned left stick, or the D-pad);
   * `show` draws the target marker and its mouseover text (the pad is the last device used).
   */
  frame(move: Stick, show: boolean): void {
    this.walk(move);
    this.refreshTarget();
    if (show) this.draw();
    else this.hide();
  }

  /** Stick walking only (dialogue without options: walking away closes it, as in OSRS). */
  walk(move: Stick): void {
    const step = tileStep(stickToWorld(move, this.deps.cameraYaw()));
    if (!step) {
      this.lastWalk = '';
      return;
    }
    this.facing = { x: step.dx, y: step.dy };
    this.locked = null; // walking hands targeting back to "nearest ahead"
    const p = this.deps.playerTile();
    const n = PAD.walkLookaheadTiles;
    const tile = { x: p.x + step.dx * n, y: p.y + step.dy * n };
    // Re-aim when the direction changes or the player has moved on: at most once a tick.
    const key = `${p.x},${p.y}>${tile.x},${tile.y}`;
    if (key === this.lastWalk) return;
    this.lastWalk = key;
    this.deps.walk(tile);
  }

  /** A: the target's left-click option. */
  act(): void {
    const id = this.current;
    if (!id) return;
    const top = this.deps.options(id)[0];
    if (!top?.run) return;
    const at = this.deps.screenOf(id);
    if (at) this.deps.setClickAt(at.x, at.y);
    top.run();
  }

  /** X: the target's right-click menu. */
  menu(): void {
    const id = this.current;
    if (!id) return;
    const options = this.deps.options(id);
    if (options.length === 0) return;
    const at = this.deps.screenOf(id) ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.deps.setClickAt(at.x, at.y);
    this.deps.openMenu(options, at.x, at.y);
  }

  /** LB / RB: the previous / next target in the current order. */
  cycle(step: number): void {
    const next = cycleTarget(this.order(), this.current, step);
    this.locked = next;
    this.current = next;
  }

  hide(): void {
    this.marker.hidden = true;
    if (this.shown) this.deps.hideTooltip();
    this.shown = false;
  }

  private order(): string[] {
    const facing = this.facing ?? this.cameraForward();
    return rankTargets(
      this.deps.candidates(),
      this.deps.playerTile(),
      facing,
      PAD.targetRangeTiles,
      PAD.targetFacingWeight,
    );
  }

  private refreshTarget(): void {
    const order = this.order();
    if (this.locked && order.includes(this.locked)) this.current = this.locked;
    else {
      this.locked = null;
      this.current = order[0] ?? null;
    }
  }

  /** The way the camera looks, on the tile grid: what's "ahead" while standing still. */
  private cameraForward(): Stick {
    return stickToWorld({ x: 0, y: -1 }, this.deps.cameraYaw());
  }

  private draw(): void {
    const id = this.current;
    const at = id ? this.deps.screenOf(id) : null;
    const [top, ...rest] = id ? this.deps.options(id) : [];
    if (!id || !at || !top) {
      this.hide();
      return;
    }
    this.marker.hidden = false;
    this.marker.style.left = `${at.x}px`;
    this.marker.style.top = `${at.y}px`;
    this.deps.showTooltip(top, rest.length);
    this.shown = true;
  }
}
