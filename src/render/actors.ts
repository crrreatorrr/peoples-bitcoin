/**
 * Characters built in code. Humanoids get a jointed rig (hips, knees,
 * shoulders, elbows, neck) that animate.ts poses each frame; their look comes
 * from the manifest's `look` block, and equipped armor and held gear change it.
 * Blobs, wraiths and sock puppets have no joints and move their whole body.
 */
import * as THREE from 'three';
import { z } from 'zod';
import { ARMOR_LOOKS, gearModel, MUZZLE, type HoldKind } from './gear';
import { blob, box, canvasTexture, cone, glow, group, lambert, shade, tube } from './kit';

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const LookSchema = z.object({
  head: z
    .enum(['human', 'goblin', 'phone', 'bear', 'sproto', 'robot', 'blob', 'rock'])
    .default('human'),
  skin: Color.default('#d9a57a'),
  hair: Color.default('#3a2a1c'),
  hairStyle: z
    .enum(['short', 'slick', 'long', 'bun', 'ponytail', 'spiky', 'bald'])
    .default('short'),
  /** Jacket or shirt. */
  top: Color.default('#4a5568'),
  /** Defaults to the coat, else the top. */
  sleeves: Color.optional(),
  /** Collar showing at the neck. */
  shirt: Color.optional(),
  tie: Color.optional(),
  pants: Color.default('#2b2b33'),
  shoes: Color.default('#1a1a1a'),
  /** A long coat over the top, down to the knees. */
  coat: Color.optional(),
  /** Overall bib and straps. */
  bib: Color.optional(),
  belt: Color.optional(),
  /** Tracksuit stripes. */
  stripes: Color.optional(),
  hood: z.boolean().default(false),
  hat: z
    .enum([
      'cap',
      'hardhat',
      'drill',
      'fedora',
      'helmet',
      'medic',
      'leafy',
      'boonie',
      'officer',
      'headset',
      'helm',
      'tophat',
    ])
    .optional(),
  hatColor: Color.optional(),
  glasses: z.enum(['round', 'shades', 'aviators']).optional(),
  mustache: Color.optional(),
  /** A bandit's band across the eyes. */
  mask: Color.optional(),
  /** A scarf over the mouth. */
  scarf: Color.optional(),
  /** Glowing eyes, for monsters. */
  eyes: Color.optional(),
  hands: Color.optional(),
  vest: Color.optional(),
  plate: Color.optional(),
  /** A pendant or lanyard on the chest. */
  neck: Color.optional(),
  /** Boots over the shoes. */
  feet: Color.optional(),
  pads: Color.optional(),
  greaves: Color.optional(),
  /** Gear ids (see gear.ts) held in each hand. */
  right: z.string().optional(),
  left: z.string().optional(),
  back: z.enum(['backpack', 'rug', 'spines']).optional(),
  pose: z.enum(['phone']).optional(),
  build: z.number().positive().default(1),
  legs: z.number().positive().default(1),
  headSize: z.number().positive().default(1),
  /** Forward lean of the upper body, in radians. */
  hunch: z.number().default(0),
});

export type Look = z.output<typeof LookSchema>;

/** Inputs to buildActor that come from the manifest entry. */
export interface ActorSpec {
  placeholder?: string;
  look?: Look;
  /** Picks a version of a builder, e.g. the Sludge Mother's crown. */
  variant?: string;
  color: string;
  accent?: string;
  scale: number;
}

export interface Joints {
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  shinL: THREE.Group;
  shinR: THREE.Group;
  handL: THREE.Group;
  handR: THREE.Group;
}

/** walk: legs and arms; hop: the body bounces; float: the body hovers. */
export type Motion = 'walk' | 'hop' | 'float';

export interface ActorModel {
  /** Pivot at the feet: falls over on death. */
  root: THREE.Group;
  /** Bobs, leans, lunges and squashes. */
  body: THREE.Group;
  bodyY: number;
  joints: Joints | null;
  height: number;
  motion: Motion;
  hunch: number;
  pose: Look['pose'];
  rightId: string | null;
  right: HoldKind | null;
  left: HoldKind | null;
  muzzle: THREE.Object3D | null;
  /** Rigged GLBs copy the posed joints onto their bones after each pose. */
  sync?: () => void;
}

