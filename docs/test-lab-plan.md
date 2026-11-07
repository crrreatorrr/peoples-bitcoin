# Test Lab plan: The People's Bitcoin

Status: plan only, nothing built yet. Written 7 November 2026 from a read-only pass over `main` at `b8b6fb2`.
Implementer: Cursor, on branch `cursor/test-lab`. Read `DESIGN.md`, `DECISIONS.md` and `TODO.md` first, as `AGENTS.md` requires.

## What the lab is for

A page at `/peoples-bitcoin/lab.html` that loads on its own. It shows:
- every actor: the President, 28 enemies (13 of them bosses), 19 NPCs and 5 Sprotos;
- every procedural animation;
- every held weapon and armour piece;
- tile position, range and aggro;
- a live sandbox in a real zone where you can spawn anything and fight it.

## Owner decisions (7 November 2026, the same for every game repo)

These answers came from the owner's Q&A and apply to every game. Repo-specific sections below may add to them, but never relax them.

1. **A separate page.** The lab is its own HTML entry, `lab.html`, at the root of the built site, with its own JS bundle. The game's `index.html` must not import, link to or preload anything from the lab.
   - Measure the game's load before and after: JS bytes, request count and time to first frame. Put both sets of numbers in the PR. The game's numbers must not change.
2. **A hidden URL in production.** The lab ships in the production build at `lab.html`, relative to the game's base path.
   - Nothing in the game links to it.
   - It has `<meta name="robots" content="noindex,nofollow">`.
   - It must pass every existing production check, including banned-string scans. The repo section lists them.
3. **Desktop browser only:** keyboard and mouse. No touch layout.
4. **Automated QA.** Expose a small automation API on `window.testLab`. Never reuse an existing debug handle name. It needs at least:
   - `list()`, which returns every entity with its id, kind and animations/attacks;
   - `select(id)`;
   - `play(clipOrAttack)`;
   - `step(n)`;
   - `state()`, which returns position, velocity, state, clip, frame and HP;
   - `ready`, a promise that resolves when the current view has finished loading and drawing.

   Add a headless script (Playwright or CDP) that opens `lab.html`, visits every entity and every animation, and fails on console errors, failed requests or a blank canvas. Wire it into the repo's checks where browser checks already exist.
5. **Interaction:**
   - **Playback controls:** play, pause, step ±1 frame or tick, speed from 0.1× to 4×, scrub and loop.
   - **Live sandbox:** drive the character with the game's own controls. Show a live readout of position, velocity, facing, state, current animation and frame.
   - **Overlays:** see item 8.
   - **Spawn and fire:** spawn any enemy or boss; force any boss phase or attack; set HP; freeze AI; give any weapon, item or power-up; fire any attack on demand.
6. **Extras:**
   - **Load-time panel.** For each asset show bytes, fetch ms, decode ms and whether it came from cache; show a total per character. Load each character only when it is selected, never the whole roster up front. Use `PerformanceResourceTiming` plus timing around decode.
   - **Side-by-side compare.** Two entities, or two phases or variants of one entity, on one shared clock.
   - **Share links.** Keep all view state in the URL hash, for example `#tab=anim&id=x&clip=y&frame=12`, so a reload restores the exact view. Add a "Save PNG" button.
7. **No sim edits.** The lab is lab-only code. Do not change gameplay or sim files, or anything that changes a sim fingerprint, server bundle, replay golden or gameplay hash.
   - If the lab needs a private value, such as a collision function the game does not export, mirror it in lab code.
   - Add a unit test that fails when the mirror drifts from the source, for example by comparing outputs on sample inputs.
8. **Overlays show the game's truth plus the art's bounds.** Draw exactly what gameplay uses (hit, hurt and collision shapes; anchors; muzzle and spawn points) in one colour, and the sprite or model bounds in another, so mismatches are obvious. Also draw a grid with world coordinates.
9. **Accepted art only.** The roster lists only art the game currently uses. Pending or archived art may appear only in a tab labelled "Archive (not in game)", never in the sandbox.
10. **Isolation.** The lab never writes the player's real save, never takes tab or writer locks, never initialises the hub and never sends scores or tickets. Use an in-memory save with everything unlocked.
11. **Free-form per repo.** Fit the layout to the game. There is no shared kit across repos.
12. **Branch and PR.** Work on `cursor/test-lab`. It was created from the latest `main` with this plan committed. Commit after each phase below, and open a PR into `main` when done. Never push to `main`. Run every repo check and report any you could not run. A different agent reviews the PR.

## Facts this plan relies on

