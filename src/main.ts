/**
 * Client entry point. Wires the pure sim (src/sim) to the renderer, input and
 * UI. The tick loop runs here: input becomes intents, intents feed runTick, and
 * rendering reads the resulting state every frame.
 */
import { INVENTORY_SIZE, MAX_CATCHUP_TICKS, START_ZONE_ID, TICK_MS, UI } from './config/balance';
import { GAME_TITLE, PRESIDENT_NAME } from './config/branding';
import { Keyboard } from './input/keyboard';
import { attachMouse } from './input/mouse';
import { clearSavedGame, loadSavedGame, saveGame } from './persist';
import { OrbitCamera } from './render/camera';
import { ClickMarker, Fireworks } from './render/effects';
import { EntityRenderer } from './render/entities';
import { AssetLoader } from './render/loader';
import { createLowResRenderer, fitToContainer } from './render/lowres';
import { Picker, type PickResult } from './render/picking';
import { createScene } from './render/scene';
import { buildWorld } from './render/world';
import { loadContent, type Content } from './sim/content';
import { buildZoneGrid } from './sim/grid';
import {
  createGameState,
  findEntity,
  type GameState,
  type Intent,
  type SimContext,
  type SimEvent,
  type Tile,
} from './sim/state';
import { runTick } from './sim/tick';
import { levelForXp } from './sim/xp';
import { BankWindow } from './ui/bank';
import { Chat } from './ui/chat';
import { ContextMenu, type MenuOption } from './ui/contextmenu';
import { DialogueBox, type DialogueLine } from './ui/dialogue';
import { Hud } from './ui/hud';
import { InventoryPanel } from './ui/inventory';
import { Minimap } from './ui/minimap';
import { OverheadText } from './ui/overhead';
import { buildSettingsPanel } from './ui/settings';
import { comingSoon, SidePanel } from './ui/sidepanel';
import { SkillGuide } from './ui/skillguide';
import { SkillsPanel } from './ui/skills';
import { Tooltip, type TargetKind } from './ui/tooltips';
import './styles.css';

interface EntityInfo {
  id: string;
  name: string;
  examine: string;
  actions: string[];
  kind: TargetKind;
}