export const ACTOR_KINDS = new Set(['humanoid', 'sludge', 'wraith', 'sock']);

/** Builds an actor, or null if the spec isn't an actor kind. `dress` overrides the look. */
export function buildActor(spec: ActorSpec, dress: Partial<Look> = {}): ActorModel | null {
  let actor: ActorModel;
  switch (spec.placeholder) {
    case 'humanoid':
      actor = humanoid({ ...LookSchema.parse({}), ...spec.look, ...dress });
      break;
    case 'sludge':
      actor = sludge(spec);
      break;
    case 'wraith':
      actor = wraith(spec);
      break;
    case 'sock':
      actor = sock(spec);
      break;
    default:
      return null;
  }
  actor.root.scale.setScalar(spec.scale);
  actor.height *= spec.scale;
  return actor;
}

/** Wraps any model (a GLB, a prop) so it can move like a hopping (or floating) actor. */
export function staticActor(model: THREE.Object3D, motion: Motion = 'hop'): ActorModel {
  const body = group([model]);
  const root = group([body]);
  const height = Math.max(0.5, new THREE.Box3().setFromObject(root).max.y);
  return { ...noHands(), root, body, bodyY: 0, joints: null, height, motion, hunch: 0 };
}

function noHands() {
  return { rightId: null, right: null, left: null, muzzle: null, pose: undefined };
}

/** The look a character has with these items worn (head, body and legs slots). */
export function dressFor(worn: readonly (string | null | undefined)[]): Partial<Look> {
  const dress: Record<string, string> = {};
  for (const id of worn) if (id) Object.assign(dress, ARMOR_LOOKS[id]);
  return dress as Partial<Look>;
}

/** Puts a weapon or tool in the right hand (null empties it). */
export function holdRight(actor: ActorModel, id: string | null): void {
  if (!actor.joints || actor.rightId === id) return;
  const hand = actor.joints.handR;
  hand.clear();
  actor.rightId = id;
  actor.right = null;
  actor.muzzle = null;
  const gear = id ? gearModel(id) : null;
  if (!gear) return;
  hand.add(gear.model);
  actor.right = gear.hold;
  actor.muzzle = gear.model.getObjectByName(MUZZLE) ?? null;
}

// ── Humanoids ────────────────────────────────────────────────────────────────

function joint(x = 0, y = 0, z = 0): THREE.Group {
  return group([], x, y, z);
}

