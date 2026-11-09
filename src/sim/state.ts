/**
 * The single authoritative GameState, plus the intents that drive it and the
 * events it emits. Only the tick loop mutates GameState.
 */
import { MOVEMENT, START_CURRENCIES, SUMMONING } from '../config/balance';
import { PRESIDENT_NAME } from '../config/branding';
import type { Content } from './content';
import { createEconomy } from './economy';
import type { Grid } from './grid';
import { createInventory } from './inventory';
import { createRng, type RngState } from './rng';
import type { DialogueLine, EquipSlot, ZoneDef } from './schemas';
import { levelForXp, xpForLevel } from './xp';

export type { EquipSlot };

export interface Tile {
  x: number;
  y: number;
}

export interface InventorySlot {
  itemId: string;
  qty: number;
}
export type Inventory = (InventorySlot | null)[];
export type Equipment = Record<EquipSlot, InventorySlot | null>;

/** A count, or every one available. */
export type Quantity = number | 'all';

/** Guns: accurate / rapid / longrange. Gavel and melee weapons: bash / block. */
export type CombatStyle = 'accurate' | 'rapid' | 'longrange' | 'bash' | 'block';

/** What a client asks for. The sim validates every intent before acting on it. */
export type Intent =
  | { type: 'walk'; x: number; y: number }
  | { type: 'interact'; targetId: string; action: string }
  | { type: 'toggleRun' }
  | { type: 'toggleRetaliate' }
  | { type: 'dropItem'; slot: number }
  | { type: 'moveItem'; from: number; to: number }
  | { type: 'equip'; slot: number }
  | { type: 'unequip'; slot: EquipSlot }
  | { type: 'eat'; slot: number }
  | { type: 'drink'; slot: number }
  | { type: 'teleport'; slot: number }
  /** Use an inventory item on an object or NPC. */
  | { type: 'useItem'; slot: number; targetId: string }
  /** Pick an option in a "Select an Option" dialogue. */
  | { type: 'chooseOption'; index: number }
  | { type: 'summon'; slot: number }
  /** Summon a relic-unlocked Sproto (no contract). The sim checks the hub relics. */
  | { type: 'summonRelic'; sprotoId: string }
  | { type: 'dismiss' }
  | { type: 'special' }
  | { type: 'setStyle'; style: CombatStyle }
  | { type: 'chat'; text: string }
  | { type: 'continueDialogue' }
  | { type: 'deposit'; slot: number; qty: Quantity }
  | { type: 'depositAll' }
  | { type: 'withdraw'; index: number; qty: Quantity; itemId?: string }
  | { type: 'buy'; itemId: string; qty: number }
  | { type: 'sell'; slot: number; qty: Quantity }
  | { type: 'build'; buildId: string }
  | { type: 'closeInterface' };

export interface ActiveAction {
  targetId: string;
  action: string;
  /** Tick of the next skilling attempt; null until the player arrives and starts. */
  nextAttemptTick: number | null;
  /** For 'Use': the inventory item being used on the target. */
  itemId?: string;
}

export type OpenInterface =
  | { kind: 'bank' }
  /** A shop window: the Trading Terminal or another shop's stall. */
  | { kind: 'terminal'; shopId: string }
  /** Ticket → Verse exchange at a Treasury terminal. */
  | { kind: 'exchange' }
  | { kind: 'build'; targetId: string };

export interface Currencies {
  tickets: number;
  /**
   * Always 0. The wallet is `tickets`. This field only exists so the current
   * test suite still typechecks; nothing in the game reads or writes it.
   */
  bitcoin: number;
}

/** Repeatable Ticket streams banked with earnTickets. */
export const STREAM_REASONS = ['pb_drop', 'pb_lobby', 'pb_sell'] as const;
export type StreamReason = (typeof STREAM_REASONS)[number];

export interface StreamPocket {
  /** Fractional Tickets not yet a whole Ticket. */
  remainder: number;
  /** Whole Tickets not yet sealed into a batch. Hub sessions only. */
  pending: number;
}

