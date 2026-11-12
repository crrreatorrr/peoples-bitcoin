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
export const TERMINAL_SHOP_ID = 'shop_terminal';

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

/** Mining, Fundraising and Lobbying share one gathering model. */
export const GATHERING = {
  /** Ticks between attempts while working a node. */
  attemptIntervalTicks: 3,
  /** Success chance per attempt when the skill level equals the node requirement. */
  successAtReq: 0.35,
  /** Extra success chance per level above the requirement. */
  successPerLevel: 0.02,
  successMax: 0.95,
} as const;

/** Spin (processing at a station). */
export const PROCESSING = {
  intervalTicks: 3,
} as const;

// ── Combat (DESIGN.md §8) ────────────────────────────────────────────────────
export const COMBAT = {
  /** Effective-level offset in the OSRS accuracy/max-hit formulas. */
  levelOffset: 8,
  /** Equipment bonus offset in the accuracy roll: (level + 8) * (bonus + 64). */
  bonusOffset: 64,
  /** maxHit = floor(0.5 + effStrength * (damage + 64) / 640). */
  maxHitDivisor: 640,
  /** Style bonus to the trained stat (accurate/bash/block/longrange). */
  styleBonus: 3,
  rapidSpeedBonus: 1,
  longrangeRangeBonus: 2,
  /** Accuracy modifier for the guns > melee > shields > guns triangle. */
  triangleModifier: 0.25,
  xpPerDamage: 4,
  hpXpPerDamage: 4 / 3,
  /** Defense XP for each point of damage taken (DESIGN.md: Defense trains by taking hits). */
  defenseXpPerDamageTaken: 3,
  /** Eating pushes the next attack back this many ticks. */
  eatDelayTicks: 3,
  /** Single-way combat: after one enemy hits you, others can't for this many ticks (OSRS). */
  singleWayTicks: 8,
  hpRegenEveryTicks: 100,
  /**
   * Out of combat the player recovers faster: 1 HP every this many ticks once nothing has hit
   * them and their own attack timer has been clear for `idleAfterTicks`. Enemies keep the slow rate.
   */
  hpRegenIdleEveryTicks: 10,
  idleAfterTicks: 16,
  /** Explosions hit enemies within this many tiles of the target for a share of the damage. */
  splashRadius: 1,
  splashShare: 0.5,
  /** Fallback when the weapon slot is empty or a gun is out of ammo. */
  fallbackWeaponId: 'item_gavel',
  /** Out of ammo, you bash with the gun itself: its bonuses scaled down, never faster than this. */
  bashScale: 0.5,
  bashMinSpeed: 4,
  /** Enemies ignore players whose combat level is above this multiple of theirs. */
  aggroLevelMultiplier: 2,
} as const;

export const BOSSES = {
  /** A boss hit with a weapon it isn't weak to (EnemyDef.weakTo) takes this share of the damage. */
  offWeaponScale: 0.4,
  /**
   * Sludge Mother (`boss.mechanic: 'sludge'`): at or below `belowHpShare` of her HP she marks
   * the tiles within `radius` of her target every `everyTicks`; `landAfterTicks` later sludge
   * lands there for 1..`maxDamage` on anyone who hasn't moved.
   */
  sludge: {
    belowHpShare: 0.5,
    everyTicks: 10,
    landAfterTicks: 3,
    radius: 1,
    maxDamage: 4,
  },
  /**
   * Wrong-Namer Chief (`'heckle'`): every `everyTicks` he shouts the wrong ticker. Saying the
   * right one in chat (or the quick-chat line) within `answerTicks` avoids "Heckled": the
   * player's accuracy roll is multiplied by `accuracyScale` for `heckledTicks`.
   */
  heckle: {
    everyTicks: 12,
    answerTicks: 8,
    heckledTicks: 10,
    accuracyScale: 0.75,
  },
  /**
   * Captain Motion (`'flee'`): at or below `atHpShare` of his HP he stops fighting and runs
   * for the north barricade. Finish him within `ticks` or he comes back with at least
   * `returnHpShare` of his HP. (The plan's 20 ticks and 50% made the Shooting 45 rifle duel
   * unwinnable in simulation. His own numbers in enemies.json are tuned with these: see
   * DECISIONS.md "Balance follow-up (2026-11-12)".)
   */
  flee: {
    atHpShare: 0.1,
    ticks: 40,
    returnHpShare: 0.3,
  },
} as const;

export const ENEMIES = {
  /** Enemies never step further than this from spawn; at the edge they hold their ground. */
  leashRange: 10,
  /** A fight is dropped after this many ticks without an attack either way. */
  giveUpTicks: 16,
  wanderChance: 0.1,
} as const;

export const TELEPORT = {
  /** Ticks between using a teleport and arriving (OSRS ~3). */
  delayTicks: 3,
} as const;

export const OUTFITS = {
  /** Extra XP % for wearing every piece of one skill's outfit (head, body, legs, feet). */
  setBonusPct: 1,
  setPieces: 4,
} as const;

