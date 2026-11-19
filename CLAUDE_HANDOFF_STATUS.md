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

## Checks

| Command | Result |
| --- | --- |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm test` | pass (58 files, 528 tests; was 59 / 596 — `tests/hub-duplication.test.ts`, 68 tests of the removed offline ledger, deleted) |
| `npm run build` | pass |

## Measurements

Cold boot of `vite preview` (production build) in Playwright Chromium (SwiftShader), offline start
into The Treasury, local requests and transfer bytes (JS gzip), measured after network idle + 3 s.

| Stage | Requests | Bytes | PNG | GLB |
| --- | --- | --- | --- | --- |
| Baseline (main) | 219 | 11,460,205 | 172 / 3.68 MB | 42 / 7.23 MB |
| After Phase 0 | 48 | 7,831,618 | 1 / 0.06 MB | 42 / 7.23 MB |

`dist/` baseline: 12,652,137 bytes, 219 files.

## Repo hygiene proposals (owner to decide)
- `src/assets/icons/*.png` (120 files, 1.6 MB): only used when `UI.pixelIcons` is false.

## Cross-repo follow-ups
- None yet from Phase 0 (client only; `SIM_VERSION` unchanged).
