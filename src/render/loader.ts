/**
 * Asset manifest loader. Code refers to art only by logical id; the manifest
 * says whether that id is a GLB model or a model built in code (a placeholder
 * kind, with a `look` for characters). A `sprite` is 2D art for the UI only:
 * inventory icons, portraits in the Summoning tab and build menu. Swapping art
 * = editing the manifest.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { z } from 'zod';
import { UI } from '../config/balance';
import manifestJson from '../config/assets.manifest.json';
import {
  buildActor,
  LookSchema,
  PLAYER_MODEL,
  staticActor,
  type ActorModel,
  type Look,
} from './actors';
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
    /** PNG path relative to src/assets: crisp pixel-art UI icon (tools/ui-art). See UI.pixelIcons. */
    pixel: z.string().optional(),
    /** Picks a version of a placeholder builder. */
    variant: z.string().optional(),
    /** How a humanoid looks (see actors.ts). */
    look: LookSchema.optional(),
    scale: z.number().default(1),
    rotationYDeg: z.number().default(0),
    /** How an unrigged GLB character moves: hops (default) or floats. */
    motion: z.enum(['hop', 'float']).optional(),
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
  .refine(
    (e) => e.placeholder || e.path || e.sprite || e.pixel,
    'needs a sprite, a pixel icon, a path or a placeholder',
  );

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

/** A GLTFLoader that reads the meshopt-compressed GLBs in src/assets/models. */
export function createGltfLoader(): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}

export class AssetLoader {
  private readonly models = new Map<string, THREE.Object3D>();
  private readonly icons = new Map<string, HTMLCanvasElement>();
  private readonly iconTextures = new Map<string, THREE.Texture>();
  private readonly terrain = new Map<string, TerrainPart>();
  private readonly warned = new Set<string>();

  private constructor(private readonly entries: Map<string, AssetEntry>) {}

  /** The manifest, with no models fetched yet: see `ensure` and `ensureAll`. */
  static create(): AssetLoader {
    const parsed = z.record(z.string(), AssetEntrySchema).parse(manifestJson);
    return new AssetLoader(new Map(Object.entries(parsed)));
  }

  /** Every model at once (tests and tools). The game loads per zone (src/render/zoneAssets.ts). */
  static async load(): Promise<AssetLoader> {
    const loader = AssetLoader.create();
    await loader.ensureAll();
    return loader;
  }

  private readonly gltf = createGltfLoader();
  /** One fetch and parse per GLB URL, however many ids share it. */
  private readonly byUrl = new Map<string, Promise<THREE.Object3D | null>>();
  private readonly loading = new Map<string, Promise<void>>();
  /** Ids drawn as placeholders while their GLB was still loading (see takeMissed). */
  private missed = new Set<string>();

  /** The GLB URL for an id, or null for a code-built model (or art still to come). */
  private modelUrl(id: string): string | null {
    const e = this.entries.get(id);
    if (!e?.path) return null;
    const bundled = MODEL_URLS[`../assets/${e.path}`];
    // A registered GLB that isn't in src/assets yet is art still to come (ART_GUIDE.md):
    // keep the code-built placeholder until the file lands, instead of failing the boot.
    if (!bundled && e.placeholder) return null;
    return bundled ?? e.path;
  }

  /** Loads the GLBs for these ids (once each); resolves when they are ready. */
  ensure(ids: Iterable<string>): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const id of ids) {
      if (this.models.has(id)) continue;
      let job = this.loading.get(id);
      if (!job) {
        const url = this.modelUrl(id);
        if (!url) continue;
        let scene = this.byUrl.get(url);
        if (!scene) {
          scene = this.gltf.loadAsync(url).then((g) => g.scene);
          this.byUrl.set(url, scene);
        }
        job = scene.then((root) => {
          if (root) this.models.set(id, root);
        });
        this.loading.set(id, job);
      }
      jobs.push(job);
    }
    return Promise.all(jobs).then(() => undefined);
  }

  /** Loads every GLB in the manifest. */
  ensureAll(): Promise<void> {
    return this.ensure(this.entries.keys());
  }

  /** Whether every GLB for these ids is loaded. */
  ready(ids: Iterable<string>): boolean {
    for (const id of ids) if (!this.models.has(id) && this.modelUrl(id)) return false;
    return true;
  }

  /** Ids drawn as placeholders since the last call because their GLB had not landed yet. */
  takeMissed(): Set<string> {
    const missed = this.missed;
    this.missed = new Set();
    return missed;
  }

  private source(id: string): THREE.Object3D | undefined {
    const source = this.models.get(id);
    if (!source && this.modelUrl(id)) this.missed.add(id);
    return source;
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
    const source = this.source(id);
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
    const source = this.source(id);
    if (source && isRigged(source))
      return riggedActor(source, entry.scale, { ...held(entry), ...dress }, id === PLAYER_MODEL);
    if (source) return staticActor(this.model(id, entry), entry.motion);
    const actor = buildActor(entry, dress) ?? staticActor(this.model(id, entry));
    actor.playerLocomotion = id === PLAYER_MODEL;
    return actor;
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

  private pixelUrl(e: AssetEntry): string | null {
    return e.pixel ? (IMAGE_URLS[`../assets/${e.pixel}`] ?? null) : null;
  }

  /** The PNG to show for an icon, if any: pixel art or sprite, per UI.pixelIcons. */
  imageUrl(id: string): string | null {
    const e = this.entry(id);
    const [first, second] = UI.pixelIcons
      ? [this.pixelUrl(e), this.spriteUrl(e)]
      : [this.spriteUrl(e), this.pixelUrl(e)];
    return first ?? second;
  }

  /** URL for an inventory icon: a PNG if there is one, else a drawn placeholder. */
  iconUrl(id: string): string {
    return this.imageUrl(id) ?? this.icon(id).toDataURL();
  }

  /** The icon as a texture, for items lying on the ground, loaded on first use. */
  iconTexture(id: string): THREE.Texture {
    let tex = this.iconTextures.get(id);
    if (tex) return tex;
    const url = this.imageUrl(id);
    if (url) {
      tex = new THREE.TextureLoader().load(url);
      tex.generateMipmaps = false;
    } else {
      tex = new THREE.CanvasTexture(this.icon(id));
    }
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.iconTextures.set(id, share(tex));
    return tex;
  }

  /**
   * Fetches the small pixel icons into the browser cache once the game is idle, so the first
   * look at the pack, bank or Terminal shows them at once. Sprite portraits (Summoning, build
   * menu) stay on demand: they are bigger and only those two panels show them.
   */
  warmIcons(): void {
    const urls = new Set<string>();
    for (const e of this.entries.values()) {
      const url = this.pixelUrl(e);
      if (url) urls.add(url);
    }
    const run = () => {
      for (const url of urls) {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
      }
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 });
    else setTimeout(run, 1000);
  }

  /** Short text glyph (emoji) for UI tab/skill icons. */
  glyph(id: string): string {
    return this.entry(id).label ?? '?';
  }
}
