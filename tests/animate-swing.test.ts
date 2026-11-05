import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ActorModel, Joints } from '../src/render/actors';
import { poseActor, SWING_OFF_ARM_BOB, swingRaise, type AnimInput } from '../src/render/animate';
import type { HoldKind } from '../src/render/gear';

/** A bare humanoid rig: just the joint groups poseActor drives. */
function rig(left: HoldKind | null = null): ActorModel {
  const g = () => new THREE.Group();
  const joints: Joints = {
    torso: g(),
    head: g(),
    armL: g(),
    armR: g(),
    foreL: g(),
    foreR: g(),
    legL: g(),
    legR: g(),
    shinL: g(),
    shinR: g(),
    handL: g(),
    handR: g(),
  };
  return {
    root: g(),
    body: g(),
    bodyY: 0,
    joints,
    height: 1.8,
    motion: 'walk',
    hunch: 0,
    pose: undefined,
    rightId: 'item_pick_steel',
    right: 'melee',
    left,
    muzzle: null,
  };
}

/** Holds the swing at cycle point `u` until the joints settle there. */
function swingAt(actor: ActorModel, u: number): Joints {
  const now = ((3 + u) / 1.1) * 1000;
  const input: AnimInput = {
    now,
    dt: 1,
    moving: false,
    running: false,
    phase: 0,
    combat: false,
    work: 'swing',
    attackAt: -Infinity,
    attackStyle: 'melee',
    hitAt: -Infinity,
    diedAt: -Infinity,
  };
  for (let i = 0; i < 4; i++) poseActor(actor, input);
  return actor.joints!;
}

describe('pickaxe swing', () => {
  it('raises only the tool arm overhead', () => {
    const top = swingAt(rig(), 0.6);
    expect(top.armR.rotation.x).toBeLessThan(-2.4);
    // The off arm stays down by the side, drifting back a little.
    expect(top.armL.rotation.x).toBeGreaterThan(0);
    expect(top.armL.rotation.x).toBeLessThan(0.3);
  });

  it('keeps the off arm near rest through the whole cycle', () => {
    const actor = rig();
    for (let u = 0; u < 1; u += 0.05) {
      const j = swingAt(actor, u);
      expect(Math.abs(j.armL.rotation.x)).toBeLessThanOrEqual(SWING_OFF_ARM_BOB + 1e-6);
      expect(j.armL.rotation.x).toBeCloseTo(SWING_OFF_ARM_BOB * swingRaise(u), 5);
      expect(Math.abs(j.armL.rotation.z - 0.06)).toBeLessThan(1e-6);
    }
  });

  it('lets a shield arm keep its hold pose', () => {
    const j = swingAt(rig('shield'), 0.6);
    expect(j.armL.rotation.x).toBeCloseTo(-0.35 + SWING_OFF_ARM_BOB, 5);
    expect(j.foreL.rotation.x).toBeCloseTo(-1.4, 5);
  });

  it('peaks overhead and rests between strikes', () => {
    expect(swingRaise(0.6)).toBe(1);
    expect(swingRaise(0)).toBe(0);
    expect(swingRaise(0.9)).toBe(0);
  });
});