export interface EarnBatch {
  id: string;
  amount: number;
  /** Set after a transport failure. The next init resends this id; checkpoints do not. */
  retryAtInit?: boolean;
}

/** One quest or step reward. `name` is the stable id; `key` is its UUIDv5. */
export interface QuestEarn {
  name: string;
  amount: number;
  /** UUIDv5 of `name`, filled before the first send and reused. */
  key: string | null;
  /**
   * `capped` is still owed: `session_ticket_cap` only. It is resent when the
   * hub session id changes. `acked` includes earns we dropped for good.
   */
  status: 'pending' | 'capped' | 'acked';
  /** Hub session id that returned session_ticket_cap, if we know it. */
  cappedSessionId: string | null;
}

export interface ShopOrder {
  key: string;
  shopId: string;
  itemId: string;
  packs: number;
}

export interface SaleOrder extends ShopOrder {
  slot: number;
}

export interface ExchangeOrder {
  id: string;
  tickets: number;
}

/** Hub writes that must survive a reload. Not the SDK's own outbox. */
export interface HubLedger {
  streams: Record<StreamReason, StreamPocket>;
  /** Standalone fractions. These are never sent to the hub. */
  offlineRemainder: Record<StreamReason, number>;
  batches: Partial<Record<StreamReason, EarnBatch>>;
  questEarns: QuestEarn[];
  purchase: ShopOrder | null;
  sale: SaleOrder | null;
  fulfilledKeys: string[];
  exchange: ExchangeOrder | null;
  appliedReceipts: string[];
  /**
   * Ids of stream batches sealed in the hub ledger store. A stale tab uses this,
   * plus that store, so it does not mint a second key for the same pending.
   */
  appliedSealIds: string[];
  relicKey: string | null;
  relicTick: number | null;
  relicAcked: boolean;
  submittedXp: number;
}

/** Session-only hub link. Never serialized. */
export interface HubSession {
  mode: 'standalone' | 'hub';
  reachable: boolean;
  effects: Record<string, number | boolean | string>;
  /** Relic ids (or hub item ids) the hub says this player owns. Unlocks relic Sprotos. */
  relics: string[];
  serverBalance: number | null;
  verseCapLeft: number | null;
  /** Tickets this session can still credit. Null until getTicketBalance. */
  sessionCapLeft: number | null;
  /** Tickets this game can still credit today. Null until getTicketBalance. */
  dailyCapLeft: number | null;
}

export interface DialogueState {
  /** NPC instance id. */
  npcId: string;
  /** Index into `lines`. */
  line: number;
  /** The lines picked for the player's quest progress when the talk began. */
  lines: DialogueLine[];
}

export interface Overhead {
  text: string;
  untilTick: number;
}

export interface QuestProgress {
  /** Completed step ids. */
  done: string[];
  complete: boolean;
  /** Dialogue choices that completed steps (they can change rewards and later lines). */
  choices: string[];
}

export interface SprotoInstance {
  defId: string;
  x: number;
  y: number;
  from: Tile;
  hp: number;
  expiresAt: number;
  nextAttackTick: number;
  /** Enemy instance id it is fighting. */
  target: string | null;
  nextHealTick: number;
  /** Next attack is a guaranteed max hit (Headshot). */
  headshot: boolean;
}