function humanoid(look: Look): ActorModel {
  const W = look.build;
  const thigh = 0.42 * look.legs;
  const shin = 0.36 * look.legs;
  const hipY = thigh + shin + 0.07;
  const torsoH = 0.56;
  const torsoW = 0.46 * W;
  const torsoD = 0.26 * W;
  const front = torsoD / 2;

  const outer = look.coat ?? look.top;
  const sleeve = lambert(look.sleeves ?? outer);
  const pants = lambert(look.pants);
  const shoe = lambert(look.feet ?? look.shoes);
  const hand = lambert(look.hands ?? look.skin);

  const body = joint(0, hipY, 0);
  const root = group([body]);

  const legs = ([1, -1] as const).map((side) => {
    const leg = joint(side * 0.11 * W, 0, 0);
    const knee = joint(0, -thigh, 0);
    leg.add(box(0.17 * W, thigh, 0.2, pants, 0, -thigh / 2, 0), knee);
    knee.add(
      box(0.16 * W, shin, 0.19, pants, 0, -shin / 2, 0),
      box(0.18 * W, 0.08, 0.28, shoe, 0, -shin - 0.03, 0.04),
    );
    if (look.coat)
      leg.add(box(0.22 * W, thigh + 0.1, 0.25, lambert(look.coat), 0, -thigh / 2 - 0.03, 0));
    if (look.stripes)
      leg.add(box(0.02, thigh, 0.05, lambert(look.stripes), side * 0.09 * W, -thigh / 2, 0));
    if (look.pads) knee.add(box(0.15 * W, 0.1, 0.05, lambert(look.pads), 0, -0.02, 0.11));
    if (look.greaves) {
      knee.add(
        box(
          0.18 * W,
          shin * 0.8,
          0.06,
          lambert(look.greaves, { emissive: shade(look.greaves, 0.3) }),
          0,
          -shin / 2,
          0.1,
        ),
      );
    }
    body.add(leg);
    return { leg, knee };
  });

  const torso = joint(0, 0.02, 0);
  torso.rotation.x = look.hunch;
  body.add(torso);
  torso.add(box(torsoW, torsoH, torsoD, lambert(outer), 0, torsoH / 2, 0));
  const collar = look.coat ? look.top : look.shirt;
  if (collar) torso.add(box(0.16 * W, 0.2, 0.01, lambert(collar), 0, torsoH - 0.12, front + 0.004));
  if (look.tie) torso.add(box(0.06, 0.3, 0.01, lambert(look.tie), 0, torsoH - 0.2, front + 0.009));
  if (look.belt) torso.add(box(torsoW + 0.02, 0.06, torsoD + 0.02, lambert(look.belt), 0, 0.05, 0));
  if (look.stripes)
    torso.add(box(0.03, torsoH, 0.01, lambert(look.stripes), 0, torsoH / 2, front + 0.004));
  if (look.bib) {
    const bib = lambert(look.bib);
    torso.add(box(torsoW * 0.7, 0.26, 0.012, bib, 0, 0.16, front + 0.006));
    for (const side of [1, -1]) {
      torso.add(
        box(0.05, torsoH - 0.2, 0.012, bib, side * torsoW * 0.28, torsoH - 0.18, front + 0.006),
      );
    }
  }
  if (look.vest)
    torso.add(
      box(torsoW + 0.06, torsoH * 0.7, torsoD + 0.06, lambert(look.vest), 0, torsoH * 0.48, 0),
    );
  if (look.plate) {
    const plate = lambert(look.plate, { emissive: shade(look.plate, 0.35) });
    torso.add(box(torsoW + 0.05, torsoH * 0.62, 0.05, plate, 0, torsoH * 0.56, front + 0.02));
    for (const side of [1, -1])
      torso.add(box(0.17, 0.08, 0.2, plate, side * (torsoW / 2 + 0.06), torsoH, 0));
  }
  if (look.neck)
    torso.add(box(0.07, 0.09, 0.03, lambert(look.neck), 0, torsoH - 0.24, front + 0.02));
  if (look.hood)
    torso.add(box(0.34 * W, 0.16, 0.12, lambert(look.top), 0, torsoH + 0.01, -front + 0.02));
  if (look.back) torso.add(backItem(look.back, torsoH, front, W));

  const head = joint(0, torsoH, 0);
  torso.add(head);
  const headTop = buildHead(head, look);

  const arms = ([1, -1] as const).map((side) => {
    const arm = joint(side * (torsoW / 2 + 0.07), torsoH - 0.06, 0);
    const elbow = joint(0, -0.3, 0);
    const grip = joint(0, -0.31, 0);
    grip.rotation.x = Math.PI / 2;
    arm.add(box(0.13, 0.3, 0.15, sleeve, 0, -0.15, 0), elbow);
    elbow.add(
      box(0.12, 0.26, 0.13, sleeve, 0, -0.13, 0),
      box(0.11, 0.1, 0.11, hand, 0, -0.3, 0),
      grip,
    );
    if (look.stripes) arm.add(box(0.02, 0.3, 0.05, lambert(look.stripes), side * 0.066, -0.15, 0));
    torso.add(arm);
    arm.rotation.z = side * 0.06;
    return { arm, elbow, grip };
  });

  const joints: Joints = {
    torso,
    head,
    legL: legs[0].leg,
    legR: legs[1].leg,
    shinL: legs[0].knee,
    shinR: legs[1].knee,
    armL: arms[0].arm,
    armR: arms[1].arm,
    foreL: arms[0].elbow,
    foreR: arms[1].elbow,
    handL: arms[0].grip,
    handR: arms[1].grip,
  };
  const actor: ActorModel = {
    ...noHands(),
    root,
    body,
    bodyY: hipY,
    joints,
    height: hipY + 0.02 + torsoH + headTop,
    motion: 'walk',
    hunch: look.hunch,
    pose: look.pose,
  };
  if (look.left) {
    const gear = gearModel(look.left);
    if (gear) {
      joints.handL.add(gear.model);
      actor.left = gear.hold;
    }
  }
  holdRight(actor, look.right ?? null);
  return actor;
}

