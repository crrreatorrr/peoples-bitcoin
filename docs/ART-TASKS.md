# Art tasks

Found during the gameplay QA pass of 2026-11-24 (branch `claude/peaceful-thompson-mpaebu`). Nothing
here was attempted: each item needs new or redrawn art. Follow
`docs/higgsfield-workflow-guide.md` (this repo uses the sprite sheet workflow; the cast's 3D
models are the rigged GLBs under `src/assets/models/`) and `ART_GUIDE.md`.

## 1. Champion Sproto has no 3D model

- **Asset:** `src/assets/models/sp_champion.glb` (manifest id `sp_champion` in
  `src/config/assets.manifest.json`, `"path": "models/sp_champion.glb"`).
- **What is wrong:** the file does not exist. It is the only one of the 374 image and model paths
  in the manifest with no file behind it. The loader keeps the code-built stand-in whenever a
  GLB is missing (`src/render/loader.ts`, "keep the code-built placeholder until the file
  lands"), so the Champion Sproto is drawn as the generic blue humanoid placeholder described by
  the entry's `look` block, while the other five Sprotos (`sp_recruit`, `sp_medic`, `sp_grunt`,
  `sp_sniper`, `sp_heavy`) each have a rigged GLB. Its sprite, `src/assets/sprites/sp_champion.png`,
  is present.
- **How to see it:** `ls src/assets/models/sp_champion.glb` fails. In game, the Champion Sproto
  is the relic summon from Sproto Fighter's Tidebreaker Belt: with a hub session whose account
  owns that Relic, open the Summoning tab with no Sproto out and press Summon beside Champion
  Sproto. It appears as a flat-colored block figure next to the modeled cast.
- **Expected result:** a rigged low-poly GLB at that path, in the style and poly budget of the
  other Sprotos (ART_GUIDE.md: Sprotos at most 1.5k triangles), matching the look the manifest
  entry already describes: blue skin, back spines, a gold title belt, red hands, a rock in the
  right hand. It needs the same foot and joint rig the other Sproto GLBs use so the procedural
  walk and attack poses work (DECISIONS.md "Foot rigs for the whole cast"). No code change is
  needed once the file is in place: the manifest already points at it.
- **Already tracked:** TODO.md, "Champion Sproto art".