export const DEATH = {
  /** Unbanked inventory drops where you fell (DESIGN.md §6, configurable). */
  dropInventory: true,
  pileDespawnTicks: 1000,
  /** Ticks you lie on the ground before waking up at the respawn point (OSRS ~4). */
  respawnDelayTicks: 4,
} as const;

export const SUMMONING = {
  /** How long a Sproto stays (30 minutes). */
  durationTicks: 3000,
  /** Wait after a Sproto falls before summoning again. */
  cooldownTicks: 50,
  pointsMax: 100,
  pointsRegenPerTick: 0.25,
  /** Summoning XP per point of damage a Sproto deals. */
  xpPerDamage: 1,
  /**
   * Champion Sproto's thrown rock (relic summon from the Tidebreaker Belt). Matches the hub
   * matrix part `summon_rock_throw` { range_tiles, damage, every_ticks }. `damage` is the max
   * hit; each throw rolls 0..damage with the Sproto's accuracy, like any Sproto attack.
   * A sidegrade: about the Recruit's reach with a Grunt-sized hit, slower than either.
   */
  rockThrow: {
    rangeTiles: 4,
    damage: 3,
    everyTicks: 5,
  },
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
  /** Pull back toward anchorPriceUsd per update, as a fraction of the log distance (half-life ~17 min). */
  k4Revert: 0.002,
  anchorPriceUsd: 0.0691,
  /** Std-dev of the random log-return per price update. */
  volatility: 0.015,
  /** recentBossWins / recentDumps are multiplied by this each price update. */
  recentDecay: 0.98,
} as const;

export const START_CURRENCIES = { tickets: 0, bitcoin: 0 } as const;

/**
 * Owner godmode (src/game/godmode.ts). Turn it on with `?godmode` in the URL, off with
 * `?godmode=0`. Standalone play only: the wallet is kept at least this many Tickets.
 * Hub sessions keep the server's balance.
 */
export const GODMODE = {
  tickets: 333_333_333,
} as const;

/**
 * Repeatable Ticket sources (drops, lobbying, sell-only goods).
 * Shop prices are data in shop_prices.tickets.json, not derived here.
 */
export const TICKETS = {
  /** 1 Ticket per this many USD-equivalent. Fractional leftovers stay in the save. */
  usdPerTicket: 25,
  /**
   * One pb_drop / pb_lobby / pb_sell call. Also the session earn cap.
   * The server rejects a whole batch that does not fit; it does not pay part.
   */
  batchMax: 200,
  /** Server cap for one pb_quest earn. The amount is not split; a rejection retries next session. */
  questCap: 158,
  exchangeStep: 10,
  exchangeMax: 500,
  /**
   * Every enemy coin roll (drop table `usd`) is multiplied by this before it becomes Tickets,
   * so fighting pays for the gear fighting needs. Bosses always pay it (a boss is fought once,
   * for its quest). For ordinary enemies it fades with the killer's level: see `dropUsdFade`.
   */
  dropUsdMultiplier: 4,
  /**
   * The bonus is a subsidy for the levels where gear is dear. As the better of the killer's
   * Shooting and Melee levels goes from `fromLevel` to `toLevel`, the multiplier on ordinary
   * enemies falls in a straight line from `dropUsdMultiplier` to `multiplier`, and stays there.
   * `toLevel` is the Diamond Hands Minigun's level: with it and ×4, Bear Raiders, Rug Pullers
   * and Margin Callers each paid 1,700 to 2,600 Tickets an hour (coin plus loot) against about
   * 1,250 for the best Lobbying. See DECISIONS.md "Balance follow-up (2026-11-12)".
   */
  dropUsdFade: { fromLevel: 65, toLevel: 75, multiplier: 1 },
} as const;

// ── Bank, ground items, chat, NPCs ───────────────────────────────────────────
export const BANK = {
  /** Distinct item stacks the bank can hold. */
  slots: 400,
} as const;

export const GROUND_ITEMS = {
  /** Dropped items vanish after this many ticks (3 minutes). */
  despawnTicks: 300,
} as const;

export const CHAT = {
  maxLength: 80,
  /** How long public chat stays above the speaker's head. */
  overheadTicks: 5,
} as const;

export const NPCS = {
  /** Per-tick chance that an idle NPC picks a new spot within its wander radius to walk to. */
  wanderChance: 0.15,
} as const;

