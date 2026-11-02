# Vendored @metaverse/hub-sdk

- Source repo: https://github.com/crrreatorrr/metaverse-hub
- Branch: `cursor/ticket-redeem-custom-auth-c054`
- Commit: `947ed4c`
- Hub PR: https://github.com/crrreatorrr/metaverse-hub/pull/25

Version 0.4.0. `init` redeems the portal ticket with Nakama custom auth (`POST /v2/account/authenticate/custom?create=false`, body `{ id: "t:<ticket>", vars: { game } }`), then `session.claim` with the session token. Later calls send that token only.

Layout matches the previous vendor: `package.json`, `README.md`, and `dist/` (no source maps). This checkout could not read the private hub repo, so `dist/` is the 0.3.0 build switched to that redeem. After hub #25 merges, re-pack from hub main with `npm pack -w @metaverse/hub-sdk` if the sha changes, drop `*.map`, and strip `sourceMappingURL` lines.