function $(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

async function boot(): Promise<void> {
  document.title = GAME_TITLE;
  const content = loadContent();
  const zone = content.zones.get(START_ZONE_ID)!;
  const ctx: SimContext = { content, grid: buildZoneGrid(zone, content) };

  let pending: Intent[] = [];
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
  const scene = createScene();
  const terrain = buildWorld(scene, zone, content, assets);
  const entities = new EntityRenderer(scene, assets, content, state);
  const cam = new OrbitCamera();
  const marker = new ClickMarker(scene);
  const fireworks = new Fireworks(scene);
  const picker = new Picker(cam.camera, renderer.domElement, terrain, entities.pickables, zone);
  const resize = () => fitToContainer(renderer, cam.camera, viewport);
  resize();
  window.addEventListener('resize', resize);

  // ── Actions ────────────────────────────────────────────────────────────────
  const describe = (entityId: string) => describeEntity(content, state, entityId);
  const interact = (entityId: string, action: string) => {
    queue({ type: 'interact', targetId: entityId, action });
    const c = entities.entityCenter(state, entityId);
    if (c) marker.show(c.x, c.z, 'action', performance.now());
  };
  const walk = (tile: Tile) => {
    queue({ type: 'walk', x: tile.x, y: tile.y });
    marker.show(tile.x + 0.5, tile.y + 0.5, 'walk', performance.now());
  };
  const examine = (text: string) => chat.add(text, 'examine');

  /** OSRS menu order: every entity's actions, Walk here, then each Examine. */
  const menuOptions = (pick: PickResult): MenuOption[] => {
    const infos = pick.entityIds.map(describe).filter((i): i is EntityInfo => i !== null);
    const options: MenuOption[] = [];
    for (const info of infos) {
      for (const action of info.actions) {
        options.push({
          action,
          target: info.name,
          targetKind: info.kind,
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
  const tooltip = new Tooltip($('#tooltip'));
  const menu = new ContextMenu($('#contextmenu'));
  const glyph = (id: string) => assets.glyph(id);
  const iconUrl = (id: string) => assets.iconUrl(id);
  const hud = new Hud(
    $('#ticker'),
    $('#orbs'),
    $('#xpcounter'),
    $('#xpdrops'),
    $('#banner'),
    glyph,
    () => queue({ type: 'toggleRun' }),
  );
  const minimap = new Minimap($('#minimap'), zone, content, assets, {
    walk,
    faceNorth: () => cam.faceNorth(),
  });
  const overhead = new OverheadText($('#overhead'));
  const dialogue = new DialogueBox(chat.dialogueHost, () => queue({ type: 'continueDialogue' }));
  const openMenu = (options: MenuOption[], x: number, y: number) => {
    tooltip.hide();
    menu.open(options, x, y);
  };
  const itemExamine = (itemId: string) => examine(content.items.get(itemId)?.examine ?? '');
  const bank = new BankWindow($('#hud'), content, iconUrl, tooltip, {
    withdraw: (index, qty) => queue({ type: 'withdraw', index, qty }),
    depositAll: () => queue({ type: 'depositAll' }),
    close: () => queue({ type: 'closeBank' }),
    examine: itemExamine,
    openMenu,
  });
  const inventory = new InventoryPanel(content, iconUrl, tooltip, INVENTORY_SIZE, {
    examine: itemExamine,
    drop: (slot) => queue({ type: 'dropItem', slot }),
    move: (from, to) => queue({ type: 'moveItem', from, to }),
    deposit: (slot, qty) => queue({ type: 'deposit', slot, qty }),
    openMenu,
    bankQuantity: () => (bank.isOpen ? bank.leftClickQuantity : null),
  });
  const guide = new SkillGuide($('#hud'), content, glyph, iconUrl);
  const skills = new SkillsPanel(content, glyph, tooltip, (skillId) =>
    guide.open(skillId, levelForXp(state.player.skills[skillId] ?? 0)),
  );

  let resetting = false;
  const persist = () => !resetting && saveGame(state);
  const sidePanel = new SidePanel($('#sidepanel'), [
    { id: 'inventory', icon: glyph('tab_inventory'), title: 'Inventory', content: inventory.el },
    {
      id: 'equipment',
      icon: glyph('tab_equipment'),
      title: 'Equipment',
      content: comingSoon('Suits, ties and aviators go here. Arrives with combat in Phase 2.'),
    },
    { id: 'skills', icon: glyph('tab_skills'), title: 'Skills', content: skills.el },
    {
      id: 'military',
      icon: glyph('tab_military'),
      title: 'Military',
      content: comingSoon('The Barracks are still being painted. Sprotos enlist in Phase 2.'),
    },
    {
      id: 'quests',
      icon: glyph('tab_quests'),
      title: 'Quests',
      content: comingSoon('RoadMap to $100bn (+ ∞%). Step 1: ⬆. Quests arrive in Phase 3.'),
    },
    {
      id: 'settings',
      icon: glyph('tab_settings'),
      title: 'Settings',
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

  attachMouse(renderer.domElement, {
    onPress: () => {
      chat.input.blur();
      if (!menu.isOpen) return false;
      menu.close();
      return true;
    },
    onClick: (x, y) => menuOptions(picker.pick(x, y))[0]?.run?.(),
    onContextMenu: (x, y) => {
      const options = menuOptions(picker.pick(x, y));
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
    if (document.activeElement === chat.input) return;
    if (e.key === 'Escape') {
      bank.close();
      guide.close();
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
    const [top, ...rest] = menuOptions(picker.pick(hover.x, hover.y));
    if (top) tooltip.show({ ...top, moreOptions: rest.length }, hover.x, hover.y);
    else tooltip.hide();
  };

  const currentDialogue = (): DialogueLine | null => {
    const d = state.player.dialogue;
    if (!d) return null;
    const npc = state.zone.npcs.find((n) => n.id === d.npcId);
    const def = npc ? content.npcs.get(npc.defId) : undefined;
    const text = def?.lines[d.line];
    return def && text !== undefined
      ? { key: `${d.npcId}:${d.line}`, speaker: def.name, text }
      : null;
  };

  // ── Sim events ─────────────────────────────────────────────────────────────
  const skillName = (id: string) => content.skills.get(id)?.name ?? id;
  const handleEvents = (events: SimEvent[]) => {
    for (const e of events) {
      if (e.type === 'message') chat.add(e.text, e.kind, e.speaker);
      else if (e.type === 'xp') hud.xpDrop(skillName(e.skillId), e.amount);
      else if (e.type === 'levelUp') {
        hud.banner(`${skillName(e.skillId)} level ${e.level}!`);
        fireworks.burst(entities.playerPosition, performance.now());
      } else if (e.type === 'autosave') persist();
    }
  };

  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => document.hidden && persist());

  if (import.meta.env.DEV) {
    Object.assign(window, { __game: { state, queue, content } });
  }

  // ── Main loop: fixed 600 ms ticks, rendering every frame ───────────────────
  let lastTickAt = performance.now();
  let lastFrameAt = lastTickAt;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
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

    entities.update(state, alpha, dt, now / 1000);
    cam.update(dt, keyboard.cameraAxes(), entities.playerPosition);
    marker.update(now);
    fireworks.update(now);
    updateHoverTooltip();

    const p = state.player;
    hud.update(state);
    minimap.draw({
      playerX: entities.playerPosition.x,
      playerZ: entities.playerPosition.z,
      yaw: cam.yawRad,
      npcs: state.zone.npcs,
      groundItems: state.zone.groundItems,
      destination: p.path.at(-1) ?? null,
    });
    overhead.update(
      p.overhead?.text ?? null,
      entities.playerHeadScreen(cam.camera, renderer.domElement, UI.overheadHeight),
    );
    dialogue.update(currentDialogue());
    bank.update(p.bankOpen, p.bank);
    inventory.update(p.inventory);
    skills.update(p.skills);
    renderer.render(scene, cam.camera);
  };
  requestAnimationFrame(frame);
}

function describeEntity(content: Content, state: GameState, entityId: string): EntityInfo | null {
  const ref = findEntity(state, entityId);
  if (!ref) return null;
  const id = entityId;
  if (ref.kind === 'npc') {
    const def = content.npcs.get(ref.instance.defId);
    return def
      ? { id, name: def.name, examine: def.examine, actions: def.actions, kind: 'npc' }
      : null;
  }
  if (ref.kind === 'ground') {
    const item = content.items.get(ref.instance.itemId);
    if (!item) return null;
    const qty = ref.instance.qty > 1 ? ` (${ref.instance.qty})` : '';
    return {
      id,
      name: `${item.name}${qty}`,
      examine: item.examine,
      actions: ['Take'],
      kind: 'item',
    };
  }
  const def = content.objects.get(ref.instance.defId);
  if (!def) return null;
  const look = ref.instance.depletedUntil !== null && def.depleted ? def.depleted : def;
  return { id, name: look.name, examine: look.examine, actions: def.actions, kind: 'object' };
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
    "ATTENTION ATTENTION: The national reserve holds $BITCOIN. It's not BTC. Talk to The Treasurer.",
  );
}

boot().catch((err: unknown) => {
  console.error(err);
  const pre = document.createElement('pre');
  pre.className = 'fatal';
  pre.textContent = `The game failed to start.\n\n${err instanceof Error ? err.message : String(err)}`;
  document.body.replaceChildren(pre);
});
