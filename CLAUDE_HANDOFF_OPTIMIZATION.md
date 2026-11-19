# Claude Code Implementation Handoff — `peoples-bitcoin`

**Branch:** `claude/mmo-load-online-parity-handoff`  
**Scope:** Cut cold-start transfer 5–6× (**~12 MB / 241 reqs → ~2 MB / <30 reqs**), restore **Online MMO Hub feature parity** (Exchange, Relic Summoning, Relic Grant, XP Leaderboard), close the **Offline-with-Hub `localStorage` exploit**, cut **Nakama Goja 100-player tick time 3–5×** (440 ms → <120 ms), and eliminate client per-frame GC/reflow/GPU leaks.

---

## 0. Hard Invariants (`AGENTS.md`)

Read `DESIGN.md`, `DECISIONS.md`, and `TODO.md` before starting:
- Hard rules (`DESIGN.md §0`): fictional in-game currency only, invented character names (only satirical President Obama with parody notice), no trademarked characters, adult (18+) satire with no explicit content/gore, placeholders via asset manifest.
- Every tunable number goes in `src/config/balance.ts`.
- `src/sim/` stays pure (zero DOM/Three.js, enforced by `tsconfig.sim.json`).
- **Do NOT edit `SPROTO_SCRIPTS.md`**.
- Any change to `src/sim/`, `src/server/`, `src/config/`, `src/data/`, or `src/net/protocol.ts` updates `__PB_SIM_VERSION__` (`scripts/simHash.mjs`). Rebuild `dist-sim/pb-sim.js` (`scripts/build-sim-bundle.mjs`) and document the synchronized copy to `metaverse-hub/server/modules/vendor/pb-sim.js` in the PR!
- After each phase, update `README.md`, `TODO.md`, `DECISIONS.md` (for new design choices), and `CHANGELOG.md`.

---

## 1. P0 — Cold-Start Load-Time Overhaul (~12 MB / 241 Reqs → ~2 MB / <30 Reqs)

### 1.1 Delete `preloadSprites()` (Instant -189 Blocking HTTP Requests & -3.50 MB WebGL Uploads)
- **File:** `src/render/loader.ts:98-134`
- **Current Problem:** `AssetLoader.load()` runs `Promise.all([preloadModels(), preloadSprites()])`, eagerly fetching and uploading **189 PNGs (3.50 MB)** as GPU `THREE.Texture`s on boot:
  - **123 of them (`src/assets/icons/*.png`, ~1.5 MB)** are **100% dead weight** because `UI.pixelIcons = true` (`src/config/balance.ts:423`) makes `imageUrl()` and `iconTexture()` (`loader.ts:220-255`) prefer `src/assets/icons/px/*.png` (65.6 KB total).
  - **66 of them (`src/assets/sprites/*.png`, ~2.0 MB)** are 2D portraits/art rendered ONLY via DOM `<img>` tags in Summoning/Build panels — **never as 3D WebGL textures**!
- **Exact Changes:**
  1. Remove `preloadSprites()` from `AssetLoader.load()` (`src/render/loader.ts:98-134`).
  2. Lazy-load individual pixel icons (`src/assets/icons/px/*.png`) on demand inside `iconTexture()` ONLY when a ground item actually drops in 3D view.
  3. Delete or archive the 123 dead legacy `src/assets/icons/*.png` files if `UI.pixelIcons` is permanent (verify no fallback path requires them).

### 1.2 Deduplicate, Zone-Scope, Overlap With `WorldSelect`, & Compress All 42 GLBs
- **Files:** `src/render/loader.ts:105-117`, `src/main.ts:127-228`, `src/game/online.ts:85-92, 116-160`, `src/assets/models/*.glb`
- **Current Problem:**
  1. `preloadModels()` (`loader.ts:105-117`) has **no URL deduplication**: 9 shared GLBs (`lobbyist_junior.glb` ×3; 8 others ×2) are fetched and parsed 2–3× each → **52 parses totaling 8.46 MB** across all 7 zones up front, even though the starting zone `zone_treasury` only uses **20 unique GLBs (3.25 MB)**!
  2. Zero compression on all 42 GLBs (`6.89 MB`): zero Draco, zero Meshopt, zero WebP/KTX2 — all embed raw `image/jpeg`.
  3. `AssetLoader.load()` does not even start until *after* `bridge.init()` + WebSocket connect + `pb.worlds` RPC + user clicking a world + `joinMatch()` + `OP.WELCOME` (polled on a 50 ms `setTimeout` at `online.ts:85-92`!).
  4. `sp_champion.glb` is referenced in `assets.manifest.json` but missing on disk (triggers 404 + fallback).
