/**
 * Visual-only effects: the click marker, particle bursts (level-up fireworks,
 * sludge poofs, explosions), shot tracers, the tutorial hint arrow and HP bars.
 * Nothing here touches game state.
 */
import * as THREE from 'three';
import { FIREWORKS, RENDER } from '../config/balance';

export type ClickKind = 'walk' | 'action';

const COLORS: Record<ClickKind, string> = { walk: '#ffe14a', action: '#ff3b2f' };
const MARKER_SIZE = 0.55;

export class ClickMarker {
  private readonly mesh: THREE.Mesh;
  private readonly materials: Record<ClickKind, THREE.MeshBasicMaterial>;
  private shownAt = -Infinity;

  constructor(scene: THREE.Scene) {
    this.materials = { walk: crossMaterial(COLORS.walk), action: crossMaterial(COLORS.action) };
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(MARKER_SIZE, MARKER_SIZE),
      this.materials.walk,
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
  }

  show(x: number, z: number, kind: ClickKind, now: number): void {
    this.mesh.material = this.materials[kind];
    this.mesh.position.set(x, 0.03, z);
    this.shownAt = now;
  }

  update(now: number): void {
    const t = (now - this.shownAt) / RENDER.clickMarkerMs;
    this.mesh.visible = t >= 0 && t < 1;
    if (this.mesh.visible) this.mesh.scale.setScalar(1 - t * 0.5);
  }
}

function crossMaterial(color: string): THREE.MeshBasicMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  for (let i = 1; i < 15; i++) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(i - 1, i - 1, 3, 3);
    ctx.fillRect(14 - i, i - 1, 3, 3);
  }
  ctx.fillStyle = color;
  for (let i = 1; i < 15; i++) {
    ctx.fillRect(i, i, 1, 1);
    ctx.fillRect(15 - i, i, 1, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
}

export const PALETTES = {
  fireworks: ['#f2c14e', '#3fdc5a', '#ff5a4d', '#4fd8ea', '#ffffff'],
  sludge: ['#2f3b22', '#4a5a2e', '#6b7a3a', '#1e2616'],
  explosion: ['#ffcf3f', '#ff7a1a', '#ff3b2f', '#fff1b0'],
  magic: ['#ffffff', '#f4e9ff', '#c9b6ff', '#a8d8ff'],
} as const;

/** What a shot looks like in flight. */
export type ShotKind = 'shot' | 'explosive' | 'magic';

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  origin: THREE.Vector3;
  startedAt: number;
  durationMs: number;
}

/** Short-lived particle bursts: level-up fireworks, sludge poofs, explosions. */
export class Bursts {
  private readonly active: Burst[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  spawn(
    at: THREE.Vector3,
    palette: readonly string[],
    now: number,
    opts: { count?: number; speed?: number; lift?: number; durationMs?: number } = {},
  ): void {
    const n = opts.count ?? FIREWORKS.particles;
    const speed = opts.speed ?? FIREWORKS.speed;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const colors = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) c.set(palette[i % palette.length]).toArray(colors, i * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const velocities = new Float32Array(n * 3);
    for (let i = 0; i < velocities.length; i += 3) {
      const theta = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      velocities[i] = Math.cos(theta) * s;
      velocities[i + 1] = (0.3 + Math.random() * 0.9) * s;
      velocities[i + 2] = Math.sin(theta) * s;
    }
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true }),
    );
    points.frustumCulled = false;
    this.scene.add(points);
    const origin = at.clone();
    origin.y += opts.lift ?? 0.6;
    this.active.push({
      points,
      velocities,
      origin,
      startedAt: now,
      durationMs: opts.durationMs ?? FIREWORKS.durationMs,
    });
  }

  update(now: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      const elapsed = now - b.startedAt;
      b.points.visible = elapsed >= 0; // a burst can be scheduled for when a shot lands
      if (elapsed < 0) continue;
      if (elapsed >= b.durationMs) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        (b.points.material as THREE.Material).dispose();
        this.active.splice(i, 1);
        continue;
      }
      const t = elapsed / 1000;
      const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const v = b.velocities;
      for (let j = 0; j < v.length; j += 3) {
        pos.array[j] = b.origin.x + v[j] * t;
        pos.array[j + 1] = Math.max(0.02, b.origin.y + v[j + 1] * t - FIREWORKS.gravity * t * t);
        pos.array[j + 2] = b.origin.z + v[j + 2] * t;
      }
      pos.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = 1 - elapsed / b.durationMs;
    }
  }
}

