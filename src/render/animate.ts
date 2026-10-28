/**
 * OSRS-style procedural animation. Each frame an actor gets a target pose from
 * what it's doing (walking or running, standing in a weapon stance, skilling,
 * attacking, flinching, dying) and its joints ease toward it. Presentation
 * only: reads timestamps, never game state.
 */
import type * as THREE from 'three';
import type { AttackStyle } from '../sim/state';
import type { ActorModel } from './actors';
import type { HoldKind } from './gear';

/** Skilling loops: pick swings, hammering, talking with your hands, typing. */
export type WorkAnim = 'swing' | 'hammer' | 'gesture' | 'type';

export interface AnimInput {
  /** performance.now() in ms. */
  now: number;
  /** Seconds since the last frame. */
  dt: number;
  moving: boolean;
  running: boolean;
  /** Walk cycle angle, advanced by distance travelled so feet don't slide. */
  phase: number;
  /** Standing with a target to fight: hold the weapon ready. */
  combat: boolean;
  work: WorkAnim | null;
  attackAt: number;
  attackStyle: AttackStyle;
  hitAt: number;
  /** When the actor died, or -Infinity while alive. */
  diedAt: number;
}

const ATTACK_MS = 520;
const HIT_MS = 320;
/** How long a death plays before the body is hidden. */
export const DEATH_MS = 1100;
const FLASH_MS = 80;
/** How fast joints ease toward their target pose (per second). */
const BLEND_RATE = 22;
/** Walk cycle radians per tile travelled. */
export const STRIDE_RAD_PER_TILE = Math.PI * 1.5;

interface Pose {
  armLx: number;
  armLz: number;
  armRx: number;
  armRz: number;
  foreLx: number;
  foreRx: number;
  legLx: number;
  legRx: number;
  shinLx: number;
  shinRx: number;
  torsoX: number;
  torsoY: number;
  headX: number;
  bodyY: number;
  bodyZ: number;
}

export function poseActor(actor: ActorModel, a: AnimInput): void {
  if (actor.muzzle) {
    actor.muzzle.visible = a.attackStyle !== 'melee' && a.now - a.attackAt < FLASH_MS;
  }
  if (a.diedAt > -Infinity) {
    fall(actor, Math.max(0, a.now - a.diedAt));
    return;
  }
  actor.root.rotation.x = 0;
  actor.root.position.y = 0;
  if (actor.joints) applyPose(actor, humanPose(actor, a), a.dt);
  else poseBody(actor, a);
}

// ── Humanoids ────────────────────────────────────────────────────────────────

function humanPose(actor: ActorModel, a: AnimInput): Pose {
  const p: Pose = {
    armLx: 0,
    armLz: 0.06,
    armRx: 0,
    armRz: -0.06,
    foreLx: -0.12,
    foreRx: -0.12,
    legLx: 0,
    legRx: 0,
    shinLx: 0,
    shinRx: 0,
    torsoX: actor.hunch,
    torsoY: 0,
    headX: 0,
    bodyY: actor.bodyY,
    bodyZ: 0,
  };
  const t = a.now / 1000;
  holdPose(p, actor, a.combat && !a.moving);
  if (a.moving) walk(p, actor, a);
  else {
    p.torsoX += 0.015 * Math.sin(t * 2);
    if (a.work) work(p, a.work, t);
    if (actor.pose === 'phone') {
      p.armLx = -2.1;
      p.armLz = 0.35;
      p.foreLx = -2.2;
    }
  }
  const k = (a.now - a.attackAt) / ATTACK_MS;
  if (k >= 0 && k < 1) attack(p, actor, a.attackStyle, k);
  else {
    const h = (a.now - a.hitAt) / HIT_MS;
    if (h >= 0 && h < 1) flinch(p, actor, h);
  }
  return p;
}

