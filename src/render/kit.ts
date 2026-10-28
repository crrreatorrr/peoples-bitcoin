/**
 * Building blocks for models made in code: cached flat-shaded materials and
 * geometries, plus small mesh helpers. Models stand with their feet at y = 0
 * and face +z.
 */
import * as THREE from 'three';

const materials = new Map<string, THREE.MeshLambertMaterial>();
const geometries = new Map<string, THREE.BufferGeometry>();
const textures = new Map<string, THREE.Texture>();

export interface MatOptions {
  emissive?: string;
  map?: THREE.Texture;
  opacity?: number;
}

export function lambert(color: string, opts: MatOptions = {}): THREE.MeshLambertMaterial {
  const key = [color, opts.emissive, opts.map?.uuid, opts.opacity].join('|');
  let mat = materials.get(key);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
      emissive: opts.emissive ?? '#000000',
      map: opts.map ?? null,
      transparent: opts.opacity !== undefined,
      opacity: opts.opacity ?? 1,
    });
    materials.set(key, mat);
  }
  return mat;
}

/** A material that glows in its own color. */
export function glow(color: string): THREE.MeshLambertMaterial {
  return lambert(color, { emissive: color });
}

function geometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = geometries.get(key);
  if (!geo) {
    geo = make();
    geometries.set(key, geo);
  }
  return geo;
}

function placed(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  return mesh;
}

export function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const geo = geometry(`box|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
  return placed(geo, mat, x, y, z);
}

/** A cylinder standing on the y axis (or a frustum when the radii differ). */
export function tube(
  rTop: number,
  rBottom: number,
  h: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  segments = 6,
): THREE.Mesh {
  const geo = geometry(
    `tube|${rTop}|${rBottom}|${h}|${segments}`,
    () => new THREE.CylinderGeometry(rTop, rBottom, h, segments),
  );
  return placed(geo, mat, x, y, z);
}

export function cylinder(r: number, h: number, mat: THREE.Material, y: number, segments = 6) {
  return tube(r, r, h, mat, 0, y, 0, segments);
}

export function cone(
  r: number,
  h: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  segments = 4,
): THREE.Mesh {
  const geo = geometry(`cone|${r}|${h}|${segments}`, () => new THREE.ConeGeometry(r, h, segments));
  return placed(geo, mat, x, y, z);
}

/** A low-poly ball. */
export function blob(r: number, mat: THREE.Material, x = 0, y = 0, z = 0, detail = 0): THREE.Mesh {
  const geo = geometry(`blob|${r}|${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
  return placed(geo, mat, x, y, z);
}

/** A ring lying flat on the ground plane. */
export function ring(
  r: number,
  thickness: number,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const geo = geometry(`ring|${r}|${thickness}`, () =>
    new THREE.TorusGeometry(r, thickness, 4, 16).rotateX(Math.PI / 2),
  );
  return placed(geo, mat, x, y, z);
}

/** Groups meshes, optionally offset. */
export function group(children: THREE.Object3D[], x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (children.length > 0) g.add(...children);
  return g;
}

/** Brightens (>1) or darkens (<1) a hex color. */
export function shade(hex: string, factor: number): string {
  return `#${new THREE.Color(hex).multiplyScalar(factor).getHexString()}`;
}

/** Deterministic 0..1 noise for texture pixels. */
export function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A nearest-filtered canvas texture, drawn once per key. */
export function canvasTexture(
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): THREE.Texture {
  let tex = textures.get(key);
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
  textures.set(key, tex);
  return tex;
}
