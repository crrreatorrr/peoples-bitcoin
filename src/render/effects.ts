/**
 * Visual-only effects: particle bursts (level-up fireworks,
 * sludge poofs, explosions), shot tracers, the tutorial hint arrow and HP bars.
 * Nothing here touches game state.
 */
import * as THREE from 'three';
import { FIREWORKS, RENDER } from '../config/balance';

export const PALETTES = {
  fireworks: ['#f2c14e', '#3fdc5a', '#ff5a4d', '#4fd8ea', '#ffffff'],
  sludge: ['#2f3b22', '#4a5a2e', '#6b7a3a', '#1e2616'],
  explosion: ['#ffcf3f', '#ff7a1a', '#ff3b2f', '#fff1b0'],
  magic: ['#ffffff', '#f4e9ff', '#c9b6ff', '#a8d8ff'],
  rock: ['#8a8a90', '#6a6a72', '#b8b0a0'],
} as const;

/** What a shot looks like in flight. */
export type ShotKind = 'shot' | 'explosive' | 'magic' | 'rock';

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
  origin?: () => THREE.Vector3 | null;
  /** Rocks tumble end over end as they fly. */
  tumble: boolean;
  onArrive?: () => void;
}

/**
 * Shots fly from shooter to target, OSRS-style, and the hitsplat waits for
 * them. Damage already resolved on the tick; this is only what you see.
 * Explosive shells lob in an arc; spells are glowing orbs; thrown rocks lob and tumble.
 */
export class Tracers {
  private readonly active: Shot[] = [];
  private readonly geometry = new THREE.OctahedronGeometry(0.07, 0);
  private readonly shell = new THREE.IcosahedronGeometry(0.13, 0);
  private readonly orb = new THREE.IcosahedronGeometry(0.11, 1);
  private readonly rock = new THREE.DodecahedronGeometry(0.11, 0);
  private readonly materials = {
    shot: new THREE.MeshBasicMaterial({ color: '#fff1a8' }),
    explosive: new THREE.MeshBasicMaterial({ color: '#7cff6b' }),
    magic: new THREE.MeshBasicMaterial({ color: '#f4e9ff' }),
    rock: new THREE.MeshLambertMaterial({ color: '#8a8a90', flatShading: true }),
  };

  constructor(private readonly scene: THREE.Scene) {}

  /** Launches a shot; returns its flight time in ms so the hit can land on arrival. */
  fire(
    from: THREE.Vector3,
    to: THREE.Vector3,
    kind: ShotKind,
    now: number,
    launch: { origin?: () => THREE.Vector3 | null; delayMs?: number; onArrive?: () => void } = {},
  ): number {
    const a = from.clone().setY(from.y + 1.1);
    const b = to.clone().setY(to.y + 0.8);
    const tiles = Math.hypot(b.x - a.x, b.z - a.z);
    const flightMs = Math.min(
      RENDER.projectileMaxMs,
      RENDER.projectileMsBase + RENDER.projectileMsPerTile * tiles,
    );
    const geometry = {
      shot: this.geometry,
      explosive: this.shell,
      magic: this.orb,
      rock: this.rock,
    }[kind];
    const mesh = new THREE.Mesh(geometry, this.materials[kind]);
    mesh.position.copy(a);
    mesh.visible = false;
    this.scene.add(mesh);
    const arc = kind === 'explosive' ? 0.25 * tiles : kind === 'rock' ? 0.18 * tiles : 0;
    const tumble = kind === 'rock';
    const delay = launch.delayMs ?? 0;
    this.active.push({
      mesh,
      from: a,
      to: b,
      startedAt: now + delay,
      flightMs,
      arc,
      tumble,
      origin: launch.origin,
      onArrive: launch.onArrive,
    });
    return delay + flightMs;
  }

  update(now: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const shot = this.active[i];
      const k = (now - shot.startedAt) / shot.flightMs;
      if (k < 0) continue;
      if (k >= 1) {
        this.scene.remove(shot.mesh);
        this.active.splice(i, 1);
        shot.onArrive?.();
        continue;
      }
      // Actors are posed before this update, so sample the launch point once as it fires.
      if (!shot.mesh.visible) {
        const at = shot.origin?.();
        if (at) shot.from.copy(at);
        shot.mesh.position.copy(shot.from);
        shot.mesh.visible = true;
        continue;
      }
      shot.mesh.position.lerpVectors(shot.from, shot.to, k);
      shot.mesh.position.y += shot.arc * 4 * k * (1 - k);
      shot.mesh.rotation.y = now / 60;
      if (shot.tumble) shot.mesh.rotation.x = now / 90;
    }
  }
}

/** A bouncing yellow arrow over the tutorial's next target. */
/**
 * Flat warning marks on ground tiles: where a boss attack is about to land (the Sludge
 * Mother's falling sludge). They pulse faster as the landing nears, then go.
 * The color comes from the asset manifest, so final art can replace the placeholder.
 */
export class TileMarks {
  private readonly active: { mesh: THREE.Mesh; startedAt: number; endsAt: number }[] = [];
  private readonly geometry = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);

  constructor(private readonly scene: THREE.Scene) {}

  /** Marks `tiles` from `now` until `now + durationMs`. */
  mark(
    tiles: readonly (readonly [number, number])[],
    colors: { color: string; accent: string },
    now: number,
    durationMs: number,
  ): void {
    for (const [x, y] of tiles) {
      const mesh = new THREE.Mesh(
        this.geometry,
        new THREE.MeshBasicMaterial({
          color: colors.color,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        }),
      );
      mesh.position.set(x + 0.5, 0.04, y + 0.5);
      mesh.renderOrder = 2;
      mesh.userData.accent = colors.accent;
      mesh.userData.color = colors.color;
      this.scene.add(mesh);
      this.active.push({ mesh, startedAt: now, endsAt: now + durationMs });
    }
  }

  update(now: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      const material = m.mesh.material as THREE.MeshBasicMaterial;
      if (now >= m.endsAt) {
        this.scene.remove(m.mesh);
        material.dispose();
        this.active.splice(i, 1);
        continue;
      }
      // Blink between the two manifest colors, three times, quicker toward the end.
      const t = (now - m.startedAt) / (m.endsAt - m.startedAt);
      const on = Math.floor(t * t * 6 + t * 2) % 2 === 0;
      material.color.set(on ? m.mesh.userData.color : m.mesh.userData.accent);
      material.opacity = 0.35 + 0.4 * t;
    }
  }
}

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
