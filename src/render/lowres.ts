/**
 * Low-res renderer: the WebGL drawing buffer is a fraction of the CSS size and
 * the browser upscales it with nearest-neighbor (`image-rendering: pixelated`).
 */
import * as THREE from 'three';
import { RENDER } from '../config/balance';

export function createLowResRenderer(container: HTMLElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(RENDER.resolutionScale);
  renderer.domElement.classList.add('game-canvas');
  container.appendChild(renderer.domElement);
  return renderer;
}

/** Matches the drawing buffer and camera to the container size. */
export function fitToContainer(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  container: HTMLElement,
): void {
  const { clientWidth: w, clientHeight: h } = container;
  renderer.setSize(w, h);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
