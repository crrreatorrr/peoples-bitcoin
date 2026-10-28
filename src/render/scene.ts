import * as THREE from 'three';
import { RENDER } from '../config/balance';

const SKY = '#8cc4e8';

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, RENDER.fogNear, RENDER.fogFar);

  scene.add(new THREE.HemisphereLight('#eef6ff', '#5a4a30', 1.6));
  const sun = new THREE.DirectionalLight('#fff1d6', 1.9);
  sun.position.set(-12, 24, 10);
  scene.add(sun);
  return scene;
}