- **Exact Changes:**
  1. **Deduplicate by resolved URL** in `AssetLoader` (`Map<string, Promise<GLTF>>`) so shared GLBs are fetched and parsed once.
  2. **Zone-scoped loading:** Load ONLY `START_ZONE_ID` (`zone_treasury`: 20 unique GLBs) before first frame, and **kick off that fetch immediately at boot in parallel with `chooseOnline()` / `WorldSelect`** so assets are already decoded by the time the player clicks a world! Add a lightweight progress bar if the player clicks before `zone_treasury` finishes. Load other zones' GLBs + Sprotos on zone transition (or idle background prefetch after first frame).
  3. **Compress all 42 GLBs** using `gltf-transform` (`meshopt` + `webp` / resized ≤512 px textures) and register `MeshoptDecoder` on `GLTFLoader` → shrinks `src/assets/models/` from **6.89 MB → ~1.5–2.5 MB** (`zone_treasury` drops to **~0.8–1.2 MB**).
  4. Replace the 50 ms `setTimeout` welcome poll in `src/game/online.ts:85-92` with an event-driven promise resolved directly by `OnlineDriver` on `OP.WELCOME`.
  5. Resolve missing `sp_champion.glb` (either add the model or remove the dead manifest URL so no 404 fires on boot).

---

## 2. P0 — Restore Online Hub Feature Parity & Close Offline-with-Hub Trust Exploit

### 2.1 Wire Missing Hub Features Into Online Worlds (`pb_world` / `HostIO`)
- **Files:** `src/server/host.ts:707, 1020`, `src/net/protocol.ts:36-71`, `src/main.ts:1020, 1216`, `src/ui/exchange.ts:67`, `src/game/onlineDriver.ts` (coordinated with `metaverse-hub` `HostIO` adapter)
- **Current Problem (also noted in `TODO.md:79,83`):** In Online MMO worlds, **4 core hub features are broken/silent**:
  1. **Tickets → Verse Exchange (`src/ui/exchange.ts:67`):** `hub.start()` is skipped online (`main.ts:1216`) and `Replica` never receives `hubSession`, so `state.hubSession.mode === 'standalone'` and `ExchangeWindow` displays `"The exchange needs the hub."`.
  2. **Cross-Game Relics (Consume):** `host.ts:707` initializes `view.hubSession` with empty `relics: []`/`effects: {}`, and `IntentSchema` (`protocol.ts:36-71`) **omits `summonRelic`** (sending it triggers a flood strike!).
  3. **Relic Grant (`pb.quest_complete`):** `main.ts:1020` gates `hub.onEvents(events)` with `if (!online)`, and `host.ts` / `HostIO` never calls `reportEvent('pb.quest_complete', ...)` on `quest_tutorial` completion.
  4. **Leaderboard (`pb_total_xp`):** `HostIO` has no `submitScore`, and client `hub.flushScore()` early-returns online.
- **Exact Changes:**
  1. Extend `HostIO` (`src/server/host.ts`) with `loadProfile(userId)` (returns `{ relics, effects }`), `reportEvent(userId, eventId, data, key)`, and `submitScore(userId, boardId, value, meta)` (wire corresponding Nakama callbacks in `metaverse-hub`).
  2. Populate `view.hubSession` on match join from `HostIO.loadProfile(userId)` and transmit `{ mode: 'hub', relics, effects, caps }` in `OP.WELCOME` so `Replica` hydrates `state.hubSession` and `ExchangeWindow` works online (calling `bridge.exchange()` via the live hub JWT and refreshing server wallet balance on success).
  3. Add `summonRelic` to `IntentSchema` in `src/net/protocol.ts` and validate relic ownership authoritatively in `host.ts` (`src/sim/sprotos.ts:64-73`).
  4. Trigger `HostIO.reportEvent('pb.quest_complete', ...)` authoritatively inside `host.ts` when `quest_tutorial` completes, and call `HostIO.submitScore('pb_total_xp', totalXp, {})` on level-up/periodic save/logout.

