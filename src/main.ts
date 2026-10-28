/**
 * Client entry point. Wires the pure sim (src/sim) to the renderer, input and
 * UI. The tick loop runs here: input becomes intents, intents feed runTick, and
 * rendering reads the resulting state every frame.
 */
import { INVENTORY_SIZE, MAX_CATCHUP_TICKS, START_ZONE_ID, TICK_MS } from './config/balance';
import { GAME_TITLE, PRESIDENT_NAME } from './config/branding';
import { attachMouse } from './input/mouse';
import { Keyboard } from './input/keyboard';
import { clearSavedGame, loadSavedGame, saveGame } from './persist';
import { OrbitCamera } from './render/camera';
import { ClickMarker, type ClickKind } from './render/effects';
import { EntityRenderer } from './render/entities';
import { AssetLoader } from './render/loader';
import { createLowResRenderer, fitToContainer } from './render/lowres';
import { Picker } from './render/picking';
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
import { Chat } from './ui/chat';
import { ContextMenu, type MenuOption } from './ui/contextmenu';
import { Hud } from './ui/hud';
import { InventoryPanel } from './ui/inventory';
import { buildSettingsPanel } from './ui/settings';
import { comingSoon, SidePanel } from './ui/sidepanel';
import { SkillsPanel } from './ui/skills';
import { Tooltip, type TargetKind } from './ui/tooltips';
import './styles.css';

interface EntityInfo {
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

  const chat = new Chat($('#chatbox'));
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
  const picker = new Picker(cam.camera, renderer.domElement, terrain, entities.pickables, zone);
  const resize = () => fitToContainer(renderer, cam.camera, viewport);
  resize();
  window.addEventListener('resize', resize);

  // ── Intents ────────────────────────────────────────────────────────────────
  let pending: Intent[] = [];
  const queue = (intent: Intent) => pending.push(intent);

  const describe = (entityId: string): EntityInfo | null =>
    describeEntity(content, state, entityId);
  const markEntity = (entityId: string, now: number) => {
    const c = entities.entityCenter(state, entityId);
    if (c) marker.show(c.x, c.z, 'action', now);
  };
  const markTile = (tile: Tile, kind: ClickKind, now: number) =>
    marker.show(tile.x + 0.5, tile.y + 0.5, kind, now);
  const interact = (entityId: string, action: string) => {
    queue({ type: 'interact', targetId: entityId, action });
    markEntity(entityId, performance.now());
  };
  const walk = (tile: Tile) => {
    queue({ type: 'walk', x: tile.x, y: tile.y });
    markTile(tile, 'walk', performance.now());
  };

  // ── UI ─────────────────────────────────────────────────────────────────────
  const tooltip = new Tooltip($('#tooltip'));
  const menu = new ContextMenu($('#contextmenu'));
  const hud = new Hud(
    $('#ticker'),
    $('#orbs'),
    $('#xpdrops'),
    $('#banner'),
    assets.glyph('orb_run'),
    () => queue({ type: 'toggleRun' }),
  );
  const inventory = new InventoryPanel(content, (id) => assets.iconUrl(id), INVENTORY_SIZE, {
    examine: (itemId) => chat.add(content.items.get(itemId)?.examine ?? '', 'examine'),
    drop: (slot) => queue({ type: 'dropItem', slot }),
    openMenu: (options, x, y) => menu.open(options, x, y),
  });
  const skills = new SkillsPanel(content, (id) => assets.glyph(id), tooltip);

