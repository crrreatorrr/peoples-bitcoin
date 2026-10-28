# Art guide

## Rules

- **Real people: satire only.** The President is a stylized low-poly caricature inspired by Barack
  Obama (owner-approved, named "President Obama" with a parody notice). Never photorealistic,
  never a signature, nothing that reads as a real endorsement. No other real people; private
  individuals only with their consent.
- **No trademarked characters.** No wizard boys, blue hedgehogs, studio mascots or anything that
  reads as one. The Gremlin mascot and Sprotos are original designs.
- **Teen-friendly.** Guns are chunky, cartoon and low-poly. No gore; defeated enemies poof into
  sludge.

## Style

- Low-poly and flat-shaded. Silhouettes should read at 7–24 units of camera distance and at
  ~55% render resolution, so favor big shapes and one strong prop over detail.
- Code-built props: 64×64 textures (palette strips or simple patterns), nearest filtering, no
  mipmaps. Character GLBs: one 512 px JPEG texture, drawn flat-shaded and matte.
- **Poly budgets:** characters ~3k tris (Tripo `face_limit` 3000), props a few hundred.

## Conventions (so a GLB can replace a placeholder with no code changes)

- 1 world unit = 1 tile. Humans are ~1.8 units tall; Sprotos ~1.1; bosses up to ~2.5.
- Origin at the feet (y = 0), centered on the footprint, model facing **+Z**.
- Multi-tile objects are centered on their whole footprint (e.g. the 2×1 RoadMap board).
- Humanoids built in code have joints for hips, knees, shoulders, elbows and the neck
  (`src/render/actors.ts`); `src/render/animate.ts` poses them every frame.
- **Rigged GLBs** with the Meshy skeleton (`Hips`, `Spine`, `Spine02`, `Head`, `LeftArm`,
  `LeftForeArm`, `LeftHand`, `LeftUpLeg`, `LeftLeg`, `LeftFoot` and the right-side bones) get the
  same procedural animation (`src/render/rigged.ts`): arms are turned down out of the A-pose,
  held gear hangs from the hand bones, and worn armor is overlaid on the bones. Clips in the GLB
  are ignored. Rig at the character's in-game height so its `scale` stays 1.
- A GLB without that skeleton is one body that hops, or floats with `"motion": "float"`.
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
| `motion`                                                 | How an unrigged GLB character moves: `hop` (default) or `float`                                                                                                                                                                                                                                                                                             |
| `color`, `accent`, `pattern`, `height`, `label`, `smoke` | Builder options                                                                                                                                                                                                                                                                                                                                             |

### Character looks

For a rigged GLB only `left`, `right` and `pose` are read from the `look`; the mesh is the rest.

A `look` describes a code-built humanoid: `head` (`human`, `goblin`, `phone`, `bear`, `sproto`, `robot`,
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
subject. Human characters add "fictional, does not resemble any real person" unless they're an
approved caricature (DESIGN.md §0, rule 2).

## Character pipeline (Higgsfield, 0.5.0)

1. **Concept:** `gpt_image_2_5`, 3:4, medium quality, in the locked style below plus
   "Character: ...". Review all concepts on one contact sheet before spending on 3D.
2. **Mesh:** Tripo H3.1 image-to-3D from the concept (`face_limit` 3000, `pbr` false,
   `texture` true). The result is 1 unit tall, centered, and faces **+x**.
3. **Turn:** `python3 tools/turn_glb.py in.glb out.glb` turns it to face +z and stands it on
   y = 0. Skip this and the auto-rigger builds a broken skeleton (hands at the hips).
4. **Rig** (anything with arms and legs): upload the turned GLB, then Meshy rigging with
   `model_url` and `height_meters` = the character's in-game height. Check the skeleton: left
   arm on +x, toes pointing +z.
5. **Shrink:** `python3 tools/shrink_glb.py in.glb src/assets/models/<id>.glb` (512 px JPEG
   texture, ~270 KB per character).
6. **Manifest:** set `"path": "models/<id>.glb"`. Rigged: no `scale`. Unrigged (1 unit tall):
   `scale` = height. Keep `look.left`/`right`/`pose` for held gear.

Costs (Oct 2026): concept 0.5 credits, Tripo 9, rigging 5.

**Locked style prompt (characters):** "3D character model in the exact style of a classic
early-2000s low-poly browser MMORPG, in-engine render: extremely low polygon count (around 400
polygons), large flat angular planes with soft simple vertex shading, no textures, no outlines, no
specular, matte. Head: blocky angular head; the face is a flat skin-colored mask with two small
black almond-slit eyes (just black triangles, no pupils, no whites), a tiny dark slit mouth, and a
nose formed by a single angular facet. Hair made of a few large flat spiky triangular shards.
Body: big boxy barrel chest, wide square shoulders, thick tapered tube arms and legs, simple
blocky mitten hands, wide chunky flat feet. Clothing is big flat color blocks. Full body, front
view, standing in an A-pose with both arms angled down about 40 degrees away from the body, empty
hands, nothing held. Plain light grey background, even lighting, no shadow, no text, no logo."
Fictional characters end with "Fictional, does not resemble any real person."

**Creatures** use "3D creature model in the exact style of ... (same render notes) ... Full body,
three-quarter front view, centered, standing on the ground", then "Creature: ...".

Held items are left out of concepts (empty hands) and come from `gear.ts`, so they can change
with what the character wields.
