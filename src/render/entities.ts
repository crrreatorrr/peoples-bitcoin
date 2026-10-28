/**
 * Draws the player, NPCs and zone objects from GameState. Reads state only.
 * The player is interpolated along the tiles stepped during the last tick.
 */
import * as THREE from 'three';
import { RENDER } from '../config/balance';
import type { Content } from '../sim/content';
import type { GameState, ObjectInstance, Tile } from '../sim/state';
import type { AssetLoader } from './loader';

const PLAYER_MODEL = 'player_president';

// Procedural placeholder animation (replaced by GLB clips in phase 6).
const WALK_CYCLE_HZ = 1.6;
const WALK_SWING_RAD = 0.7;
const MINE_CYCLE_HZ = 1.1;
const SMOKE_BOB = 0.06;

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
  private readonly segment = { dx: 0, dz: 0 };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetLoader,
    private readonly content: Content,
    state: GameState,
  ) {
    this.player = this.createActor(PLAYER_MODEL);

    for (const npc of state.zone.npcs) {
      const view = this.createActor(this.content.npcs.get(npc.defId)!.model);
      view.root.position.set(npc.x + 0.5, 0, npc.y + 0.5);
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
    this.updateObjects(timeSec);
    this.updatePlayer(state, Math.min(1, Math.max(0, alpha)), dt, timeSec);
    for (const view of this.npcs.values()) animate(view, 'idle', timeSec);
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

  private updatePlayer(state: GameState, alpha: number, dt: number, timeSec: number): void {
    const p = state.player;
    const moving = interpolateSteps(p.stepsThisTick, alpha, this.playerPosition, this.segment);
    this.player.root.position.copy(this.playerPosition);

    let mode: AnimMode = 'idle';
    let faceX = 0;
    let faceZ = 0;
    if (moving && alpha < 1) {
      mode = 'walk';
      faceX = this.segment.dx;
      faceZ = this.segment.dz;
    } else if (p.action && p.path.length === 0) {
      const target = this.entityCenter(state, p.action.targetId);
      if (target) {
        faceX = target.x - (p.pos.x + 0.5);
        faceZ = target.z - (p.pos.y + 0.5);
      }
      if (p.action.action === 'Mine' && p.action.nextAttemptTick !== null) mode = 'mine';
    }
    if (faceX !== 0 || faceZ !== 0) turnToward(this.player, Math.atan2(faceX, faceZ), dt);
    animate(this.player, mode, timeSec);
  }

  /** World-space center of an entity's footprint, or null if it doesn't exist. */
  entityCenter(state: GameState, entityId: string): THREE.Vector3 | null {
    const obj = state.zone.objects.find((o) => o.id === entityId);
    if (obj) {
      const def = this.content.objects.get(obj.defId)!;
      return new THREE.Vector3(obj.x + def.width / 2, 0, obj.y + def.height / 2);
    }
    const npc = state.zone.npcs.find((n) => n.id === entityId);
    return npc ? new THREE.Vector3(npc.x + 0.5, 0, npc.y + 0.5) : null;
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

/** Positions `out` along the tick's steps; returns true if the actor is moving. */
function interpolateSteps(
  steps: Tile[],
  t: number,
  out: THREE.Vector3,
  segment: { dx: number; dz: number },
): boolean {
  if (steps.length < 2) {
    out.set(steps[0].x + 0.5, 0, steps[0].y + 0.5);
    return false;
  }
  const segments = steps.length - 1;
  const f = t * segments;
  const i = Math.min(segments - 1, Math.floor(f));
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
