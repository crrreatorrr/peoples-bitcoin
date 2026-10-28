# Art guide

## Rules

- **No likeness of real people.** No real faces, names, signatures or recognizable outfits of
  real public figures. The President is a generic suited figure the player will customize.
- **No trademarked characters.** No wizard boys, blue hedgehogs, studio mascots or anything that
  reads as one. The Gremlin mascot and Sprotos are original designs.
- **Teen-friendly.** Guns are chunky, cartoon and low-poly. No gore; defeated enemies poof into
  sludge.

## Style

- Low-poly and flat-shaded. Silhouettes should read at 7–24 units of camera distance and at
  ~55% render resolution, so favor big shapes and one strong prop over detail.
- 64×64 textures (palette strips or simple patterns), nearest filtering, no mipmaps.
- **Poly budgets:** Sprotos ≤ 1.5k tris, bosses ≤ 6k tris, props a few hundred.

## Conventions (so a GLB can replace a placeholder with no code changes)

- 1 world unit = 1 tile. Humans are ~1.5 units tall; Sprotos ~0.6.
- Origin at the feet (y = 0), centered on the footprint, model facing **+Z**.
- Multi-tile objects are centered on their whole footprint (e.g. the 2×1 RoadMap board).
- Humanoid placeholders expose parts named `legL`, `legR`, `armL`, `armR` and `tool`. GLBs should
  instead provide clips; map logical names (`idle`, `walk`, `mine`, …) to clip names with the
  manifest's `clips` field.

## Manifest fields (`src/config/assets.manifest.json`)

| Field                                                                               | Meaning                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `sprite`, `spriteHeight`                                                            | PNG under `src/assets/` shown as a billboard (or icon); height in tiles. Overrides `path` and `placeholder`                                 |
| `placeholder`                                                                       | Built-in primitive: `tile`, `wall`, `water`, `humanoid`, `rack`, `tree`, `pillar`, `bench`, `flagpole`, `gremlin`, `board`, `icon`, `glyph` |
| `path`                                                                              | GLB/GLTF under `src/assets/`. Overrides `placeholder`                                                                                       |
| `scale`, `rotationYDeg`                                                             | Applied to the model after loading                                                                                                          |
| `clips`                                                                             | Logical animation name → clip name in the GLB                                                                                               |
| `color`, `accent`, `skin`, `hair`, `pattern`, `height`, `label`, `glasses`, `smoke` | Placeholder options                                                                                                                         |

## Palette (placeholders)

| Use                  | Color                 |
| -------------------- | --------------------- |
| Grass                | `#4e7a31`             |
| Path                 | `#8d7e63`             |
| Marble floor         | `#d3cab7`             |
| Carpet / accent gold | `#8a1d2a` / `#d2a63a` |
| Stone wall           | `#b8b0a0`             |
| UI gold              | `#f2c14e`             |
| Price up / down      | `#3fdc5a` / `#ff5a4d` |

## Sprites (current art, from Higgsfield)

Characters, enemies, Sprotos, props and item icons are 2D pixel-art sprites generated with
Higgsfield (`gpt_image_2_5`, transparent background, medium quality for sprites, low for icons),
then cropped to their alpha bounds and downscaled: world sprites to at most 192 px
(`src/assets/sprites/`), icons to 64 × 64 (`src/assets/icons/`). The world itself stays low-poly
3D. In the manifest an entry's `sprite` (path under `src/assets/`) wins over `path` and
`placeholder`; `spriteHeight` is its height in tiles. Sprites stand on the ground as camera-facing
billboards, flip to face their direction of travel and bob while walking.

Prompt style: "Pixel art game sprite in a chunky retro MMO style, 3/4 front view, centered,
crisp dark outline, limited palette, transparent background, no text, no logos", plus the
subject. Human characters always add "fictional, does not resemble any real person".

## Pipeline (owner, later)

Concept image → image-to-3D GLB → Blender cleanup (decimate, flat-shade, 64×64 palette texture,
rig/animate) → export GLB → compress with `gltf-transform` (meshopt or draco) → drop into
`src/assets/` and set `path` in the manifest.