function backItem(kind: NonNullable<Look['back']>, torsoH: number, front: number, W: number) {
  if (kind === 'backpack') {
    return group([
      box(0.32 * W, 0.36, 0.14, lambert('#4b5a2e'), 0, torsoH * 0.55, -front - 0.07),
      box(0.26 * W, 0.12, 0.06, lambert('#3e4a26'), 0, torsoH * 0.38, -front - 0.15),
    ]);
  }
  if (kind === 'rug') {
    const rug = tube(0.1, 0.1, 0.8, lambert('#a8322a'), 0, torsoH * 0.75, -front - 0.1, 8);
    rug.rotation.z = Math.PI / 2 - 0.5;
    const band = tube(0.105, 0.105, 0.08, lambert('#e0b43a'), 0, torsoH * 0.75, -front - 0.1, 8);
    band.rotation.z = rug.rotation.z;
    return group([rug, band]);
  }
  const spines = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const spike = cone(
      0.06,
      0.2,
      lambert(i % 2 ? '#f2c14e' : '#3f6fd8'),
      0,
      torsoH - 0.05 - i * 0.12,
      -front - 0.06,
    );
    spike.rotation.x = -2.2;
    spines.add(spike);
  }
  return spines;
}

/** Builds a head on the neck joint; returns the height of its top above the neck. */
function buildHead(neck: THREE.Group, look: Look): number {
  const s = look.headSize;
  const skin = lambert(look.skin);
  const eyeMat = look.eyes ? glow(look.eyes) : lambert('#141414');
  neck.add(box(0.12, 0.06, 0.12, skin, 0, 0.03, 0));
  let top: number;
  let width = 0.3 * s;
  switch (look.head) {
    case 'phone': {
      const red = lambert('#c8261e');
      neck.add(
        box(0.36, 0.17, 0.3, red, 0, 0.14, 0),
        tube(0.09, 0.09, 0.02, lambert('#f2f2f2'), 0, 0.14, 0.15, 10).rotateX(Math.PI / 2),
        box(0.42, 0.06, 0.09, red, 0, 0.27, 0),
        box(0.1, 0.08, 0.11, red, 0.17, 0.25, 0),
        box(0.1, 0.08, 0.11, red, -0.17, 0.25, 0),
      );
      return 0.31;
    }
    case 'bear': {
      const fur = skin;
      neck.add(
        box(0.36, 0.32, 0.34, fur, 0, 0.2, 0),
        box(0.18, 0.13, 0.14, lambert(shade(look.skin, 1.35)), 0, 0.13, 0.2),
        box(0.07, 0.05, 0.03, lambert('#141414'), 0, 0.17, 0.28),
        blob(0.07, fur, 0.14, 0.38, 0),
        blob(0.07, fur, -0.14, 0.38, 0),
        box(0.05, 0.04, 0.01, eyeMat, 0.08, 0.25, 0.171),
        box(0.05, 0.04, 0.01, eyeMat, -0.08, 0.25, 0.171),
      );
      return 0.42;
    }
    case 'sproto': {
      const r = 0.2 * s;
      neck.add(
        blob(r, lambert('#3f6fd8'), 0, r * 0.95, 0, 1),
        blob(r * 0.62, lambert('#f2c14e'), -r * 0.42, r * 0.95, r * 0.42, 1),
        blob(r * 0.22, lambert('#e02a2a'), 0, r * 0.8, r * 0.95),
        box(r * 0.32, r * 0.22, 0.02, lambert('#ffffff'), r * 0.32, r * 1.1, r * 0.86),
        box(r * 0.32, r * 0.22, 0.02, lambert('#ffffff'), -r * 0.32, r * 1.1, r * 0.86),
        box(r * 0.12, r * 0.12, 0.02, lambert('#141414'), r * 0.32, r * 1.08, r * 0.88),
        box(r * 0.12, r * 0.12, 0.02, lambert('#141414'), -r * 0.32, r * 1.08, r * 0.88),
      );
      top = r * 1.85;
      width = r * 1.8;
      break;
    }
    case 'robot': {
      const screen = canvasTexture('robot-gm', 16, 12, (ctx) => {
        ctx.fillStyle = '#102010';
        ctx.fillRect(0, 0, 16, 12);
        ctx.fillStyle = '#3fdc5a';
        ctx.font = 'bold 8px monospace';
        ctx.fillText('gm', 3, 9);
      });
      neck.add(
        box(0.3, 0.26, 0.28, lambert('#9aa3ad'), 0, 0.18, 0),
        box(
          0.24,
          0.17,
          0.01,
          lambert('#ffffff', { map: screen, emissive: '#1a3a1a' }),
          0,
          0.18,
          0.141,
        ),
        box(0.02, 0.12, 0.02, lambert('#5a5a60'), 0, 0.37, 0),
        blob(0.035, glow('#ff3b2f'), 0, 0.44, 0),
      );
      return 0.46;
    }
    case 'blob': {
      neck.add(
        blob(0.24, skin, 0, 0.2, 0),
        blob(0.12, skin, 0.14, 0.3, -0.05),
        box(0.06, 0.05, 0.02, eyeMat, 0.08, 0.24, 0.22),
        box(0.06, 0.05, 0.02, eyeMat, -0.08, 0.24, 0.22),
      );
      return 0.42;
    }
    case 'rock': {
      neck.add(
        box(0.34, 0.3, 0.32, skin, 0, 0.18, 0),
        box(0.08, 0.04, 0.02, eyeMat, 0.08, 0.2, 0.161),
        box(0.08, 0.04, 0.02, eyeMat, -0.08, 0.2, 0.161),
      );
      return 0.33;
    }
    default: {
      const h = 0.32 * s;
      const face = h / 2 + 0.06;
      neck.add(
        box(width, h, width, skin, 0, face, 0),
        box(0.05 * s, 0.05 * s, 0.01, eyeMat, 0.07 * s, face + 0.02 * s, width / 2 + 0.001),
        box(0.05 * s, 0.05 * s, 0.01, eyeMat, -0.07 * s, face + 0.02 * s, width / 2 + 0.001),
        box(0.05, 0.04, 0.04, lambert(shade(look.skin, 0.9)), 0, face - 0.04 * s, width / 2 + 0.02),
      );
      if (look.head === 'goblin') {
        for (const side of [1, -1]) {
          const ear = cone(0.05, 0.26, skin, side * (width / 2 + 0.1), face + 0.04, 0);
          ear.rotation.z = -side * 1.25;
          neck.add(ear);
        }
        neck.add(box(0.07, 0.08, 0.1, skin, 0, face - 0.03, width / 2 + 0.05));
      } else {
        neck.add(
          box(0.03, 0.07, 0.06, skin, width / 2 + 0.01, face, 0),
          box(0.03, 0.07, 0.06, skin, -width / 2 - 0.01, face, 0),
        );
      }
      top = h + 0.06;
      hair(neck, look, top, width);
      faceExtras(neck, look, face, width);
    }
  }
  if (look.hat) hat(neck, look.hat, look.hatColor ?? '#4b5a2e', top, width);
  return (
    top + (look.hat ? 0.08 : look.hairStyle === 'spiky' || look.hairStyle === 'bun' ? 0.08 : 0.02)
  );
}

