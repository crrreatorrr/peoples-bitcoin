/**
 * Placeholder art built from Three.js primitives: low-poly, flat-shaded, with
 * 64×64 nearest-filtered canvas textures. Each builder reads its colors and
 * options from an asset manifest entry, so placeholders are tweakable in JSON
 * and replaceable by GLBs later.
 */
import * as THREE from 'three';
import type { AssetEntry } from './loader';

const TEX_SIZE = 64;
const materialCache = new Map<string, THREE.MeshLambertMaterial>();
const textureCache = new Map<string, THREE.Texture>();

export interface TerrainPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface MatOptions {
  emissive?: string;
  map?: THREE.Texture;
  opacity?: number;
}

function lambert(color: string, opts: MatOptions = {}): THREE.MeshLambertMaterial {
  const key = [color, opts.emissive, opts.map?.uuid, opts.opacity].join('|');
  let mat = materialCache.get(key);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
      emissive: opts.emissive ?? '#000000',
      map: opts.map ?? null,
      transparent: opts.opacity !== undefined,
      opacity: opts.opacity ?? 1,
    });
    materialCache.set(key, mat);
  }
  return mat;
}

function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function cylinder(r: number, h: number, mat: THREE.Material, y: number, segments = 6): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), mat);
  mesh.position.y = y;
  return mesh;
}

function blob(r: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

/** Brightens (>1) or darkens (<1) a hex color. */
function shade(hex: string, factor: number): string {
  return `#${new THREE.Color(hex).multiplyScalar(factor).getHexString()}`;
}

/** Deterministic 0..1 noise for texture pixels. */
function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function canvasTexture(
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): THREE.Texture {
  let tex = textureCache.get(key);
  if (tex) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(key, tex);
  return tex;
}

function patternTexture(e: AssetEntry): THREE.Texture {
  const pattern = e.pattern ?? 'noise';
  return canvasTexture(`${pattern}|${e.color}|${e.accent}`, TEX_SIZE, TEX_SIZE, (ctx) => {
    const s = TEX_SIZE;
    const px = 2;
    for (let y = 0; y < s; y += px) {
      for (let x = 0; x < s; x += px) {
        ctx.fillStyle = shade(e.color, 0.88 + hash2(x, y, 7) * 0.24);
        ctx.fillRect(x, y, px, px);
      }
    }
    ctx.fillStyle = shade(e.color, 0.68);
    if (pattern === 'brick' || pattern === 'cobble') {
      const rowH = pattern === 'brick' ? 8 : 16;
      for (let row = 0; row < s / rowH; row++) {
        ctx.fillRect(0, row * rowH, s, 1);
        for (let x = row % 2 ? rowH : 0; x < s; x += rowH * 2) ctx.fillRect(x, row * rowH, 1, rowH);
      }
    } else if (pattern === 'tiles') {
      ctx.fillRect(0, 0, s, 1);
      ctx.fillRect(0, 0, 1, s);
      ctx.fillRect(0, s / 2, s, 1);
      ctx.fillRect(s / 2, 0, 1, s);
    } else if (pattern === 'carpet') {
      ctx.fillStyle = e.accent ?? '#d2a63a';
      for (let y = 8; y < s; y += 16) {
        for (let x = 8; x < s; x += 16) {
          ctx.fillRect(x - 1, y - 3, 2, 6);
          ctx.fillRect(x - 3, y - 1, 6, 2);
        }
      }
    }
  });
}

// ── Terrain ──────────────────────────────────────────────────────────────────

export function terrainPart(e: AssetEntry): TerrainPart {
  if (e.placeholder === 'wall') {
    const h = e.height ?? 1.5;
    const geometry = new THREE.BoxGeometry(1, h, 1).translate(0, h / 2, 0);
    return { geometry, material: lambert('#ffffff', { map: patternTexture(e) }) };
  }
  if (e.placeholder === 'water') {
    const geometry = new THREE.BoxGeometry(1, 0.04, 1).translate(0, -0.1, 0);
    return { geometry, material: lambert(e.color, { opacity: 0.88 }) };
  }
  const geometry = new THREE.BoxGeometry(1, 0.1, 1).translate(0, -0.05, 0);
  return { geometry, material: lambert('#ffffff', { map: patternTexture(e) }) };
}

// ── Entity placeholders (feet at y = 0, facing +z) ───────────────────────────

export function buildPlaceholder(e: AssetEntry): THREE.Object3D {
  switch (e.placeholder) {
    case 'humanoid':
      return humanoid(e);
    case 'rack':
      return rack(e);
    case 'tree':
      return tree(e);
    case 'pillar':
      return pillar(e);
    case 'bench':
      return bench(e);
    case 'flagpole':
      return flagpole(e);
    case 'gremlin':
      return gremlinStatue(e);
    case 'board':
      return roadmapBoard(e);
    default:
      return box(0.8, 0.8, 0.8, lambert(e.color), 0, 0.4, 0);
  }
}

function humanoid(e: AssetEntry): THREE.Group {
  const g = new THREE.Group();
  const suit = lambert(e.color);
  const trousers = lambert(shade(e.color, 0.75));
  const skin = lambert(e.skin ?? '#d9a57a');
  const hair = lambert(e.hair ?? '#333333');
  const black = lambert('#141414');
  const shirt = lambert('#f0f0f0');

  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.name = side < 0 ? 'legL' : 'legR';
    leg.position.set(side * 0.11, 0.56, 0);
    leg.add(box(0.17, 0.5, 0.2, trousers, 0, -0.25, 0));
    leg.add(box(0.18, 0.08, 0.27, black, 0, -0.52, 0.03));
    g.add(leg);
  }

  g.add(box(0.48, 0.55, 0.28, suit, 0, 0.84, 0));
  g.add(box(0.16, 0.22, 0.01, shirt, 0, 1.0, 0.145));
  g.add(box(0.07, 0.36, 0.02, lambert(e.accent ?? '#b3262e'), 0, 0.92, 0.15));

  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.name = side < 0 ? 'armL' : 'armR';
    arm.position.set(side * 0.31, 1.08, 0);
    arm.add(box(0.13, 0.48, 0.16, suit, 0, -0.22, 0));
    arm.add(box(0.11, 0.1, 0.12, skin, 0, -0.5, 0));
    if (side > 0) {
      const tool = new THREE.Group();
      tool.name = 'tool';
      tool.visible = false;
      tool.add(box(0.04, 0.04, 0.42, lambert('#6b4a2b'), 0, -0.5, 0.2));
      tool.add(box(0.06, 0.26, 0.07, lambert('#9aa3ad'), 0, -0.5, 0.4));
      arm.add(tool);
    }
    g.add(arm);
  }

  g.add(box(0.3, 0.32, 0.3, skin, 0, 1.3, 0));
  g.add(box(0.32, 0.08, 0.32, hair, 0, 1.48, -0.01));
  g.add(box(0.32, 0.2, 0.06, hair, 0, 1.38, -0.15));
  g.add(box(0.05, 0.05, 0.01, black, -0.07, 1.32, 0.151));
  g.add(box(0.05, 0.05, 0.01, black, 0.07, 1.32, 0.151));
  if (e.glasses) g.add(box(0.27, 0.025, 0.01, black, 0, 1.35, 0.158));
  return g;
}

