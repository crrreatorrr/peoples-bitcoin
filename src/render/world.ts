/**
 * Static zone geometry: one InstancedMesh per terrain type. Returns the meshes
 * so the picker can raycast them for click-to-walk.
 */
import * as THREE from 'three';
import type { Content } from '../sim/content';
import type { ZoneDef } from '../sim/schemas';
import type { AssetLoader } from './loader';

const OUTER_GROUND = '#3d5f27';
/** Per-tile brightness jitter so flat ground reads as tiles. */
const TILE_TINT_RANGE = 0.12;

export function buildWorld(
  scene: THREE.Scene,
  zone: ZoneDef,
  content: Content,
  assets: AssetLoader,
): THREE.InstancedMesh[] {
  const tilesByTerrain = new Map<string, { x: number; y: number }[]>();
  zone.tiles.forEach((row, y) => {
    for (let x = 0; x < zone.width; x++) {
      const terrainId = zone.legend[row[x]];
      let list = tilesByTerrain.get(terrainId);
      if (!list) tilesByTerrain.set(terrainId, (list = []));
      list.push({ x, y });
    }
  });

  const meshes: THREE.InstancedMesh[] = [];
  const matrix = new THREE.Matrix4();
  const tint = new THREE.Color();
  for (const [terrainId, tiles] of tilesByTerrain) {
    const terrain = content.terrain.get(terrainId)!;
    const { geometry, material } = assets.terrainPart(terrain.model);
    const mesh = new THREE.InstancedMesh(geometry, material, tiles.length);
    tiles.forEach((t, i) => {
      mesh.setMatrixAt(i, matrix.makeTranslation(t.x + 0.5, 0, t.y + 0.5));
      const jitter = 1 - TILE_TINT_RANGE / 2 + tileNoise(t.x, t.y) * TILE_TINT_RANGE;
      mesh.setColorAt(i, tint.setScalar(jitter));
    });
    mesh.computeBoundingSphere();
    scene.add(mesh);
    meshes.push(mesh);
  }

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(zone.width * 6, zone.height * 6),
    new THREE.MeshLambertMaterial({ color: OUTER_GROUND }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(zone.width / 2, -0.12, zone.height / 2);
  scene.add(ground);

  return meshes;
}

function tileNoise(x: number, y: number): number {
  const h = Math.imul((x * 73856093) ^ (y * 19349663), 2654435761);
  return ((h >>> 0) % 1000) / 1000;
}
