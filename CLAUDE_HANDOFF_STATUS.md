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

## Checks

| Command | Result |
| --- | --- |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm test` | pass (59 files, 530 tests after Phase 1; Phase 0: 58 / 528; was 59 / 596 — `tests/hub-duplication.test.ts`, 68 tests of the removed offline ledger, deleted) |
| `npm run build` | pass |

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

Baseline loaded everything before the first frame, so its first-frame numbers equal its totals.
"First frame" = requests finished when `canvas.game-canvas` appears (it is created after the zone's
models are awaited). Time to canvas in this headless run: 1,155 ms baseline → ~750 ms.

`dist/` baseline: 12,652,137 bytes, 219 files.

## Repo hygiene proposals (owner to decide)
- `src/assets/icons/*.png` (120 files, 1.6 MB): only used when `UI.pixelIcons` is false.

## Cross-repo follow-ups
- None yet from Phase 0 (client only; `SIM_VERSION` unchanged).
