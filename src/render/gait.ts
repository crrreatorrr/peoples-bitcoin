/**
 * Foot-planted gait for characters whose leg lengths are known (rigged GLBs and
 * code-built humanoids). Each foot follows a path: on the ground it moves back
 * at exactly the ground speed, rolling heel → flat → toe; in the air it swings
 * forward to the next footfall (a low step walking, a heel kick running). The
 * hips sit as high as the planted legs reach, and two-bone IK turns the ankle
 * targets into hip, knee, ankle and toe angles. Pure math: no Three.js.
 *
 * Sagittal plane, in model units: z forward, y up, the hip joint at rest at
 * `hipY` above the ground. Angles use the joints' convention: negative x
 * rotation swings a limb forward, a positive knee angle bends it.
 */

export interface LegGeometry {
  /** Hip-to-knee and knee-to-ankle lengths in the sagittal plane. */
  thigh: number;
  shin: number;
  /** Hip joint and ankle heights above the ground at rest. */
  hipY: number;
  ankleY: number;
  /** How far the heel sits behind, and the ball of the foot in front of, the ankle. */
  heel: number;
  ball: number;
  /** Height of the toe joint at the ball of the foot, which the foot rolls over. */
  ballY: number;
  /** How far each hip joint sits out from the middle (turning the hips moves it). */
  hipX: number;
  /** How far forward of straight down the thigh and shin point at rest (radians). */
  thighRest: number;
  shinRest: number;
}

export interface LegPose {
  /** Thigh swing (x rotation, negative is forward). */
  hip: number;
  /** Knee bend (positive bends). */
  knee: number;
  /** Ankle relative to the shin (positive points the toes down). */
  ankle: number;
  /** Toes relative to the foot (negative curls them up, to stay flat at push-off). */
  toe: number;
}

export interface GaitPose {
  left: LegPose;
  right: LegPose;
  /** How far the hips sit above (+) or below (−) their rest height. */
  hipDrop: number;
  /** Hip yaw, swinging toward the forward leg. */
  hipYaw: number;
}

export interface GaitStyle {
  /** Fraction of the cycle each foot is on the ground. Under 0.5 leaves both feet in the air. */
  duty: number;
  /**
   * How much of the ground's travel a planted foot follows (1 = locked to the
   * ground). One footfall per tile is a long step for short legs; following it
   * all the way would squat the hips, so the foot gives a little instead.
   */
  plant: number;
  /** Where the stance is centred, in front of the hip (fraction of leg length). */
  reach: number;
  /** Toe-up angle at heel strike and heel-up angle at toe-off (radians). */
  heelStrike: number;
  toeOff: number;
  /** Fractions of the stance spent rolling off the heel, and when the heel starts to lift. */
  heelRoll: number;
  heelLift: number;
  /** Peak foot lift during the swing (fraction of leg length), and when it peaks (0..1). */
  lift: number;
  liftPeak: number;
  /** How much of the ground's speed the foot keeps as it leaves and before it lands (0..1). */
  retract: number;
  /** Constant knee give (fraction of leg length the hips sit lower). */
  crouch: number;
  /** Bounce of the hips: lowest mid-stance, highest mid-flight (fraction of leg length). */
  bounce: number;
  /** Planted legs reach at most this fraction of their full length (keeps a soft knee). */
  maxReach: number;
  hipYaw: number;
}

/**
 * Walking: a 1-tile step is long for these legs, so the planted foot gives 15%
 * (fully planted, the hips would bob 14 cm); the stance sits a little behind
 * the hips, where the toe roll covers the back leg.
 */
export const WALK: GaitStyle = {
  duty: 0.55,
  plant: 0.85,
  reach: -0.08,
  heelStrike: 0.45,
  toeOff: 0.9,
  heelRoll: 0.18,
  heelLift: 0.3,
  lift: 0.1,
  liftPeak: 0.4,
  retract: 0.8,
  crouch: 0.005,
  bounce: 0,
  maxReach: 0.985,
  hipYaw: 0.15,
};

/** Running: fully planted, landing under the hips, with a flight phase and a heel kick. */
export const RUN: GaitStyle = {
  duty: 0.34,
  plant: 1,
  reach: -0.08,
  heelStrike: 0.12,
  toeOff: 0.75,
  heelRoll: 0.12,
  heelLift: 0.35,
  lift: 0.42,
  liftPeak: 0.32,
  retract: 1,
  crouch: 0.06,
  bounce: 0.035,
  maxReach: 0.97,
  hipYaw: 0.18,
};

