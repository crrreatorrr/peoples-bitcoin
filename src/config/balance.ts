/**
 * Every tunable number lives here (DESIGN.md §17). Sim and render code import
 * from this file instead of hard-coding values.
 */

// ── Core loop ────────────────────────────────────────────────────────────────
export const TICK_MS = 600;
export const AUTOSAVE_EVERY_TICKS = 10;
/** If the tab stalls longer than this many ticks, skip ahead instead of catching up. */
export const MAX_CATCHUP_TICKS = 5;
export const INVENTORY_SIZE = 28;
export const START_ZONE_ID = 'zone_treasury';

// ── Movement ─────────────────────────────────────────────────────────────────
export const MOVEMENT = {
  walkTilesPerTick: 1,
  runTilesPerTick: 2,
  runEnergyMax: 100,
  /** Energy spent on each tick the player actually runs. */
  runDrainPerTick: 0.6,
  /** Energy regained on each tick the player does not run. */
  runRegenPerTick: 0.3,
  /** Minimum energy needed to switch run on. */
  runEnergyToEnable: 1,
} as const;

// ── Skills (OSRS XP curve) ───────────────────────────────────────────────────
export const XP_CURVE = {
  maxLevel: 99,
  maxXp: 200_000_000,
  // xp(L) = floor( sum_{n=1}^{L-1} floor(n + base * 2^(n / growth)) / divisor )
  base: 300,
  growth: 7,
  divisor: 4,
} as const;

export const MINING = {
  /** Ticks between mining attempts while standing at a rack. */
  attemptIntervalTicks: 3,
  /** Success chance per attempt when Mining level equals the rack requirement. */
  successAtReq: 0.35,
  /** Extra success chance per Mining level above the requirement. */
  successPerLevel: 0.02,
  successMax: 0.95,
} as const;

// ── Economy (DESIGN.md §6) ───────────────────────────────────────────────────
export const ECONOMY = {
  supply: 1_000_000_000,
  startPriceUsd: 0.0691,
  priceFloorUsd: 0.0069,
  priceUpdateEveryTicks: 5,
  historyLength: 200,
  startHopium: 50,
  hopiumNeutral: 50,
  /** drift = k1*(hopium-50) + k2*recentBossWins - k3*recentDumps (log-return per update) */
  k1Hopium: 0.0002,
  k2BossWins: 0.002,
  k3Dumps: 0.003,
  /** Std-dev of the random log-return per price update. */
  volatility: 0.015,
  /** recentBossWins / recentDumps are multiplied by this each price update. */
  recentDecay: 0.98,
} as const;

export const START_CURRENCIES = { bitcoin: 0, btc: 0 } as const;

// ── Camera & rendering ───────────────────────────────────────────────────────
export const CAMERA = {
  fovDeg: 50,
  near: 0.1,
  far: 200,
  minPitchDeg: 25,
  maxPitchDeg: 75,
  startPitchDeg: 48,
  startYawDeg: 15,
  minDistance: 7,
  maxDistance: 24,
  startDistance: 13,
  /** Height above the player's feet the camera looks at. */
  lookHeight: 0.9,
  dragYawPerPx: 0.008,
  dragPitchPerPx: 0.006,
  keyYawPerSec: 1.8,
  keyPitchPerSec: 1.0,
  /** Multiplier applied to distance per wheel deltaY unit: d *= exp(deltaY * zoomPerWheel). */
  zoomPerWheel: 0.0012,
} as const;

export const RENDER = {
  /** Fraction of CSS resolution the scene renders at before nearest-neighbor upscale. */
  resolutionScale: 0.55,
  fogNear: 22,
  fogFar: 48,
  /** Radians per second used to turn actors toward their facing. */
  turnSpeed: 12,
  clickMarkerMs: 450,
  dragThresholdPx: 4,
} as const;

// ── UI ───────────────────────────────────────────────────────────────────────
export const UI = {
  chatMaxLines: 150,
  xpDropMs: 1600,
  bannerMs: 2600,
} as const;
