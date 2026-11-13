# Vendored @metaverse/hub-sdk

- repo: https://github.com/crrreatorrr/metaverse-hub
- branch: claude/account-progress
- sha: c9d01b3
- package: packages/hub-sdk @ 0.8.0
- built with: `node scripts/vendor-sdk.mjs`
- iife: dist/hub-sdk.iife.js (global HubSDK; classic script, not a CDN import)
- iife sha256: 833ce281696f9769bd13d284b9d9262957838181cf1ac308358c6b602b21f309
- source src/createHubSdk.ts: 4ae184ef8b4a6e97192769a4118ea855fcd4463176ee7bac295a884e449ebcdf
- source src/env.ts: c3a8eb38ea73539fa4d971da705e004355bed8258079a73a2ecbda912c35ef46
- source src/errors.ts: 4eaba836a4dfad994b3926d90b66a158c4384ce6f100bf8a0791877c0646b541
- source src/events.ts: 584d264acb48d7e63746bc63b56767577dd4370a0b5fbdf4ddd73fc0fd2b9f64
- source src/feedback.ts: 3ee200cafc7d07ca4b0c995a56a0d3ef5a6046e262fc62c7aef0bb903e83cf67
- source src/index.ts: b7db97e20962db7bdfc123f539af28a47e109062cf5ed74a374e09ef4b3cd457
- source src/live.ts: 9272fe0acd8c0b8171028f163df42f7e9545408d28194da7de19e037f0417527
- source src/nakama.ts: 67a701b47178244f1a63b433f8d715aea824b1599a49f140b35b401950ee266a
- source src/pageShot.ts: 8e562aa07991d5b716d9f83aa2f659dbd43782b5b6e063d411895f52dfc84af9
- source src/pbShop.ts: 3bbeff5bcf3b6e2c724409eadce9907432e1e52b02988938ff5e6f2ebdfe0faf
- source src/progress.ts: fd39c7a20135c7c7dec4cf85783c564afe60cb44ac47715f01cd6ba42f5e1009
- source src/realtime/chatRules.ts: 26913facb5c4c28c0a3529a4ecb6a3a50fadfe067736c74fb571184a9aa81b0e
- source src/realtime/client.ts: 09b799cc261ae06eb36a3141722e7752b603c58eac66fdb2b2a4f88f4ae08b79
- source src/realtime/friends.ts: d2b309fca509ab6e46def7d4be20e470d7d932f6eacef63287ce7697225f86ef
- source src/realtime/mock.ts: e476f22d8c78c0b1e0dc5cb0e7fc553bfd3534dd22d45920aeb903c8dfa049a7
- source src/realtime/protocol.ts: 9f25c52103c82110eb518043395fed92a71f5c713f70c6e7369072ce988ea14e
- source src/realtime/types.ts: dc8a6a5f62c5e0f2874819a79dd473b5b41b3cbdb29aad8bfd2a0fc4687734cf
- source src/save.ts: 098fb0a6834e43bdad620c2729b0abf28a9551b8c4ab8cc7cb3428ebba8aea98
- source src/storage.ts: 7a1f52e2f432026590ed99e85c318ea21ef10c6fe83b9e0c1ebe8c173ced5344
- source src/third_party/modern-screenshot.d.ts: 22372ef230b98655ee2597c8c741d75e397405f22dbb5c2f45521e6fe9950056
- source src/third_party/modern-screenshot.js: c1d44ba7cf8a296754c7013a12c79266235550b0564d17487a76e006f8472721
- source src/ticket.ts: b01e1635c7031dd0e6855ecb22b99af1654395c41f0296863b627a31ded41033
- source src/types.ts: 90b551a3fe2b4e85f81b82bc7c9c1909654715f2a45a85cb7d683f6f05d309ab

Layout: `package.json`, `README.md`, `SOURCE.pin.json`, `dist/*.js`, `dist/*.d.ts`, and `dist/hub-sdk.iife.js`. No source maps are included, and `sourceMappingURL` lines are stripped.

Ticket redeem is `authenticateCustom` (`t:` + ticket, create=false) with the Nakama server key as Basic auth, then `profile.get`. Later calls send only the session token.

The previous vendor tracked hub #25 at 947ed4c, which redeemed without the server key. The merged hub server requires it, so every redeem failed and the game ran with no hub session.

0.5.0 added the realtime API (`realtimeFromSdk`, `MatchHandle`), which online play uses through
`src/net/hubTransport.ts` (Contract C9), including the early-message fix for match data that
arrives before the join reply. 0.6.4 (hub main at 2a82e9e, PR #117) added the `marina_anchor` and
`dragon_scale` relic ids and the `coop.stage_clear` and `shooter.wave_clear` events.

0.7.0 added the in-game feedback window (`installFeedback`, `feedbackTransportFromSdk`,
`sdk.feedbackAccess`, `sdk.submitFeedback`), which `src/game/feedback.ts` uses. 0.7.1 added the
optional `tickets` field to `reportEvent`'s result (this game's events pay none).

This copy is package 0.8.0 from hub branch `claude/account-progress` at c9d01b3 (metaverse-hub #187), not yet on main.
Re-vendor from hub main once that branch merges, before this game's account-progress change
merges. 0.8.0 adds `createProgressStore` and `hubVisitStarting` and raises the cloud save limit to
16384 bytes. This game uses only `hubVisitStarting` (src/main.ts): its offline save is a world
snapshot kept per owner (src/hub/saveOwner.ts), not a progress store. Run `vendor-sdk.mjs` with the
hub worktree as the current directory: esbuild writes cwd-relative module paths into the IIFE's
comments, so a run from elsewhere gives an IIFE that no longer matches `SOURCE.pin.json`.

0.7.2 (hub main at c6627e5, metaverse-hub #183) makes the feedback screenshot show the whole page: the SDK draws the HTML
(HUD, panels, dialogs, world select) over the canvases with modern-screenshot (MIT,
`dist/third_party/modern-screenshot.js`, loaded on demand; Vite splits it into its own chunk).
The adapter names only the WebGL world view in `canvases`, so the minimap and compass canvases
are drawn with the HTML. The Google Fonts `<link>` in `index.html` carries
`crossorigin="anonymous"` so the screenshot can embed the fonts. Shop, session and realtime calls
stay the same. `tests/sdk-hash.test.ts` pins the version and hashes: update it with each
re-vendor.

Re-sync this tree to hub main whenever packages/hub-sdk changes.
