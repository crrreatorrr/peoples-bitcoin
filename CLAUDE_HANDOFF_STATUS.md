# Optimization handoff status — peoples-bitcoin

Branch `claude/happy-pasteur-0dhfzp`. Handoff: `CLAUDE_HANDOFF_OPTIMIZATION.md`. Brief: `CLAUDE_SESSION_BRIEF.md`.

## Items

### Phase 0
- §1.1.1 Remove `preloadSprites()` — **done** (ccfbadf). Ground items load their icon texture on first drop;
  pixel icons are warmed into the HTTP cache on idle (`AssetLoader.warmIcons`). Screenshot of the
  Treasury identical before/after.
- §1.1.2 Lazy pixel icon textures in `iconTexture()` — **done** (ccfbadf).
- §1.1.3 Delete the 120 legacy `src/assets/icons/*.png` — **skipped**: they are the `UI.pixelIcons = false`
  fallback, and are no longer requested at boot, so they cost nothing at runtime. Listed under repo
  hygiene below for the owner.
- §2.2.1 Offline-with-hub exploit — **done** (0acb4db). Offline is "Offline practice": local shop, no hub
  earn/spend/sell/exchange/relic/score. DECISIONS.md "Offline practice (2026-11-19)".
- §2.2.2 Remove duplicated ledger glue — **done** (0acb4db): `src/hub/client.ts`, `src/hub/ledgerStore.ts`,
  `src/hub/uuid.ts`, `tests/hub-duplication.test.ts` deleted; `src/hub/singleWriter.ts` **kept** (it is
  the local save's cross-tab writer lock, not hub ledger code).
- §2.2.2 `bridge.ts` reads `sdk.getSession()`, no double `location.assign` — **done** (0acb4db).
- §2.2 "20 s worst-case hang" — **partial**: the owner wait (`SAVE_OWNER_WAIT_MS`) is kept on purpose,
  so a hub account's practice save stays its own on a shared browser. It only applies when `init`
  hangs.

### Phase 1
- §1.2.1 Deduplicate GLB fetch/parse by URL — **done** (e273615): `AssetLoader.byUrl`.
  (The browser cache already deduplicated the *downloads*: baseline was 42 GLB requests, not 52;
  the win is parse time.)
- §1.2.2 Zone-scoped loading, started at boot in parallel with `chooseOnline()` / world select —
  **done** (e273615). `src/render/zoneAssets.ts` walks the zone's data (and the enemy/NPC/object
  defs it names) for model ids; the Treasury needs 26 of the 42 GLBs. Other zones load in the
  background after the first frame; a view drawn with placeholders meanwhile is rebuilt once.
  A "Loading The Treasury..." box shows if the zone is not ready when the game starts (checked
  with GLBs delayed 2.5 s in Playwright). Tests: `tests/zone-assets.test.ts`.
- §1.2.3 Compress all 42 GLBs — **done** (90ff9f0): meshopt `--level high`, `MeshoptDecoder`
  registered (`createGltfLoader`, also used by `src/dev/gait.ts`). 7,227,008 → 3,289,152 bytes.
  WebP textures **skipped**: the textures are already 512 px JPEG (1.4 MB total); WebP q90 saved
  only ~25% as a second lossy generation. Screenshot diff vs. baseline: 154 of 1,024,000 pixels
  differ by more than 24/255 (idle animation phase).
- §1.2.4 Event-driven WELCOME instead of the 50 ms poll — **done** (e273615): `OnlineDriver.welcomed`.
- §1.2.5 `sp_champion.glb` 404 — **already fine**: the manifest entry has a placeholder, so the
  loader never requests the missing file (zero 404s in every measurement here). The art itself is
  still a TODO item for the owner.

### Phase 2
- §2.1.1 Optional `HostIO` calls — **done** (4b5148b). Exact signatures (src/server/host.ts):
  - `loadProfile?(who: Who): HubProfile | null` with `HubProfile = { relics?: string[]; effects?: Record<string, number | boolean | string> }`
  - `getRelics?(who: Who): string[] | null` (fallback when `loadProfile` is absent)
  - `reportEvent?(who: Who, eventId: string, data: Record<string, unknown>, key: string): EconomyResult`
    — called as `reportEvent(who, 'pb.quest_complete', { questId: 'quest_tutorial', tick }, uuidv5('pb.quest_complete:<userId>'))`;
    `{ error: code }` on failure (`session_closed` expires the session, `idempotency_mismatch` = acked), may return `{ granted: '<relic id>' }`
  - `submitScore?(who: Who, boardId: string, value: number, meta: Record<string, unknown>): EconomyResult`
    — called as `submitScore(who, 'pb_total_xp', floor(totalXp), {})`; `{ error: code }` on failure
  - `Who = { userId, sid }` as for the existing economy calls. Every call is wrapped in try/catch.
- §2.1.2 Hub profile → `view.hubSession` on join, `hub: { relics, effects }` in WELCOME,
  client `Replica` state hydrated (`OnlineDriver.applyHub`), `OP.HUB_OUT` for later changes —
  **done** (4b5148b). Online Exchange: client `bridge.exchange()` with the live hub JWT
  (`src/game/onlineExchange.ts`), then `OP.WALLET` makes the world re-read the balance — **done**.
