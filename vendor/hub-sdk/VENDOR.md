# Vendored @metaverse/hub-sdk

- Source repo: https://github.com/crrreatorrr/metaverse-hub
- Branch: `cursor/ticket-redeem-custom-auth-c054`
- Commit: `947ed4c`
- Hub PR: https://github.com/crrreatorrr/metaverse-hub/pull/25

Version 0.4.0. `init` redeems the portal ticket with Nakama custom auth (`POST /v2/account/authenticate/custom?create=false`, body `{ id: "t:<ticket>", vars: { game } }`), then `session.claim` with the session token. Later calls send that token only.

Layout matches the previous vendor: `package.json`, `README.md`, and `dist/` (no source maps). This checkout could not read the private hub repo, so `dist/` is the 0.3.0 build switched to that redeem. After hub #25 merges, re-pack from hub main with `npm pack -w @metaverse/hub-sdk` if the sha changes, drop `*.map`, and strip `sourceMappingURL` lines.

## Local patch: Tidebreaker Belt relic id (2026-11-03)

`dist/types.js` and `dist/types.d.ts` add `'tidebreaker_belt'` to `RELIC_IDS`. Nothing else changed. `init` (`asRelics`), `noteGrant` and `reportEvent` all filter relic ids through `isRelicId`, so without this the Sproto Fighter relic was silently dropped from `init().relics` and People's Bitcoin could not see it. Hub main's `packages/hub-sdk/src/types.ts` already lists it. `GAME_IDS` and `RELIC_BY_GAME` are left alone: this game never inits as `sproto-fighter`. The SDK was not re-packed from hub main on purpose: newer builds expect a server key and would break the ticket redeem above. When the vendor is next re-packed after hub #25, this patch is already upstream and can be dropped.
