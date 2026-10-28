/**
 * Rigged GLB characters (Higgsfield / Meshy auto-rig: Hips, Spine, Head,
 * LeftArm, LeftForeArm, LeftUpLeg...) driven by the same procedural animation
 * as the code-built humanoids. animate.ts poses invisible proxy joints; sync()
 * copies each proxy's rotation onto its bone, after turning the A-pose arms
 * down so "rest" means arms at the sides. Held gear hangs from anchors on the
 * hand bones; worn armor shows as low-poly overlays on the bones.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { hat, type ActorModel, type Joints, type Look } from './actors';
import { box, lambert, shade } from './kit';

type ProxyName = Exclude<keyof Joints, 'handL' | 'handR'>;

const BONES: Record<ProxyName, string> = {
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
};

const PARENT: Partial<Record<ProxyName, ProxyName>> = {
  head: 'torso',
  armL: 'torso',
  armR: 'torso',
  foreL: 'armL',
  foreR: 'armR',
  shinL: 'legL',
  shinR: 'legR',
};

/** How far below the wrist the grip sits, and how wide a head is, in model meters. */
const GRIP_DROP = 0.07;
const HEAD_WIDTH = 0.3;

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
}

/** True if the model has a skeleton this adapter can drive. */
export function isRigged(model: THREE.Object3D): boolean {
  return (
    model.getObjectByName('Hips') !== undefined && model.getObjectByName('LeftArm') !== undefined
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

  const down = new THREE.Vector3(0, -1, 0);
  const armFix = (arm: string, fore: string) =>
    new THREE.Quaternion().setFromUnitVectors(worldPos(fore).sub(worldPos(arm)).normalize(), down);
  const fixL = armFix('LeftArm', 'LeftForeArm');
  const fixR = armFix('RightArm', 'RightForeArm');

  const links: Link[] = (Object.keys(BONES) as ProxyName[]).map((name) => {
    const b = bone(BONES[name]);
    const restWorld = b.getWorldQuaternion(new THREE.Quaternion());
    return {
      proxy: proxies[name],
      bone: b,
      restLocal: b.quaternion.clone(),
      restWorld,
      restWorldInv: restWorld.clone().invert(),
      fix: name === 'armL' ? fixL : name === 'armR' ? fixR : null,
      inherit: name === 'foreL' ? fixL : name === 'foreR' ? fixR : null,
    };
  });

  const q = new THREE.Quaternion();
  const sync = () => {
    for (const l of links) {
      q.copy(l.proxy.quaternion);
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

  const handL = anchor(bone('LeftHand'), down);
  const handR = anchor(bone('RightHand'), down);
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
    pose: undefined,
    rightId: null,
    right: null,
    left: null,
    muzzle: null,
    sync,
  };
  wear(model, dress, height);
  return actor;
}

/**
 * A grip anchor on a hand bone, oriented like the code-built rig's (+z down
 * the hanging arm, +y forward), so held gear fits either kind of character.
 */
function anchor(hand: THREE.Bone, down: THREE.Vector3): THREE.Group {
  const a = new THREE.Group();
  hand.add(a);
  const wrist = hand.getWorldPosition(new THREE.Vector3());
  const target = wrist.addScaledVector(down, GRIP_DROP);
  a.position.copy(hand.worldToLocal(target.clone()));
  const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  a.quaternion.copy(hand.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(want));
  const s = hand.getWorldScale(new THREE.Vector3());
  a.scale.set(1 / s.x, 1 / s.y, 1 / s.z);
  return a;
}

/** Flat-shaded matte materials, for the old-school look. */
function flatten(model: THREE.Object3D): void {
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
