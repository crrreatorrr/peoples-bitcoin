/**
 * Client entry point. Wires the pure sim (src/sim) to the renderer, input and
 * UI. The tick loop runs here: input becomes intents, intents feed runTick, and
 * rendering reads the resulting state every frame.
 */
import * as THREE from 'three';
import { INVENTORY_SIZE, MAX_CATCHUP_TICKS, START_ZONE_ID, TICK_MS, UI } from './config/balance';
import { GAME_TITLE, PRESIDENT_NAME } from './config/branding';
import { Keyboard } from './input/keyboard';
import { attachMouse } from './input/mouse';
import { clearSavedGame, loadSavedGame, saveGame } from './persist';
import { OrbitCamera } from './render/camera';
import { PALETTES } from './render/effects';
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
import { buyPrice, sellPrice } from './sim/terminal';
import { entityActions, runTick } from './sim/tick';
import { levelForXp } from './sim/xp';
import { BankWindow } from './ui/bank';
import { BuildWindow } from './ui/build';
import { Chat } from './ui/chat';
import { ContextMenu, type MenuOption } from './ui/contextmenu';
import { DialogueBox, type DialogueLine } from './ui/dialogue';
import { levelTag } from './ui/format';
import { Hitsplats } from './ui/hitsplats';
import { Hud } from './ui/hud';
import { InventoryPanel, type InventoryMode } from './ui/inventory';
import { Minimap } from './ui/minimap';
import { OverheadText } from './ui/overhead';
import { buildSettingsPanel } from './ui/settings';
import { SidePanel } from './ui/sidepanel';
import { SkillGuide } from './ui/skillguide';
import { SkillsPanel } from './ui/skills';
import { QuestJournal, QuestList } from './ui/quests';
import { EquipmentTab, SummoningTab } from './ui/tabs';
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

  let pending: Intent[] = [];
  /** Added to the browser clock; only the dev QA hook moves it. */
  let clockOffset = 0;
  const clockNow = () => performance.now() + clockOffset;
  const queue = (intent: Intent) => pending.push(intent);

  const chat = new Chat($('#chatbox'), PRESIDENT_NAME, (text) => queue({ type: 'chat', text }));
  const loaded = loadSavedGame(content);
  const state: GameState =
    loaded.state ?? createGameState(content, START_ZONE_ID, Date.now() >>> 0);
  greet(chat, loaded.status);

  // ── Rendering ──────────────────────────────────────────────────────────────
  const assets = await AssetLoader.load();
  const viewport = $('#viewport');
  const renderer = createLowResRenderer(viewport);
  const cam = new OrbitCamera();
  const canvas = renderer.domElement;
  let view = new ZoneView(state, content, assets, cam.camera, canvas);
  const resize = () => fitToContainer(renderer, cam.camera, viewport);
  resize();
  window.addEventListener('resize', resize);

  // ── Actions ────────────────────────────────────────────────────────────────
  const describe = (entityId: string) => describeEntity(ctx, state, entityId);
  const interact = (entityId: string, action: string) => {
    queue({ type: 'interact', targetId: entityId, action });
    const c = view.entities.entityCenter(state, entityId);
    if (c) view.marker.show(c.x, c.z, 'action', clockNow());
  };
  const walk = (tile: Tile) => {
    queue({ type: 'walk', x: tile.x, y: tile.y });
    view.marker.show(tile.x + 0.5, tile.y + 0.5, 'walk', clockNow());
  };
  const examine = (text: string) => chat.add(text, 'examine');

  /** OSRS menu order: every entity's actions, Walk here, then each Examine. */
  const menuOptions = (pick: PickResult): MenuOption[] => {
    const infos = pick.entityIds.map(describe).filter((i): i is EntityInfo => i !== null);
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
          run: () => interact(info.id, action),
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
  const iconUrl = (id: string) => assets.iconUrl(id);
  const openMenu = (options: MenuOption[], x: number, y: number) => {
    tooltip.hide();
    menu.open(options, x, y);
  };
  const itemExamine = (itemId: string) => examine(content.items.get(itemId)?.examine ?? '');
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
    walk,
    faceNorth: () => cam.faceNorth(),
  });
  minimap.setZone(content.zones.get(state.zone.id)!);
  const overhead = new OverheadText($('#overhead'));
  const hitsplats = new Hitsplats($('#hitsplats'));
  const dialogue = new DialogueBox(chat.dialogueHost, () => queue({ type: 'continueDialogue' }));
  const bank = new BankWindow(hudRoot, content, iconUrl, tooltip, {
    withdraw: (index, qty) => queue({ type: 'withdraw', index, qty }),
    depositAll: () => queue({ type: 'depositAll' }),
    close: closeInterface,
    examine: itemExamine,
    openMenu,
  });
  const terminal = new TerminalWindow(hudRoot, content, iconUrl, tooltip, {
    buy: (itemId, qty) => queue({ type: 'buy', itemId, qty }),
    close: closeInterface,
    examine: itemExamine,
    openMenu,
    priceOf: (itemId, qty) => buyPrice(state, ctx, itemId, qty),
  });
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
    deposit: (slot, qty) => queue({ type: 'deposit', slot, qty }),
    sell: (slot, qty) => queue({ type: 'sell', slot, qty }),
    value: (itemId) => {
      const name = content.items.get(itemId)?.name ?? itemId;
      const price = sellPrice(state, ctx, itemId, 1);
      chat.add(
        `The Terminal will pay ${price.toLocaleString('en-US')} $BITCOIN for a ${name} right now.`,
      );
    },
    openMenu,
    mode: inventoryMode,
  });
  const guide = new SkillGuide(hudRoot, content, glyph, iconUrl);
  const skills = new SkillsPanel(content, glyph, tooltip, (skillId) =>
    guide.open(skillId, levelForXp(state.player.skills[skillId] ?? 0)),
  );
  const equipment = new EquipmentTab(ctx, iconUrl, {
    unequip: (slot) => queue({ type: 'unequip', slot }),
    setStyle: (style) => queue({ type: 'setStyle', style }),
  });
  const summoning = new SummoningTab(content, iconUrl, {
    special: () => queue({ type: 'special' }),
    dismiss: () => queue({ type: 'dismiss' }),
  });
  const journal = new QuestJournal(hudRoot, content);
  const quests = new QuestList(ctx, (questId) => journal.open(questId));

  let resetting = false;
  const persist = () => !resetting && saveGame(state);
  const sidePanel = new SidePanel($('#sidepanel'), [
    {
      id: 'inventory',
      icon: glyph('tab_inventory'),
      title: 'Inventory',
      hotkey: 'F4',
      content: inventory.el,
    },
    {
      id: 'equipment',
      icon: glyph('tab_equipment'),
      title: 'Equipment',
      hotkey: 'F1',
      content: equipment.el,
    },
    { id: 'skills', icon: glyph('tab_skills'), title: 'Skills', hotkey: 'F2', content: skills.el },
    {
      id: 'summoning',
      icon: glyph('tab_summoning'),
      title: 'Summoning',
      hotkey: 'F5',
      content: summoning.el,
    },
    { id: 'quests', icon: glyph('tab_quests'), title: 'Quests', hotkey: 'F3', content: quests.el },
    {
      id: 'settings',
      icon: glyph('tab_settings'),
      title: 'Settings',
      hotkey: 'F10',
      content: buildSettingsPanel(
        () => chat.add(persist() ? 'Game saved.' : 'Saving is unavailable in this browser.'),
        () => {
          resetting = true;
          clearSavedGame();
          location.reload();
        },
      ),
    },
  ]);

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
    onClick: (x, y) => menuOptions(view.picker.pick(x, y))[0]?.run?.(),
    onContextMenu: (x, y) => {
      const options = menuOptions(view.picker.pick(x, y));
      if (options.length > 0) openMenu(options, x, y);
    },
    onHover: (x, y) => (hover = { x, y }),
    onLeave: () => {
      hover = null;
      tooltip.hide();
    },
    onDrag: (dx, dy) => cam.drag(dx, dy),
    onWheel: (dy) => cam.zoom(dy),
  });

  chat.input.addEventListener('keydown', (e) => {
    // Space on an empty chat line still continues dialogue.
    if (e.key === ' ' && !chat.input.value && dialogue.isOpen) {
      e.preventDefault();
      dialogue.continue();
    }
  });
  window.addEventListener('keydown', (e) => {
    if (/^F\d+$/.test(e.key) && sidePanel.selectByHotkey(e.key)) {
      e.preventDefault(); // F-keys switch tabs, as in OSRS (F5 must not reload)
      return;
    }
    if (document.activeElement === chat.input) return;
    if (e.key === 'Escape') {
      bank.close();
      terminal.close();
      buildWindow.close();
      guide.close();
      journal.close();
      sidePanel.select('inventory');
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
    return typeof line === 'string'
      ? { key, speaker: def.name, text: line }
      : { key, speaker: state.player.name, text: line.player, player: true };
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
    for (const e of events) {
      switch (e.type) {
        case 'message':
          chat.add(e.text, e.kind, e.speaker);
          break;
        case 'xp':
          hud.xpDrop(skillName(e.skillId), e.amount);
          view.entities.playWork(state, e.skillId, now);
          break;
        case 'levelUp':
          hud.banner(`${skillName(e.skillId)} level ${e.level}!`);
          view.bursts.spawn(view.entities.playerPosition, PALETTES.fireworks, now, { lift: 1.2 });
          break;
        case 'hitsplat':
          hitsplats.spawn(e.targetId, e.damage, now);
          view.entities.markHit(e.targetId, now);
          break;
        case 'attack': {
          view.entities.playAttack(e.attackerId, e.style, now);
          if (e.style === 'melee') break;
          const explosive = e.style === 'explosive';
          const from = view.entities.positionOf(e.attackerId);
          const to = view.entities.positionOf(e.targetId);
          if (from && to) {
            view.tracers.fire(from, to, explosive, now);
            if (explosive)
              view.bursts.spawn(to, PALETTES.explosion, now, {
                count: 30,
                speed: 2.6,
                durationMs: 600,
              });
          }
          break;
        }
        case 'death': {
          view.entities.markDeath(e.entityId, now);
          const at = view.entities.positionOf(e.entityId);
          if (at && e.entityId !== PLAYER_ID) {
            view.bursts.spawn(at, PALETTES.sludge, now, {
              count: 40,
              speed: 1.6,
              durationMs: 900,
              lift: 0.4,
            });
          }
          break;
        }
        case 'zoneChanged':
          view = new ZoneView(state, content, assets, cam.camera, canvas);
          minimap.setZone(content.zones.get(e.zoneId)!);
          hitsplats.clear();
          break;
        case 'autosave':
          persist();
          break;
      }
    }
  };

  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => document.hidden && persist());

  if (import.meta.env.DEV) {
    // QA hook. advance(ms) steps the game clock frame by frame, even in a hidden tab.
    const advance = (ms: number) => {
      for (let t = 0; t < ms; t += 16) {
        clockOffset += 16;
        step(clockNow());
      }
    };
    Object.assign(window, { __game: { state, queue, content, ctx, view: () => view, advance } });
  }

  // ── Main loop: fixed 600 ms ticks, rendering every frame ───────────────────
  let lastTickAt = clockNow();
  let lastFrameAt = lastTickAt;
  const step = (now: number) => {
    // After a long stall (background tab), resume without a burst of ticks.
    if (now - lastTickAt > TICK_MS * MAX_CATCHUP_TICKS) lastTickAt = now - TICK_MS;
    while (now - lastTickAt >= TICK_MS) {
      lastTickAt += TICK_MS;
      const intents = pending;
      pending = [];
      handleEvents(runTick(state, ctx, intents));
    }
    const alpha = (now - lastTickAt) / TICK_MS;
    const dt = Math.min(0.1, (now - lastFrameAt) / 1000);
    lastFrameAt = now;
    const p = state.player;

    view.entities.update(state, alpha, dt, now);
    cam.update(dt, keyboard.cameraAxes(), view.entities.playerPosition);
    view.marker.update(now);
    view.bursts.update(now);
    view.tracers.update(now);
    const hint = hintTarget();
    view.hint.update(hint?.pos ?? null, hint?.height ?? 0, now / 1000);
    updateHoverTooltip();

    const screenOf = (id: string) => {
      const pos = view.entities.positionOf(id);
      return pos
        ? view.entities.toScreen(pos, view.entities.heightOf(id) + 0.1, cam.camera, canvas)
        : null;
    };
    hitsplats.update(now, screenOf);
    overhead.update(
      p.overhead?.text ?? null,
      view.entities.toScreen(view.entities.playerPosition, UI.overheadHeight, cam.camera, canvas),
    );

    hud.update(state);
    minimap.draw({
      playerX: view.entities.playerPosition.x,
      playerZ: view.entities.playerPosition.z,
      yaw: cam.yawRad,
      npcs: [...state.zone.npcs, ...state.zone.enemies.filter((e) => e.respawnAt === null)],
      groundItems: state.zone.groundItems,
      destination: p.path.at(-1) ?? null,
    });
    dialogue.update(currentDialogue());
    bank.update(p.interface?.kind === 'bank', p.bank);
    terminal.update(p.interface?.kind === 'terminal', p.currencies.bitcoin, state.economy.priceUsd);
    const build = buildState(content, ctx, state);
    buildWindow.update(build.name, build.choices);
    inventory.update(p.inventory);
    skills.update(p.skills, p.unlocks);
    equipment.update(state);
    summoning.update(state);
    quests.update(state, currentHint(state, ctx));
    journal.update(state);
    renderer.render(view.scene, cam.camera);
  };
  const frame = (t: number) => {
    requestAnimationFrame(frame);
    step(t + clockOffset);
  };
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
  chat.add(`Welcome to The Treasury, ${PRESIDENT_NAME}.`);
  chat.add(
    'ATTENTION ATTENTION: Follow the yellow arrow and the Quests tab. The Treasurer is waiting in the main hall.',
  );
}

boot().catch((err: unknown) => {
  console.error(err);
  const pre = document.createElement('pre');
  pre.className = 'fatal';
  pre.textContent = `The game failed to start.\n\n${err instanceof Error ? err.message : String(err)}`;
  document.body.replaceChildren(pre);
});