export interface PlayerState {
  name: string;
  pos: Tile;
  path: Tile[];
  /** Tiles visited during the last tick, starting at the previous position. Render interpolates along these. */
  stepsThisTick: Tile[];
  running: boolean;
  runEnergy: number;
  hp: number;
  action: ActiveAction | null;
  nextAttackTick: number;
  style: CombatStyle;
  inventory: Inventory;
  equipment: Equipment;
  /** Bank stacks in display order. Every item stacks in the bank. */
  bank: InventorySlot[];
  interface: OpenInterface | null;
  dialogue: DialogueState | null;
  /** Public chat shown above the player's head. */
  overhead: Overhead | null;
  /** Skill id → total XP. */
  skills: Record<string, number>;
  currencies: Currencies;
  ledger: HubLedger;
  quests: Record<string, QuestProgress>;
  /** Earned flags: boss kills ("boss:<enemyId>"), quest unlocks ("bunker") and NPCs met ("met:<npcId>"). */
  unlocks: string[];
  /** Bunker hotspot key → built option id. */
  bunker: Record<string, string>;
  /** Bunker hotspot key → tick its production was last collected. */
  collected: Record<string, number>;
  sproto: SprotoInstance | null;
  summoning: { points: number; cooldownUntil: number };
  /** Rally: +pct damage until the given tick. */
  rally: { untilTick: number; pct: number };
  /** Fight back automatically when attacked (OSRS Auto Retaliate). */
  autoRetaliate: boolean;
  /** Food can't be eaten again before this tick. */
  nextEatTick: number;
  /** The last enemy to attack the player, for single-way combat. */
  lastHitBy: { id: string; tick: number } | null;
  /** While dying: the tick the player wakes up at the respawn point. */
  dyingUntil: number | null;
  /** Active drink boosts: skill id → extra levels until a tick. */
  boosts: Record<string, { amount: number; until: number }>;
  /** A teleport in progress: where to, and the tick you arrive. */
  teleport: { at: number; zone: string; x: number; y: number } | null;
  /** Reusable items (teleports) → the tick they can be used again. */
  cooldowns: Record<string, number>;
  /** Online friends, ignores and chat filters. Unused offline. */
  social: SocialState;
  /** Display name online (the hub username); the nameplate. Offline it is unused. */
  displayName?: string;
}

export type ChatFilter = 'on' | 'friends' | 'off';

export interface SocialState {
  /** Friend user ids, with the name last seen. */
  friends: { id: string; name: string }[];
  ignores: { id: string; name: string }[];
  publicFilter: ChatFilter;
  privateFilter: ChatFilter;
  tradeFilter: ChatFilter;
}

export function emptySocial(): SocialState {
  return { friends: [], ignores: [], publicFilter: 'on', privateFilter: 'on', tradeFilter: 'on' };
}

export interface ObjectInstance {
  id: string;
  defId: string;
  x: number;
  y: number;
  /** Tick at which a depleted object respawns; null while available. */
  depletedUntil: number | null;
}

export interface NpcInstance {
  id: string;
  defId: string;
  x: number;
  y: number;
  /** Wander radius is measured from here. */
  spawn: Tile;
  /** Position at the start of the last tick, for render interpolation. */
  from: Tile;
  /** Where it's wandering to. */
  goal: Tile | null;
  /** Shown only to players with this unlock (zone placement `requires`). */
  requires?: string;
}

export interface EnemyInstance {
  id: string;
  defId: string;
  x: number;
  y: number;
  spawn: Tile;
  from: Tile;
  hp: number;
  /** Tick it comes back after dying; null while alive. */
  respawnAt: number | null;
  /** 'player', 'sproto' or null. */
  target: string | null;
  nextAttackTick: number;
  tauntedUntil: number;
  suppressedUntil: number;
  /** Boss adds don't respawn. */
  temp: boolean;
  nextAddTick: number;
  /** Last tick it attacked or was attacked; fights are dropped after a quiet spell. */
  lastCombatTick: number;
  /** Where it's wandering to. */
  goal: Tile | null;
  /** Quest-only enemies: only around while that quest's next step is `step`. */
  gate?: { quest: string; step: string };
  /** A line it's saying (see EnemyDef.barks). */
  overhead: Overhead | null;
  /** Which barks it has used this life. */
  said: { aggro: boolean; hurt: boolean };
  /** The last weapon (or 'sproto') it shrugged off, so it only says so once per weapon. */
  resisted: string | null;
  /** A private instance (quest boss copy, its adds): only this pid sees and fights it. */
  owner?: string;
  /** pid → damage dealt this life; the top damager owns the loot. Multiplayer only. */
  damageBy?: Record<string, number>;
}