- §2.1.3 `summonRelic` in `IntentSchema`, ownership checked authoritatively (sim against the
  server's hubSession) — **done** (4b5148b).
- §2.1.4 `pb.quest_complete` from the host on tutorial completion (and on join / flush until
  acked); `pb_total_xp` on level-up, the save tick and logout — **done** (4b5148b).
  Tests: `tests/net/hub-parity.test.ts`, `tests/online-exchange.test.ts`.
- §2.1 Live end-to-end — **blocked** on metaverse-hub: its `pb_world` shell must implement the
  four optional calls and re-vendor this repo's pb bundle (see follow-ups).
- §3.1 Zero-allocation A* — **done** (97eaaa6): module-scoped buffers + generation stamp,
  reused heap, inlined neighbour/walkability/heuristic. `tests/pathfinding-golden.test.ts` pins
  14,000 seeded paths; also checked equal on all 870 calls of a 14-player world run.
- §3.2 Dirty-flag serialization — **partial** (b6c4b16, c26ba8c): the whole-entity JSON is built
  lazily (only for new entities or a changed static part), change detection uses the two parts,
  no object spread (a helper call in the Goja bundle), inlined distance, a set-free broadcast.
  Not done: per-field dirty flags for `selfPatch` (would need the sim to mark its own writes,
  invasive across `src/sim`) and cached static JSON across ticks. `tests/net/broadcast-golden.test.ts`
  pins every byte a seeded 14-player world with walking, combat and a logout sends; unchanged.
- §3.3 Staggered persistence — **done** (9b21c3c): saves, Ticket flushes and online rows by join
  slot. Storage writes in the worst tick, 100 bots: 200 → 3. `tests/net/stagger.test.ts`.
- Extra (f85332f): `parseIntent` validates `walk` intents without zod (zod was ~7% of jitless
  time); a test checks it agrees with `IntentSchema`.
- §3.4 Goja measurement — **blocked**: no Goja/Nakama runtime here. Measured with the same
  `PbSim.benchWorld` from the built bundle in Node and in Node `--jitless` (V8's interpreter,
  the closest stand-in available). Measure in the hub: `pb.bench` RPC.

### Phase 3
- §4.1 Quaternion churn in `rigged.ts` sync — **done** (e033a99): `inheritInv` precomputed, one
  scratch quaternion; no clones per frame.
- §4.2 Forced layout in `toScreen()` — **done** (2c3a0dc): `src/render/canvasRect.ts` caches the
  rectangle until resize/scroll/ResizeObserver; `picking.ts` uses it too.
- §4.3 60 Hz hover raycast — **done** (6713b22): repick when cursor, camera matrix, tick or view
  changed, or after 150 ms (entities glide between ticks). Smoke-tested: tooltips correct.
- §4.4 GPU leaks — **done** (2c3a0dc): `releaseObject()` (src/render/kit.ts) frees an entity's own
  materials and canvas textures when remote players leave, enemies despawn, the Sproto changes,
  an object swaps model, armor redresses and a chat head is rendered. Geometries and GLB image
  textures are left alone on purpose (shared with the loaded GLB and every copy).
- §4.5a `vendor-three` chunk — **done** (ff79789): 648 KB / 164 KB gzip, cached across deploys.
  The game chunk is still 982 KB (364 KB gzip) and Vite still warns.
- §4.5b Non-blocking Google Fonts — **done** (ff79789): print-media swap, `crossorigin` kept
  (the feedback screenshot test still passes). Self-hosting **skipped**: it needs the font files
  fetched and committed, and the current CORS setup is already relied on and tested.
- §4.5c Merge static prop geometries to get draw calls under 300 — **skipped**: it rebuilds how
  every prop in `src/render/props.ts` is made, needs per-prop visual checks on a real GPU, and
  changes nothing in load time. Left in TODO ("Known gaps from Phase 1").
- §4.5d Decompose `src/main.ts` — **skipped**: a 1,400-line pure refactor that would conflict with
  every other agent's work on the game shell; better done as its own task.

## Checks

| Command | Result |
| --- | --- |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm test` | pass (64 files, 548 tests after Phase 2 and Phase 3; Phase 1: 59 / 530; Phase 0: 58 / 528; was 59 / 596 — `tests/hub-duplication.test.ts`, 68 tests of the removed offline ledger, deleted) |
| `npm run build` | pass |
| `node scripts/build-sim-bundle.mjs` | pass: `pb-sim 49699e030161ede6`, 836 KB, `dist-sim/pb-sim.js` sha256 `1d770c578c3c9d079f56a39f2f2d51a14dc34106a48626f58483c304f302926d` (not committed; `dist-sim` is gitignored) |
| Goja `pb.bench` | not run: no Nakama/Goja here (see Phase 2 §3.4) |

## Measurements

Cold boot of `vite preview` (production build) in Playwright Chromium (SwiftShader), offline start
into The Treasury, local requests and transfer bytes (JS gzip), measured after network idle + 3 s.

| Stage | Requests | Bytes | PNG | GLB |
| --- | --- | --- | --- | --- |
| Baseline (main) | 219 | 11,460,205 | 172 / 3.68 MB | 42 / 7.23 MB |
| After Phase 0 | 48 | 7,831,618 | 1 / 0.06 MB | 42 / 7.23 MB |
| Phase 1, zone loading only — first frame | 30 | 4,917,942 | | 25 |
| After Phase 1 — first frame | 30 | 2,546,294 | | 25 |
| After Phase 1 — all, incl. background | 48 | 3,901,680 | 1 | 42 / 3.29 MB |
| After Phase 1, `?net=loopback` — first frame | 31 | 2,567,882 | | 25 |
| After Phase 3 — first frame (3 runs) | 31 | 2,548,091 | | 25 |
| After Phase 3 — all, incl. background | 49 | 3,903,477 | 1 | 42 / 3.29 MB |

Baseline loaded everything before the first frame, so its first-frame numbers equal its totals.
"First frame" = requests finished when `canvas.game-canvas` appears (it is created after the zone's
models are awaited). Time to canvas in this headless run: 1,155 ms baseline → ~750 ms.

`dist/` baseline: 12,652,137 bytes, 219 files. After Phase 3: 8,731,287 bytes, 220 files (the
unused legacy icons and sprites are still emitted; they are never requested at boot).
Time to canvas after Phase 3: ~500 ms (three runs; baseline 1,155 ms).

### World tick (`PbSim.benchWorld(100 players, 30% walking per tick)`, median of 5 runs, two rounds)

| Build | Node ms/tick | Node `--jitless` ms/tick | jitless sim | jitless broadcast | jitless visible |
| --- | --- | --- | --- | --- | --- |
| main (`0d77b686c8efbfd5`) | 10.83 / 9.73 | 21.05 / 20.94 | 6.5 | 13.9 | 5.5 |
| Phase 2 (`49699e030161ede6`) | 6.59 / 7.04 | 15.92 / 16.63 | 5.3 | 10.4 | 3.1 |

About −34% in Node and −22% in `--jitless`. The handoff's 440 ms is a Goja figure from the owner's
machine; Goja is far slower than V8's interpreter, so the absolute numbers do not transfer, and the
3–5× target is not shown here. Worst tick storage writes: 200 → 3.

## Review of this branch
A fresh subagent reviewed `git diff 35b7f56..HEAD` without my conclusions: no important bugs.
It checked pathfinding, AOI and broadcast equivalence, `parseIntent`, `releaseObject` sharing,
and the online trust path. Four nits; three fixed (next commit), one left:
- Fixed: chat-head portraits drawn while models were loading stayed placeholders (cache now
  cleared on the model rebuild); a zone change before that zone's models loaded (for example online,
  where the first snapshot moves you out of the start zone) now loads them first and redraws; a failed
  GLB fetch no longer stops the placeholder rebuild, and a later load can try it again.
- Left: after `OP.WALLET` the wallet shows the hub balance, so Tickets earned since the last flush
  disappear from the display until the next earn ack. That is the same behaviour as every earn
  ack; nothing is lost.

## Pre-existing issues seen in review (not changed here)
From a review pass over main's last change (#46, offline saves per hub account); still present:
- `src/hub/saveOwner.ts` `resolveSaveOwner`: a hub visit whose `init` *fails* (expired or used
  ticket, network error) resolves to the device owner, so that visit plays and saves over the
  browser's device game. Suggest `pending` when `visitStarting` and init answered without an
  account. Lower stakes now that offline play never reaches the hub, but it is still another
  person's save on a shared browser.
- Same function: with no visit starting but `init` already started by world select, it waits up
  to `SAVE_OWNER_WAIT_MS` for `init` before returning the device owner it could return at once.
- `src/persist.ts` `clearSavedGame` leaves the owner's `.save.unreadable` backup behind.

## Repo hygiene proposals (owner to decide)
- `src/assets/icons/*.png` (120 files, 1.6 MB): only used when `UI.pixelIcons` is false.

## Cross-repo follow-ups
- **metaverse-hub: re-vendor the pb bundle.** `SIM_VERSION` is now `49699e030161ede6` (was
  `0d77b686c8efbfd5`). `npm run build:sim -- --out ../metaverse-hub/server/modules/vendor/pb-sim.js`
  from this branch, rebuild the hub module. Clients and worlds must come from the same commit.
- **metaverse-hub `pb_world` shell:** implement the optional `HostIO` calls above (`loadProfile`
  or `getRelics`, `reportEvent`, `submitScore`) on top of its existing hub profile, event and
  score code; the game works without them.
- **metaverse-hub:** route the client's `OP.WALLET` (8) like the other client ops (the shell
  passes every op to `host.message`, so likely nothing to do) and allow server op 109.
- **Measure in Goja:** the hub's dev `pb.bench` RPC, before and after the re-vendor.
- No hub-sdk re-vendor was needed (and none was done, per the brief).