- **Rendering:** Three.js r186 with procedural animation. There are no clips and no sprite frames.
  - `poseActor(actor, AnimInput)` in `src/render/animate.ts:63` is a pure function. You can drive it with made-up inputs: `moving`, `running`, `phase`, `combat`, `work`, `attackAt`/`attackStyle`, `hitAt`, `diedAt`.
  - Timings: `ATTACK_MS` 520, `HIT_MS` 320, `DEATH_MS` 1100.
  - Stances: `HoldKind` in `src/render/gear.ts:14`.
  - Motion modes: `walk`, `hop`, `float` (`src/render/actors.ts:116`).
  - Rigged GLBs are posed through proxy joints (`src/render/rigged.ts`).
- **Assets:** a manifest, `src/config/assets.manifest.json`. `src/render/loader.ts` has `create(id)`, `actor(id, dress)` and `iconUrl(id)`.
  - `AssetLoader.load()` preloads every GLB, about 9.5 MB. **The lab must not call it.** Add a per-id load path in lab code; it can wrap the loader's internals without changing them.
- **Content:** JSON in `src/data/`, loaded by `loadContent()` (`src/sim/content.ts:121`):
  - `enemies.json`: 28 entries; bosses have a `boss` block with `adds`.
  - `npcs.json`: 19. `sprotos.json`: 5. `items.json`: 124, of which 21 have a `weapon` block. `objects.json`: 77. `zones.json`: 7.
- **Sim:** tile grid, 600 ms ticks, pure and enforced. Entry points: `runTick`, `createGameState`, `buildGrids`.
  - There are no hitboxes: each entity takes one tile, reach is cardinal adjacency or weapon `range`, and enemies have `aggroRange`.
- **Projectiles are render-only:** `Tracers.fire`, `Bursts.spawn` (`src/render/effects.ts`). Hitsplats are DOM (`src/ui/hitsplats.ts`).
- **Existing dev hook:** `window.__game` in `src/main.ts:711` (DEV only). `main.ts` is a 998-line monolith that can't be imported; reuse the modules it wires together instead.
- **Collision risks:**
  - `claimWriter` takes the `peoples-bitcoin.writer` lock.
  - The save key is `peoples-bitcoin.save`.
  - `HubBridge.init` waits up to 8 s.
  - **The lab must not call any of them.**
- **Sim version:** anything changed under `src/sim` or `src/config` changes `__PB_SIM_VERSION__` and forces a world-server rebuild. **Lab code lives in `src/lab/` only.**
- **Existing precedent:** the code-split dynamic import in `src/game/online.ts:30`.

## Owner decisions applied here

- **Overlays.** There are no hitboxes, so "game truth" here means:
  - the occupied tile and footprint (`footprintOf`);
  - weapon range in tiles, as a ring of tiles;
  - aggro range;
  - the A* path the entity is following;
  - the tile grid with `x,y` labels.

  "Art bounds" means each model's `Box3`. Show both.
- **Boss control:**
  - spawn any boss with its `adds`;
  - set HP;
  - freeze or unfreeze its AI;
  - force an attack style (melee, gun, explosive, magic) on the render side;
  - in the sandbox, fight it with any equipped weapon.

## Tabs

1. **Roster.** Grid of every actor, grouped Player / Enemies / Bosses / NPCs / Sprotos / Lobbyists, with thumbnails from `iconUrl`. Show manifest id, the model it reuses and its scale (for example, `enemy_pundit` reuses `enemy_heckler.glb` at 1.15), plus JSON stats.
2. **Animation.** One actor on a turntable, with an orbit camera.
   - Buttons for idle, walk, run, each `work` (swing, hammer, gesture, type), attack in each style, hit, death, phone pose, and the motion modes.
   - Playback controls drive a fake clock into `poseActor`.
   - Show bone names and joint axes for rigged models.
3. **Gear.** Pick any actor and any of the 21 weapons, every `GEAR` entry and every `ARMOR_LOOKS` entry. See it held in each `HoldKind` stance. Fire a tracer or burst of the weapon's `ShotKind`. Show weapon stats from `items.json`.
4. **Sandbox (real sim).**
   - Choose a zone from `zones.json`. Build state with `createGameState(content, zoneId, seed)` and render it with `ZoneView`.
   - Controls: pause, step one tick, ticks per second (0.1×–4×).
   - Click a tile to move the President (send intents exactly as the game does). Spawn any enemy, boss or Sproto on a chosen tile, and equip any item.
   - Inspector panel for the selected entity: id, `x,y`, `from`, HP, state, target, current path.
   - Teleport the player. Kill all. Reset with a seed.