  let resetting = false;
  const persist = () => !resetting && saveGame(state);
  new SidePanel($('#sidepanel'), [
    {
      id: 'inventory',
      icon: assets.glyph('tab_inventory'),
      title: 'Inventory',
      content: inventory.el,
    },
    {
      id: 'equipment',
      icon: assets.glyph('tab_equipment'),
      title: 'Equipment',
      content: comingSoon('Suits, ties and aviators go here. Arrives with combat in Phase 2.'),
    },
    { id: 'skills', icon: assets.glyph('tab_skills'), title: 'Skills', content: skills.el },
    {
      id: 'military',
      icon: assets.glyph('tab_military'),
      title: 'Military',
      content: comingSoon('The Barracks are still being painted. Sprotos enlist in Phase 2.'),
    },
    {
      id: 'quests',
      icon: assets.glyph('tab_quests'),
      title: 'Quests',
      content: comingSoon('RoadMap to $100bn (+ ∞%). Step 1: ⬆. Quests arrive in Phase 3.'),
    },
    {
      id: 'settings',
      icon: assets.glyph('tab_settings'),
      title: 'Settings',
      content: buildSettingsPanel(
        () =>
          chat.add(persist() ? 'Game saved.' : 'Saving is unavailable in this browser.', 'game'),
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
      if (!menu.isOpen) return false;
      menu.close();
      return true;
    },
    onClick: (x, y) => {
      const pick = picker.pick(x, y);
      const info = pick.entityId ? describe(pick.entityId) : null;
      if (pick.entityId && info && info.actions.length > 0)
        interact(pick.entityId, info.actions[0]);
      else if (pick.tile) walk(pick.tile);
    },
    onContextMenu: (x, y) => {
      const pick = picker.pick(x, y);
      const info = pick.entityId ? describe(pick.entityId) : null;
      const options: MenuOption[] = [];
      if (pick.entityId && info) {
        const id = pick.entityId;
        for (const action of info.actions) {
          options.push({
            action,
            target: info.name,
            targetKind: info.kind,
            run: () => interact(id, action),
          });
        }
      }
      const tile = pick.tile;
      if (tile) options.push({ action: 'Walk here', run: () => walk(tile) });
      if (info) {
        options.push({
          action: 'Examine',
          target: info.name,
          targetKind: info.kind,
          run: () => chat.add(info.examine, 'examine'),
        });
      }
      if (options.length > 0) {
        tooltip.hide();
        menu.open(options, x, y);
      }
    },
    onHover: (x, y) => (hover = { x, y }),
    onLeave: () => {
      hover = null;
      tooltip.hide();
    },
    onDrag: (dx, dy) => cam.drag(dx, dy),
    onWheel: (dy) => cam.zoom(dy),
  });

  const updateHoverTooltip = () => {
    if (!hover || menu.isOpen) return;
    const pick = picker.pick(hover.x, hover.y);
    const info = pick.entityId ? describe(pick.entityId) : null;
    if (info && info.actions.length > 0) {
      // Other options: remaining actions, Walk here, Examine.
      const more = info.actions.length - 1 + (pick.tile ? 1 : 0) + 1;
      tooltip.show(
        { action: info.actions[0], target: info.name, targetKind: info.kind, moreOptions: more },
        hover.x,
        hover.y,
      );
    } else if (pick.tile || info) {
      tooltip.show({ action: 'Walk here', moreOptions: info ? 1 : 0 }, hover.x, hover.y);
    } else {
      tooltip.hide();
    }
  };

  // ── Sim events ─────────────────────────────────────────────────────────────
  const skillName = (id: string) => content.skills.get(id)?.name ?? id;
  const handleEvents = (events: SimEvent[]) => {
    for (const e of events) {
      if (e.type === 'message') chat.add(e.text, e.kind, e.speaker);
      else if (e.type === 'xp') hud.xpDrop(skillName(e.skillId), e.amount);
      else if (e.type === 'levelUp') hud.banner(`${skillName(e.skillId)} level ${e.level}!`);
      else if (e.type === 'autosave') persist();
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
    updateHoverTooltip();
    hud.update(state);
    inventory.update(state.player.inventory);
    skills.update(state.player.skills);
    renderer.render(scene, cam.camera);
  };
  requestAnimationFrame(frame);
}

function describeEntity(content: Content, state: GameState, entityId: string): EntityInfo | null {
  const ref = findEntity(state, entityId);
  if (!ref) return null;
  if (ref.kind === 'npc') {
    const def = content.npcs.get(ref.instance.defId);
    return def ? { name: def.name, examine: def.examine, actions: def.actions, kind: 'npc' } : null;
  }
  const def = content.objects.get(ref.instance.defId);
  if (!def) return null;
  const look = ref.instance.depletedUntil !== null && def.depleted ? def.depleted : def;
  return { name: look.name, examine: look.examine, actions: def.actions, kind: 'object' };
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