### 2.2 Close Offline-with-Hub `localStorage` Exploit & Remove Duplicated Ledger Glue
- **Files:** `src/game/online.ts:146-149`, `src/main.ts:171-218, 1216`, `src/hub/client.ts` (798 LOC), `src/hub/ledgerStore.ts` (198 LOC), `src/hub/singleWriter.ts` (79 LOC), `src/hub/bridge.ts:177, 195, 271-278`
- **Current Problem:**
  1. Choosing **"Play offline"** after entering from the hub keeps the live hub JWT while running the entire simulation client-side against editable `localStorage['peoples-bitcoin.save@<playerId>']` — letting anyone edit DevTools/`localStorage` to forge 200M XP on `pb_total_xp`, claim `pb.quest_complete` relic, and farm 200 Tickets/session → Verse without playing!
  2. Offline-with-hub forces a 20 s worst-case hang (`HUB_INIT_TIMEOUT_MS` 8 s + `SAVE_OWNER_WAIT_MS` 12 s) and ~1,075 LOC of duplicated outbox/seal/lock code (`client.ts` + `ledgerStore.ts` + `singleWriter.ts`) duplicating `@metaverse/hub-sdk`'s `hub-outbox`.
  3. `src/hub/bridge.ts:177,195` reaches directly into private `sessionStorage.getItem('hub:peoples-bitcoin:session')` instead of `this.sdk.getSession()`, and `bridge.ts:271-278` calls `window.location.assign` a second time right after `this.sdk.exit()`.
- **Exact Changes:**
  1. Once Online parity (§2.1) is live, make **"Play offline"** strictly **standalone/unranked** (clearly labeled `"Offline Practice — does not earn Hub Tickets, Relics, or Leaderboard XP"`): do not run `HubClient` Ticket earns, Verse exchange, `pb.quest_complete`, or `pb_total_xp` writes from client `localStorage` saves (record decision in `DECISIONS.md`).
  2. Delete the now-unnecessary offline seal/ledger/single-writer duplication (keeping only clean `bridge.ts` for auth, online Exchange, Feedback, and `exitToHub()`), switch `bridge.ts:177,195` to `this.sdk.getSession()`, and remove the duplicate `window.location.assign` at `bridge.ts:271-278`.

---

## 3. P1 — Cut Nakama Goja 100-Player Tick Time 3–5× (440 ms → <120 ms)

- **Files:** `src/sim/pathfinding.ts:64-68`, `src/server/aoi.ts:69-82, 231-250`, `src/server/host.ts:284-285, 309, 407, 805-826`
- **Current Problem (`handoff.md:44`, `TODO.md:85`):** 100 active bots consume **~440 ms of the 600 ms tick** inside Nakama's interpreted Goja VM (no JIT):
  1. `findPath()` (`pathfinding.ts:64-68`) allocates and `.fill()`s `Float64Array`, `Int32Array`, and `Uint8Array` (~64 KB/call in 4,960-tile `zone_trenches`) on **every single call**.
  2. `zoneEntities()` (`aoi.ts:69-82`) runs `JSON.stringify` **3× per entity per tick** (`text`, `dyn`, `stat`) even for stationary entities; `selfPatch()` (`aoi.ts:231-250`) calls `JSON.stringify` on entire top-level `PlayerState` keys (`bank` up to 400 slots, `inventory`, `quests`) every 10 ticks or whenever `busy`.
  3. `host.ts:284-285, 309, 407, 805-826` runs `saveRows(live())`, `flushTickets()`, and `writeOnlineSafe()` for **all 100 players synchronously on the same tick** (`tick % 100 === 0`), causing periodic Goja tick spikes.
