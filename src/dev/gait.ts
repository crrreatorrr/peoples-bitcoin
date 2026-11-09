/**
 * Dev-only gait check (`/gait.html`): a character walking and running on a
 * treadmill of tiles that scrolls at the real game speeds, posed by the same
 * code the game uses. `window.gaitMeasure(seconds)` steps it at 60 fps and
 * reports foot contact from the skinned shoe vertices: how far the lowest one
 * floats or sinks and how fast it slides against the ground while planted.
 * `window.gaitTrace('walk' | 'run')` prints one cycle frame by frame.
 * `?phase=1.2` freezes both gaits at that cycle angle; `?view=front|top`;
 * `?model=<id>` picks another rigged GLB or a code-built character.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MOVEMENT, TICK_MS } from '../config/balance';
import { poseActor, STRIDE_RAD_PER_TILE, type AnimInput } from '../render/animate';
import manifest from '../config/assets.manifest.json';
import { riggedActor } from '../render/rigged';
import { buildActor, type ActorModel, type ActorSpec } from '../render/actors';

const MODELS = import.meta.glob('../assets/models/*.glb', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const params = new URLSearchParams(location.search);
const modelId = params.get('model') ?? 'player_president';
const frozen = params.has('phase') ? Number(params.get('phase')) : null;
const view = params.get('view') ?? 'side';

interface Lane {
  name: string;
  running: boolean;
  tilesPerSec: number;
  actor: ActorModel;
  ground: THREE.Group;
  feet: { mesh: THREE.SkinnedMesh | null; verts: number[] };
  restFootY: number;
  phase: number;
  /** Shoe vertex positions last step. */
  last: Float32Array;
  off: number;
  contact: number;
  contactZ: number;
  slip: number;
  stats: {
    float: number;
    sink: number;
    slide: number;
    samples: number;
    slideSum: number;
    airborne: number;
  };
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#8fb3c9');
scene.add(new THREE.HemisphereLight('#ffffff', '#556644', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 1.6);
sun.position.set(3, 6, 4);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

function resize(): void {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function treadmill(): THREE.Group {
  const g = new THREE.Group();
  for (let z = -6; z <= 6; z++) {
    const tile = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.02, 0.98),
      new THREE.MeshLambertMaterial({ color: z % 2 ? '#6f8f4a' : '#5d7a3c' }),
    );
    tile.position.set(0, -0.01, z);
    g.add(tile);
  }
  return g;
}

// A rigged GLB, or else a code-built character from the manifest (no foot-contact numbers).
const url = MODELS[`../assets/models/${modelId}.glb`];
const gltf = url ? await new GLTFLoader().loadAsync(url) : null;
const spec = (manifest as unknown as Record<string, Partial<ActorSpec>>)[modelId];
const makeActor = (): ActorModel =>
  gltf ? riggedActor(gltf.scene, 1) : buildActor({ color: '#888888', scale: 1, ...spec })!;
const tilesPerSec = (n: number) => n / (TICK_MS / 1000);
const lanes: Lane[] = [
  { name: 'walk', running: false, tilesPerSec: tilesPerSec(MOVEMENT.walkTilesPerTick) },
  { name: 'run', running: true, tilesPerSec: tilesPerSec(MOVEMENT.runTilesPerTick) },
].map((l, i) => {
  const actor = makeActor();
  // Seen from the side the lanes are stacked (run above walk); from the front, side by side.
  const lane = new THREE.Group();
  if (view === 'side') lane.position.y = i * 2.15;
  else lane.position.x = i === 0 ? -0.9 : 0.9;
  scene.add(lane);
  lane.add(actor.root);
  const ground = treadmill();
  lane.add(ground);
  lane.updateMatrixWorld(true);
  const feet = shoeVertices(actor);
  const sole = new Float32Array(feet.verts.length * 3);
  measureSole(feet, sole);
  let restFootY = Infinity;
  for (let i = 1; i < sole.length; i += 3) restFootY = Math.min(restFootY, sole[i]);
  return {
    ...l,
    actor,
    ground,
    feet,
    restFootY,
    phase: 0,
    last: sole,
    off: 0,
    contact: 0,
    contactZ: 0,
    slip: 0,
    stats: { float: 0, sink: 0, slide: 0, samples: 0, slideSum: 0, airborne: 0 },
  };
});

if (view === 'front') camera.position.set(0, 1.1, 7.5);
else if (view === 'top') camera.position.set(4.5, 7, 4.5);
else camera.position.set(11, 2.0, 0);
camera.lookAt(0, view === 'side' ? 1.9 : 0.85, 0);

const info = document.createElement('pre');
info.style.cssText =
  'position:fixed;left:8px;top:8px;margin:0;font:12px monospace;color:#fff;text-shadow:0 1px 2px #000';
document.body.appendChild(info);

/** The skinned vertices of both shoes: those mostly weighted to a foot or toe bone. */
function shoeVertices(actor: ActorModel): Lane['feet'] {
  let mesh: THREE.SkinnedMesh | null = null;
  actor.root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  if (!mesh) return { mesh: null, verts: [] };
  const m = mesh as THREE.SkinnedMesh;
  const bones = m.skeleton.bones;
  const index = m.geometry.getAttribute('skinIndex');
  const weight = m.geometry.getAttribute('skinWeight');
  const verts: number[] = [];
  for (let v = 0; v < index.count; v++) {
    let best = 0;
    for (let k = 1; k < 4; k++)
      if (weight.getComponent(v, k) > weight.getComponent(v, best)) best = k;
    if (/Foot|ToeBase/.test(bones[index.getComponent(v, best)].name)) verts.push(v);
  }
  return { mesh: m, verts };
}