export interface GroundItem {
  id: string;
  itemId: string;
  qty: number;
  x: number;
  y: number;
  despawnTick: number;
  /** Only this pid sees it until `publicAt` (never, for a death pile). Multiplayer only. */
  owner?: string;
  publicAt?: number;
}

export interface ZoneState {
  id: string;
  objects: ObjectInstance[];
  npcs: NpcInstance[];
  enemies: EnemyInstance[];
  groundItems: GroundItem[];
  nextGroundItemId: number;
  nextEnemyId: number;
}

export interface EconomyState {
  priceUsd: number;
  /** Most recent price last. */
  history: number[];
  /** Server-wide sentiment, 0–100. */
  hopium: number;
  recentBossWins: number;
  recentDumps: number;
}

/**
 * One player's view of the world. The sim's per-player code reads and writes
 * `player` and `zone` through it; a single-player game is a world of one with
 * pid `'player'`. `zone`, `tick`, `rng` and `economy` are accessors over `world`.
 */
export interface GameState {
  tick: number;
  rng: RngState;
  player: PlayerState;
  /** The zone (instance) the player is in. */
  zone: ZoneState;
  /** The world's other zone instances, keyed by zone key (read-only shim for tests and saves). */
  readonly otherZones: Record<string, ZoneState>;
  economy: EconomyState;
  /** Not saved. Standalone until the client links a hub session. */
  hubSession: HubSession;
  /** Player id in the world: `'player'` offline. */
  readonly pid: string;
  /** Entity id of this player in events and enemy targets: `'player'` offline. */
  readonly selfId: string;
  /** Entity id of this player's Sproto: `'sproto'` offline. */
  readonly sprotoId: string;
  readonly world: WorldState;
}

/** Every player and zone instance on one server world (or the one offline player). */
export interface WorldState {
  tick: number;
  rng: RngState;
  economy: EconomyState;
  players: Record<string, PlayerState>;
  /** Zone instance key → zone. The key is the zone id, or `${zoneId}@${pid}` for a private instance. */
  zones: Record<string, ZoneState>;
  /** pid → zone instance key. */
  playerZone: Record<string, string>;
  /** Join order: per-player phases run in this order, so a tick is deterministic. */
  joinSeq: string[];
}

/** Online shops: the server's wallet. Results carry the new balance. */
export type WalletResult = { ok: true; balance: number } | { ok: false; error: string };
export interface WalletPort {
  spend(pid: string, shopId: string, itemId: string, packs: number): WalletResult;
  sell(pid: string, shopId: string, itemId: string, packs: number): WalletResult;
}

/** Static data the tick needs alongside the state. */
export interface SimContext {
  content: Content;
  /** Collision grid per zone id. */
  grids: Map<string, Grid>;
  /** Online only: shops buy and sell through the server wallet. */
  wallet?: WalletPort;
}

export type MessageKind = 'game' | 'npc' | 'public' | 'levelup' | 'warning' | 'quest';

/** How an attack looks: a swing, a shot, an explosive shell, a spell, or a thrown rock. */
export type AttackStyle = 'melee' | 'gun' | 'explosive' | 'magic' | 'rock';

export type SimEvent =
  | { type: 'message'; kind: MessageKind; text: string; speaker?: string }
  | { type: 'xp'; skillId: string; amount: number }
  | { type: 'levelUp'; skillId: string; level: number }
  | { type: 'hitsplat'; targetId: string; damage: number }
  | { type: 'attack'; attackerId: string; targetId: string; style: AttackStyle }
  | { type: 'death'; entityId: string }
  | { type: 'zoneChanged'; zoneId: string }
  /** The player started teleporting (for the sparkle). */
  | { type: 'teleport' }
  | { type: 'autosave' }
  /** A quest just flipped to complete. */
  | { type: 'questComplete'; questId: string; tick: number }
  /** A quest Ticket reward is waiting to be sent on its own key. */
  | { type: 'questEarn'; name: string; amount: number };