5. **Compare.** Two actors, or one actor in two gear sets, side by side on one clock.
6. **Zones.** A top-down view of each zone's tile legend, with object, NPC and enemy spawn points and coordinates.
7. **Loading.** The load-time panel.
8. **Icons & sprites.** The 120 icons and 64 UI sprites in a grid with their ids. Missing files are flagged.

## Files

- **Add:**
  - `lab.html` (root, next to `index.html`)
  - `src/lab/main.ts` and lab modules under `src/lab/`
  - `tests/lab/*.test.ts` (Vitest, node): lab pure helpers such as range-ring and aggro tiles, and hash-state parse and serialise
  - `scripts/lab-smoke.mjs` (headless walk of every actor)
- **Edit (small):**
  - `vite.config.ts`: add `build.rollupOptions.input = { main: 'index.html', lab: 'lab.html' }`.
  - `README.md`, `TODO.md`, `CHANGELOG.md`: a short section on the lab.
  - `DECISIONS.md`: record "lab ships hidden at /lab.html; no sim edits; tiles stand in for hitboxes".
- **Do not touch:** `src/sim/**`, `src/config/**`, `src/server/**`, `SPROTO_SCRIPTS.md`, `vendor/hub-sdk`.

## Phases (commit after each)

1. **Skeleton.** Add the `lab.html` entry and vite input. The lab boots Three with the lowres pipeline, an orbit camera and per-id asset loading. Show load numbers before and after for `index.html`.
2. **Roster + Animation + Gear tabs**, with playback controls and hash state.
3. **Sandbox:** real-sim zone, spawn, inspector, overlays (tiles, range, aggro, path, bounding boxes).
4. **Compare, Zones, Loading, Icons**, and the PNG export.
5. **Automation:** `window.testLab`, `scripts/lab-smoke.mjs`, docs, and the PR.

## Acceptance

- Opening `/lab.html` downloads nothing until an actor is picked, apart from the lab bundle and three.
- Every enemy, boss, NPC, Sproto and the President renders and runs every animation without console errors. The smoke script proves it.
- Any boss can be spawned in any zone, frozen, damaged to any HP and fought with any of the 21 weapons.
- A reload restores the exact view from the URL hash.
- `index.html` bundle size and request count are unchanged.
- `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass. `__PB_SIM_VERSION__` is unchanged.

## Risks

- `EntityRenderer` needs a full `GameState`, and its views are private. The lab reads animation state from its own driver rather than editing `entities.ts`.
- `AGENTS.md` says "sprite sheet workflow", but world characters are rigged GLBs. The lab treats sprites as UI only.

## Cursor prompt

The owner pastes this into Cursor:

```text
You are working in the The People's Bitcoin repo (crrreatorrr/peoples-bitcoin). Check out the existing branch `cursor/test-lab`. It was created from the latest `main` and already contains `docs/test-lab-plan.md`.

1. Read `AGENTS.md`, `DESIGN.md` (its hard rules override everything), `DECISIONS.md` and `TODO.md`, then read `docs/test-lab-plan.md` in full. That plan is the spec. It records the owner's answers, so follow it exactly and don't re-ask anything it already settles.
2. Build the Test Lab phase by phase as the plan lays out, and commit after each phase. The lab is a separate, unlinked `lab.html` page with `noindex` and its own bundle. It loads each character only when that character is selected. It ships hidden in the production build.
3. Repo-specific hard rules:
   - Lab code lives only in `src/lab/`. Do not touch `src/sim/**` or `src/config/**`: either would change `__PB_SIM_VERSION__`.
   - Never call `AssetLoader.load()` (it preloads every GLB), `claimWriter`, the persistence code or `HubBridge`.
   - Characters have no hitboxes, so the overlays show tile footprint, weapon range, aggro range, the A* path and the tile grid, plus model bounding boxes.
   - Record design choices in `DECISIONS.md`, and update README, TODO and CHANGELOG at the end.
4. Never write the real save, never take tab or writer locks, and never initialise the hub. Use `window.testLab` as the automation handle.
5. When done, run: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and the new `scripts/lab-smoke.mjs`. Then open a PR from `cursor/test-lab` into `main` titled "Add Test Lab (lab.html)". In the PR, report:
   - the game page's load numbers (JS bytes, request count, time to first frame) before and after;
   - the result of every check, and any check you could not run, with the reason;
   - every place you mirrored private code, and the drift test that guards it.
6. If part of the plan can only be done by breaking one of these rules, stop and ask me rather than editing a protected file.
```