- **Exact Changes:**
  1. **Zero-Allocation A\* (`src/sim/pathfinding.ts`):** Hoist reusable module-scoped typed arrays (`gScore`, `fScore`, `cameFrom`, `visitedGen`) with an incrementing `gen++` stamp (clearing only on 32-bit wrap) → O(visited) instead of O(grid), zero GC churn per call.
  2. **Dirty-Flag Entity & Self Serialization (`src/server/aoi.ts`):**
     - Cache static entity JSON (`stat`) once on spawn / equipment change instead of re-stringifying every tick.
     - Track dirty flags/versions on `position/hp/anim` (`dyn`) and `PlayerState` sub-fields (`inventory`, `bank`, `skills`, `quests`) so `selfPatch()` and `zoneEntities()` skip unchanged fields with zero `JSON.stringify` calls.
  3. **Staggered Server Persistence (`src/server/host.ts`):** Round-robin `saveRows` and `flushTickets` across ticks (e.g., 2–5 players per tick on `playerSlot % 25 === tick % 25`) instead of flushing all 100 players in one tick.
  4. Verify with `PbSim.benchWorld` (100 bots) in both Node and Goja and record before/after tick timings.

---

## 4. P1/P2 — Client Frame-Time Hotspots, GPU Memory Leaks & Bundle Polish

1. **Eliminate Per-Frame Quaternion Churn (`src/render/rigged.ts:172-183`):** Precompute `inheritInv` once at setup and reuse module-scoped scratch `THREE.Quaternion`s (`tmpQ`, `tmpInv`) in `sync()` instead of `.clone()`ing 20–24 quaternions per actor per frame (eliminates 36k–144k allocations/s).
2. **Eliminate Forced Synchronous Layout Reflows (`src/render/entities.ts:221-231`, `src/main.ts:1094-1150`):** Cache `canvas.getBoundingClientRect()` once per frame (or on `ResizeObserver`) instead of calling it inside `EntityRenderer.toScreen()` interleaved with DOM style writes in `nameplates`/`hitsplats`/`overhead`/`shouts`.
3. **Stop 60 Hz Full-Scene Raycasting (`src/main.ts:1124`, `src/render/picking.ts:30-37`):** Run `updateHoverTooltip()` only when pointer position, camera transform, or sim tick changes (dirty-flag) rather than raycasting every high-poly `SkinnedMesh` at 60 fps.
4. **Fix Dynamic Entity GPU Leaks (`src/render/entities.ts:261,285,302,374,452,563`, `src/render/chatheads.ts:71`, `src/render/effects.ts:285-305`):** Dispose cloned `MeshLambertMaterial`s (`flatten()`) and `HpBar` (`CanvasTexture` + `SpriteMaterial`) whenever remote players leave AOI, enemies despawn, armor redresses, objects swap models, or `ChatHeads.render()` completes.
5. **Bundle & Draw-Call Polish:** Add `manualChunks` (`vendor-three`) in `vite.config.ts`; self-host or non-blocking-load `Press Start 2P`/`VT323` (`index.html:11-17`); merge static procedural prop geometries by material (`src/render/props.ts`) to get draw calls under 300; decompose 1,400-LOC `src/main.ts` into focused boot/HUD/online modules.

---

## 5. Verification Checklist

Run before opening PR (from `AGENTS.md`):
```bash
npm run lint
npm run typecheck
npm test
npm run build
node scripts/build-sim-bundle.mjs
```
Verify explicitly:
- Cold boot to `zone_treasury` downloads **<2.5 MB / <30 requests** with zero 404s (`sp_champion.glb`) and zero `preloadSprites()` WebGL uploads.
- Online world tests cover `summonRelic`, `pb.quest_complete`, `pb_total_xp`, and `ExchangeWindow`.
- `PbSim.benchWorld` (100 bots) tick time drops substantially below 200 ms in Goja.
- Update `README.md`, `TODO.md`, `DECISIONS.md`, and `CHANGELOG.md`, and note the `dist-sim/pb-sim.js` sync needed in `metaverse-hub/server/modules/vendor/pb-sim.js`.