function hair(neck: THREE.Group, look: Look, top: number, w: number): void {
  if (look.hairStyle === 'bald' || look.hat === 'helm') return;
  const mat = lambert(look.hair);
  const back = -w / 2 - 0.01;
  neck.add(box(w + 0.03, 0.08, w + 0.03, mat, 0, top - 0.02, -0.005));
  switch (look.hairStyle) {
    case 'slick':
      neck.add(
        box(w + 0.03, 0.2, 0.06, mat, 0, top - 0.12, back),
        box(w + 0.05, 0.05, w * 0.6, mat, 0, top + 0.01, 0.02),
      );
      break;
    case 'long':
      neck.add(box(w + 0.04, 0.36, 0.08, mat, 0, top - 0.2, back));
      break;
    case 'bun':
      neck.add(
        box(w + 0.03, 0.18, 0.06, mat, 0, top - 0.12, back),
        blob(0.09, mat, 0, top + 0.03, back + 0.02),
      );
      break;
    case 'ponytail':
      neck.add(
        box(w + 0.03, 0.18, 0.06, mat, 0, top - 0.12, back),
        box(0.08, 0.24, 0.08, mat, 0, top - 0.18, back - 0.05),
      );
      break;
    case 'spiky':
      for (let i = 0; i < 5; i++) {
        const spike = cone(0.06, 0.16, mat, (i - 2) * 0.06, top + 0.04, -0.02 - (i % 2) * 0.05);
        spike.rotation.x = -0.6;
        neck.add(spike);
      }
      neck.add(box(w + 0.03, 0.18, 0.06, mat, 0, top - 0.12, back));
      break;
    default:
      neck.add(box(w + 0.03, 0.18, 0.06, mat, 0, top - 0.12, back));
  }
}