export type EntityRef =
  | { kind: 'object'; instance: ObjectInstance }
  | { kind: 'npc'; instance: NpcInstance }
  | { kind: 'ground'; instance: GroundItem }
  | { kind: 'enemy'; instance: EnemyInstance };

export const PLAYER_ID = 'player';
export const SPROTO_ID = 'sproto';

/** Entity id of a player in events and enemy targets. The offline player keeps `'player'`. */
export function playerEntityId(pid: string): string {
  return pid === PLAYER_ID ? PLAYER_ID : `p:${pid}`;
}

/** Entity id of a player's Sproto. The offline player's is `'sproto'`. */
export function sprotoIdOf(pid: string): string {
  return pid === PLAYER_ID ? SPROTO_ID : `s:${pid}`;
}

/** The pid behind a player or Sproto entity id, or null for anything else. */
export function pidOfEntity(id: string): string | null {
  if (id === PLAYER_ID || id === SPROTO_ID) return PLAYER_ID;
  if (id.startsWith('p:') || id.startsWith('s:')) return id.slice(2);
  return null;
}

function emptyPocket(): StreamPocket {
  return { remainder: 0, pending: 0 };
}

export function emptyLedger(): HubLedger {
  return {
    streams: { pb_drop: emptyPocket(), pb_lobby: emptyPocket(), pb_sell: emptyPocket() },
    offlineRemainder: { pb_drop: 0, pb_lobby: 0, pb_sell: 0 },
    batches: {},
    questEarns: [],
    purchase: null,
    sale: null,
    fulfilledKeys: [],
    exchange: null,
    appliedReceipts: [],
    appliedSealIds: [],
    relicKey: null,
    relicTick: null,
    relicAcked: false,
    submittedXp: 0,
  };
}

export function freshHubSession(): HubSession {
  return {
    mode: 'standalone',
    reachable: false,
    effects: {},
    relics: [],
    serverBalance: null,
    verseCapLeft: null,
    sessionCapLeft: null,
    dailyCapLeft: null,
  };
}

export function emptyEquipment(): Equipment {
  return {
    head: null,
    neck: null,
    weapon: null,
    body: null,
    legs: null,
    hands: null,
    feet: null,
    ammo: null,
  };
}

/** The NPC placed `index`-th in `zone`, standing on its spawn tile. */
export function npcInstance(zone: ZoneDef, index: number): NpcInstance {
  const n = zone.npcs[index];
  return {
    id: `n${index}`,
    defId: n.npcId,
    x: n.x,
    y: n.y,
    spawn: { x: n.x, y: n.y },
    from: { x: n.x, y: n.y },
    goal: null,
    ...(n.requires ? { requires: n.requires } : {}),
  };
}

export function createZoneState(zone: ZoneDef, content: Content): ZoneState {
  return {
    id: zone.id,
    objects: zone.objects.map((o, i) => ({
      id: `o${i}`,
      defId: o.objectId,
      x: o.x,
      y: o.y,
      depletedUntil: null,
    })),
    npcs: zone.npcs.flatMap((n, i) => (n.requires ? [] : [npcInstance(zone, i)])),
    enemies: zone.enemies.map((e, i) => {
      const enemy = newEnemy(`e${i}`, e.enemyId, e.x, e.y, content, false);
      if (e.quest) {
        enemy.gate = { ...e.quest };
        // The template is the offline player's copy; online players get their own (enemies.ts).
        enemy.owner = PLAYER_ID;
        enemy.respawnAt = Infinity; // dormant until its quest step comes up
      }
      return enemy;
    }),
    groundItems: [],
    nextGroundItemId: 0,
    nextEnemyId: zone.enemies.length,
  };
}

export function newEnemy(
  id: string,
  defId: string,
  x: number,
  y: number,
  content: Content,
  temp: boolean,
): EnemyInstance {
  return {
    id,
    defId,
    x,
    y,
    spawn: { x, y },
    from: { x, y },
    hp: content.enemies.get(defId)?.hp ?? 1,
    respawnAt: null,
    target: null,
    nextAttackTick: 0,
    tauntedUntil: 0,
    suppressedUntil: 0,
    temp,
    nextAddTick: 0,
    lastCombatTick: 0,
    goal: null,
    overhead: null,
    said: { aggro: false, hurt: false },
    resisted: null,
  };
}