function rack(e: AssetEntry): THREE.Group {
  const g = new THREE.Group();
  const accent = e.accent ?? '#7cff6b';
  const panel = lambert(shade(e.color, 0.55));
  const led = lambert('#111111', { emissive: accent });
  g.add(box(0.8, 1.7, 0.7, lambert(e.color), 0, 0.85, 0));
  g.add(box(0.86, 0.06, 0.76, lambert(shade(e.color, 1.25)), 0, 1.72, 0));
  for (const z of [0.36, -0.36]) {
    g.add(box(0.68, 1.55, 0.02, panel, 0, 0.85, z));
    for (let i = 0; i < 6; i++) {
      const y = 0.3 + i * 0.22;
      g.add(box(0.42, 0.04, 0.02, led, -0.06, y, z * 1.04));
      g.add(box(0.05, 0.05, 0.02, led, 0.24, y, z * 1.04));
    }
  }
  if (e.smoke) {
    const smoke = new THREE.Group();
    smoke.name = 'smoke';
    const puff = lambert('#8a8a8a', { opacity: 0.75 });
    smoke.add(
      blob(0.16, puff, 0.1, 1.95, 0),
      blob(0.22, puff, -0.08, 2.25, 0.05),
      blob(0.13, puff, 0.05, 2.55, -0.05),
    );
    g.add(smoke);
  }
  return g;
}

function tree(e: AssetEntry): THREE.Group {
  const g = new THREE.Group();
  const leaves = lambert(e.color);
  g.add(cylinder(0.13, 1.1, lambert(e.accent ?? '#5b3b22'), 0.55));
  g.add(blob(0.75, leaves, 0, 1.55, 0));
  g.add(blob(0.5, lambert(shade(e.color, 1.15)), 0.15, 2.1, -0.1));
  g.rotation.y = Math.random() * Math.PI * 2;
  return g;
}

