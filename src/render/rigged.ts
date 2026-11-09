/**
 * Rigged GLB characters (Higgsfield / Meshy auto-rig: Hips, Spine, Head,
 * LeftArm, LeftForeArm, LeftUpLeg...) driven by the same procedural animation
 * as the code-built humanoids. animate.ts poses invisible proxy joints; sync()
 * copies each proxy's rotation onto its bone, after turning the A-pose arms
 * down so "rest" means arms at the sides. Held gear hangs from anchors on the
 * hand bones; worn armor shows as low-poly overlays on the bones. The mesh
 * already shows clothes and hats, so only `left`, `right`, `pose` and worn
 * armor are read from the look.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { hat, holdRight, type ActorModel, type Joints, type Look } from './actors';
import type { LegGeometry } from './gait';
import { gearModel } from './gear';
import { box, lambert, shade } from './kit';

type ProxyName = Exclude<keyof Joints, 'handL' | 'handR'>;

const BONES: Record<ProxyName, string> = {
  hips: 'Hips',
  torso: 'Spine',
  head: 'Head',
  armL: 'LeftArm',
  foreL: 'LeftForeArm',
  armR: 'RightArm',
  foreR: 'RightForeArm',
  legL: 'LeftUpLeg',
  shinL: 'LeftLeg',
  legR: 'RightUpLeg',
  shinR: 'RightLeg',
  footL: 'LeftFoot',
  footR: 'RightFoot',
  toeL: 'LeftToeBase',
  toeR: 'RightToeBase',
};

/**
 * The torso joint bends the whole back: its turn is shared out along these
 * bones (hips to chest), so a lean curves the spine instead of pivoting at the
 * shoulders.
 */
const SPINE = ['Spine02', 'Spine01', 'Spine'];

const PARENT: Partial<Record<ProxyName, ProxyName>> = {
  torso: 'hips',
  legL: 'hips',
  legR: 'hips',
  head: 'torso',
  armL: 'torso',
  armR: 'torso',
  foreL: 'armL',
  foreR: 'armR',
  shinL: 'legL',
  shinR: 'legR',
  footL: 'shinL',
  footR: 'shinR',
  toeL: 'footL',
  toeR: 'footR',
};

/** How far below the wrist the grip sits, and how wide a head is, in model meters. */
const GRIP_DROP = 0.07;
const HEAD_WIDTH = 0.3;
/** Height of a code-built humanoid at scale 1: held gear is sized for it. */
const GEAR_HEIGHT = 1.83;

interface Link {
  proxy: THREE.Object3D;
  bone: THREE.Bone;
  restLocal: THREE.Quaternion;
  restWorld: THREE.Quaternion;
  restWorldInv: THREE.Quaternion;
  /** Upper arms: turns the A-pose arm down to hang at the side. */
  fix: THREE.Quaternion | null;
  /** Forearms: the parent arm's fix, so elbows bend in the arms-down frame. */
  inherit: THREE.Quaternion | null;
  /** Share of the joint's turn this bone takes (the spine splits the torso's). */
  share: number;
}

/** True if the model has a skeleton this adapter can drive. */
export function isRigged(model: THREE.Object3D): boolean {
  return [...Object.values(BONES), ...SPINE, 'LeftHand', 'RightHand'].every(
    (name) => model.getObjectByName(name) !== undefined,
  );
}

