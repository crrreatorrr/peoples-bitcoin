/**
 * Client entry point. Wires the pure sim (src/sim) to the renderer, input and
 * UI. The tick loop runs here: input becomes intents, intents feed runTick, and
 * rendering reads the resulting state every frame.
 */
import * as THREE from 'three';
import { INVENTORY_SIZE, START_ZONE_ID, TERMINAL_SHOP_ID, UI } from './config/balance';
import { HubBridge } from './hub/bridge';
import { HubClient } from './hub/client';
import { clearHubLedger } from './hub/ledgerStore';
import { claimWriter } from './hub/singleWriter';
import { GAME_TITLE, PARODY_NOTICE, PRESIDENT_NAME } from './config/branding';
import { Keyboard } from './input/keyboard';
import { attachMouse } from './input/mouse';
import { clearSavedGame, loadSavedGame, saveGame } from './persist';
import { dressFor } from './render/actors';
import { OrbitCamera } from './render/camera';
import { ChatHeads } from './render/chatheads';
import { PALETTES } from './render/effects';
import { dressKeyOf, PLAYER_MODEL } from './render/entities';
import { AssetLoader } from './render/loader';
import { createLowResRenderer, fitToContainer } from './render/lowres';
import type { PickResult } from './render/picking';
import { ZoneView } from './render/zoneview';
import { buildProblem, builtOption } from './sim/bunker';
import { combatLevel } from './sim/combat';
import { loadContent, type Content } from './sim/content';
import { buildGrids } from './sim/grid';
import { currentHint } from './sim/quests';
import {
  createGameState,
  findEntity,
  PLAYER_ID,
  type GameState,
  type Intent,
  type SimContext,
  type SimEvent,
  type Tile,
} from './sim/state';
import { buyPrice } from './sim/terminal';
import { entityActions } from './sim/tick';
import { createFrameLoop, crashGuard } from './game/crash';
import { LocalDriver, type GameDriver } from './game/driver';
import { chooseOnline, type OnlineSession } from './game/online';
import type { ChatOut } from './net/protocol';
import type { RemoteActor } from './net/replica';
import { FriendsPanel } from './ui/friends';
import { Nameplates } from './ui/nameplates';
import { QuickChatMenu } from './ui/quickchat';
import { TradeWindow } from './ui/trade';
import { levelForXp } from './sim/xp';
import { BankWindow } from './ui/bank';
import { ExchangeWindow } from './ui/exchange';
import { BuildWindow } from './ui/build';
import { Chat } from './ui/chat';
import { ClickCross } from './ui/clickcross';
import { ContextMenu, type MenuOption } from './ui/contextmenu';
import { DialogueBox, type DialogueLine } from './ui/dialogue';
import { levelTag } from './ui/format';
import { Hitsplats } from './ui/hitsplats';
import { Hud } from './ui/hud';
import { InventoryPanel, type InventoryMode } from './ui/inventory';
import { Minimap } from './ui/minimap';
import { OverheadPool, OverheadText } from './ui/overhead';
import { showCrashPanel } from './ui/crashpanel';
import { buildSettingsPanel } from './ui/settings';
import { SidePanel } from './ui/sidepanel';
import { SkillGuide } from './ui/skillguide';
import { SkillsPanel } from './ui/skills';
import { QuestJournal, QuestList } from './ui/quests';
import { CombatTab, EquipmentTab, SummoningTab } from './ui/tabs';
import { TerminalWindow } from './ui/terminal';
import { Tooltip, type TargetKind } from './ui/tooltips';
import './styles.css';

interface EntityInfo {
  id: string;
  name: string;
  examine: string;
  actions: string[];
  kind: TargetKind;
  /** Combat level, for monsters. */
  level?: number;
}

