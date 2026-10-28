/**
 * Draws the player, NPCs, zone objects and ground items from GameState. Reads
 * state only. Actors are interpolated between their previous and current tiles.
 */
import * as THREE from 'three';
import { RENDER } from '../config/balance';
import type { Content } from '../sim/content';
import type { GameState, GroundItem, NpcInstance, ObjectInstance, Tile } from '../sim/state';
import type { AssetLoader } from './loader';

const PLAYER_MODEL = 'player_president';

// Procedural placeholder animation (replaced by GLB clips in phase 6).
const WALK_CYCLE_HZ = 1.6;
const WALK_SWING_RAD = 0.7;
const MINE_CYCLE_HZ = 1.1;
const SMOKE_BOB = 0.06;
const GROUND_ITEM_SIZE = 0.42;
const GROUND_ITEM_HEIGHT = 0.22;

type AnimMode = 'idle' | 'walk' | 'mine';

interface ActorView {
  root: THREE.Group;
  parts: Partial<Record<'legL' | 'legR' | 'armL' | 'armR' | 'tool', THREE.Object3D>>;
  facing: number;
}

interface ObjectView {
  root: THREE.Group;
  model: THREE.Object3D;
  depleted: boolean;
  instance: ObjectInstance;
}

export class EntityRenderer {
  /** Roots carrying userData.entityId, for picking. */
  readonly pickables: THREE.Object3D[] = [];
  /** Interpolated player feet position, for the camera. */
  readonly playerPosition = new THREE.Vector3();

  private readonly player: ActorView;
  private readonly npcs = new Map<string, ActorView>();
  private readonly objects: ObjectView[] = [];
  private readonly groundItems = new Map<string, THREE.Sprite>();
  private readonly segment = { dx: 0, dz: 0 };
  private readonly scratch = new THREE.Vector3();

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
      const model = this.assets.create(def.model);
      root.add(model);
      scene.add(root);
      this.pickables.push(root);
      this.objects.push({ root, model, depleted: false, instance: obj });
    }
  }

  update(state: GameState, alpha: number, dt: number, timeSec: number): void {
    const t = Math.min(1, Math.max(0, alpha));
    this.updateObjects(timeSec);
    this.updateGroundItems(state.zone.groundItems);
    this.updatePlayer(state, t, dt, timeSec);
    for (const npc of state.zone.npcs) this.updateNpc(state, npc, t, dt, timeSec);
  }

  /** World-space center of an entity's footprint, or null if it doesn't exist. */
  entityCenter(state: GameState, entityId: string): THREE.Vector3 | null {
    const obj = state.zone.objects.find((o) => o.id === entityId);
    if (obj) {
      const def = this.content.objects.get(obj.defId)!;
      return new THREE.Vector3(obj.x + def.width / 2, 0, obj.y + def.height / 2);
    }
    const tile =
      state.zone.npcs.find((n) => n.id === entityId) ??
      state.zone.groundItems.find((g) => g.id === entityId);
    return tile ? new THREE.Vector3(tile.x + 0.5, 0, tile.y + 0.5) : null;
  }

  private updateObjects(timeSec: number): void {
    for (const view of this.objects) {
      const def = this.content.objects.get(view.instance.defId)!;
      const depleted = view.instance.depletedUntil !== null;
      if (depleted !== view.depleted && def.depleted) {
        view.root.remove(view.model);
        view.model = this.assets.create(depleted ? def.depleted.model : def.model);
        view.root.add(view.model);
        view.depleted = depleted;
      }
      const smoke = view.depleted ? view.model.getObjectByName('smoke') : undefined;
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
        new THREE.SpriteMaterial({ map: this.assets.iconTexture(model), alphaTest: 0.5 }),
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
    const moving = interpolateSteps(p.stepsThisTick, t, this.playerPosition, this.segment);
    this.player.root.position.copy(this.playerPosition);

    let mode: AnimMode = 'idle';
    let faceX = 0;
    let faceZ = 0;
    const targetId = p.action?.targetId ?? p.dialogue?.npcId;
    if (moving && t < 1) {
      mode = 'walk';
      faceX = this.segment.dx;
      faceZ = this.segment.dz;
    } else if (targetId && p.path.length === 0) {
      const target = this.entityCenter(state, targetId);
      if (target) {
        faceX = target.x - (p.pos.x + 0.5);
        faceZ = target.z - (p.pos.y + 0.5);
      }
      if (p.action?.action === 'Mine' && p.action.nextAttemptTick !== null) mode = 'mine';
    }
    if (faceX !== 0 || faceZ !== 0) turnToward(this.player, Math.atan2(faceX, faceZ), dt);
    animate(this.player, mode, timeSec);
  }

  private updateNpc(state: GameState, npc: NpcInstance, t: number, dt: number, timeSec: number) {
    const view = this.npcs.get(npc.id);
    if (!view) return;
    const moving = interpolateSteps([npc.from, npc], t, view.root.position, this.segment);
    let faceX = moving ? this.segment.dx : 0;
    let faceZ = moving ? this.segment.dz : 0;
    if (state.player.dialogue?.npcId === npc.id || state.player.action?.targetId === npc.id) {
      faceX = state.player.pos.x - npc.x;
      faceZ = state.player.pos.y - npc.y;
    }
    if (faceX !== 0 || faceZ !== 0) turnToward(view, Math.atan2(faceX, faceZ), dt);
    animate(view, moving && t < 1 ? 'walk' : 'idle', timeSec);
  }

  /** Screen position (CSS px) above the player's head, or null if behind the camera. */
  playerHeadScreen(camera: THREE.Camera, canvas: HTMLElement, height: number) {
    const v = this.scratch.copy(this.playerPosition);
    v.y += height;
    v.project(camera);
    if (v.z > 1) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
    };
  }

  private createActor(modelId: string): ActorView {
    const root = this.assets.create(modelId);
    const parts: ActorView['parts'] = {};
    for (const name of ['legL', 'legR', 'armL', 'armR', 'tool'] as const) {
      const part = root.getObjectByName(name);
      if (part) parts[name] = part;
    }
    this.scene.add(root);
    return { root, parts, facing: 0 };
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
      mode === 'mine' ? -1.4 - 0.8 * Math.sin(t * Math.PI * 2 * MINE_CYCLE_HZ) : swing * 0.8;
  }
  if (tool) tool.visible = mode === 'mine';
}