export function riggedActor(
  source: THREE.Object3D,
  scale: number,
  dress: Partial<Look> = {},
): ActorModel {
  const model = cloneSkinned(source);
  flatten(model);
  const body = new THREE.Group();
  const root = new THREE.Group();
  body.add(model);
  root.add(body);
  root.updateMatrixWorld(true);

  const bone = (name: string) => model.getObjectByName(name) as THREE.Bone;
  // Face +z: the character's left arm belongs on +x.
  if (bone('LeftArm').getWorldPosition(new THREE.Vector3()).x < 0) {
    model.rotation.y += Math.PI;
    root.updateMatrixWorld(true);
  }
  const height = new THREE.Box3().setFromObject(model).max.y;

  // Invisible proxy joints, placed where the bones are, for animate.ts to pose.
  const proxyRoot = new THREE.Group();
  body.add(proxyRoot);
  const proxies = {} as Record<ProxyName, THREE.Group>;
  const worldPos = (name: string) => bone(name).getWorldPosition(new THREE.Vector3());
  for (const name of Object.keys(BONES) as ProxyName[]) {
    proxies[name] = new THREE.Group();
  }
  for (const name of Object.keys(BONES) as ProxyName[]) {
    const parentName = PARENT[name];
    const at = worldPos(BONES[name]);
    if (parentName) at.sub(worldPos(BONES[parentName]));
    proxies[name].position.copy(at);
    (parentName ? proxies[parentName] : proxyRoot).add(proxies[name]);
  }
  // Legs turn against the hips' yaw first, so they still swing along the path.
  proxies.legL.rotation.order = 'YXZ';
  proxies.legR.rotation.order = 'YXZ';

  const down = new THREE.Vector3(0, -1, 0);
  const armFix = (arm: string, fore: string) =>
    new THREE.Quaternion().setFromUnitVectors(worldPos(fore).sub(worldPos(arm)).normalize(), down);
  const fixL = armFix('LeftArm', 'LeftForeArm');
  const fixR = armFix('RightArm', 'RightForeArm');

  const link = (proxy: ProxyName, boneName: string, share = 1): Link => {
    const b = bone(boneName);
    const restWorld = b.getWorldQuaternion(new THREE.Quaternion());
    return {
      proxy: proxies[proxy],
      bone: b,
      restLocal: b.quaternion.clone(),
      restWorld,
      restWorldInv: restWorld.clone().invert(),
      fix: proxy === 'armL' ? fixL : proxy === 'armR' ? fixR : null,
      inherit: proxy === 'foreL' ? fixL : proxy === 'foreR' ? fixR : null,
      share,
    };
  };
  const links: Link[] = (Object.keys(BONES) as ProxyName[])
    .filter((name) => name !== 'torso')
    .map((name) => link(name, BONES[name]));
  for (const name of SPINE) links.push(link('torso', name, 1 / SPINE.length));

  const q = new THREE.Quaternion();
  const none = new THREE.Quaternion();
  const sync = () => {
    for (const l of links) {
      q.copy(l.proxy.quaternion);
      if (l.share < 1) q.slerpQuaternions(none, l.proxy.quaternion, l.share);
      if (l.fix) q.multiply(l.fix);
      if (l.inherit) q.premultiply(l.inherit.clone().invert()).multiply(l.inherit);
      // bone = restLocal · (restWorld⁻¹ · q · restWorld): rotate about character axes.
      l.bone.quaternion
        .copy(l.restLocal)
        .multiply(l.restWorldInv.clone().multiply(q).multiply(l.restWorld));
    }
  };
  sync();
  root.updateMatrixWorld(true);

  const gearScale = height / GEAR_HEIGHT;
  const handL = anchor(bone('LeftHand'), down, gearScale);
  const handR = anchor(bone('RightHand'), down, gearScale);
  const joints: Joints = { ...proxies, handL, handR };
  root.scale.setScalar(scale);
  const actor: ActorModel = {
    root,
    body,
    bodyY: 0,
    joints,
    height: height * scale,
    motion: 'walk',
    hunch: 0,
    pose: dress.pose,
    rightId: null,
    right: null,
    left: null,
    muzzle: null,
    sync,
    legs: legGeometry(model, worldPos),
  };
  wear(model, dress, height);
  const left = dress.left ? gearModel(dress.left) : null;
  if (left) {
    handL.add(left.model);
    actor.left = left.hold;
  }
  holdRight(actor, dress.right ?? null);
  return actor;
}

/**
 * Leg lengths and rest angles in the side view, averaged over both legs, from
 * the rest skeleton; the heel is the back of the shoe's sole.
 */
function legGeometry(model: THREE.Object3D, at: (bone: string) => THREE.Vector3): LegGeometry {
  const side = (s: 'Left' | 'Right') => {
    const hip = at(`${s}UpLeg`);
    const knee = at(`${s}Leg`);
    const ankle = at(`${s}Foot`);
    const ball = at(`${s}ToeBase`);
    const span = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.y - b.y, a.z - b.z);
    const lean = (a: THREE.Vector3, b: THREE.Vector3) => Math.atan2(b.z - a.z, a.y - b.y);
    return {
      thigh: span(hip, knee),
      shin: span(knee, ankle),
      hipY: hip.y,
      ankleY: ankle.y,
      // No foot-weighted sole found: about half as far back as the ball is forward.
      heel: ankle.z - Math.min(soleBack(model, s, ankle.y), ankle.z + 0.5 * (ankle.z - ball.z)),
      ball: ball.z - ankle.z,
      ballY: ball.y,
      hipX: Math.abs(hip.x),
      thighRest: lean(hip, knee),
      shinRest: lean(knee, ankle),
    };
  };
  const l = side('Left');
  const r = side('Right');
  return Object.fromEntries(
    Object.entries(l).map(([k, v]) => [k, (v + r[k as keyof LegGeometry]) / 2]),
  ) as unknown as LegGeometry;
}