function pillar(e: AssetEntry): THREE.Group {
  const g = new THREE.Group();
  const stone = lambert(e.color);
  g.add(box(0.8, 0.15, 0.8, stone, 0, 0.075, 0));
  g.add(cylinder(0.28, 2.1, stone, 1.2, 8));
  g.add(box(0.8, 0.15, 0.8, stone, 0, 2.3, 0));
  return g;
}

function bench(e: AssetEntry): THREE.Group {
  const g = new THREE.Group();
  const wood = lambert(e.color);
  const iron = lambert('#2b2b2b');
  g.add(box(0.95, 0.08, 0.36, wood, 0, 0.42, 0));
  g.add(box(0.95, 0.3, 0.06, wood, 0, 0.66, -0.16));
  for (const x of [-0.4, 0.4]) {
    g.add(box(0.06, 0.42, 0.06, iron, x, 0.21, 0.12));
    g.add(box(0.06, 0.42, 0.06, iron, x, 0.21, -0.12));
  }
  return g;
}

function flagpole(e: AssetEntry): THREE.Group {
  const g = new THREE.Group();
  const flagTex = canvasTexture(`flag|${e.accent}`, 32, 20, (ctx) => {
    ctx.fillStyle = e.accent ?? '#2f9e44';
    ctx.fillRect(0, 0, 32, 20);
    ctx.fillStyle = '#f2c14e';
    ctx.fillRect(15, 6, 3, 10);
    ctx.fillRect(12, 8, 9, 2);
    ctx.fillRect(13, 6, 7, 2);
    ctx.fillRect(15, 4, 3, 2);
  });
  g.add(box(0.4, 0.15, 0.4, lambert('#7a7a7a'), 0, 0.075, 0));
  g.add(cylinder(0.04, 3.2, lambert(e.color), 1.6));
  g.add(blob(0.07, lambert('#f2c14e'), 0, 3.25, 0));
  g.add(box(0.9, 0.55, 0.02, lambert('#ffffff', { map: flagTex }), 0.47, 2.85, 0));
  return g;
}

function gremlinStatue(e: AssetEntry): THREE.Group {
  const g = new THREE.Group();
  const gold = lambert(e.color);
  const stone = lambert('#9a948a');
  const black = lambert('#141414');
  g.add(box(0.9, 0.5, 0.9, stone, 0, 0.25, 0));
  g.add(blob(0.3, gold, 0, 0.82, 0));
  g.add(blob(0.36, gold, 0, 1.3, 0.02));
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 4), gold);
    ear.position.set(side * 0.4, 1.42, 0);
    ear.rotation.z = -side * 1.1;
    g.add(ear);
    g.add(box(0.08, 0.1, 0.02, black, side * 0.12, 1.36, 0.33));
  }
  return g;
}

function roadmapBoard(e: AssetEntry): THREE.Group {
  const g = new THREE.Group();
  const accent = e.accent ?? '#3fdc5a';
  const tex = canvasTexture(`board|${e.color}|${accent}`, 128, 64, (ctx) => {
    ctx.fillStyle = e.color;
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = accent;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ROADMAP TO $100BN', 64, 13);
    ctx.fillRect(60, 26, 8, 32);
    ctx.beginPath();
    ctx.moveTo(64, 16);
    ctx.lineTo(80, 32);
    ctx.lineTo(48, 32);
    ctx.closePath();
    ctx.fill();
  });
  const post = lambert('#3a3a3a');
  g.add(box(0.1, 1.8, 0.1, post, -0.85, 0.9, -0.05));
  g.add(box(0.1, 1.8, 0.1, post, 0.85, 0.9, -0.05));
  const screen = box(
    1.9,
    0.95,
    0.08,
    lambert('#ffffff', { map: tex, emissive: '#222222' }),
    0,
    1.45,
    0,
  );
  g.add(screen);
  return g;
}

// ── Icons ────────────────────────────────────────────────────────────────────

/** 32×32 chunky "ore" icon in the entry's color, with its label in the corner. */
export function iconDataUrl(e: AssetEntry): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const shape: [number, number][] = [
    [6, 20],
    [10, 9],
    [19, 5],
    [27, 11],
    [26, 23],
    [16, 28],
    [8, 26],
  ];
  ctx.beginPath();
  shape.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = e.color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = shade(e.color, 0.45);
  ctx.stroke();
  ctx.fillStyle = shade(e.color, 1.35);
  ctx.fillRect(12, 10, 6, 3);
  ctx.fillRect(10, 13, 3, 4);
  if (e.label) {
    ctx.font = 'bold 8px monospace';
    ctx.fillStyle = '#000000';
    ctx.fillText(e.label, 17, 31);
  }
  return canvas.toDataURL();
}