const TAU = Math.PI * 2;

/**
 * The legs at cycle angle `phase` (π per tile, as in animate.ts; the left foot
 * lands at π/2), for legs of geometry `g` crossing `tile` model units per tile.
 * `run` blends walking (0) into running (1) and `weight` standing (0) into
 * striding (1). Blends mix where the feet go, not joint angles, so planted
 * feet stay on the ground while the gait changes.
 */
export function gait(
  phase: number,
  g: LegGeometry,
  tile: number,
  run = 0,
  weight = 1,
  walkStyle: GaitStyle = WALK,
  runStyle: GaitStyle = RUN,
): GaitPose {
  const walking = stride(phase, walkStyle, g, tile);
  const s = run > 0 ? mixStride(walking, stride(phase, runStyle, g, tile), run) : walking;
  // Standing: each ankle where it rests, under the hips.
  const stand: FootTarget = {
    z: g.thigh * Math.sin(g.thighRest) + g.shin * Math.sin(g.shinRest),
    y: g.hipY - g.thigh * Math.cos(g.thighRest) - g.shin * Math.cos(g.shinRest),
    pitch: 0,
    toe: 0,
  };
  const footL = mixFoot(stand, s.left, weight);
  const footR = mixFoot(stand, s.right, weight);
  const hipYaw = s.hipYaw * weight;
  // Turning the hips carries each hip joint forward or back, which the legs make up for.
  const shift = g.hipX * Math.sin(hipYaw);
  const legLen = g.thigh + g.shin;
  const limit = lerp(1, s.maxReach, weight) * legLen;
  // The hips settle as low as the gait asks, then lower still if a foot can't reach.
  let hipY = lerp(g.hipY, s.hipY, weight);
  for (const [f, hipZ] of [
    [footL, -shift],
    [footR, shift],
  ] as const) {
    const dz = Math.min(Math.abs(f.z - hipZ), limit * 0.999);
    hipY = Math.min(hipY, f.y + Math.sqrt(limit * limit - dz * dz));
  }
  return {
    left: solve(footL, hipY, -shift, g),
    right: solve(footR, hipY, shift, g),
    hipDrop: hipY - g.hipY,
    hipYaw,
  };
}

interface Stride {
  left: FootTarget;
  right: FootTarget;
  /** Hip height the style asks for, before the feet's reach lowers it. */
  hipY: number;
  hipYaw: number;
  maxReach: number;
}

/** Where one style puts the feet and hips at `phase`. */
function stride(phase: number, style: GaitStyle, g: LegGeometry, tile: number): Stride {
  const legLen = g.thigh + g.shin;
  const uL = frac((phase - Math.PI / 2) / TAU);
  return {
    left: foot(uL, style, g, tile, legLen),
    right: foot(frac(uL + 0.5), style, g, tile, legLen),
    hipY:
      g.hipY -
      style.crouch * legLen -
      style.bounce * legLen * Math.cos(2 * TAU * (uL - style.duty / 2)),
    // Hips turn with the forward leg: the left (+x) leading turns them by −y.
    hipYaw: -style.hipYaw * Math.sin(phase),
    maxReach: style.maxReach,
  };
}

function mixStride(a: Stride, b: Stride, t: number): Stride {
  return {
    left: mixFoot(a.left, b.left, t),
    right: mixFoot(a.right, b.right, t),
    hipY: lerp(a.hipY, b.hipY, t),
    hipYaw: lerp(a.hipYaw, b.hipYaw, t),
    maxReach: lerp(a.maxReach, b.maxReach, t),
  };
}

function mixFoot(a: FootTarget, b: FootTarget, t: number): FootTarget {
  return {
    z: lerp(a.z, b.z, t),
    y: lerp(a.y, b.y, t),
    pitch: lerp(a.pitch, b.pitch, t),
    toe: lerp(a.toe, b.toe, t),
  };
}

interface FootTarget {
  /** Ankle position relative to the point on the ground under the hip. */
  z: number;
  y: number;
  /** Foot pitch: positive lifts the toes, negative the heel. */
  pitch: number;
  /** Toe bend that keeps the toes flat on the ground (≤ 0). */
  toe: number;
}

