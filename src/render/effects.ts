/**
 * Visual-only effects. The click marker is the OSRS-style cross that shows
 * where a click landed: yellow for walking, red for an action.
 */
import * as THREE from 'three';
import { RENDER } from '../config/balance';

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