function $(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

async function boot(): Promise<void> {
  document.title = GAME_TITLE;
  const content = loadContent();
  const ctx: SimContext = { content, grids: buildGrids(content) };

  /** Added to the browser clock; only the dev QA hook moves it. */
  let clockOffset = 0;
  let frozen = false;
  const clockNow = () => performance.now() + clockOffset;

  // With a hub session (or ?net=loopback), world select first; else, or "Play offline", standalone.
  const bridge = new HubBridge();
  const session: OnlineSession | null = await chooseOnline(content, bridge, clockNow);
  const online = session?.driver ?? null;
  const loaded = online ? null : loadSavedGame(content);
  const state: GameState =
    online?.state ?? loaded?.state ?? createGameState(content, START_ZONE_ID, Date.now() >>> 0);
  const local = online ? null : new LocalDriver(state, ctx, clockNow());
  const driver: GameDriver = online ?? local!;
  const queue = (intent: Intent) => {
    if (!frozen) driver.queue(intent);
  };

  const chat = new Chat($('#chatbox'), PRESIDENT_NAME, (text) => queue({ type: 'chat', text }));
  if (loaded) greet(chat, loaded.status);
  else greetOnline(chat, session!);
  let resetting = false;
  const tabLock = document.querySelector<HTMLElement>('#tab-lock');
  const freeze = () => {
    if (frozen) return;
    saveGame(state);
    frozen = true;
    if (local) local.frozen = true;
    tabLock?.removeAttribute('hidden');
  };
  // Online, the server keeps the character and one session per account.
  if (!online) claimWriter(freeze);
  const persist = () => !online && !resetting && !frozen && saveGame(state);
  const hub = new HubClient(
    state,
    ctx,
    (text, kind) => chat.add(text, kind),
    queue,
    persist,
    bridge,
  );
  const openShopId = () =>
    state.player.interface?.kind === 'terminal' ? state.player.interface.shopId : TERMINAL_SHOP_ID;

  // ── Rendering ──────────────────────────────────────────────────────────────
  const assets = await AssetLoader.load();
  const viewport = $('#viewport');
  const renderer = createLowResRenderer(viewport);
  const cam = new OrbitCamera();
  const canvas = renderer.domElement;
  let view = new ZoneView(state, content, assets, cam.camera, canvas);
  const heads = new ChatHeads(renderer, assets);
  const resize = () => fitToContainer(renderer, cam.camera, viewport);
  resize();
  window.addEventListener('resize', resize);

  // ── Actions ────────────────────────────────────────────────────────────────
  const describe = (entityId: string) =>
    describeEntity(ctx, state, entityId) ??
    (online ? describeOther(online.replica.others.get(entityId)) : null);
  /** Where the last left click, or the right click that opened the menu, landed (client pixels). */
  let clickAt = { x: 0, y: 0 };
  const cross = new ClickCross(document.body);
  const interact = (entityId: string, action: string) => {
    queue({ type: 'interact', targetId: entityId, action });
    cross.show(clickAt.x, clickAt.y, 'action', clockNow());
  };
  /** Where the minimap flag goes until the next tick plans the real path. */
  let pendingDestination: Tile | null = null;
  const walk = (tile: Tile, marker = true) => {
    queue({ type: 'walk', x: tile.x, y: tile.y });
    pendingDestination = tile;
    if (marker) cross.show(clickAt.x, clickAt.y, 'walk', clockNow());
  };
  const examine = (text: string) => chat.add(text, 'examine');

  /** The inventory slot picked with "Use": the next click uses it on something. */
  let usingSlot: number | null = null;
  const useOptions = (infos: EntityInfo[], tile: Tile | null): MenuOption[] => {
    const slot = usingSlot!;
    const item = state.player.inventory[slot];
    const name = item ? (content.items.get(item.itemId)?.name ?? item.itemId) : '';
    const options: MenuOption[] = infos.map((info) => ({
      action: 'Use',
      using: name,
      target: info.name,
      targetKind: info.kind,
      run: () => {
        usingSlot = null;
        queue({ type: 'useItem', slot, targetId: info.id });
        cross.show(clickAt.x, clickAt.y, 'action', clockNow());
      },
    }));
    if (tile) {
      options.push({
        action: 'Walk here',
        run: () => {
          usingSlot = null;
          walk(tile);
        },
      });
    }
    return options;
  };

  /** OSRS menu order: every entity's actions, Walk here, then each Examine. */
  const menuOptions = (pick: PickResult): MenuOption[] => {
    const infos = pick.entityIds.map(describe).filter((i): i is EntityInfo => i !== null);
    if (usingSlot !== null && state.player.inventory[usingSlot])
      return useOptions(infos, pick.tile);
    usingSlot = null;
    const yours = combatLevel(state.player.skills);
    const options: MenuOption[] = [];
    for (const info of infos) {
      const level = info.level === undefined ? undefined : levelTag(info.level, yours);
      for (const action of info.actions) {
        options.push({
          action,
          target: info.name,
          targetKind: info.kind,
          level,
          run: () =>
            info.kind === 'player' ? playerAction(info, action) : interact(info.id, action),
        });
      }
    }
    const tile = pick.tile;
    if (tile) options.push({ action: 'Walk here', run: () => walk(tile) });
    for (const info of infos) {
      options.push({
        action: 'Examine',
        target: info.name,
        targetKind: info.kind,
        level: info.level === undefined ? undefined : levelTag(info.level, yours),
        run: () => examine(info.examine),
      });
    }
    return options;
  };

  // ── UI ─────────────────────────────────────────────────────────────────────
  const hudRoot = $('#hud');
  const tooltip = new Tooltip($('#tooltip'));
  const menu = new ContextMenu($('#contextmenu'));
  const glyph = (id: string) => assets.glyph(id);
  const tabImage = (id: string) => assets.imageUrl(id);
  const iconUrl = (id: string) => assets.iconUrl(id);
  const openMenu = (options: MenuOption[], x: number, y: number) => {
    tooltip.hide();
    menu.open(options, x, y);
  };
  const itemExamine = (itemId: string) =>
    itemId
      ? examine(content.items.get(itemId)?.examine ?? '')
      : chat.add('Nothing interesting happens.');
  const closeInterface = () => queue({ type: 'closeInterface' });

  const hud = new Hud(
    $('#ticker'),
    $('#orbs'),
    $('#xpcounter'),
    $('#xpdrops'),
    $('#banner'),
    glyph,
    () => queue({ type: 'toggleRun' }),
    () => queue({ type: 'special' }),
  );
  const minimap = new Minimap($('#minimap'), content, assets, {
    walk: (tile) => walk(tile, false), // OSRS shows only the minimap flag
    faceNorth: () => cam.faceNorth(),
  });
  minimap.setZone(content.zones.get(state.zone.id)!);
  const overhead = new OverheadText($('#overhead'));
  const shouts = new OverheadPool($('#overheads'));
  const hitsplats = new Hitsplats($('#hitsplats'));
  const dialogue = new DialogueBox(
    chat.dialogueHost,
    () => queue({ type: 'continueDialogue' }),
    (index) => queue({ type: 'chooseOption', index }),
  );
  const bank = new BankWindow(hudRoot, content, iconUrl, tooltip, {
    withdraw: (index, qty, itemId) => queue({ type: 'withdraw', index, qty, itemId }),
    depositAll: () => queue({ type: 'depositAll' }),
    close: closeInterface,
    examine: itemExamine,
    openMenu,
  });
  const terminal = new TerminalWindow(hudRoot, content, iconUrl, tooltip, {
    buy: (itemId, packs) => hub.buy(openShopId(), itemId, packs),
    message: (text) => chat.add(text),
    close: closeInterface,
    examine: itemExamine,
    openMenu,
    priceOf: (itemId, packs) => buyPrice(state, ctx, itemId, packs),
    packSize: (itemId) =>
      content.ticketPrices.find((row) => row.shopId === openShopId() && row.itemId === itemId)
        ?.packSize ?? 1,
  });
  const exchange = new ExchangeWindow(
    hudRoot,
    (tickets) => hub.requestExchange(tickets),
    closeInterface,
  );
  const buildWindow = new BuildWindow(hudRoot, content, iconUrl, {
    build: (buildId) => queue({ type: 'build', buildId }),
    close: closeInterface,
  });
  const inventoryMode = (): InventoryMode => {
    const ui = state.player.interface;
    if (ui?.kind === 'bank' && bank.isOpen) return { kind: 'bank', qty: bank.leftClickQuantity };
    if (ui?.kind === 'terminal' && terminal.isOpen) return { kind: 'terminal' };
    return { kind: 'normal' };
  };
  const inventory = new InventoryPanel(content, iconUrl, tooltip, INVENTORY_SIZE, {
    examine: itemExamine,
    drop: (slot) => queue({ type: 'dropItem', slot }),
    move: (from, to) => queue({ type: 'moveItem', from, to }),
    use: (slot, kind) => queue({ type: kind, slot }),
    select: (slot) => (usingSlot = slot),
    selected: () => usingSlot,
    deposit: (slot, qty) => queue({ type: 'deposit', slot, qty }),
    sell: (slot, qty) => hub.sell(slot, qty),
    canSell: (itemId) => hub.canSell(itemId),
    value: (itemId) => hub.describeValue(itemId),
    openMenu,
    mode: inventoryMode,
  });
  const guide = new SkillGuide(hudRoot, content, glyph, iconUrl);
  const skills = new SkillsPanel(content, glyph, tooltip, (skillId) =>
    guide.open(skillId, levelForXp(state.player.skills[skillId] ?? 0)),
  );
  const combat = new CombatTab(ctx, {
    setStyle: (style) => queue({ type: 'setStyle', style }),
    toggleRetaliate: () => queue({ type: 'toggleRetaliate' }),
  });
  const equipment = new EquipmentTab(ctx, iconUrl, {
    unequip: (slot) => queue({ type: 'unequip', slot }),
    openMenu,
    examine: itemExamine,
  });
  const summoning = new SummoningTab(content, iconUrl, {
    special: () => queue({ type: 'special' }),
    dismiss: () => queue({ type: 'dismiss' }),
  });
  const journal = new QuestJournal(hudRoot, content);
  const quests = new QuestList(ctx, (questId) => journal.open(questId));

  // ── Online: friends, quick-chat, trades, other players' names ─────────────
  const nameplates = new Nameplates(
    hudRoot.appendChild(Object.assign(document.createElement('div'), { className: 'nameplates' })),
  );
  const friends = online
    ? new FriendsPanel(
        (op) => online.sendSocial(op),
        (name) => {
          chat.input.value = `/m ${name} `;
          chat.input.focus();
        },
      )
    : null;
  const tradeWindow = online
    ? new TradeWindow(
        hudRoot,
        content,
        (msg) => online.sendTrade(msg),
        () => state.player.inventory,
      )
    : null;
  /** The frame art has no spare tab socket: online, Friends sits at the top of Settings. */
  const withFriends = (settings: HTMLElement): HTMLElement => {
    if (!friends) return settings;
    const both = document.createElement('div');
    both.append(friends.el, settings);
    return both;
  };
  if (online) {
    const myName = online.welcome?.name ?? 'You';
    const quick = new QuickChatMenu(content, (phrase) => online.say({ ch: 'quick', phrase }));
    chat.goOnline(
      {
        pm: (to, text) => online.say({ ch: 'pm', to, text }),
        reply: (text) => online.say({ ch: 'reply', text }),
        filters: (f) =>
          online.sendSocial({
            op: 'filters',
            public: f.public,
            private: f.private,
            trade: f.trade,
          }),
        quickChat: (anchor) => quick.open(anchor),
      },
      myName,
    );
    online.chat.add((c: ChatOut) => showChat(chat, c, myName));
    online.social.add((s) => {
      friends?.update(s);
      chat.setFilters(s.filters);
    });
    online.trade.add((t) => tradeWindow?.update(t));
    online.kicked.add((reason) => showKick(reason));
  }
  /** Right-click actions on another player. */
  const playerAction = (info: EntityInfo, action: string) => {
    if (!online) return;
    const name = info.name;
    if (action === 'Trade with') online.sendTrade({ op: 'request', to: info.id });
    else if (action === 'Message') {
      chat.input.value = `/m ${name} `;
      chat.input.focus();
    } else if (action === 'Add friend') online.sendSocial({ op: 'addFriend', name });
    else if (action === 'Ignore') online.sendSocial({ op: 'addIgnore', name });
  };

  // Top: Combat, Skills, Quests, Inventory. Bottom: Equipment, Summoning, Settings.
  // F-keys follow the OSRS defaults; Esc returns to Inventory.
  const sidePanel = new SidePanel(
    $('#sidepanel'),
    [
      {
        id: 'combat',
        icon: glyph('tab_combat'),
        image: tabImage('tab_combat'),
        title: 'Combat Options',
        hotkey: 'F1',
        content: combat.el,
      },
      {
        id: 'skills',
        icon: glyph('tab_skills'),
        image: tabImage('tab_skills'),
        title: 'Skills',
        hotkey: 'F2',
        content: skills.el,
      },
      {
        id: 'quests',
        icon: glyph('tab_quests'),
        image: tabImage('tab_quests'),
        title: 'Quests',
        hotkey: 'F3',
        content: quests.el,
      },
      {
        id: 'inventory',
        icon: glyph('tab_inventory'),
        image: tabImage('tab_inventory'),
        title: 'Inventory',
        content: inventory.el,
      },
    ],
    [
      {
        id: 'equipment',
        icon: glyph('tab_equipment'),
        image: tabImage('tab_equipment'),
        title: 'Worn Equipment',
        hotkey: 'F4',
        content: equipment.el,
      },
      {
        id: 'summoning',
        icon: glyph('tab_summoning'),
        image: tabImage('tab_summoning'),
        title: 'Summoning',
        hotkey: 'F6',
        content: summoning.el,
      },
      {
        id: 'settings',
        icon: glyph('tab_settings'),
        image: tabImage('tab_settings'),
        title: online ? 'Friends & Settings' : 'Settings',
        hotkey: 'F10',
        content: withFriends(
          buildSettingsPanel(
            () => {
              if (online) {
                chat.add('Your character is saved on the server.');
                return;
              }
              hub.checkpoint();
              chat.add(persist() ? 'Game saved.' : 'Saving is unavailable in this browser.');
            },
            () => {
              if (online) {
                chat.add('Starting over is only for offline play.', 'warning');
                return;
              }
              hub.logReset();
              resetting = true;
              clearSavedGame();
              clearHubLedger();
              location.reload();
            },
            () => {
              online?.dispose();
              void hub.exitToHub();
            },
          ),
        ),
      },
    ],
  );
  sidePanel.select('inventory');

  // ── Mouse & keyboard ───────────────────────────────────────────────────────
  const keyboard = new Keyboard();
  let hover: { x: number; y: number } | null = null;

  attachMouse(canvas, {
    onPress: () => {
      chat.input.blur();
      if (!menu.isOpen) return false;
      menu.close();
      return true;
    },
    onClick: (x, y) => {
      clickAt = { x, y };
      menuOptions(view.picker.pick(x, y))[0]?.run?.();
    },
    onContextMenu: (x, y) => {
      clickAt = { x, y };
      const options = menuOptions(view.picker.pick(x, y));
      if (options.length > 0) openMenu(options, x, y);
    },
    onHover: (x, y) => (hover = { x, y }),
    onLeave: () => {
      hover = null;
      tooltip.hide();
    },
    onDrag: (dx, dy) => cam.drag(dx, dy),
    onWheel: (dx, dy) => {
      cam.zoom(dy);
      if (dx !== 0) cam.drag(-dx, 0); // sideways trackpad swipe rotates
    },
  });
  // No browser context menu anywhere in the game (OSRS has its own), except in text fields.
  document.addEventListener('contextmenu', (e) => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
  });

  chat.input.addEventListener('keydown', (e) => {
    // Space on an empty chat line still continues dialogue; 1-5 still pick options.
    if (e.key === ' ' && !chat.input.value && dialogue.isOpen) {
      e.preventDefault();
      dialogue.continue();
    } else if (/^[1-5]$/.test(e.key) && !chat.input.value && dialogue.choose(Number(e.key) - 1)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keydown', (e) => {
    if (/^F\d+$/.test(e.key) && sidePanel.selectByHotkey(e.key)) {
      e.preventDefault(); // F-keys switch tabs, as in OSRS (F5 must not reload)
      return;
    }
    if (document.activeElement === chat.input) return;
    if (e.key === 'Escape') {
      usingSlot = null;
      bank.close();
      terminal.close();
      exchange.close();
      buildWindow.close();
      guide.close();
      journal.close();
      sidePanel.select('inventory');
    } else if (/^[1-5]$/.test(e.key) && dialogue.choose(Number(e.key) - 1)) {
      e.preventDefault();
    } else if (e.key === ' ' && dialogue.isOpen) {
      e.preventDefault();
      dialogue.continue();
    } else if (e.key === 'Enter') {
      chat.input.focus();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      chat.input.focus(); // typing anywhere starts a chat message
    }
  });

  const updateHoverTooltip = () => {
    if (!hover || menu.isOpen) return;
    const [top, ...rest] = menuOptions(view.picker.pick(hover.x, hover.y));
    if (top) tooltip.showFixed({ ...top, moreOptions: rest.length });
    else tooltip.hide();
  };

  const currentDialogue = (): DialogueLine | null => {
    const d = state.player.dialogue;
    if (!d) return null;
    const npc = state.zone.npcs.find((n) => n.id === d.npcId);
    const def = npc ? content.npcs.get(npc.defId) : undefined;
    const line = d.lines[d.line];
    if (!def || line === undefined) return null;
    const key = `${d.npcId}:${d.lines.length}:${d.line}`;
    if (typeof line === 'string') {
      return { key, speaker: def.name, text: line, portrait: heads.url(def.model) };
    }
    if ('options' in line) {
      return { key, speaker: '', text: '', options: line.options.map((o) => o.text) };
    }
    const dress = dressFor(dressKeyOf(state.player).split('|'));
    const portrait = heads.url(PLAYER_MODEL, dress, true);
    return { key, speaker: state.player.name, text: line.player, player: true, portrait };
  };

  /** The nearest instance in this zone of whatever the tutorial wants next. */
  const hintTarget = (): { pos: THREE.Vector3; height: number } | null => {
    const hint = currentHint(state, ctx);
    if (!hint) return null;
    const p = state.player.pos;
    const near = <T extends { id: string; x: number; y: number }>(list: T[]) =>
      list.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    const target =
      (hint.npc && near(state.zone.npcs.filter((n) => n.defId === hint.npc))) ||
      (hint.object && near(state.zone.objects.filter((o) => o.defId === hint.object))) ||
      (hint.enemy &&
        near(state.zone.enemies.filter((e) => e.defId === hint.enemy && e.respawnAt === null)));
    if (!target) return null;
    const pos = view.entities.entityCenter(state, target.id);
    return pos ? { pos, height: view.entities.heightOf(target.id) } : null;
  };

  // ── Sim events ─────────────────────────────────────────────────────────────
  const skillName = (id: string) => content.skills.get(id)?.name ?? id;
  const handleEvents = (events: SimEvent[]) => {
    const now = clockNow();
    // Shots in flight this tick: hits on their targets (and a shell's splash) land on arrival.
    const flight = new Map<string, number>();
    let splashDelay = 0;
    // OSRS shows one XP drop per tick, with an icon for each skill.
    const xpThisTick = new Map<string, number>();
    for (const e of events) {
      switch (e.type) {
        case 'message':
          chat.add(e.text, e.kind, e.speaker);
          break;
        case 'xp':
          xpThisTick.set(e.skillId, (xpThisTick.get(e.skillId) ?? 0) + e.amount);
          view.entities.playWork(state, e.skillId, now);
          break;
        case 'levelUp':
          hud.banner(`${skillName(e.skillId)} level ${e.level}!`);
          view.bursts.spawn(view.entities.playerPosition, PALETTES.fireworks, now, { lift: 1.2 });
          break;
        case 'hitsplat': {
          const delay = flight.get(e.targetId) ?? splashDelay;
          hitsplats.spawn(e.targetId, e.damage, now, delay);
          view.entities.markHit(e.targetId, now + delay);
          break;
        }
        case 'attack': {
          view.entities.playAttack(e.attackerId, e.style, now);
          if (e.style === 'melee') break;
          const explosive = e.style === 'explosive';
          const from = view.entities.positionOf(e.attackerId);
          const to = view.entities.positionOf(e.targetId);
          if (!from || !to) break;
          const kind = explosive ? 'explosive' : e.style === 'magic' ? 'magic' : 'shot';
          const ms = view.tracers.fire(from, to, kind, now);
          flight.set(e.targetId, ms);
          if (kind === 'magic') {
            view.bursts.spawn(to, PALETTES.magic, now + ms, {
              count: 16,
              speed: 1.4,
              durationMs: 450,
              lift: 0.9,
            });
          }
          if (explosive) {
            splashDelay = ms;
            view.bursts.spawn(to, PALETTES.explosion, now + ms, {
              count: 30,
              speed: 2.6,
              durationMs: 600,
            });
          }
          break;
        }
        case 'death': {
          const delay = flight.get(e.entityId) ?? 0;
          view.entities.markDeath(e.entityId, now + delay);
          const at = view.entities.positionOf(e.entityId);
          if (at && e.entityId !== PLAYER_ID) {
            view.bursts.spawn(at, PALETTES.sludge, now + delay, {
              count: 40,
              speed: 1.6,
              durationMs: 900,
              lift: 0.4,
            });
          }
          break;
        }
        case 'zoneChanged': {
          const old = view;
          view = new ZoneView(state, content, assets, cam.camera, canvas);
          old.dispose();
          minimap.setZone(content.zones.get(e.zoneId)!);
          hitsplats.clear();
          break;
        }
        case 'autosave':
          break;
      }
    }
    if (!online) hub.onEvents(events);
    if (xpThisTick.size > 0) {
      hud.xpDrop([...xpThisTick].map(([id, amount]) => ({ icon: glyph(`skill_${id}`), amount })));
    }
  };

  window.addEventListener('pagehide', () => {
    if (online) online.dispose();
    else if (!frozen) hub.checkpoint();
  });
  document.addEventListener('visibilitychange', () => {
    if (!frozen && !online && document.hidden) hub.checkpoint();
  });

  if (import.meta.env.DEV) {
    // QA hook. advance(ms) steps the game clock frame by frame, even in a hidden tab.
    const advance = (ms: number) => {
      for (let t = 0; t < ms; t += 16) {
        clockOffset += 16;
        step(clockNow());
      }
    };
    Object.assign(window, {
      __game: { state, queue, content, ctx, view: () => view, advance, renderer, cam },
    });
  }

  // ── Main loop: fixed 600 ms ticks (local or the server's), rendering every frame ──
  let lastFrameAt = clockNow();
  const step = (now: number) => {
    if (frozen) return;
    for (const events of driver.advance(now)) {
      handleEvents(events);
      pendingDestination = null;
      tradeWindow?.refresh();
    }
    const alpha = driver.alpha(now);
    const dt = Math.min(0.1, (now - lastFrameAt) / 1000);
    lastFrameAt = now;
    const p = state.player;

    view.entities.update(state, alpha, dt, now);
    const others: RemoteActor[] = online ? [...online.replica.others.values()] : [];
    if (online) {
      view.entities.updateOthers(others, alpha, dt, now);
      nameplates.update(
        others
          .filter((o) => o.kind === 'p')
          .map((o) => {
            const pos = view.entities.positionOf(o.id);
            const lift = view.entities.heightOf(o.id) + 0.3;
            return {
              id: o.id,
              name: o.name,
              say: o.overhead,
              at: pos ? view.entities.toScreen(pos, lift, cam.camera, canvas) : null,
            };
          }),
      );
    }
    cam.update(dt, keyboard.cameraAxes(), view.entities.playerPosition);
    cross.update(now);
    view.bursts.update(now);
    view.tracers.update(now);
    const hint = hintTarget();
    view.hint.update(hint?.pos ?? null, hint?.height ?? 0, now / 1000);
    updateHoverTooltip();

    const screenOf = (id: string) => {
      const pos = view.entities.positionOf(id);
      return pos
        ? view.entities.toScreen(pos, view.entities.heightOf(id) * 0.5, cam.camera, canvas)
        : null;
    };
    hitsplats.update(now, screenOf);
    overhead.update(
      p.overhead?.text ?? null,
      view.entities.toScreen(view.entities.playerPosition, UI.overheadHeight, cam.camera, canvas),
    );
    shouts.update(
      state.zone.enemies.flatMap((e) => {
        const pos = e.overhead && view.entities.positionOf(e.id);
        if (!e.overhead || !pos) return [];
        const above = view.entities.heightOf(e.id) + 0.15;
        return [
          {
            id: e.id,
            text: e.overhead.text,
            at: view.entities.toScreen(pos, above, cam.camera, canvas),
          },
        ];
      }),
    );

    hud.update(state);
    minimap.draw({
      playerX: view.entities.playerPosition.x,
      playerZ: view.entities.playerPosition.z,
      yaw: cam.yawRad,
      npcs: [...state.zone.npcs, ...state.zone.enemies.filter((e) => e.respawnAt === null)],
      groundItems: state.zone.groundItems,
      players: others.filter((o) => o.kind === 'p'),
      destination: pendingDestination ?? p.path.at(-1) ?? null,
    });
    dialogue.update(currentDialogue());
    bank.update(p.interface?.kind === 'bank', p.bank);
    terminal.update(
      p.interface?.kind === 'terminal' ? p.interface.shopId : null,
      p.currencies.tickets,
      hub.shopStatus(),
    );
    exchange.update(
      p.interface?.kind === 'exchange',
      p.currencies.tickets,
      hub.exchangeAmounts(),
      p.ledger.exchange !== null,
      state.hubSession.verseCapLeft,
      state.hubSession.mode === 'hub',
    );
    const build = buildState(content, ctx, state);
    buildWindow.update(build.name, build.choices);
    inventory.update(p.inventory);
    skills.update(p.skills, p.unlocks);
    combat.update(state);
    equipment.update(state);
    summoning.update(state);
    quests.update(state, currentHint(state, ctx));
    journal.update(state);
    renderer.render(view.scene, cam.camera);
  };
  // Always reschedules, even when a frame throws (game/crash.ts); a throw ends that frame's ticks.
  // A tab lock (frozen) is a deliberate stop.
  const frame = createFrameLoop((t) => step(t + clockOffset), { stop: () => frozen });
  if (frozen) return;
  if (!online) await hub.start();
  if (frozen) return;
  requestAnimationFrame(frame);
}

/** The build window's title and choices for the open hotspot, if any. */
function buildState(content: Content, ctx: SimContext, state: GameState) {
  const ui = state.player.interface;
  const ref = ui?.kind === 'build' ? findEntity(state, ui.targetId) : null;
  if (ref?.kind !== 'object') return { name: null, choices: [] };
  const def = content.objects.get(ref.instance.defId)!;
  const built = builtOption(state, def, ref.instance);
  return {
    name: def.name,
    choices: def.builds.map((option) => ({
      option,
      problem: buildProblem(state, ctx, option),
      built: built?.id === option.id,
    })),
  };
}

function describeEntity(ctx: SimContext, state: GameState, entityId: string): EntityInfo | null {
  const ref = findEntity(state, entityId);
  if (!ref) return null;
  const content = ctx.content;
  const id = entityId;
  const actions = entityActions(state, ctx, ref);
  switch (ref.kind) {
    case 'npc': {
      const def = content.npcs.get(ref.instance.defId);
      return def ? { id, name: def.name, examine: def.examine, actions, kind: 'npc' } : null;
    }
    case 'enemy': {
      const def = content.enemies.get(ref.instance.defId);
      return def
        ? {
            id,
            name: def.name,
            examine: def.examine,
            actions,
            kind: 'npc',
            level: def.level,
          }
        : null;
    }
    case 'ground': {
      const item = content.items.get(ref.instance.itemId);
      if (!item) return null;
      const qty = ref.instance.qty > 1 ? ` (${ref.instance.qty})` : '';
      return { id, name: `${item.name}${qty}`, examine: item.examine, actions, kind: 'item' };
    }
    case 'object': {
      const def = content.objects.get(ref.instance.defId);
      if (!def) return null;
      const built = def.role === 'hotspot' ? builtOption(state, def, ref.instance) : null;
      const look =
        ref.instance.depletedUntil !== null && def.depleted ? def.depleted : (built ?? def);
      return { id, name: look.name, examine: look.examine, actions, kind: 'object' };
    }
  }
}

/** Another player or their Sproto in the right-click menu and tooltip. */
function describeOther(o: RemoteActor | undefined): EntityInfo | null {
  if (!o) return null;
  if (o.kind === 's') {
    return {
      id: o.id,
      name: 'Sproto',
      examine: "Someone else's Sproto.",
      actions: [],
      kind: 'npc',
    };
  }
  return {
    id: o.id,
    name: o.name,
    examine: `${o.name}, a fellow President. Everyone here is the same President, in their own gear.`,
    actions: ['Trade with', 'Message', 'Add friend', 'Ignore'],
    kind: 'player',
    level: o.combatLevel,
  };
}

function showChat(chat: Chat, c: ChatOut, me: string): void {
  switch (c.ch) {
    case 'public':
      chat.add(c.text, 'public', c.from || me, c.quick);
      return;
    case 'pm_in':
      chat.add(c.text, 'private', `From ${c.from}${c.world ? ` (world ${c.world})` : ''}`, c.quick);
      chat.replyName = c.from;
      return;
    case 'pm_out':
      chat.add(c.text, 'private', `To ${c.to}`, c.quick);
      return;
    case 'trade':
      chat.add(c.text, 'trade');
      return;
    case 'system':
      chat.add(c.text, 'game');
      return;
  }
}

const KICK_TEXT: Record<string, string> = {
  sim_mismatch: 'This world runs a newer version of the game. Reload to update.',
  flood: 'You were disconnected for sending too much, too fast.',
  superseded: 'You logged in somewhere else.',
  already_online: 'You logged in on another world.',
  world_full: 'That world is full.',
  shutdown: 'The world is restarting.',
  session_expired: 'Your hub session has ended. Return to the hub and enter again.',
  connection_lost: 'The connection to the world was lost.',
};

/** The world is gone: say why, and offer to go back to world select. */
function showKick(reason: string): void {
  const box = document.createElement('div');
  box.className = 'world-select';
  const panel = document.createElement('div');
  panel.className = 'panel';
  const text = document.createElement('p');
  text.textContent = KICK_TEXT[reason] ?? `Disconnected (${reason}).`;
  const again = document.createElement('button');
  again.textContent = 'Back to world select';
  again.addEventListener('click', () => location.reload());
  panel.append(text, again);
  box.append(panel);
  document.body.append(box);
}

function greetOnline(chat: Chat, session: OnlineSession): void {
  chat.add(PARODY_NOTICE, 'examine');
  chat.add(`Welcome to world ${session.world}, ${session.driver.welcome?.name ?? PRESIDENT_NAME}.`);
  chat.add(
    'Chat: Enter to talk, /m name text for a private message, Tab to reply. Right-click a player to trade, message or add them as a friend.',
  );
}

function greet(chat: Chat, status: 'loaded' | 'none' | 'unreadable'): void {
  if (status === 'loaded') {
    chat.add(`Welcome back, ${PRESIDENT_NAME}. Your progress has been restored.`);
    return;
  }
  if (status === 'unreadable') {
    chat.add(
      'Your save could not be read, so a new term has begun. (The old save was kept as a backup.)',
      'warning',
    );
  }
  chat.add(PARODY_NOTICE, 'examine');
  chat.add(`Welcome to The Treasury, ${PRESIDENT_NAME}.`);
  chat.add(
    'ATTENTION ATTENTION: Follow the yellow arrow and the Quests tab. Morelight, your Chief of Staff, is waiting by the main path.',
  );
}

// Uncaught errors and rejections share the loop's counter; the panel opens once the game pauses.
crashGuard.install(window);
crashGuard.onFatal((report) => showCrashPanel(report));

// A failed boot (for example one asset that will not load) shows the same panel, with the error
// and a Retry button.
boot().catch((err: unknown) => crashGuard.report(err, 'boot'));