function faceExtras(neck: THREE.Group, look: Look, eyeY: number, w: number): void {
  const z = w / 2 + 0.008;
  const y = eyeY + 0.02;
  if (look.glasses === 'shades') neck.add(box(w * 0.85, 0.06, 0.01, lambert('#0e0e12'), 0, y, z));
  if (look.glasses === 'aviators') {
    neck.add(
      box(w * 0.85, 0.02, 0.01, lambert('#e0b43a'), 0, y + 0.03, z),
      box(0.09, 0.06, 0.01, lambert('#3a2a1c'), 0.07, y, z),
      box(0.09, 0.06, 0.01, lambert('#3a2a1c'), -0.07, y, z),
    );
  }
  if (look.glasses === 'round') {
    neck.add(
      box(w * 0.85, 0.02, 0.01, lambert('#141414'), 0, y + 0.03, z),
      box(0.08, 0.07, 0.01, lambert('#cfe6f2', { opacity: 0.5 }), 0.07, y, z),
      box(0.08, 0.07, 0.01, lambert('#cfe6f2', { opacity: 0.5 }), -0.07, y, z),
    );
  }
  if (look.mask) neck.add(box(w + 0.02, 0.07, w + 0.02, lambert(look.mask), 0, y, 0));
  if (look.scarf) neck.add(box(w + 0.03, 0.12, w + 0.03, lambert(look.scarf), 0, eyeY - 0.08, 0));
  if (look.mustache)
    neck.add(box(0.16, 0.035, 0.012, lambert(look.mustache), 0, eyeY - 0.075, z + 0.01));
}

