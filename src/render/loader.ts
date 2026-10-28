/**
 * Asset manifest loader. Code refers to art only by logical id; the manifest
 * says whether that id is a placeholder (built from primitives) or a GLB file
 * under src/assets. Swapping final art = editing the manifest, not code.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { z } from 'zod';
import manifestJson from '../config/assets.manifest.json';
import { buildPlaceholder, iconDataUrl, terrainPart, type TerrainPart } from './placeholders';

const AssetEntrySchema = z
  .object({
    /** Built-in placeholder kind (see placeholders.ts). */
    placeholder: z.string().optional(),
    /** GLB/GLTF path relative to src/assets. Takes precedence over the placeholder. */
    path: z.string().optional(),
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
  .refine((e) => e.placeholder || e.path, 'needs a placeholder or a path');

export type AssetEntry = z.output<typeof AssetEntrySchema>;

const ASSET_URLS = import.meta.glob('../assets/**/*.{glb,gltf}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const MISSING: AssetEntry = { placeholder: 'box', color: '#ff00ff', scale: 1, rotationYDeg: 0 };

export class AssetLoader {
  private readonly models = new Map<string, THREE.Object3D>();
  private readonly icons = new Map<string, string>();
  private readonly terrain = new Map<string, TerrainPart>();
  private readonly warned = new Set<string>();

  private constructor(private readonly entries: Map<string, AssetEntry>) {}

  static async load(): Promise<AssetLoader> {
    const parsed = z.record(z.string(), AssetEntrySchema).parse(manifestJson);
    const loader = new AssetLoader(new Map(Object.entries(parsed)));
    await loader.preloadModels();
    return loader;
  }

  private async preloadModels(): Promise<void> {
    const gltf = new GLTFLoader();
    const jobs = [...this.entries]
      .filter(([, e]) => e.path)
      .map(async ([id, e]) => {
        const url = ASSET_URLS[`../assets/${e.path}`] ?? e.path!;
        this.models.set(id, (await gltf.loadAsync(url)).scene);
      });
    await Promise.all(jobs);
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
    const source = this.models.get(id);
    const model = source ? cloneSkinned(source) : buildPlaceholder(entry);
    model.scale.multiplyScalar(entry.scale);
    model.rotation.y += THREE.MathUtils.degToRad(entry.rotationYDeg);
    const root = new THREE.Group();
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

  /** Data URL for an inventory icon. */
  iconUrl(id: string): string {
    let url = this.icons.get(id);
    if (!url) {
      url = iconDataUrl(this.entry(id));
      this.icons.set(id, url);
    }
    return url;
  }

  /** Short text glyph (emoji) for UI tab/skill icons. */
  glyph(id: string): string {
    return this.entry(id).label ?? '?';
  }
}