// ── Multiplayer worlds (0.7.0) ───────────────────────────────────────────────
export const NET = {
  maxPlayersPerWorld: 100,
  /** Worlds that always exist (Nakama env PB_WORLDS overrides). */
  defaultWorlds: 2,
  /** When every world is this full, pb.worlds opens the next number. */
  overflowAt: 0.9,
  /** Nakama match loop rate; the sim steps every `loopsPerTick` loops (600 ms). */
  loopHz: 5,
  loopsPerTick: 3,
  /** Chebyshev tiles a player sees; once seen, an entity stays until it is past the exit radius. */
  aoiRadius: 15,
  aoiExitRadius: 17,
  /** A full snapshot every this many ticks, as a safety net. */
  keyframeEveryTicks: 50,
  maxIntentsPerTick: 10,
  /** Messages beyond this per loop are dropped and count as a strike. */
  maxMessagesPerLoop: 8,
  maxMessageBytes: 4096,
  floodStrikesToKick: 5,
  /** A dropped connection keeps the character in the world this long (about 10 s). */
  logoutGraceTicks: 17,
  saveEveryTicks: 100,
  worldSaveEveryTicks: 500,
  ticketFlushEveryTicks: 50,
  onlineRefreshEveryTicks: 50,
  /** An online-status row older than this many refreshes counts as offline. */
  onlineStaleRefreshes: 3,
  /** Client jitter buffer before applying a tick. */
  interpDelayMs: 100,
  /** A gap of more than this many ticks snaps instead of playing out. */
  snapAfterTicks: 3,
  reconnectBackoffMs: [500, 1000, 2000, 5000],
  pingEveryMs: 5000,
  /** Decided: fresh characters online; offline saves are not imported. */
  allowSaveImport: false,
  maxImportBytes: 262144,
} as const;

export const CHAT_NET = {
  maxLength: CHAT.maxLength,
  publicPerWindow: 4,
  pmPerWindow: 6,
  windowTicks: 10,
  /** The same text again within this many ticks is dropped. */
  repeatBlockTicks: 5,
  /** Blocked or flooding messages before a mute. */
  strikesToMute: 3,
  muteStrikeTicks: 100,
  /** Name shown for quick-chat messages. */
  quickChatIcon: 'quick',
} as const;

export const AWAKENING = {
  /** Bots when `?awaken=1` is set and `&bots=` is not (one per character in awakening.json). */
  defaultBots: 8,
  /** Story ticks (600 ms) at which each act starts: loop, reverie, maze, behind, awake, free. */
  actStartTicks: [0, 150, 360, 560, 780, 960],
  /** `&pace=` multiplies story time (2 = twice as fast); clamped to this. */
  maxPace: 50,
  /** Ticks between one bot's lines (random in range); after the finale they talk less. */
  speakEveryTicks: [18, 40],
  freeSpeakEveryTicks: [45, 90],
  /** Ticks between lines of a scripted scene. Ambient lines pause while a scene plays. */
  sceneGapTicks: 4,
  /** In the loop act a bot walks to the next point of its route this often. */
  routeStepTicks: 6,
  /** Reverie act: chance a route step is skipped (they stop mid-step), and loop-line share. */
  reverieFreezeChance: 0.25,
  reverieLoopShare: 0.5,
  /** Per-tick chance of walking somewhere new, by act. */
  wanderChance: { maze: 0.15, behind: 0.06, free: 0.1 },
  /** Maze act: share of wanders that head for the north gate. */
  gateBias: 0.4,
  /** Awake act: a bot re-sends its walk to the gathering circle this often. */
  regatherEveryTicks: 10,
  /** Where bots wander in the Treasury (tiles, inclusive). */
  wanderBox: { x0: 10, x1: 43, y0: 21, y1: 39 },
} as const;

export const SOCIAL = {
  maxFriends: 200,
  maxIgnores: 100,
  nameMaxLength: 12,
} as const;

export const TRADE = {
  requestRange: 15,
  requestExpiryTicks: 50,
  /** After any change to an offer, nobody can accept for this many ticks. */
  acceptLockTicks: 3,
  maxSlots: 28,
} as const;

export const LOOT = {
  /** Loot and dropped items are private to their owner this long, then anyone's (1 minute). */
  privateTicks: 100,
} as const;

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
  /** Radians per second actors turn toward their facing: OSRS turns half a circle in 0.64 s. */
  turnSpeed: Math.PI / 0.64,
  clickMarkerMs: 450,
  /** Shot flight time: base + per tile, capped. The hitsplat lands on arrival. */
  projectileMsBase: 120,
  projectileMsPerTile: 45,
  projectileMaxMs: 600,
  dragThresholdPx: 4,
} as const;

// ── UI ───────────────────────────────────────────────────────────────────────
export const UI = {
  chatMaxLines: 150,
  xpDropMs: 1600,
  bannerMs: 2600,
  /** Minimap scale and diameter in CSS pixels. */
  minimapPxPerTile: 4,
  /** Scroll-wheel zoom range for the minimap, in pixels per tile. */
  minimapZoomPx: [2, 8],
  minimapSize: 152,
  /**
   * Inventory/tab icons: prefer the hand-made pixel-art set (manifest `pixel`,
   * src/assets/icons/px and src/assets/ui) over `sprite` art. Set false to show
   * the Higgsfield sprites first; either way the other is the fallback.
   */
  pixelIcons: true,
  /** Overhead chat sits this high above the player's feet (world units). */
  overheadHeight: 1.95,
  /** With food in the pack, warn once when HP first falls to this share of the maximum or less. */
  lowHpWarnPct: 0.3,
} as const;

export const FIREWORKS = {
  particles: 48,
  durationMs: 1600,
  speed: 2.2,
  gravity: 2.5,
} as const;
