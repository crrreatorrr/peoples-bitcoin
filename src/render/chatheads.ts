/**
 * OSRS-style chat heads: a 3/4 portrait of a character's head and shoulders,
 * rendered once from their 3D model into an offscreen target and cached as an
 * image URL for the dialogue box.
 */
import * as THREE from 'three';
import type { Look } from './actors';
import type { AssetLoader } from './loader';

const SIZE = 64;
const TURN_RAD = 0.5;
const FOV_DEG = 28;

export class ChatHeads {
  private readonly target = new THREE.WebGLRenderTarget(SIZE, SIZE);
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.05, 20);
  private readonly pixels = new Uint8Array(SIZE * SIZE * 4);
  private readonly cache = new Map<string, string>();
  private readonly clearColor = new THREE.Color();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly assets: AssetLoader,
  ) {
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#6a5a40', 1.8));
    const key = new THREE.DirectionalLight('#fff4e0', 1.6);
    key.position.set(1.5, 2, 3);
    this.scene.add(key);
  }

  /** A portrait facing right (NPCs, drawn on the left) or left (the player, on the right). */
  url(modelId: string, dress: Partial<Look> = {}, facingLeft = false): string {
    const key = `${modelId}|${JSON.stringify(dress)}|${facingLeft}`;
    let url = this.cache.get(key);
    if (!url) {
      url = this.render(modelId, dress, facingLeft);
      this.cache.set(key, url);
    }
    return url;
  }

  private render(modelId: string, dress: Partial<Look>, facingLeft: boolean): string {
    const actor = this.assets.actor(modelId, dress);
    actor.root.rotation.y = facingLeft ? -TURN_RAD : TURN_RAD;
    this.scene.add(actor.root);
    actor.root.updateMatrixWorld(true);

    // Frame the head (or the top of a model without joints).
    const scale = actor.root.scale.y;
    const focus = new THREE.Vector3(0, actor.height * 0.8, 0);
    if (actor.joints) {
      actor.joints.head.getWorldPosition(focus);
      focus.y += 0.15 * scale;
    }
    const distance = 1.15 * scale;
    this.camera.position.set(focus.x, focus.y + 0.04 * scale, focus.z + distance);
    this.camera.lookAt(focus);

    const r = this.renderer;
    r.getClearColor(this.clearColor);
    const alpha = r.getClearAlpha();
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.camera);
    r.readRenderTargetPixels(this.target, 0, 0, SIZE, SIZE, this.pixels);
    r.setRenderTarget(null);
    r.setClearColor(this.clearColor, alpha);
    this.scene.remove(actor.root);

    // WebGL rows run bottom-up; flip them into a canvas.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(SIZE, SIZE);
    const row = SIZE * 4;
    for (let y = 0; y < SIZE; y++) {
      image.data.set(this.pixels.subarray((SIZE - 1 - y) * row, (SIZE - y) * row), y * row);
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL();
  }
}
