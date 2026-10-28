/**
 * Draws everything that lives in the current zone: the player, their Sproto,
 * NPCs, enemies, objects and ground items. Reads state only. Actors are
 * interpolated between their previous and current tiles. Sprite actors flip to
 * face their direction of travel and bob as they walk; primitive placeholders
 * turn and swing their limbs instead.
 */
import * as THREE from 'three';
import { RENDER } from '../config/balance';
import { builtOption } from '../sim/bunker';
import type { Content } from '../sim/content';
import {
  maxHp,
  PLAYER_ID,
  SPROTO_ID,
  type GameState,
  type GroundItem,
  type ObjectInstance,
  type Tile,
} from '../sim/state';
import { HpBar } from './effects';
import { SPRITE_NAME, type AssetLoader } from './loader';

const PLAYER_MODEL = 'player_president';

// Procedural placeholder animation (sprites bob instead).
const WALK_CYCLE_HZ = 1.6;
const WALK_SWING_RAD = 0.7;
const MINE_CYCLE_HZ = 1.1;
const SPRITE_BOB = 0.07;
const SMOKE_BOB = 0.06;
const GROUND_ITEM_SIZE = 0.42;
const GROUND_ITEM_HEIGHT = 0.22;
/** HP bars stay up this long after a hit. */
const HP_BAR_MS = 4000;

type AnimMode = 'idle' | 'walk' | 'work';

interface ActorView {
  root: THREE.Group;
  parts: Partial<Record<'legL' | 'legR' | 'armL' | 'armR' | 'tool', THREE.Object3D>>;
  sprite: THREE.Sprite | null;
  height: number;
  facing: number;
  hpBar: HpBar;
  lastHitAt: number;
  modelId: string;
}

interface ObjectView {
  root: THREE.Group;
  model: THREE.Object3D;
  modelId: string;
  instance: ObjectInstance;
}

export class EntityRenderer {
  /** Roots carrying userData.entityId, for picking. */
  readonly pickables: THREE.Object3D[] = [];
  /** Interpolated player feet position, for the camera. */
  readonly playerPosition = new THREE.Vector3();

