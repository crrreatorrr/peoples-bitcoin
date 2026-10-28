/**
 * Draws everything that lives in the current zone: the player, their Sproto,
 * NPCs, enemies, objects and ground items. Reads state only. Actors are 3D
 * models interpolated between their previous and current tiles; they turn to
 * face where they walk or what they fight, and animate.ts poses them (walk,
 * run, weapon stances, attacks, flinches, skilling, death). The player wears
 * their armor and holds their weapon, or their tool while skilling.
 */
import * as THREE from 'three';
import { COMBAT, RENDER } from '../config/balance';
import { builtOption } from '../sim/bunker';
import type { Content } from '../sim/content';
import { bestTool } from '../sim/inventory';
import {
  maxHp,
  PLAYER_ID,
  SPROTO_ID,
  type AttackStyle,
  type GameState,
  type GroundItem,
  type ObjectInstance,
  type PlayerState,
  type Tile,
} from '../sim/state';
import { levelForXp } from '../sim/xp';
import { dressFor, holdRight, type ActorModel } from './actors';
import { DEATH_MS, poseActor, STRIDE_RAD_PER_TILE, type WorkAnim } from './animate';
import { HpBar } from './effects';
import type { AssetLoader } from './loader';

export const PLAYER_MODEL = 'player_president';
const SMOKE_BOB = 0.06;
const GROUND_ITEM_SIZE = 0.5;
/** HP bars stay up this long after a hit. */
const HP_BAR_MS = 4000;
/** How long a one-off skilling burst (a Construction build) animates. */
const WORK_BURST_MS = 1400;
/** Moving further than this in one frame is a teleport, not a step. */
const TELEPORT_DISTANCE = 2.5;

interface ActorView {
  /** Positioned on the tile, turned to face. */
  root: THREE.Group;
  actor: ActorModel;
  modelId: string;
  /** Worn items the model was built with (player only). */
  dressKey: string;
  facing: number;
  phase: number;
  attackAt: number;
  attackStyle: AttackStyle;
  hitAt: number;
  diedAt: number;
  hpBar: HpBar;
}

interface Doing {
  combat: boolean;
  work: WorkAnim | null;
  face: Tile | null;
}