/** A new character standing at the zone's spawn. */
export function createPlayer(content: Content, zoneId: string): PlayerState {
  const zone = content.zones.get(zoneId);
  if (!zone) throw new Error(`Unknown zone '${zoneId}'`);
  const skills: Record<string, number> = {};
  for (const skill of content.skills.values()) skills[skill.id] = xpForLevel(skill.startLevel);
  const quests: Record<string, QuestProgress> = {};
  for (const q of content.quests.values())
    if (q.autoStart) quests[q.id] = { done: [], complete: false, choices: [] };
  return {
    name: PRESIDENT_NAME,
    pos: { ...zone.spawn },
    path: [],
    stepsThisTick: [{ ...zone.spawn }],
    running: false,
    runEnergy: MOVEMENT.runEnergyMax,
    hp: levelForXp(skills.hitpoints ?? 0),
    action: null,
    nextAttackTick: 0,
    style: 'accurate',
    inventory: createInventory(),
    equipment: emptyEquipment(),
    bank: [],
    interface: null,
    dialogue: null,
    overhead: null,
    skills,
    currencies: { ...START_CURRENCIES },
    ledger: emptyLedger(),
    quests,
    unlocks: [],
    bunker: {},
    collected: {},
    sproto: null,
    summoning: { points: SUMMONING.pointsMax, cooldownUntil: 0 },
    rally: { untilTick: 0, pct: 0 },
    autoRetaliate: true,
    nextEatTick: 0,
    lastHitBy: null,
    dyingUntil: null,
    boosts: {},
    teleport: null,
    cooldowns: {},
    social: emptySocial(),
  };
}

export function createWorldState(seed: number): WorldState {
  return {
    tick: 0,
    rng: createRng(seed),
    economy: createEconomy(),
    players: {},
    zones: {},
    playerZone: {},
    joinSeq: [],
  };
}

/** Zones that are one instance per player (the bunker). */
export const INSTANCED_ZONES: readonly string[] = ['zone_bunker'];

/** The zone instance key `pid` uses for `zoneId`. The offline player uses plain zone ids. */
export function zoneKeyFor(zoneId: string, pid: string): string {
  return pid !== PLAYER_ID && INSTANCED_ZONES.includes(zoneId) ? `${zoneId}@${pid}` : zoneId;
}

const VIEWS = new WeakMap<WorldState, Map<string, GameState>>();

/** The live per-player view of `world` for `pid` (cached, so it is the same object every time). */
export function viewFor(world: WorldState, pid: string): GameState {
  let views = VIEWS.get(world);
  if (!views) {
    views = new Map();
    VIEWS.set(world, views);
  }
  const cached = views.get(pid);
  if (cached) return cached;
  const view: GameState = {
    get tick() {
      return world.tick;
    },
    set tick(v: number) {
      world.tick = v;
    },
    get rng() {
      return world.rng;
    },
    set rng(v: RngState) {
      world.rng = v;
    },
    get economy() {
      return world.economy;
    },
    set economy(v: EconomyState) {
      world.economy = v;
    },
    get player() {
      return world.players[pid];
    },
    set player(v: PlayerState) {
      world.players[pid] = v;
    },
    get zone() {
      return world.zones[world.playerZone[pid]];
    },
    set zone(v: ZoneState) {
      world.zones[world.playerZone[pid]] = v;
    },
    get otherZones() {
      const here = world.playerZone[pid];
      return Object.fromEntries(Object.entries(world.zones).filter(([k]) => k !== here));
    },
    hubSession: freshHubSession(),
    pid,
    selfId: playerEntityId(pid),
    sprotoId: sprotoIdOf(pid),
    world,
  };
  views.set(pid, view);
  return view;
}