/** Builds a hat on a head joint (also used on rigged GLB heads). */
export function hat(
  neck: THREE.Group,
  kind: NonNullable<Look['hat']>,
  color: string,
  top: number,
  w: number,
): void {
  const mat = lambert(color);
  const dark = lambert(shade(color, 0.7));
  switch (kind) {
    case 'cap':
      neck.add(
        box(w + 0.04, 0.1, w + 0.04, mat, 0, top + 0.01, 0),
        box(w * 0.9, 0.025, 0.15, mat, 0, top - 0.03, w / 2 + 0.07),
      );
      break;
    case 'hardhat':
      neck.add(
        tube(w * 0.55, w * 0.63, 0.15, mat, 0, top + 0.04, 0, 8),
        tube(w * 0.75, w * 0.75, 0.03, mat, 0, top - 0.03, 0.02, 8),
      );
      break;
    case 'drill':
      neck.add(
        tube(w * 1.0, w * 1.0, 0.03, mat, 0, top - 0.01, 0, 10),
        tube(w * 0.38, w * 0.52, 0.17, dark, 0, top + 0.08, 0, 4),
      );
      break;
    case 'fedora':
      neck.add(
        tube(w * 0.88, w * 0.88, 0.025, mat, 0, top - 0.02, 0, 10),
        tube(w * 0.44, w * 0.54, 0.16, mat, 0, top + 0.06, 0, 8),
        tube(w * 0.55, w * 0.55, 0.035, lambert('#0a0a0a'), 0, top + 0.01, 0, 8),
      );
      break;
    case 'helmet':
    case 'medic':
    case 'leafy':
      neck.add(
        tube(w * 0.42, w * 0.64, 0.18, mat, 0, top + 0.03, 0, 8),
        tube(w * 0.68, w * 0.68, 0.03, dark, 0, top - 0.06, 0, 8),
      );
      if (kind === 'medic') {
        neck.add(
          box(0.12, 0.04, 0.01, lambert('#d62828'), 0, top + 0.04, w * 0.6),
          box(0.04, 0.12, 0.01, lambert('#d62828'), 0, top + 0.04, w * 0.6),
        );
      }
      if (kind === 'leafy') {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          neck.add(
            blob(
              0.07,
              lambert(i % 2 ? '#3f7a2c' : '#5a9a3a'),
              Math.cos(a) * w * 0.5,
              top + 0.08,
              Math.sin(a) * w * 0.5,
            ),
          );
        }
      }
      break;
    case 'boonie':
      neck.add(
        tube(w * 0.85, w * 0.85, 0.025, mat, 0, top - 0.02, 0, 10),
        tube(w * 0.5, w * 0.56, 0.12, mat, 0, top + 0.04, 0, 8),
      );
      break;
    case 'officer':
      neck.add(
        tube(w * 0.66, w * 0.52, 0.14, mat, 0, top + 0.04, 0, 10),
        box(w * 0.8, 0.03, 0.1, lambert('#141414'), 0, top - 0.02, w / 2 + 0.03),
        box(0.08, 0.08, 0.01, lambert('#e0b43a'), 0, top + 0.05, w * 0.62),
      );
      break;
    case 'headset':
      neck.add(
        box(w + 0.06, 0.03, 0.05, lambert('#202024'), 0, top + 0.01, 0),
        box(0.05, 0.1, 0.1, lambert('#202024'), w / 2 + 0.03, top - 0.12, 0),
        box(0.05, 0.1, 0.1, lambert('#202024'), -w / 2 - 0.03, top - 0.12, 0),
        box(0.02, 0.02, 0.14, lambert('#202024'), w / 2 + 0.02, top - 0.2, 0.08),
      );
      break;
    case 'tophat':
      neck.add(
        tube(w * 0.8, w * 0.8, 0.025, mat, 0, top - 0.01, 0, 10),
        tube(w * 0.42, w * 0.42, 0.3, mat, 0, top + 0.14, 0, 10),
        tube(w * 0.43, w * 0.43, 0.05, lambert('#b3262e'), 0, top + 0.03, 0, 10),
      );
      break;
    case 'helm':
      neck.add(
        box(
          w + 0.06,
          top - 0.02,
          w + 0.06,
          lambert(color, { emissive: shade(color, 0.35) }),
          0,
          top / 2 + 0.04,
          0,
        ),
        box(w * 0.7, 0.04, 0.01, lambert('#0e0e12'), 0, top * 0.62, w / 2 + 0.035),
        cone(0.05, 0.14, glow(color), 0, top + 0.1, 0),
      );
      break;
  }
}

// ── Monsters without joints ─────────────────────────────────────────────────

function wrap(body: THREE.Group, height: number, motion: Motion): ActorModel {
  return {
    ...noHands(),
    root: group([body]),
    body,
    bodyY: 0,
    joints: null,
    height,
    motion,
    hunch: 0,
  };
}

