import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildActor } from '../src/render/actors';
import { poseActor, type AnimInput } from '../src/render/animate';
import {
  foot,
  gait,
  plantFor,
  PRESIDENT_RUN,
  PRESIDENT_WALK,
  RUN,
  WALK,
  type LegGeometry,
  type LegPose,
} from '../src/render/gait';

/** The President's legs (player_president.glb), rest legs leaning slightly forward. */
const LEGS: LegGeometry = {
  thigh: 0.36,
  shin: 0.373,
  hipY: 0.875,
  ankleY: 0.143,
  heel: 0.052,
  ball: 0.097,
  ballY: 0.043,
  hipX: 0.109,
  thighRest: 0.076,
  shinRest: 0.042,
};
const LEG = LEGS.thigh + LEGS.shin;
const TILE = 1;
const TAU = Math.PI * 2;

/** Where the joint angles actually put the ankle, relative to the point under the hip joint. */
function ankle(
  p: LegPose,
  hipY: number,
  hipZ = 0,
  g = LEGS,
): { z: number; y: number; footPitch: number } {
  const thigh = g.thighRest - p.hip;
  const shin = g.shinRest - p.hip - p.knee;
  return {
    z: hipZ + g.thigh * Math.sin(thigh) + g.shin * Math.sin(shin),
    y: hipY - g.thigh * Math.cos(thigh) - g.shin * Math.cos(shin),
    footPitch: -(p.hip + p.knee + p.ankle),
  };
}

/** Left foot's cycle position at `phase` (it lands at π/2). */
const uLeft = (phase: number) => ((((phase - Math.PI / 2) / TAU) % 1) + 1) % 1;

