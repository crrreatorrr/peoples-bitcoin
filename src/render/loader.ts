/**
 * Asset manifest loader. Code refers to art only by logical id; the manifest
 * says whether that id is a sprite (a PNG under src/assets shown as a
 * camera-facing billboard, or an inventory icon), a GLB model, or a built-in
 * placeholder made from primitives. Swapping art = editing the manifest.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { z } from 'zod';
import manifestJson from '../config/assets.manifest.json';
import { buildPlaceholder, iconCanvas, terrainPart, type TerrainPart } from './placeholders';

const AssetEntrySchema = z
  .object({
    /** Built-in placeholder kind (see placeholders.ts). */
    placeholder: z.string().optional(),
    /** GLB/GLTF path relative to src/assets. */
    path: z.string().optional(),
    /** PNG path relative to src/assets. Takes precedence over path and placeholder. */
    sprite: z.string().optional(),
    /** World height of a sprite billboard, in tiles. */
    spriteHeight: z.number().default(1.7),
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

const MISSING: AssetEntry = {
  placeholder: 'box',
  color: '#ff00ff',
  scale: 1,
  rotationYDeg: 0,
  spriteHeight: 1,
};

/** Marks the billboard inside a sprite-based model, so renderers can flip and bob it. */
export const SPRITE_NAME = 'sprite';

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
      .filter(([, e]) => e.path && !e.sprite)
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
        this.sprites.set(id, tex);
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

  /** A new scene object for the id, wrapped in a group so callers can position it freely. */
  create(id: string): THREE.Group {
    const entry = this.entry(id);
    const root = new THREE.Group();
    const tex = this.sprites.get(id);
    if (tex) {
      root.add(billboard(tex, entry.spriteHeight));
      return root;
    }
    const source = this.models.get(id);
    const model = source ? cloneSkinned(source) : buildPlaceholder(entry);
    model.scale.multiplyScalar(entry.scale);
    model.rotation.y += THREE.MathUtils.degToRad(entry.rotationYDeg);
    root.add(model);
    return root;
  }

  /** Shared geometry + material for instanced terrain tiles. */
  terrainPart(id: string): TerrainPart {
    let part = this.terrain.get(id);
    if (!part) {
      part = terrainPart(this.entry(id));
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
      this.iconTextures.set(id, tex);
    }
    return tex;
  }

  /** Short text glyph (emoji) for UI tab/skill icons. */
  glyph(id: string): string {
    return this.entry(id).label ?? '?';
  }
}

/** A camera-facing sprite standing on the ground, `height` tiles tall. */
function billboard(tex: THREE.Texture, height: number): THREE.Sprite {
  const image = tex.image as { width: number; height: number };
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, alphaTest: 0.4 }));
  sprite.name = SPRITE_NAME;
  sprite.center.set(0.5, 0);
  sprite.scale.set((height * image.width) / image.height, height, 1);
  return sprite;
}
