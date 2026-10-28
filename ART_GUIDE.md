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
- Humanoids built in code have joints for hips, knees, shoulders, elbows and the neck
  (`src/render/actors.ts`); `src/render/animate.ts` poses them every frame. A GLB that replaces a
  character is shown as one body that hops (no clips are played yet).
- Held gear (`src/render/gear.ts`) has its grip at the origin; with the forearm pointing straight
  ahead, +Y is up and +Z is forward. Barrels run along +Z, handles along +Y. Guns put a hidden
  mesh named `muzzle` at the barrel tip for the muzzle flash.

## Manifest fields (`src/config/assets.manifest.json`)

| Field                                                    | Meaning                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `placeholder`                                            | Model built in code. Characters: `humanoid`, `sludge`, `wraith`, `sock`. Props: `rack`, `donor`, `podium`, `terminal`, `hatch`, `ladder`, `trench`, `barricade`, `hotspot`, `locker`, `medbay`, `desk`, `bunkbed`, `farm`, `armory`, `circle`, `tree`, `pillar`, `bench`, `flagpole`, `gremlin`, `board`, `booth`, `prop`. Terrain: `tile`, `wall`, `water` |
| `look`                                                   | How a `humanoid` looks (below)                                                                                                                                                                                                                                                                                                                              |
| `variant`                                                | Picks a version of a builder: donor `chicken`/`empty`/`gala`/`yacht`, farm `1`–`3`, armory `1`–`2`, sludge `mother`                                                                                                                                                                                                                                         |
| `path`                                                   | GLB/GLTF under `src/assets/`. Overrides `placeholder`                                                                                                                                                                                                                                                                                                       |
| `sprite`                                                 | PNG under `src/assets/`: 2D art for the UI only (inventory icons, Summoning-tab portraits, build menu). Never shown in the world                                                                                                                                                                                                                            |
| `scale`, `rotationYDeg`                                  | Applied to the model                                                                                                                                                                                                                                                                                                                                        |
| `color`, `accent`, `pattern`, `height`, `label`, `smoke` | Builder options                                                                                                                                                                                                                                                                                                                                             |

### Character looks

A `look` describes a humanoid: `head` (`human`, `goblin`, `phone`, `bear`, `sproto`, `robot`,
`blob`, `rock`), `skin`, `hair`, `hairStyle`, `top`, `sleeves`, `shirt`, `tie`, `pants`, `shoes`,
`coat`, `bib`, `belt`, `stripes`, `hood`, `hat`, `hatColor`, `glasses`, `mustache`, `mask`,
`scarf`, `eyes` (glowing), `hands`, armor layers (`vest`, `plate`, `pads`, `greaves`), held gear
(`right`, `left`: ids from `gear.ts`), `back` (`backpack`, `rug`, `spines`), `pose`, and
proportions (`build`, `legs`, `headSize`, `hunch`). Worn armor changes the player's look through
`ARMOR_LOOKS` in `gear.ts`.

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

## Sprites (2D UI art, from Higgsfield)

Characters, enemies, Sprotos, props and item icons were generated as 2D pixel-art sprites with
Higgsfield (`gpt_image_2_5`, transparent background, medium quality for sprites, low for icons),
then cropped to their alpha bounds and downscaled: sprites to at most 192 px
(`src/assets/sprites/`), icons to 64 × 64 (`src/assets/icons/`). Since 0.4.0 the world is fully
3D (camera-facing sprites leaned into walls as the camera turned); sprites are used for inventory
icons, portraits and menus, and the 3D looks were made to match them.

Prompt style: "Pixel art game sprite in a chunky retro MMO style, 3/4 front view, centered,
crisp dark outline, limited palette, transparent background, no text, no logos", plus the
subject. Human characters always add "fictional, does not resemble any real person".

## Pipeline (owner, later)

Concept image → image-to-3D GLB → Blender cleanup (decimate, flat-shade, 64×64 palette texture,
rig/animate) → export GLB → compress with `gltf-transform` (meshopt or draco) → drop into
`src/assets/` and set `path` in the manifest.