  private readonly player: ActorView;
  private sproto: ActorView | null = null;
  private readonly npcs = new Map<string, ActorView>();
  private readonly enemies = new Map<string, ActorView>();
  private readonly objects: ObjectView[] = [];
  private readonly groundItems = new Map<string, THREE.Sprite>();
  private readonly segment = { dx: 0, dz: 0 };
  private readonly scratch = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetLoader,
    private readonly content: Content,
    state: GameState,
  ) {
    this.player = this.createActor(PLAYER_MODEL);

    for (const npc of state.zone.npcs) {
      const view = this.createActor(this.content.npcs.get(npc.defId)!.model);
      view.root.userData.entityId = npc.id;
      this.pickables.push(view.root);
      this.npcs.set(npc.id, view);
    }

    for (const obj of state.zone.objects) {
      const def = this.content.objects.get(obj.defId)!;
      const root = new THREE.Group();
      root.position.set(obj.x + def.width / 2, 0, obj.y + def.height / 2);
      root.userData.entityId = obj.id;
      const modelId = this.objectModel(state, obj);
      const model = this.assets.create(modelId);
      root.add(model);
      scene.add(root);
      this.pickables.push(root);
      this.objects.push({ root, model, modelId, instance: obj });
    }
  }

  update(state: GameState, alpha: number, dt: number, timeSec: number, camera: THREE.Camera): void {
    const t = Math.min(1, Math.max(0, alpha));
    this.cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    this.updateObjects(state, timeSec);
    this.updateGroundItems(state.zone.groundItems);
    this.updatePlayer(state, t, dt, timeSec);
    this.updateSproto(state, t, dt, timeSec);
    this.updateEnemies(state, t, dt, timeSec);
    for (const npc of state.zone.npcs) {
      const view = this.npcs.get(npc.id);
      if (!view) continue;
      const talking =
        state.player.dialogue?.npcId === npc.id || state.player.action?.targetId === npc.id;
      this.moveActor(view, [npc.from, npc], t, dt, timeSec, talking ? state.player.pos : null, npc);
    }
  }

  /** Called when something is hit, so its HP bar shows. */
  markHit(entityId: string, now: number): void {
    const view = this.viewOf(entityId);
    if (view) view.lastHitAt = now;
  }

  /** Interpolated world position of an entity's feet, or null if it isn't drawn. */
  positionOf(entityId: string): THREE.Vector3 | null {
    if (entityId === PLAYER_ID) return this.playerPosition;
    const view = this.viewOf(entityId);
    if (view) return view.root.position;
    const obj = this.objects.find((o) => o.instance.id === entityId);
    if (obj) return obj.root.position;
    return this.groundItems.get(entityId)?.position ?? null;
  }

  /** Height of an entity's sprite/model, for placing hitsplats and arrows above it. */
  heightOf(entityId: string): number {
    if (entityId === PLAYER_ID) return this.player.height;
    return this.viewOf(entityId)?.height ?? 1.5;
  }

  /** World-space center of an entity's footprint, or null if it doesn't exist. */
  entityCenter(state: GameState, entityId: string): THREE.Vector3 | null {
    const obj = state.zone.objects.find((o) => o.id === entityId);
    if (obj) {
      const def = this.content.objects.get(obj.defId)!;
      return new THREE.Vector3(obj.x + def.width / 2, 0, obj.y + def.height / 2);
    }
    const pos = this.positionOf(entityId);
    return pos ? pos.clone() : null;
  }

  /** Screen position (CSS px) of a world point, or null if it's behind the camera. */
  toScreen(world: THREE.Vector3, lift: number, camera: THREE.Camera, canvas: HTMLElement) {
    const v = this.scratch.copy(world);
    v.y += lift;
    v.project(camera);
    if (v.z > 1) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
    };
  }

  private viewOf(entityId: string): ActorView | null {
    if (entityId === PLAYER_ID) return this.player;
    if (entityId === SPROTO_ID) return this.sproto;
    return this.enemies.get(entityId) ?? this.npcs.get(entityId) ?? null;
  }

  private objectModel(state: GameState, obj: ObjectInstance): string {
    const def = this.content.objects.get(obj.defId)!;
    if (obj.depletedUntil !== null && def.depleted) return def.depleted.model;
    if (def.role === 'hotspot') return builtOption(state, def, obj)?.model ?? def.model;
    return def.model;
  }

  private updateObjects(state: GameState, timeSec: number): void {
    for (const view of this.objects) {
      const modelId = this.objectModel(state, view.instance);
      if (modelId !== view.modelId) {
        view.root.remove(view.model);
        view.model = this.assets.create(modelId);
        view.root.add(view.model);
        view.modelId = modelId;
      }
      const smoke = view.model.getObjectByName('smoke');
      if (smoke) smoke.position.y = Math.sin(timeSec * 3) * SMOKE_BOB;
    }
  }

  private updateGroundItems(items: GroundItem[]): void {
    const live = new Set<string>();
    for (const item of items) {
      live.add(item.id);
      if (this.groundItems.has(item.id)) continue;
      const model = this.content.items.get(item.itemId)?.model ?? '';
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.assets.iconTexture(model), alphaTest: 0.4 }),
      );
      sprite.scale.setScalar(GROUND_ITEM_SIZE);
      sprite.position.set(item.x + 0.5, GROUND_ITEM_HEIGHT, item.y + 0.5);
      sprite.userData.entityId = item.id;
      this.scene.add(sprite);
      this.pickables.push(sprite);
      this.groundItems.set(item.id, sprite);
    }
    for (const [id, sprite] of this.groundItems) {
      if (live.has(id)) continue;
      this.scene.remove(sprite);
      sprite.material.dispose();
      this.pickables.splice(this.pickables.indexOf(sprite), 1);
      this.groundItems.delete(id);
    }
  }

  private updatePlayer(state: GameState, t: number, dt: number, timeSec: number): void {
    const p = state.player;
    const view = this.player;
    const moving = interpolateSteps(p.stepsThisTick, t, this.playerPosition, this.segment);
    view.root.position.copy(this.playerPosition);

    let mode: AnimMode = moving && t < 1 ? 'walk' : 'idle';
    let face: Tile | null = null;
    const targetId = p.action?.targetId ?? p.dialogue?.npcId;
    if (mode === 'idle' && targetId && p.path.length === 0) {
      const target = this.entityCenter(state, targetId);
      if (target) face = { x: target.x - 0.5, y: target.z - 0.5 };
      if (p.action && p.action.nextAttemptTick !== null) mode = 'work';
    }
    this.pose(view, mode, moving ? this.segment : null, face, p.pos, dt, timeSec);
    view.hpBar.set(
      p.hp / maxHp(p),
      p.hp < maxHp(p) || performance.now() - view.lastHitAt < HP_BAR_MS,
    );
  }

  private updateSproto(state: GameState, t: number, dt: number, timeSec: number): void {
    const s = state.player.sproto;
    const modelId = s ? this.content.sprotos.get(s.defId)?.model : undefined;
    if (this.sproto && (!s || this.sproto.modelId !== modelId)) {
      this.scene.remove(this.sproto.root);
      this.pickables.splice(this.pickables.indexOf(this.sproto.root), 1);
      this.sproto = null;
    }
    if (!s || !modelId) return;
    if (!this.sproto) {
      this.sproto = this.createActor(modelId);
      this.sproto.root.userData.entityId = SPROTO_ID;
    }
    const target = s.target ? state.zone.enemies.find((e) => e.id === s.target) : null;
    this.moveActor(this.sproto, [s.from, s], t, dt, timeSec, target ?? null);
    const max = this.content.sprotos.get(s.defId)?.hp ?? s.hp;
    this.sproto.hpBar.set(s.hp / max, s.hp < max);
  }

  private updateEnemies(state: GameState, t: number, dt: number, timeSec: number): void {
    const live = new Set<string>();
    const now = performance.now();
    for (const enemy of state.zone.enemies) {
      live.add(enemy.id);
      let view = this.enemies.get(enemy.id);
      if (!view) {
        view = this.createActor(this.content.enemies.get(enemy.defId)!.model);
        view.root.userData.entityId = enemy.id;
        this.pickables.push(view.root);
        this.enemies.set(enemy.id, view);
      }
      view.root.visible = enemy.respawnAt === null;
      if (!view.root.visible) continue;
      const target =
        enemy.target === PLAYER_ID
          ? state.player.pos
          : enemy.target === SPROTO_ID
            ? state.player.sproto
            : null;
      this.moveActor(view, [enemy.from, enemy], t, dt, timeSec, target ?? null);
      const max = this.content.enemies.get(enemy.defId)?.hp ?? enemy.hp;
      view.hpBar.set(enemy.hp / max, enemy.hp < max || now - view.lastHitAt < HP_BAR_MS);
    }
    for (const [id, view] of this.enemies) {
      if (live.has(id)) continue;
      this.scene.remove(view.root);
      this.pickables.splice(this.pickables.indexOf(view.root), 1);
      this.enemies.delete(id);
    }
  }

  /** Interpolates an actor between two tiles and poses it. */
  private moveActor(
    view: ActorView,
    steps: readonly Tile[],
    t: number,
    dt: number,
    timeSec: number,
    faceTarget: Tile | null,
    at?: Tile,
  ): void {
    const moving = interpolateSteps(steps, t, view.root.position, this.segment);
    const here = at ?? steps[steps.length - 1];
    this.pose(
      view,
      moving && t < 1 ? 'walk' : 'idle',
      moving ? this.segment : null,
      faceTarget,
      here,
      dt,
      timeSec,
    );
  }

  private pose(
    view: ActorView,
    mode: AnimMode,
    moveDir: { dx: number; dz: number } | null,
    faceTile: Tile | null,
    here: Tile,
    dt: number,
    timeSec: number,
  ): void {
    const dir = moveDir ?? (faceTile ? { dx: faceTile.x - here.x, dz: faceTile.y - here.y } : null);
    if (view.sprite) {
      // Flip the billboard to face left/right on screen, and bob while moving or working.
      if (dir && (dir.dx !== 0 || dir.dz !== 0)) {
        const screenX = dir.dx * this.cameraRight.x + dir.dz * this.cameraRight.z;
        if (Math.abs(screenX) > 0.01)
          view.sprite.scale.x = Math.abs(view.sprite.scale.x) * (screenX < 0 ? -1 : 1);
      }
      const hz = mode === 'walk' ? WALK_CYCLE_HZ * 2 : mode === 'work' ? MINE_CYCLE_HZ * 2 : 0;
      view.sprite.position.y = hz ? Math.abs(Math.sin(timeSec * Math.PI * hz)) * SPRITE_BOB : 0;
      return;
    }
    if (dir && (dir.dx !== 0 || dir.dz !== 0)) turnToward(view, Math.atan2(dir.dx, dir.dz), dt);
    animate(view, mode, timeSec);
  }

  private createActor(modelId: string): ActorView {
    const root = this.assets.create(modelId);
    const parts: ActorView['parts'] = {};
    for (const name of ['legL', 'legR', 'armL', 'armR', 'tool'] as const) {
      const part = root.getObjectByName(name);
      if (part) parts[name] = part;
    }
    const sprite = (root.getObjectByName(SPRITE_NAME) as THREE.Sprite | undefined) ?? null;
    const box = new THREE.Box3().setFromObject(root);
    const height = sprite ? sprite.scale.y : Math.max(0.5, box.max.y);
    const hpBar = new HpBar();
    hpBar.sprite.position.y = height + 0.25;
    root.add(hpBar.sprite);
    this.scene.add(root);
    return { root, parts, sprite, height, facing: 0, hpBar, lastHitAt: -Infinity, modelId };
  }
}