/** Arms follow what the hands carry; `ready` raises weapons to fight. */
function holdPose(p: Pose, actor: ActorModel, ready: boolean): void {
  switch (actor.left) {
    case 'item':
      p.armLx = -0.25;
      p.foreLx = -1.35;
      break;
    case 'shield':
      p.armLx = -0.35;
      p.armLz = 0.12;
      p.foreLx = -1.4;
      break;
    case 'carry':
      p.foreLx = -0.04;
      break;
  }
  switch (actor.right) {
    case 'pistol':
      if (ready) Object.assign(p, { armRx: -1.5, armRz: 0.06, foreRx: -0.05 });
      else Object.assign(p, { armRx: -0.15, foreRx: -0.6 });
      break;
    case 'rifle':
      if (ready)
        Object.assign(p, { armRx: -1.25, foreRx: -0.35, armLx: -1.4, armLz: -0.5, foreLx: -0.3 });
      else
        Object.assign(p, { armRx: -0.35, foreRx: -1.25, armLx: -0.6, armLz: -0.35, foreLx: -1.2 });
      break;
    case 'heavy':
      Object.assign(p, {
        armRx: ready ? -0.5 : -0.35,
        foreRx: -1.2,
        armLx: ready ? -0.75 : -0.55,
        armLz: -0.3,
        foreLx: -1.1,
      });
      break;
    case 'melee':
      if (ready) Object.assign(p, { armRx: -0.9, foreRx: -1.0 });
      else Object.assign(p, { armRx: -0.15, foreRx: -0.9 });
      break;
    case 'item':
      Object.assign(p, { armRx: -0.25, foreRx: -1.35 });
      break;
    case 'carry':
      p.foreRx = -0.04;
      break;
    default:
      // Fists up.
      if (ready) Object.assign(p, { armRx: -0.7, foreRx: -1.7, armLx: -0.7, foreLx: -1.7 });
  }
}

const swingsFreely = (hold: HoldKind | null) =>
  hold === null || hold === 'carry' || hold === 'pistol' || hold === 'melee';

function walk(p: Pose, actor: ActorModel, a: AnimInput): void {
  const run = a.running;
  const s = Math.sin(a.phase);
  const c = Math.cos(a.phase);
  const stride = run ? 0.85 : 0.55;
  const knee = run ? 1.3 : 0.75;
  p.legLx = -stride * s;
  p.legRx = stride * s;
  p.shinLx = knee * Math.max(0, c);
  p.shinRx = knee * Math.max(0, -c);
  p.bodyY = actor.bodyY + (run ? 0.07 : 0.035) * (Math.abs(c) - 0.5);
  p.torsoX += run ? 0.18 : 0.04;
  const swing = (run ? 0.8 : 0.5) * s;
  if (swingsFreely(actor.left) && actor.right !== 'rifle' && actor.right !== 'heavy') {
    p.armLx += swing;
    if (run && actor.left === null) p.foreLx = -1.3;
  }
  if (swingsFreely(actor.right)) {
    p.armRx -= swing * (actor.right === null ? 1 : 0.5);
    if (run && actor.right === null) p.foreRx = -1.3;
  }
}

function work(p: Pose, kind: WorkAnim, t: number): void {
  switch (kind) {
    case 'swing': {
      // Slow raise overhead, fast strike, short rest.
      const u = (t * 1.1) % 1;
      const raise = u < 0.6 ? easeInOut(u / 0.6) : u < 0.78 ? 1 - easeIn((u - 0.6) / 0.18) : 0;
      p.armRx = -0.35 - 2.3 * raise;
      p.armLx = p.armRx;
      p.armLz = -0.35;
      p.foreRx = p.foreLx = -0.25;
      p.torsoX += 0.28 * (1 - raise);
      break;
    }
    case 'hammer': {
      const s = Math.sin(t * Math.PI * 2 * 1.8);
      p.armRx = -1.1 - 0.6 * s;
      p.foreRx = -0.9 + 0.4 * s;
      p.torsoX += 0.3;
      p.headX = 0.3;
      break;
    }
    case 'gesture':
      p.armRx = -0.45 + 0.3 * Math.sin(t * 2.3);
      p.foreRx = -1.2 + 0.35 * Math.sin(t * 3.1);
      p.headX = 0.08 * Math.sin(t * 2.3);
      break;
    case 'type':
      p.armLx = p.armRx = -0.5;
      p.foreLx = -1.1 + 0.08 * Math.sin(t * 15);
      p.foreRx = -1.1 + 0.08 * Math.sin(t * 15 + 2);
      p.headX = 0.15;
      break;
  }
}

