/**
 * OSRS-style camera: orbits the player at a tilt. Drag or arrow keys rotate,
 * the wheel zooms. Pitch and distance are clamped (DESIGN.md §2).
 */
import * as THREE from 'three';
import { CAMERA } from '../config/balance';

const { degToRad, clamp } = THREE.MathUtils;

export class OrbitCamera {
  readonly camera: THREE.PerspectiveCamera;
  private yaw = degToRad(CAMERA.startYawDeg);
  private pitch = degToRad(CAMERA.startPitchDeg);
  private distance: number = CAMERA.startDistance;
  private readonly target = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fovDeg, 1, CAMERA.near, CAMERA.far);
  }

  drag(dxPx: number, dyPx: number): void {
    this.yaw -= dxPx * CAMERA.dragYawPerPx;
    this.setPitch(this.pitch + dyPx * CAMERA.dragPitchPerPx);
  }

  zoom(deltaY: number): void {
    this.distance = clamp(
      this.distance * Math.exp(deltaY * CAMERA.zoomPerWheel),
      CAMERA.minDistance,
      CAMERA.maxDistance,
    );
  }

  /** `keys` axes are -1..1 from the keyboard; `focus` is the player's feet. */
  update(dt: number, keys: { yaw: number; pitch: number }, focus: THREE.Vector3): void {
    this.yaw += keys.yaw * CAMERA.keyYawPerSec * dt;
    this.setPitch(this.pitch + keys.pitch * CAMERA.keyPitchPerSec * dt);
    this.target.set(focus.x, focus.y + CAMERA.lookHeight, focus.z);
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horizontal,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.target);
  }

  private setPitch(p: number): void {
    this.pitch = clamp(p, degToRad(CAMERA.minPitchDeg), degToRad(CAMERA.maxPitchDeg));
  }
}