interface ObjectView {
  root: THREE.Group;
  model: THREE.Group;
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
  private readonly groundItems = new Map<string, THREE.Mesh>();
  private readonly groundGeometry = new THREE.PlaneGeometry(GROUND_ITEM_SIZE, GROUND_ITEM_SIZE);
  private readonly segment = { dx: 0, dz: 0 };
  private readonly scratch = new THREE.Vector3();
  private workBurst: { anim: WorkAnim; tool: string | null; until: number } | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetLoader,
    private readonly content: Content,
    state: GameState,
  ) {
    this.player = this.createActor(PLAYER_MODEL, dressKeyOf(state.player));
    interpolateSteps([state.player.pos], 1, this.player.root.position, this.segment);

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

  update(state: GameState, alpha: number, dt: number, now: number): void {
    const t = Math.min(1, Math.max(0, alpha));
    this.updateObjects(state, dt, now);
    this.updateGroundItems(state.zone.groundItems);
    this.updatePlayer(state, t, dt, now);
    this.updateSproto(state, t, dt, now);
    this.updateEnemies(state, t, dt, now);
    for (const npc of state.zone.npcs) {
      const view = this.npcs.get(npc.id);
      if (!view) continue;
      const talking = state.player.dialogue?.npcId === npc.id;
      const facing = talking || state.player.action?.targetId === npc.id;
      this.drive(view, [npc.from, npc], t, dt, now, npc, {
        combat: false,
        work: talking ? 'gesture' : null,
        face: facing ? state.player.pos : null,
      });
    }
  }

  /** Something was hit: show its HP bar and play a flinch. */
  markHit(entityId: string, now: number): void {
    const view = this.viewOf(entityId);
    if (view) view.hitAt = now;
  }

  /** Something attacked: swing, shoot or lunge. */
  playAttack(attackerId: string, style: AttackStyle, now: number): void {
    const view = this.viewOf(attackerId);
    if (!view) return;
    view.attackAt = now;
    view.attackStyle = style;
  }

  /** Something died: it falls over before disappearing (or, for the player, respawning). */
  markDeath(entityId: string, now: number): void {
    const view = this.viewOf(entityId);
    if (view) view.diedAt = now;
  }

  /** A one-off skilling animation for actions that finish instantly (Construction). */
  playWork(state: GameState, skillId: string, now: number): void {
    if (skillId !== 'construction') return;
    this.workBurst = {
      anim: 'hammer',
      tool: this.toolFor(state.player, skillId),
      until: now + WORK_BURST_MS,
    };
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

  /** Height of an entity's model, for placing hitsplats and arrows above it. */
  heightOf(entityId: string): number {
    return this.viewOf(entityId)?.actor.height ?? 1.5;
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

  private unpick(obj: THREE.Object3D): void {
    const i = this.pickables.indexOf(obj);
    if (i >= 0) this.pickables.splice(i, 1);
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

  private updateObjects(state: GameState, dt: number, now: number): void {
    for (const view of this.objects) {
      const modelId = this.objectModel(state, view.instance);
      if (modelId !== view.modelId) {
        view.root.remove(view.model);
        view.model = this.assets.create(modelId);
        view.root.add(view.model);
        view.modelId = modelId;
      }
      const smoke = view.model.getObjectByName('smoke');
      if (smoke) smoke.position.y = Math.sin((now / 1000) * 3) * SMOKE_BOB;
      const actor = view.model.userData.actor as ActorModel | undefined;
      if (actor) poseActor(actor, idleInput(now, dt));
    }
  }

  private updateGroundItems(items: GroundItem[]): void {
    const live = new Set<string>();
    for (const item of items) {
      live.add(item.id);
      if (this.groundItems.has(item.id)) continue;
      const model = this.content.items.get(item.itemId)?.model ?? '';
      // Lying flat on the ground, like OSRS drops: never pokes through walls.
      const mesh = new THREE.Mesh(
        this.groundGeometry,
        new THREE.MeshBasicMaterial({ map: this.assets.iconTexture(model), alphaTest: 0.4 }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(item.x + 0.5, 0.03, item.y + 0.5);
      mesh.userData.entityId = item.id;
      this.scene.add(mesh);
      this.pickables.push(mesh);
      this.groundItems.set(item.id, mesh);
    }
    for (const [id, mesh] of this.groundItems) {
      if (live.has(id)) continue;
      this.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
      this.unpick(mesh);
      this.groundItems.delete(id);
    }
  }

  private updatePlayer(state: GameState, t: number, dt: number, now: number): void {
    const p = state.player;
    const key = dressKeyOf(p);
    if (key !== this.player.dressKey) this.redress(this.player, key);
    if (p.dyingUntil === null) this.player.diedAt = -Infinity;

    const work = this.workOf(state, now);
    const fighting = p.action?.action === 'Attack';
    // An empty gun is swung as a club, so it stays in hand; no weapon means the gavel.
    const weapon = p.equipment.weapon?.itemId ?? null;
    let held = weapon;
    if (work) held = work.tool;
    else if (!weapon && (fighting || now - this.player.attackAt < 900)) {
      held = COMBAT.fallbackWeaponId;
    }
    holdRight(this.player.actor, held);

    const targetId = p.action?.targetId ?? p.dialogue?.npcId;
    const target = targetId ? this.entityCenter(state, targetId) : null;
    const face = target ? { x: target.x - 0.5, y: target.z - 0.5 } : null;
    this.drive(this.player, p.stepsThisTick, t, dt, now, p.pos, {
      combat: fighting && p.path.length === 0,
      work: work?.anim ?? null,
      face,
    });
    this.playerPosition.copy(this.player.root.position);
    this.player.hpBar.set(p.hp / maxHp(p), now - this.player.hitAt < HP_BAR_MS);
  }

  private updateSproto(state: GameState, t: number, dt: number, now: number): void {
    const s = state.player.sproto;
    const modelId = s ? this.content.sprotos.get(s.defId)?.model : undefined;
    if (this.sproto && (!s || this.sproto.modelId !== modelId)) {
      this.scene.remove(this.sproto.root);
      this.unpick(this.sproto.root);
      this.sproto = null;
    }
    if (!s || !modelId) return;
    if (!this.sproto) {
      this.sproto = this.createActor(modelId);
      this.sproto.root.userData.entityId = SPROTO_ID;
      this.pickables.push(this.sproto.root);
      interpolateSteps([s], 1, this.sproto.root.position, this.segment);
    }
    const target = s.target ? state.zone.enemies.find((e) => e.id === s.target) : null;
    this.drive(this.sproto, [s.from, s], t, dt, now, s, {
      combat: target != null,
      work: null,
      face: target ?? null,
    });
    const max = this.content.sprotos.get(s.defId)?.hp ?? s.hp;
    this.sproto.hpBar.set(s.hp / max, now - this.sproto.hitAt < HP_BAR_MS);
  }

  private updateEnemies(state: GameState, t: number, dt: number, now: number): void {
    const live = new Set<string>();
    for (const enemy of state.zone.enemies) {
      live.add(enemy.id);
      let view = this.enemies.get(enemy.id);
      if (!view) {
        view = this.createActor(this.content.enemies.get(enemy.defId)!.model);
        view.root.userData.entityId = enemy.id;
        interpolateSteps([enemy], 1, view.root.position, this.segment);
        this.pickables.push(view.root);
        this.enemies.set(enemy.id, view);
      }
      const dead = enemy.respawnAt !== null;
      if (!dead && view.diedAt !== -Infinity) {
        // Respawned: stand up at the spawn point.
        view.diedAt = -Infinity;
        view.hitAt = -Infinity;
        interpolateSteps([enemy], 1, view.root.position, this.segment);
      }
      view.root.visible = !dead || now - view.diedAt < DEATH_MS;
      if (!view.root.visible) continue;
      if (dead) {
        poseActor(view.actor, { ...idleInput(now, dt), diedAt: view.diedAt });
        continue;
      }
      const target =
        enemy.target === PLAYER_ID
          ? state.player.pos
          : enemy.target === SPROTO_ID
            ? state.player.sproto
            : null;
      this.drive(view, [enemy.from, enemy], t, dt, now, enemy, {
        combat: target != null,
        work: null,
        face: target ?? null,
      });
      const max = this.content.enemies.get(enemy.defId)?.hp ?? enemy.hp;
      view.hpBar.set(enemy.hp / max, now - view.hitAt < HP_BAR_MS);
    }
    for (const [id, view] of this.enemies) {
      if (live.has(id)) continue;
      // Adds vanish from the state when killed; let them finish falling.
      if (now - view.diedAt < DEATH_MS) {
        poseActor(view.actor, { ...idleInput(now, dt), diedAt: view.diedAt });
        continue;
      }
      this.scene.remove(view.root);
      this.unpick(view.root);
      this.enemies.delete(id);
    }
  }

  /** Moves an actor along this tick's steps, turns it and poses it. */
  private drive(
    view: ActorView,
    steps: readonly Tile[],
    t: number,
    dt: number,
    now: number,
    here: Tile,
    doing: Doing,
  ): void {
    const before = this.scratch.copy(view.root.position);
    const moved = interpolateSteps(steps, t, view.root.position, this.segment);
    const moving = moved && t < 1;
    const distance = before.distanceTo(view.root.position);
    if (distance < TELEPORT_DISTANCE) view.phase += distance * STRIDE_RAD_PER_TILE;

    const face = doing.face;
    const dir = moving
      ? this.segment
      : face && (face.x !== here.x || face.y !== here.y)
        ? { dx: face.x - here.x, dz: face.y - here.y }
        : null;
    let facingAway = 0;
    if (dir && (dir.dx !== 0 || dir.dz !== 0)) {
      facingAway = turnToward(view, Math.atan2(dir.dx, dir.dz), dt);
    }

    poseActor(view.actor, {
      now,
      dt,
      moving,
      // Two steps this tick is a run, but like OSRS the run cycle waits until
      // the actor faces its way; while turning it steps along at a walk.
      running: steps.length > 2 && (!moving || facingAway < Math.PI / 4),
      phase: view.phase,
      combat: doing.combat,
      work: moving ? null : doing.work,
      attackAt: view.attackAt,
      attackStyle: view.attackStyle,
      hitAt: view.hitAt,
      diedAt: view.diedAt,
    });
  }

  /** What skilling loop the player is in, and the tool it shows. */
  private workOf(state: GameState, now: number): { anim: WorkAnim; tool: string | null } | null {
    const p = state.player;
    if (this.workBurst && now < this.workBurst.until && p.path.length === 0) return this.workBurst;
    const a = p.action;
    if (!a || a.action === 'Attack' || a.nextAttemptTick === null || p.path.length > 0) return null;
    const obj = state.zone.objects.find((o) => o.id === a.targetId);
    const def = obj && this.content.objects.get(obj.defId);
    if (!def) return null;
    if (def.role === 'station') return { anim: 'gesture', tool: null };
    const node = this.content.gatherByObject.get(def.id);
    if (!node) return null;
    const tool = this.toolFor(p, node.skillId);
    return { anim: node.skillId === 'mining' ? 'swing' : 'gesture', tool };
  }

  private toolFor(p: PlayerState, skillId: string): string | null {
    const level = levelForXp(p.skills[skillId] ?? 0);
    return bestTool(p.inventory, this.content, skillId, level)?.id ?? null;
  }

  private createActor(modelId: string, dressKey = ''): ActorView {
    const root = new THREE.Group();
    const view: ActorView = {
      root,
      actor: this.assets.actor(modelId, dressFor(dressKey.split('|'))),
      modelId,
      dressKey,
      facing: 0,
      phase: 0,
      attackAt: -Infinity,
      attackStyle: 'melee',
      hitAt: -Infinity,
      diedAt: -Infinity,
      hpBar: new HpBar(),
    };
    root.add(view.actor.root, view.hpBar.sprite);
    view.hpBar.sprite.position.y = view.actor.height + 0.25;
    this.scene.add(root);
    return view;
  }

  /** Rebuilds the player's model after armor changes. */
  private redress(view: ActorView, dressKey: string): void {
    view.root.remove(view.actor.root);
    view.actor = this.assets.actor(view.modelId, dressFor(dressKey.split('|')));
    view.dressKey = dressKey;
    view.root.add(view.actor.root);
    view.hpBar.sprite.position.y = view.actor.height + 0.25;
  }
}

/** Worn head, body and legs items, which change how the player is built. */
export function dressKeyOf(p: PlayerState): string {
  return [p.equipment.head, p.equipment.body, p.equipment.legs]
    .map((s) => s?.itemId ?? '')
    .join('|');
}

function idleInput(now: number, dt: number) {
  return {
    now,
    dt,
    moving: false,
    running: false,
    phase: 0,
    combat: false,
    work: null,
    attackAt: -Infinity,
    attackStyle: 'melee' as const,
    hitAt: -Infinity,
    diedAt: -Infinity,
  };
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

/** Turns at a fixed rate toward `angle`; returns how far off it still is (radians). */
function turnToward(view: ActorView, angle: number, dt: number): number {
  let diff = angle - view.facing;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const step = RENDER.turnSpeed * dt;
  view.facing += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
  view.root.rotation.y = view.facing;
  return Math.max(0, Math.abs(diff) - step);
}