/** A goo blob. Variant "mother" adds a crown and a spray of eyes. */
function sludge(spec: ActorSpec): ActorModel {
  const goo = lambert(spec.color);
  const dark = lambert(shade(spec.color, 0.75));
  const eye = glow(spec.accent ?? '#e0c040');
  const body = group([
    blob(0.42, goo, 0, 0.36, 0, 1),
    blob(0.3, dark, 0.2, 0.2, 0.12),
    blob(0.26, goo, -0.22, 0.18, -0.08),
    blob(0.14, dark, 0.05, 0.75, -0.05),
    box(0.1, 0.07, 0.03, eye, -0.13, 0.48, 0.38),
    box(0.1, 0.07, 0.03, eye, 0.13, 0.48, 0.38),
  ]);
  let height = 0.85;
  if (spec.variant === 'mother') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      body.add(cone(0.05, 0.16, lambert('#c8b83a'), Math.cos(a) * 0.14, 0.92, Math.sin(a) * 0.14));
    }
    for (const [x, y, z] of [
      [0.3, 0.3, 0.25],
      [-0.32, 0.22, 0.18],
      [0.1, 0.62, 0.3],
      [-0.2, 0.55, 0.28],
      [0.35, 0.5, 0.05],
    ]) {
      body.add(box(0.06, 0.05, 0.03, eye, x, y, z));
    }
    height = 1.0;
  }
  return wrap(body, height, 'hop');
}

/** A hooded purple robe that hovers. */
function wraith(spec: ActorSpec): ActorModel {
  const robe = lambert(spec.color, { opacity: 0.85 });
  const dark = lambert(shade(spec.color, 0.55));
  const eye = glow(spec.accent ?? '#f2e05a');
  const skirt = cone(0.4, 1.15, robe, 0, 0.6, 0, 8);
  const body = group([
    skirt,
    blob(0.24, dark, 0, 1.25, 0, 1),
    box(0.06, 0.05, 0.02, eye, 0.08, 1.25, 0.21),
    box(0.06, 0.05, 0.02, eye, -0.08, 1.25, 0.21),
  ]);
  for (const side of [1, -1]) {
    const arm = cone(0.08, 0.5, robe, side * 0.32, 0.85, 0.1, 6);
    arm.rotation.z = side * 2.3;
    body.add(arm);
  }
  for (let i = 0; i < 3; i++)
    body.add(
      blob(
        0.06,
        glow('#b98cff'),
        Math.cos(i * 2.1) * 0.45,
        1.5 + i * 0.1,
        Math.sin(i * 2.1) * 0.45,
      ),
    );
  return wrap(body, 1.6, 'float');
}

/** A striped sock puppet with button eyes, hiding behind cardboard. */
function sock(spec: ActorSpec): ActorModel {
  const colors = [spec.color, '#f2f2f2', spec.accent ?? '#2f4fa8'];
  const body = new THREE.Group();
  for (let i = 0; i < 7; i++)
    body.add(tube(0.2, 0.21, 0.13, lambert(colors[i % 3]), 0, 0.07 + i * 0.13, 0, 8));
  body.add(
    blob(0.22, lambert(colors[0]), 0, 1.0, 0.08, 1),
    tube(0.05, 0.05, 0.02, lambert('#141414'), 0.08, 1.06, 0.28, 8).rotateX(Math.PI / 2),
    tube(0.05, 0.05, 0.02, lambert('#141414'), -0.08, 1.06, 0.28, 8).rotateX(Math.PI / 2),
    box(0.14, 0.03, 0.02, lambert('#e02a2a'), 0, 0.92, 0.28),
    blob(0.07, lambert('#d62828'), 0.06, 1.2, 0),
    blob(0.07, lambert('#2f4fa8'), -0.08, 1.21, -0.02),
    box(0.46, 0.56, 0.04, lambert('#b8925a'), 0.12, 0.5, 0.3),
    box(0.18, 0.18, 0.01, lambert('#d62828'), 0.12, 0.55, 0.325),
  );
  return wrap(body, 1.3, 'hop');
}