function attack(p: Pose, actor: ActorModel, style: AttackStyle, k: number): void {
  if (style !== 'melee') {
    holdPose(p, actor, true);
    const kick = Math.max(0, 1 - k / 0.35);
    const strength = style === 'explosive' ? 0.45 : actor.right === 'heavy' ? 0.15 : 0.28;
    p.armRx -= kick * strength;
    p.torsoX -= kick * strength * 0.4;
    p.bodyZ -= style === 'explosive' ? kick * 0.12 : 0;
    return;
  }
  if (actor.right === null) {
    // A jab: guard, punch out, back to guard.
    holdPose(p, actor, true);
    const e = Math.sin(Math.PI * Math.min(1, k / 0.6));
    p.armRx = -0.7 - 0.9 * e;
    p.foreRx = -1.7 + 1.6 * e;
    p.torsoY = -0.3 * e;
    return;
  }
  const armRest = p.armRx;
  const foreRest = p.foreRx;
  if (k < 0.35) {
    const e = easeOut(k / 0.35);
    p.armRx = lerp(armRest, -2.7, e);
    p.foreRx = lerp(foreRest, -0.6, e);
    p.torsoY = 0.25 * e;
  } else if (k < 0.55) {
    const e = easeIn((k - 0.35) / 0.2);
    p.armRx = lerp(-2.7, -0.35, e);
    p.foreRx = lerp(-0.6, -0.1, e);
    p.torsoX += 0.22 * e;
    p.torsoY = lerp(0.25, -0.2, e);
  } else {
    const e = easeInOut((k - 0.55) / 0.45);
    p.armRx = lerp(-0.35, armRest, e);
    p.foreRx = lerp(-0.1, foreRest, e);
    p.torsoX += 0.22 * (1 - e);
    p.torsoY = -0.2 * (1 - e);
  }
}

function flinch(p: Pose, actor: ActorModel, h: number): void {
  const e = Math.sin(Math.PI * h);
  p.torsoX -= 0.22 * e;
  p.headX -= 0.15 * e;
  if (actor.left === null) {
    p.armLx -= 0.8 * e;
    p.foreLx -= 0.9 * e;
  }
}

function applyPose(actor: ActorModel, p: Pose, dt: number): void {
  const j = actor.joints!;
  const k = 1 - Math.exp(-BLEND_RATE * dt);
  const ease = (o: THREE.Object3D, axis: 'x' | 'y' | 'z', target: number) => {
    o.rotation[axis] += (target - o.rotation[axis]) * k;
  };
  ease(j.armL, 'x', p.armLx);
  ease(j.armL, 'z', p.armLz);
  ease(j.armR, 'x', p.armRx);
  ease(j.armR, 'z', p.armRz);
  ease(j.foreL, 'x', p.foreLx);
  ease(j.foreR, 'x', p.foreRx);
  ease(j.legL, 'x', p.legLx);
  ease(j.legR, 'x', p.legRx);
  ease(j.shinL, 'x', p.shinLx);
  ease(j.shinR, 'x', p.shinRx);
  ease(j.torso, 'x', p.torsoX);
  ease(j.torso, 'y', p.torsoY);
  ease(j.head, 'x', p.headX);
  actor.body.position.y += (p.bodyY - actor.body.position.y) * k;
  actor.body.position.z += (p.bodyZ - actor.body.position.z) * k;
}

// ── Blobs, wraiths, sock puppets ─────────────────────────────────────────────

function poseBody(actor: ActorModel, a: AnimInput): void {
  const t = a.now / 1000;
  let y = actor.motion === 'float' ? 0.25 + 0.08 * Math.sin(t * 2.2) : 0;
  let z = 0;
  let squash = 1 + 0.03 * Math.sin(t * 3);
  if (a.moving) {
    const hop = Math.abs(Math.sin(a.phase));
    if (actor.motion === 'hop') {
      y += 0.14 * hop;
      squash = 1 + 0.14 * (hop - 0.4);
    } else z = 0.05;
  }
  const k = (a.now - a.attackAt) / ATTACK_MS;
  if (k >= 0 && k < 1) {
    const e = Math.sin(Math.PI * k);
    z += 0.38 * e;
    if (actor.motion === 'float') y += 0.2 * e;
    else squash *= 1 - 0.18 * Math.sin(Math.PI * Math.min(1, k * 2));
  }
  const h = (a.now - a.hitAt) / HIT_MS;
  if (h >= 0 && h < 1) squash *= 1 - 0.14 * Math.sin(Math.PI * h);
  actor.body.position.set(0, y, z);
  const wide = 1 / Math.sqrt(squash);
  actor.body.scale.set(wide, squash, wide);
}

function fall(actor: ActorModel, ms: number): void {
  const e = easeIn(Math.min(1, ms / 450));
  const sink = Math.max(0, Math.min(1, (ms - 650) / 450));
  if (actor.joints) {
    actor.root.rotation.x = (-Math.PI / 2) * e;
    actor.root.position.y = -0.5 * sink;
    return;
  }
  const squash = Math.max(0.08, 1 - e * 0.9);
  actor.body.scale.set(1 + e * 0.4, squash, 1 + e * 0.4);
  actor.root.position.y = -0.3 * sink;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