/** Puts `player` into `world` in zone `zoneId` (creating that zone instance if needed). */
export function addPlayerToWorld(
  world: WorldState,
  content: Content,
  pid: string,
  player: PlayerState,
  zoneId: string,
): GameState {
  const def = content.zones.get(zoneId);
  if (!def) throw new Error(`Unknown zone '${zoneId}'`);
  const key = zoneKeyFor(zoneId, pid);
  world.zones[key] ??= createZoneState(def, content);
  world.players[pid] = player;
  world.playerZone[pid] = key;
  if (!world.joinSeq.includes(pid)) world.joinSeq.push(pid);
  return viewFor(world, pid);
}

/** Takes `pid` out of the world: their private zones and enemies go, and enemies forget them. */
export function removePlayerFromWorld(world: WorldState, pid: string): PlayerState | undefined {
  const player = world.players[pid];
  if (!player) return undefined;
  const selfId = playerEntityId(pid);
  const sprotoId = sprotoIdOf(pid);
  const here = world.zones[world.playerZone[pid]];
  if (here) {
    here.enemies = here.enemies.filter((e) => e.owner !== pid);
    for (const e of here.enemies) if (e.target === selfId || e.target === sprotoId) e.target = null;
  }
  for (const key of Object.keys(world.zones)) if (key.endsWith(`@${pid}`)) delete world.zones[key];
  delete world.players[pid];
  delete world.playerZone[pid];
  world.joinSeq = world.joinSeq.filter((p) => p !== pid);
  VIEWS.get(world)?.delete(pid);
  return player;
}

export function createGameState(content: Content, zoneId: string, seed: number): GameState {
  const world = createWorldState(seed);
  return addPlayerToWorld(world, content, PLAYER_ID, createPlayer(content, zoneId), zoneId);
}

export function findEntity(state: GameState, id: string): EntityRef | null {
  const z = state.zone;
  const obj = z.objects.find((o) => o.id === id);
  if (obj) return { kind: 'object', instance: obj };
  const npc = z.npcs.find((n) => n.id === id && npcVisible(state, n));
  if (npc) return { kind: 'npc', instance: npc };
  const ground = z.groundItems.find((g) => g.id === id && groundVisible(state, g));
  if (ground) return { kind: 'ground', instance: ground };
  const enemy = z.enemies.find(
    (e) => e.id === id && e.respawnAt === null && enemyVisible(state, e),
  );
  if (enemy) return { kind: 'enemy', instance: enemy };
  return null;
}

/** NPCs with a `requires` only show for players with that unlock. */
export function npcVisible(state: GameState, npc: NpcInstance): boolean {
  return !npc.requires || hasUnlock(state.player, npc.requires);
}

/** Private loot shows only for its owner until it turns public. */
export function groundVisible(state: GameState, g: GroundItem): boolean {
  if (g.owner === undefined || g.owner === state.pid) return true;
  return g.publicAt !== undefined && state.tick >= g.publicAt;
}

/** The owner a boss's adds get: its own, except the offline template's (public) adds. */
export function addOwner(enemy: EnemyInstance): string | undefined {
  return enemy.owner === PLAYER_ID ? undefined : enemy.owner;
}

/** Private enemy instances show only for their owner. */
export function enemyVisible(state: GameState, e: EnemyInstance): boolean {
  return e.owner === undefined || e.owner === state.pid;
}

export function gridOf(state: GameState, ctx: SimContext): Grid {
  const grid = ctx.grids.get(state.zone.id);
  if (!grid) throw new Error(`No grid for zone '${state.zone.id}'`);
  return grid;
}

export function maxHp(player: PlayerState): number {
  return levelForXp(player.skills.hitpoints ?? 0);
}

export function hasUnlock(player: PlayerState, flag: string): boolean {
  return player.unlocks.includes(flag);
}

export function message(events: SimEvent[], text: string, kind: MessageKind = 'game'): void {
  events.push({ type: 'message', kind, text });
}