/** World positions of the shoe vertices, as x, y, z triples. */
function measureSole(feet: Lane['feet'], out: Float32Array): void {
  const vtx = new THREE.Vector3();
  feet.verts.forEach((v, i) => {
    feet.mesh!.getVertexPosition(v, vtx).applyMatrix4(feet.mesh!.matrixWorld);
    out[i * 3] = vtx.x;
    out[i * 3 + 1] = vtx.y;
    out[i * 3 + 2] = vtx.z;
  });
}

/** A foot this close to its rest height counts as planted. */
const CONTACT = 0.03;
let clock = 0;
let elapsed = 0;

function resetStats(): void {
  for (const l of lanes)
    l.stats = { float: 0, sink: 0, slide: 0, samples: 0, slideSum: 0, airborne: 0 };
}

let sole = new Float32Array(0);

/** Advances both lanes by `dt` seconds of game time and records foot contact. */
function step(dt: number): void {
  clock += dt * 1000;
  elapsed += dt;
  for (const l of lanes) {
    if (sole.length !== l.last.length) sole = new Float32Array(l.last.length);
    l.phase = frozen ?? l.phase + l.tilesPerSec * dt * STRIDE_RAD_PER_TILE;
    l.ground.position.z = -((((l.phase / STRIDE_RAD_PER_TILE) % 2) + 2) % 2);
    const input: AnimInput = {
      now: clock,
      // A frozen frame settles fully onto its pose.
      dt: frozen === null ? dt : 1,
      moving: true,
      running: l.running,
      phase: l.phase,
      combat: false,
      work: null,
      attackAt: -Infinity,
      attackStyle: 'melee',
      hitAt: -Infinity,
      diedAt: -Infinity,
    };
    poseActor(l.actor, input);
    l.actor.root.updateMatrixWorld(true);
    // The lowest shoe vertex is the one touching the ground: it should sit on the
    // ground and move back with it.
    if (l.feet.verts.length === 0) continue;
    measureSole(l.feet, sole);
    let lowIdx = 0;
    for (let i = 1; i < l.feet.verts.length; i++)
      if (sole[i * 3 + 1] < sole[lowIdx * 3 + 1]) lowIdx = i;
    l.off = sole[lowIdx * 3 + 1] - l.restFootY;
    const vx = (sole[lowIdx * 3] - l.last[lowIdx * 3]) / dt;
    const vz = (sole[lowIdx * 3 + 2] - l.last[lowIdx * 3 + 2]) / dt;
    l.last.set(sole);
    l.contact = l.feet.verts[lowIdx];
    l.contactZ = sole[lowIdx * 3 + 2];
    l.slip = Math.hypot(vx, vz + l.tilesPerSec);
    if (elapsed > 1 && frozen === null) {
      const s = l.stats;
      s.samples++;
      s.float = Math.max(s.float, l.off);
      s.sink = Math.min(s.sink, l.off);
      if (l.off > CONTACT) s.airborne++;
      else {
        // Ground moves at -tilesPerSec in z; a planted foot should match it.
        s.slideSum += Math.hypot(vx, vz + l.tilesPerSec);
        s.slide = s.slideSum / Math.max(1, s.samples - s.airborne);
      }
    }
  }
}

function draw(): void {
  info.textContent = [
    `${modelId}  ${view}`,
    ...lanes.map(
      (l) =>
        `${l.name.padEnd(5)} ${l.tilesPerSec.toFixed(2)} tiles/s  foot ${(l.off * 100).toFixed(1).padStart(5)} cm` +
        `  max float ${(l.stats.float * 100).toFixed(1)} cm  max sink ${(l.stats.sink * 100).toFixed(1)} cm` +
        `  airborne ${((100 * l.stats.airborne) / Math.max(1, l.stats.samples)).toFixed(0)}%` +
        `  planted slide ${l.stats.slide.toFixed(2)} m/s`,
    ),
  ].join('\n');
  renderer.render(scene, camera);
}

let prev = performance.now();
function frame(now: number): void {
  step(Math.max(1e-3, Math.min(0.05, (now - prev) / 1000)));
  prev = now;
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

declare global {
  interface Window {
    /** Steps `seconds` of game time at 60 fps (no rAF needed) and returns the foot-contact stats. */
    gaitMeasure: (seconds?: number) => Record<string, Lane['stats']>;
    /** One gait cycle of a lane, sampled `n` times: phase, contact height and contact z per step. */
    gaitTrace: (lane: string, n?: number) => string;
  }
}
window.gaitMeasure = (seconds = 6) => {
  resetStats();
  elapsed = 1;
  for (let t = 0; t < seconds; t += 1 / 60) step(1 / 60);
  draw();
  return Object.fromEntries(lanes.map((l) => [l.name, { ...l.stats }]));
};
window.gaitTrace = (name, n = 48) => {
  const l = lanes.find((x) => x.name === name)!;
  const dt = 2 / l.tilesPerSec / n;
  const rows: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    step(dt);
    if (i < n) continue;
    rows.push(
      `${(l.phase % (2 * Math.PI)).toFixed(2)} y=${(l.off * 100).toFixed(1)} ` +
        `z=${(l.contactZ * 100).toFixed(1)} v=${l.slip.toFixed(2)} vert=${l.contact}`,
    );
  }
  draw();
  return rows.join('\n');
};
(window as unknown as { gaitLanes: Lane[] }).gaitLanes = lanes;
