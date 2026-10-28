/**
 * Asset manifest loader. Code refers to art only by logical id; the manifest
 * says whether that id is a GLB model or a model built in code (a placeholder
 * kind, with a `look` for characters). A `sprite` is 2D art for the UI only:
 * inventory icons, portraits in the Summoning tab and build menu. Swapping art
 * = editing the manifest.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { z } from 'zod';
import manifestJson from '../config/assets.manifest.json';
import { buildActor, LookSchema, staticActor, type ActorModel, type Look } from './actors';
import { share } from './kit';
import { flatten, isRigged, riggedActor } from './rigged';
import { buildPlaceholder, iconCanvas, terrainPart, type TerrainPart } from './placeholders';

const AssetEntrySchema = z
  .object({
    /** Built-in placeholder kind (see placeholders.ts). */
    placeholder: z.string().optional(),
    /** GLB/GLTF path relative to src/assets. */
    path: z.string().optional(),
    /** PNG path relative to src/assets: 2D art for icons and portraits, never shown in the world. */
    sprite: z.string().optional(),
    /** Picks a version of a placeholder builder. */
    variant: z.string().optional(),
    /** How a humanoid looks (see actors.ts). */
    look: LookSchema.optional(),
    scale: z.number().default(1),
    rotationYDeg: z.number().default(0),
    /** Logical clip name → clip name inside the GLB. */
    clips: z.record(z.string(), z.string()).optional(),
    color: z.string().default('#ff00ff'),
    accent: z.string().optional(),
    skin: z.string().optional(),
    hair: z.string().optional(),
    pattern: z.string().optional(),
    height: z.number().optional(),
    label: z.string().optional(),
    glasses: z.boolean().optional(),
    smoke: z.boolean().optional(),
  })
  .refine((e) => e.placeholder || e.path || e.sprite, 'needs a sprite, a path or a placeholder');

export type AssetEntry = z.output<typeof AssetEntrySchema>;

const MODEL_URLS = import.meta.glob('../assets/**/*.{glb,gltf}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const IMAGE_URLS = import.meta.glob('../assets/**/*.png', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** What a rigged character holds and how it stands; its mesh already shows the rest of the look. */
function held(entry: AssetEntry): Partial<Look> {
  const { left, right, pose } = entry.look ?? {};
  return { left, right, pose };
}

const MISSING: AssetEntry = {
  placeholder: 'box',
  color: '#ff00ff',
  scale: 1,
  rotationYDeg: 0,
};

export class AssetLoader {
  private readonly models = new Map<string, THREE.Object3D>();
  private readonly sprites = new Map<string, THREE.Texture>();
  private readonly icons = new Map<string, HTMLCanvasElement>();
  private readonly iconTextures = new Map<string, THREE.Texture>();
  private readonly terrain = new Map<string, TerrainPart>();
  private readonly warned = new Set<string>();

  private constructor(private readonly entries: Map<string, AssetEntry>) {}

  static async load(): Promise<AssetLoader> {
    const parsed = z.record(z.string(), AssetEntrySchema).parse(manifestJson);
    const loader = new AssetLoader(new Map(Object.entries(parsed)));
    await Promise.all([loader.preloadModels(), loader.preloadSprites()]);
    return loader;
  }

  private async preloadModels(): Promise<void> {
    const gltf = new GLTFLoader();
    const jobs = [...this.entries]
      .filter(([, e]) => e.path)
      .map(async ([id, e]) => {
        const url = MODEL_URLS[`../assets/${e.path}`] ?? e.path!;
        this.models.set(id, (await gltf.loadAsync(url)).scene);
      });
    await Promise.all(jobs);
  }

  private async preloadSprites(): Promise<void> {
    const loader = new THREE.TextureLoader();
    const jobs = [...this.entries]
      .filter(([, e]) => e.sprite)
      .map(async ([id, e]) => {
        const url = this.spriteUrl(e);
        if (!url) return;
        const tex = await loader.loadAsync(url);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        this.sprites.set(id, share(tex));
      });
    await Promise.all(jobs);
  }

  private spriteUrl(e: AssetEntry): string | null {
    return e.sprite ? (IMAGE_URLS[`../assets/${e.sprite}`] ?? null) : null;
  }

  entry(id: string): AssetEntry {
    const e = this.entries.get(id);
    if (e) return e;
    if (!this.warned.has(id)) {
      this.warned.add(id);
      console.warn(`[assets] unknown asset id '${id}', using a magenta box`);
    }
    return MISSING;
  }

  /**
   * A new scene object for the id, wrapped in a group so callers can position
   * it freely. Characters used as objects (lobbyists) carry their ActorModel in
   * `userData.actor` so they can be animated.
   */
  create(id: string): THREE.Group {
    const entry = this.entry(id);
    const root = new THREE.Group();
    const source = this.models.get(id);
    const actor = source
      ? isRigged(source)
        ? riggedActor(source, entry.scale, held(entry))
        : null
      : buildActor(entry);
    if (actor) {
      root.add(actor.root);
      root.userData.actor = actor;
      return root;
    }
    root.add(this.model(id, entry));
    return root;
  }

  /** A character model; `dress` changes its look (worn armor, held gear). */
  actor(id: string, dress: Partial<Look> = {}): ActorModel {
    const entry = this.entry(id);
    const source = this.models.get(id);
    if (source && isRigged(source))
      return riggedActor(source, entry.scale, { ...held(entry), ...dress });
    if (source) return staticActor(this.model(id, entry));
    return buildActor(entry, dress) ?? staticActor(this.model(id, entry));
  }

  private model(id: string, entry: AssetEntry): THREE.Object3D {
    const source = this.models.get(id);
    const model = source ? cloneSkinned(source) : buildPlaceholder(entry);
    if (source) flatten(model);
    model.scale.multiplyScalar(entry.scale);
    model.rotation.y += THREE.MathUtils.degToRad(entry.rotationYDeg);
    return model;
  }

  /** Shared geometry + material for instanced terrain tiles. */
  terrainPart(id: string): TerrainPart {
    let part = this.terrain.get(id);
    if (!part) {
      part = terrainPart(this.entry(id));
      share(part.geometry);
      share(part.material);
      this.terrain.set(id, part);
    }
    return part;
  }

  private icon(id: string): HTMLCanvasElement {
    let canvas = this.icons.get(id);
    if (!canvas) {
      canvas = iconCanvas(this.entry(id));
      this.icons.set(id, canvas);
    }
    return canvas;
  }

  /** URL for an inventory icon: the sprite PNG if there is one, else a drawn placeholder. */
  iconUrl(id: string): string {
    return this.spriteUrl(this.entry(id)) ?? this.icon(id).toDataURL();
  }

  /** The icon as a texture, for items lying on the ground. */
  iconTexture(id: string): THREE.Texture {
    let tex = this.iconTextures.get(id) ?? this.sprites.get(id);
    if (!tex) {
      tex = new THREE.CanvasTexture(this.icon(id));
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.iconTextures.set(id, share(tex));
    }
    return tex;
  }

  /** Short text glyph (emoji) for UI tab/skill icons. */
  glyph(id: string): string {
    return this.entry(id).label ?? '?';
  }
}