describe('foot-planted gait', () => {
  for (const [name, style, running] of [
    ['walk', WALK, false],
    ['run', RUN, true],
  ] as const) {
    it(`${name}: the joint angles put each ankle where the foot path says`, () => {
      for (let i = 0; i < 64; i++) {
        const phase = (i / 64) * TAU;
        const g = gait(phase, LEGS, TILE, running ? 1 : 0);
        const shift = LEGS.hipX * Math.sin(g.hipYaw);
        const want = foot(uLeft(phase), style, LEGS, TILE, LEG, plantFor(style, LEGS, TILE));
        const got = ankle(g.left, LEGS.hipY + g.hipDrop, -shift);
        expect(got.z).toBeCloseTo(want.z, 3);
        expect(got.y).toBeCloseTo(want.y, 3);
        expect(got.footPitch).toBeCloseTo(want.pitch, 5);
      }
    });

    it(`${name}: a planted foot moves back with the ground and never sinks`, () => {
      const n = 400;
      const du = 1 / n;
      for (let i = 0; i < n * style.duty - 1; i++) {
        const a = foot(i * du, style, LEGS, TILE, LEG);
        const b = foot((i + 1) * du, style, LEGS, TILE, LEG);
        expect(a.y).toBeGreaterThanOrEqual(LEGS.ankleY - 1e-9);
        // Flat on the ground, the ankle travels exactly with the planted share of the ground.
        if (a.pitch === 0 && b.pitch === 0) {
          expect((b.z - a.z) / du).toBeCloseTo(-2 * TILE * style.plant, 6);
          expect(a.y).toBeCloseTo(LEGS.ankleY, 9);
        }
      }
    });

    it(`${name}: the legs always reach, with the knee never past straight`, () => {
      for (let i = 0; i < 200; i++) {
        const g = gait((i / 200) * TAU, LEGS, TILE, running ? 1 : 0);
        for (const leg of [g.left, g.right]) {
          // Straight is the rest bend (the rest shin leans less than the thigh).
          expect(leg.knee).toBeGreaterThan(LEGS.shinRest - LEGS.thighRest - 1e-6);
        }
        expect(g.hipDrop).toBeLessThanOrEqual(0);
        expect(g.hipDrop).toBeGreaterThan(-0.12 * LEG * 2);
      }
    });
  }

  it('short legs plant less of the step instead of squatting', () => {
    // A Sproto: legs a quarter as long, the same one-tile step.
    const short: LegGeometry = {
      ...LEGS,
      thigh: 0.118,
      shin: 0.078,
      hipY: 0.251,
      ankleY: 0.056,
      heel: 0.03,
      ball: 0.05,
      ballY: 0.006,
      hipX: 0.076,
      thighRest: -0.01,
      shinRest: -0.056,
    };
    const len = short.thigh + short.shin;
    for (const [style, running] of [
      [WALK, false],
      [RUN, true],
    ] as const) {
      expect(plantFor(style, short, TILE)).toBeLessThan(0.5);
      expect(plantFor(style, LEGS, TILE)).toBeGreaterThan(0.8);
      for (let i = 0; i < 100; i++) {
        const g = gait((i / 100) * TAU, short, TILE, running ? 1 : 0);
        expect(g.hipDrop).toBeGreaterThanOrEqual(-style.maxDrop * len - 1e-9);
      }
    }
  });

  it('walking always has a foot down; running has a moment with both feet up', () => {
    const down = (u: number, duty: number) => u < duty;
    let walkAir = 0;
    let runAir = 0;
    for (let i = 0; i < 360; i++) {
      const u = i / 360;
      if (!down(u, WALK.duty) && !down((u + 0.5) % 1, WALK.duty)) walkAir++;
      if (!down(u, RUN.duty) && !down((u + 0.5) % 1, RUN.duty)) runAir++;
    }
    expect(walkAir).toBe(0);
    expect(runAir).toBeGreaterThan(0);
  });

  it('standing (weight 0) is the rest pose', () => {
    const g = gait(1.3, LEGS, TILE, 0.5, 0);
    for (const leg of [g.left, g.right]) {
      expect(leg.hip).toBeCloseTo(0, 3);
      expect(leg.knee).toBeCloseTo(0, 3);
      expect(leg.ankle).toBeCloseTo(0, 3);
      expect(leg.toe).toBeCloseTo(0, 9);
    }
    expect(g.hipDrop).toBeCloseTo(0, 3);
    expect(g.hipYaw).toBeCloseTo(0, 9);
  });

  it('the left foot lands as the left leg is furthest forward (phase π/2)', () => {
    const at = foot(uLeft(Math.PI / 2), WALK, LEGS, TILE, LEG);
    const later = foot(uLeft(Math.PI / 2 + 1), WALK, LEGS, TILE, LEG);
    expect(at.pitch).toBeGreaterThan(0); // heel down, toes up
    expect(at.z).toBeGreaterThan(later.z);
  });

  it('the President uses both shoe pivots and plants nearly the full walking stride', () => {
    const left = { ...LEGS, heel: 0.197, ball: 0.103, shinRest: 0.031 };
    const right = { ...LEGS, heel: 0.205, ball: 0.092, shinRest: 0.053 };
    const plant = Math.min(
      plantFor(PRESIDENT_WALK, left, TILE),
      plantFor(PRESIDENT_WALK, right, TILE),
    );
    expect(plant).toBeGreaterThan(0.96);

    for (const phase of [0.55, 2.13, 3.22, 4.95, 5.46]) {
      const pose = gait(phase, { left, right }, TILE, 0, 1, PRESIDENT_WALK);
      for (const [side, g, offset] of [
        ['left', left, 0],
        ['right', right, 0.5],
      ] as const) {
        const want = foot((uLeft(phase) + offset) % 1, PRESIDENT_WALK, g, TILE, LEG, plant);
        const shift = (side === 'left' ? -1 : 1) * g.hipX * Math.sin(pose.hipYaw);
        const got = ankle(pose[side], g.hipY + pose.hipDrop, shift, g);
        expect(got.z).toBeCloseTo(want.z, 3);
        expect(got.y).toBeCloseTo(want.y, 3);
      }
    }
  });

  it('matches ground speed just before a running foot lands', () => {
    const u = 0.98;
    const du = 0.001;
    const a = foot(u, PRESIDENT_RUN, LEGS, TILE, LEG);
    const b = foot(u + du, PRESIDENT_RUN, LEGS, TILE, LEG);
    expect((b.z - a.z) / du).toBeCloseTo(-2 * TILE, 6);
  });

  it('keeps the same supporting foot when movement resumes during a stop', () => {
    const actor = buildActor({ placeholder: 'humanoid', color: '#777', scale: 1 })!;
    actor.playerLocomotion = true;
    const input: AnimInput = {
      now: 0,
      dt: 1 / 60,
      moving: true,
      running: true,
      phase: 1.3,
      combat: false,
      work: null,
      attackAt: -Infinity,
      attackStyle: 'melee',
      hitAt: -Infinity,
      diedAt: -Infinity,
    };
    for (let i = 0; i < 20; i++) poseActor(actor, input);
    for (let i = 0; i < 7; i++) poseActor(actor, { ...input, moving: false });
    const before = actor.joints!.footL!.getWorldPosition(new THREE.Vector3());
    const support = actor.supportFoot;
    poseActor(actor, { ...input, dt: 1 / 240 });
    const after = actor.joints!.footL!.getWorldPosition(new THREE.Vector3());
    expect(actor.supportFoot).toBe(support);
    expect(after.distanceTo(before)).toBeLessThan(0.025);
  });
});