/** Positions `out` along the tiles stepped this tick; returns true if the actor moved. */
function interpolateSteps(
  steps: readonly Tile[],
  t: number,
  out: THREE.Vector3,
  segment: { dx: number; dz: number },
): boolean {
  const last = steps.length - 1;
  const moved = last > 0 && (steps[0].x !== steps[last].x || steps[0].y !== steps[last].y);
  if (!moved) {
    out.set(steps[last].x + 0.5, 0, steps[last].y + 0.5);
    return false;
  }
  const f = t * last;
  const i = Math.min(last - 1, Math.floor(f));
  const local = f - i;
  const a = steps[i];
  const b = steps[i + 1];
  out.set(a.x + (b.x - a.x) * local + 0.5, 0, a.y + (b.y - a.y) * local + 0.5);
  segment.dx = b.x - a.x;
  segment.dz = b.y - a.y;
  return true;
}

function turnToward(view: ActorView, angle: number, dt: number): void {
  let diff = angle - view.facing;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const step = RENDER.turnSpeed * dt;
  view.facing += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
  view.root.rotation.y = view.facing;
}

function animate(view: ActorView, mode: AnimMode, t: number): void {
  const { legL, legR, armL, armR, tool } = view.parts;
  const swing = mode === 'walk' ? Math.sin(t * Math.PI * 2 * WALK_CYCLE_HZ) * WALK_SWING_RAD : 0;
  if (legL) legL.rotation.x = swing;
  if (legR) legR.rotation.x = -swing;
  if (armL) armL.rotation.x = -swing * 0.8;
  if (armR) {
    armR.rotation.x =
      mode === 'work' ? -1.4 - 0.8 * Math.sin(t * Math.PI * 2 * MINE_CYCLE_HZ) : swing * 0.8;
  }
  if (tool) tool.visible = mode === 'work';
}
