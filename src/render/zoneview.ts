/**
 * Everything drawn for one zone: its scene, terrain, entities and effects, plus
 * the picker that raycasts them. Rebuilt whenever the player changes zone.
 */
import type * as THREE from 'three';
import type { Content } from '../sim/content';
import type { GameState } from '../sim/state';
import { Bursts, HintArrow, Tracers } from './effects';
import { EntityRenderer } from './entities';
import { disposeScene } from './kit';
import type { AssetLoader } from './loader';
import { Picker } from './picking';
import { createScene } from './scene';
import { buildWorld } from './world';

export class ZoneView {
  readonly scene: THREE.Scene;
  readonly entities: EntityRenderer;
  readonly bursts: Bursts;
  readonly tracers: Tracers;
  readonly hint: HintArrow;
  readonly picker: Picker;

  constructor(
    state: GameState,
    content: Content,
    assets: AssetLoader,
    camera: THREE.Camera,
    canvas: HTMLElement,
  ) {
    const zone = content.zones.get(state.zone.id)!;
    this.scene = createScene();
    const terrain = buildWorld(this.scene, zone, content, assets);
    this.entities = new EntityRenderer(this.scene, assets, content, state);
    this.bursts = new Bursts(this.scene);
    this.tracers = new Tracers(this.scene);
    this.hint = new HintArrow(this.scene);
    this.picker = new Picker(camera, canvas, terrain, this.entities.pickables, zone);
  }

  /** Frees this zone's GPU memory once another zone replaces it. */
  dispose(): void {
    disposeScene(this.scene);
  }
}
