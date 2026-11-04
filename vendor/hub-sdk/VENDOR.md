# Vendored @metaverse/hub-sdk

- repo: https://github.com/crrreatorrr/metaverse-hub
- branch: claude/kind-bardeen-h2fhj8
- sha: ee187cf
- package: packages/hub-sdk @ 0.6.0
- built with: `node scripts/vendor-sdk.mjs`

Layout: `package.json`, `README.md`, `dist/*.js`, `dist/*.d.ts`. No source maps are included, and `sourceMappingURL` lines are stripped.

Ticket redeem is `authenticateCustom` (`t:` + ticket, create=false) with the Nakama server key as Basic auth, then `profile.get`. Later calls send only the session token.

The previous vendor tracked hub #25 at 947ed4c, which redeemed without the server key. The merged hub server requires it, so every redeem failed and the game ran with no hub session.

0.5.0 adds the realtime API (`realtimeFromSdk`, `MatchHandle`), which online play uses through
`src/net/hubTransport.ts` (Contract C9). This copy is from the hub agent's branch head
(`claude/loving-galileo-ndy2tu`, which includes the `contract/hub-v1` SDK plus the early-message
fix for match data that arrives before the join reply); re-vendor from hub `main` once it merges.
0.6.0 adds the `sproto-arcade` game id, the `breakwater_coin` Relic, and optional
`loadSave` / `writeSave` (cloud save). This copy is from hub `claude/kind-bardeen-h2fhj8` @ ee187cf.
`tests/sdk-hash.test.ts` pins the version and hashes: update it with each re-vendor.

Re-sync this tree to hub main whenever packages/hub-sdk changes.