interface Shot {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  startedAt: number;
  flightMs: number;
  arc: number;
  onArrive?: () => void;
}

/**
 * Shots fly from shooter to target, OSRS-style, and the hitsplat waits for
 * them. Damage already resolved on the tick; this is only what you see.
 * Explosive shells lob in an arc; spells are glowing orbs.
 */
export class Tracers {
  private readonly active: Shot[] = [];
  private readonly geometry = new THREE.OctahedronGeometry(0.07, 0);
  private readonly shell = new THREE.IcosahedronGeometry(0.13, 0);
  private readonly orb = new THREE.IcosahedronGeometry(0.11, 1);
  private readonly materials = {
    shot: new THREE.MeshBasicMaterial({ color: '#fff1a8' }),
    explosive: new THREE.MeshBasicMaterial({ color: '#7cff6b' }),
    magic: new THREE.MeshBasicMaterial({ color: '#f4e9ff' }),
  };

  constructor(private readonly scene: THREE.Scene) {}

  /** Launches a shot; returns its flight time in ms so the hit can land on arrival. */
  fire(
    from: THREE.Vector3,
    to: THREE.Vector3,
    kind: ShotKind,
    now: number,
    onArrive?: () => void,
  ): number {
    const a = from.clone().setY(from.y + 1.1);
    const b = to.clone().setY(to.y + 0.8);
    const tiles = Math.hypot(b.x - a.x, b.z - a.z);
    const flightMs = Math.min(
      RENDER.projectileMaxMs,
      RENDER.projectileMsBase + RENDER.projectileMsPerTile * tiles,
    );
    const geometry = { shot: this.geometry, explosive: this.shell, magic: this.orb }[kind];
    const mesh = new THREE.Mesh(geometry, this.materials[kind]);
    mesh.position.copy(a);
    this.scene.add(mesh);
    const arc = kind === 'explosive' ? 0.25 * tiles : 0;
    this.active.push({ mesh, from: a, to: b, startedAt: now, flightMs, arc, onArrive });
    return flightMs;
  }

  update(now: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const shot = this.active[i];
      const k = (now - shot.startedAt) / shot.flightMs;
      if (k >= 1) {
        this.scene.remove(shot.mesh);
        this.active.splice(i, 1);
        shot.onArrive?.();
        continue;
      }
      shot.mesh.position.lerpVectors(shot.from, shot.to, Math.max(0, k));
      shot.mesh.position.y += shot.arc * 4 * k * (1 - k);
      shot.mesh.rotation.y = now / 60;
    }
  }
}

/** A bouncing yellow arrow over the tutorial's next target. */
export class HintArrow {
  private readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.ConeGeometry(0.22, 0.5, 4).rotateX(Math.PI);
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ color: '#ffe14a', emissive: '#806a10', flatShading: true }),
    );
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(target: THREE.Vector3 | null, heightAbove: number, timeSec: number): void {
    this.mesh.visible = target !== null;
    if (!target) return;
    this.mesh.position.set(
      target.x,
      target.y + heightAbove + 0.3 + Math.abs(Math.sin(timeSec * 3)) * 0.35,
      target.z,
    );
    this.mesh.rotation.y = timeSec * 2;
  }
}

/** A small green-over-red bar that floats above a combatant (one billboard sprite). */
export class HpBar {
  readonly sprite: THREE.Sprite;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private shown = -1;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = 30;
    canvas.height = 4;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.texture, depthTest: false }),
    );
    this.sprite.scale.set(0.8, 0.11, 1);
    this.sprite.renderOrder = 5;
    this.sprite.visible = false;
  }

  set(fraction: number, visible: boolean): void {
    this.sprite.visible = visible;
    const px = Math.round(Math.max(0, Math.min(1, fraction)) * 30);
    if (!visible || px === this.shown) return;
    this.shown = px;
    this.ctx.fillStyle = '#c0281e';
    this.ctx.fillRect(0, 0, 30, 4);
    this.ctx.fillStyle = '#2fd04a';
    this.ctx.fillRect(0, 0, px, 4);
    this.texture.needsUpdate = true;
  }
}