/** Where one foot's ankle is at its own cycle position `u` (0 = heel strike). */
export function foot(
  u: number,
  s: GaitStyle,
  g: LegGeometry,
  tile: number,
  legLen: number,
): FootTarget {
  // On the ground the foot moves back at the ground speed: 2 tiles per cycle.
  const speed = 2 * tile * s.plant;
  const travel = speed * s.duty;
  const centre = s.reach * legLen;
  if (u < s.duty) return planted(u / s.duty, centre + travel / 2 - speed * u, s, g);

  const start = planted(1, centre - travel / 2, s, g);
  const end = planted(0, centre + travel / 2, s, g);
  const k = (u - s.duty) / (1 - s.duty);
  // The foot leaves and lands moving back with the ground (no slap at touchdown):
  // it carries on back after toe-off (the heel kick), swings through, then draws
  // back just before it lands.
  const groundVel = -speed * (1 - s.duty) * s.retract;
  const lift = s.lift * legLen * bump(k, s.liftPeak);
  const toeEase = 1 - smooth(clamp01(k / 0.3));
  return {
    z: hermite(start.z, groundVel, end.z, groundVel, k),
    y: lerp(start.y, end.y, k) + lift,
    pitch: lerp(start.pitch, end.pitch, smooth(k)),
    toe: start.toe * toeEase,
  };
}

/**
 * A foot on the ground, `t` of the way through its stance, its flat footprint
 * (the point under the ankle when flat) at `print`. It pivots on the heel after
 * landing and on the ball before lifting off; both pivots stay put on the ground.
 */
function planted(t: number, print: number, s: GaitStyle, g: LegGeometry): FootTarget {
  if (t < s.heelRoll) {
    const pitch = s.heelStrike * (1 - smooth(t / s.heelRoll));
    const [z, y] = rotate(g.heel, g.ankleY, pitch);
    return { z: print - g.heel + z, y, pitch, toe: 0 };
  }
  if (t > s.heelLift) {
    // The toes stay flat; the foot turns about the toe joint.
    const pitch = -s.toeOff * easeIn((t - s.heelLift) / (1 - s.heelLift));
    const [z, y] = rotate(-g.ball, g.ankleY - g.ballY, pitch);
    return { z: print + g.ball + z, y: g.ballY + y, pitch, toe: pitch };
  }
  return { z: print, y: g.ankleY, pitch: 0, toe: 0 };
}

/** Two-bone IK: hip and knee angles that put the ankle on target, then the foot's own angles. */
function solve(f: FootTarget, hipY: number, hipZ: number, g: LegGeometry): LegPose {
  const dz = f.z - hipZ;
  const dy = f.y - hipY;
  const max = (g.thigh + g.shin) * 0.9999;
  const min = Math.abs(g.thigh - g.shin) + 1e-4;
  const d = Math.min(max, Math.max(min, Math.hypot(dz, dy)));
  const cosKnee = (d * d - g.thigh * g.thigh - g.shin * g.shin) / (2 * g.thigh * g.shin);
  const knee = Math.acos(clamp(cosKnee, -1, 1));
  // Forward of straight down to the ankle, plus the extra the bent knee needs.
  const toAnkle = Math.atan2(dz, -dy);
  const lead = Math.asin(clamp((g.shin * Math.sin(knee)) / d, -1, 1));
  const thighAngle = toAnkle + lead;
  const shinAngle = thighAngle - knee;
  // Joint turns are relative to the rest pose, whose leg isn't quite straight down.
  const hip = g.thighRest - thighAngle;
  const bend = g.shinRest - shinAngle - hip;
  return { hip, knee: bend, ankle: -f.pitch - hip - bend, toe: f.toe };
}

const frac = (x: number) => x - Math.floor(x);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const clamp01 = (x: number) => clamp(x, 0, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const easeIn = (t: number) => t * t;
/** 0 at both ends, 1 at `peak`. */
const bump = (t: number, peak: number) =>
  Math.sin(Math.PI * (t < peak ? (0.5 * t) / peak : 0.5 + (0.5 * (t - peak)) / (1 - peak)));
/** Cubic from `a` to `b` leaving at slope `da` and arriving at slope `db`. */
function hermite(a: number, da: number, b: number, db: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * da + (-2 * t3 + 3 * t2) * b + (t3 - t2) * db
  );
}

/** Rotates (z, y) by `a` (positive lifts +z). */
function rotate(z: number, y: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [z * c - y * s, z * s + y * c];
}
