/**
 * Turns a screen position into what's under the cursor: every entity in front
 * of the terrain (nearest first) and the ground tile, for "Walk here".
 */
import * as THREE from 'three';
import type { Tile } from '../sim/state';

export interface PickResult {
  /** Distinct entity ids under the cursor, nearest first. */
  entityIds: string[];
  tile: Tile | null;
}

/** Nudge into the hit surface so a wall's side face resolves to the wall's own tile. */
const SURFACE_NUDGE = 0.01;

export class Picker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly point = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.Camera,
    private readonly canvas: HTMLElement,
    private readonly terrain: THREE.Object3D[],
    private readonly entities: THREE.Object3D[],
    private readonly zoneSize: { width: number; height: number },
  ) {}

  pick(clientX: number, clientY: number): PickResult {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.entities, ...this.terrain], true);

    const entityIds: string[] = [];
    for (const hit of hits) {
      const id = findEntityId(hit.object);
      if (id) {
        if (!entityIds.includes(id)) entityIds.push(id);
        continue;
      }
      if (!hit.face) continue;
      this.point.copy(hit.point).addScaledVector(hit.face.normal, -SURFACE_NUDGE);
      const tile = { x: Math.floor(this.point.x), y: Math.floor(this.point.z) };
      const inside =
        tile.x >= 0 && tile.y >= 0 && tile.x < this.zoneSize.width && tile.y < this.zoneSize.height;
      return { entityIds, tile: inside ? tile : null };
    }
    return { entityIds, tile: null };
  }
}

function findEntityId(obj: THREE.Object3D | null): string | null {
  for (let o = obj; o; o = o.parent) {
    if (typeof o.userData.entityId === 'string') return o.userData.entityId;
  }
  return null;
}
