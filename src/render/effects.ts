/**
 * Visual-only effects. The click marker is the OSRS-style cross that shows
 * where a click landed: yellow for walking, red for an action.
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

const FIREWORK_COLORS = ['#f2c14e', '#3fdc5a', '#ff5a4d', '#4fd8ea', '#ffffff'];

/** Level-up burst of sparks around the player. */
export class Fireworks {
  private readonly points: THREE.Points;
  private readonly velocities: Float32Array;
  private readonly origin = new THREE.Vector3();
  private startedAt = -Infinity;

  constructor(scene: THREE.Scene) {
    const n = FIREWORKS.particles;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const colors = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      c.set(FIREWORK_COLORS[i % FIREWORK_COLORS.length]).toArray(colors, i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.velocities = new Float32Array(n * 3);
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true }),
    );
    this.points.visible = false;
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(at: THREE.Vector3, now: number): void {
    this.origin.copy(at);
    this.origin.y += 1.2;
    const v = this.velocities;
    for (let i = 0; i < v.length; i += 3) {
      const theta = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random() * 0.8;
      const speed = FIREWORKS.speed * (0.5 + Math.random() * 0.5);
      v[i] = Math.cos(theta) * speed;
      v[i + 1] = up * speed;
      v[i + 2] = Math.sin(theta) * speed;
    }
    this.startedAt = now;
  }

  update(now: number): void {
    const elapsed = now - this.startedAt;
    this.points.visible = elapsed >= 0 && elapsed < FIREWORKS.durationMs;
    if (!this.points.visible) return;
    const t = elapsed / 1000;
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const v = this.velocities;
    for (let i = 0; i < v.length; i += 3) {
      pos.array[i] = this.origin.x + v[i] * t;
      pos.array[i + 1] = this.origin.y + v[i + 1] * t - FIREWORKS.gravity * t * t;
      pos.array[i + 2] = this.origin.z + v[i + 2] * t;
    }
    pos.needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity = 1 - elapsed / FIREWORKS.durationMs;
  }
}