/** The z of the back of a shoe: its rearmost sole vertex, weighted mostly to the foot. */
function soleBack(model: THREE.Object3D, side: 'Left' | 'Right', ankleY: number): number {
  let back = Infinity;
  const v = new THREE.Vector3();
  model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const foot = mesh.skeleton.bones.findIndex((b) => b.name === `${side}Foot`);
    const index = mesh.geometry.getAttribute('skinIndex');
    const weight = mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < index.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++)
        if (index.getComponent(i, k) === foot) w = weight.getComponent(i, k);
      if (w < 0.5) continue;
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      // Sole level only: a coat hem or cuff weighted to the foot isn't the heel.
      if (v.y < ankleY * 0.4) back = Math.min(back, v.z);
    }
  });
  return back;
}

/**
 * A grip anchor on a hand bone, oriented like the code-built rig's (+z down
 * the hanging arm, +y forward), so held gear fits either kind of character.
 * `size` shrinks gear for small characters and grows it for big ones.
 */
function anchor(hand: THREE.Bone, down: THREE.Vector3, size: number): THREE.Group {
  const a = new THREE.Group();
  hand.add(a);
  const wrist = hand.getWorldPosition(new THREE.Vector3());
  const target = wrist.addScaledVector(down, GRIP_DROP * size);
  a.position.copy(hand.worldToLocal(target.clone()));
  const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  a.quaternion.copy(hand.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(want));
  const s = hand.getWorldScale(new THREE.Vector3());
  a.scale.set(size / s.x, size / s.y, size / s.z);
  return a;
}

/** Flat-shaded matte materials, for the old-school look. */
export function flatten(model: THREE.Object3D): void {
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const old = mesh.material as THREE.MeshStandardMaterial;
    mesh.material = new THREE.MeshLambertMaterial({
      map: old.map ?? null,
      color: old.map ? '#ffffff' : old.color,
      flatShading: true,
    });
    mesh.frustumCulled = false; // posed limbs can leave the bind-pose bounds
  });
}

/** Worn armor as overlays on the bones: hats, vests, plates, greaves, gloves, boots, pendants. */
function wear(model: THREE.Object3D, look: Partial<Look>, height: number): void {
  const on = (name: string, at: THREE.Vector3) => {
    const b = model.getObjectByName(name) as THREE.Bone | undefined;
    if (!b) return null;
    const g = new THREE.Group();
    b.add(g);
    g.position.copy(b.worldToLocal(at.clone()));
    g.quaternion.copy(b.getWorldQuaternion(new THREE.Quaternion()).invert());
    const s = b.getWorldScale(new THREE.Vector3());
    g.scale.set(1 / s.x, 1 / s.y, 1 / s.z);
    return g;
  };
  const pos = (name: string) =>
    (model.getObjectByName(name) as THREE.Bone).getWorldPosition(new THREE.Vector3());

  if (look.hat) {
    const top = pos('Head');
    top.y = height - 0.05;
    const g = on('Head', top);
    if (g) hat(g, look.hat, look.hatColor ?? '#4b5a2e', 0, HEAD_WIDTH);
  }
  const chest = pos('Spine02');
  if (look.vest) on('Spine02', chest)?.add(box(0.5, 0.42, 0.34, lambert(look.vest), 0, -0.05, 0));
  if (look.plate) {
    const mat = lambert(look.plate, { emissive: shade(look.plate, 0.35) });
    on('Spine02', chest)?.add(box(0.46, 0.34, 0.06, mat, 0, -0.02, 0.17));
  }
  if (look.neck)
    on('Spine02', chest)?.add(box(0.07, 0.08, 0.03, lambert(look.neck), 0, 0.08, 0.17));
  for (const side of ['Left', 'Right']) {
    if (look.greaves) {
      on(`${side}Leg`, pos(`${side}Leg`))?.add(
        box(
          0.16,
          0.3,
          0.06,
          lambert(look.greaves, { emissive: shade(look.greaves, 0.3) }),
          0,
          -0.2,
          0.09,
        ),
      );
    }
    if (look.feet)
      on(`${side}Foot`, pos(`${side}Foot`))?.add(
        box(0.16, 0.1, 0.26, lambert(look.feet), 0, -0.03, 0.04),
      );
    if (look.hands)
      on(`${side}Hand`, pos(`${side}Hand`))?.add(
        box(0.13, 0.12, 0.13, lambert(look.hands), 0, -0.06, 0),
      );
  }
}
