# Handoff: online worlds (0.7.0)

Only the steps that need you. Everything else (code, tests, docs, the server bundle) is done and
committed on the branches below.

## 1. Merge and deploy, in this order

1. **metaverse-hub:** merge the hub's realtime work first (the branch that `contract/hub-v1` came
   from), then **`claude/pb-world`** (worktree `/home/user/metaverse-hub-pb`). PB adds no database
   migrations, so the migration-id order (hub 0011–0012, then sproto 0020+) is not affected by it.
   `server/modules/vendor/pb-sim.js` on that branch is sim version **7cd8d3c92b4e2dbc**.
2. **peoples-bitcoin:** merge this branch. Its build has the same sim version. If anything under
   `src/sim`, `src/server`, `src/config`, `src/data` or `src/net/protocol.ts` changes before or
   after the merge, refresh the hub's copy so they match again (a client with another version is
   refused with "This world runs a newer version"):
   ```bash
   npm run build:sim -- --out ../metaverse-hub/server/modules/vendor/pb-sim.js
   ```
   then commit that file in metaverse-hub.
3. **VPS:** rebuild and restart Nakama the usual way (`deploy/scripts/bootstrap.sh`).
   - Optional: set `PB_WORLDS` in the Nakama runtime env (default 2 always-on worlds).
   - Do **not** set `PB_DEV_RPCS` in production (it enables the `pb.bench` dev RPC).
4. **PB static site:** redeploy the build with `VITE_NAKAMA_SERVER_KEY` set, as today. `/v2` and
   `/ws` are already proxied to Nakama on the play host (metaverse-hub `deploy/Caddyfile`).

## 2. Live playtest (two browsers, two hub accounts)

1. Enter The People's Bitcoin from the hub portal in both browsers. World select appears; pick the
   same world. Each should see the other walking, with their username over their head.
2. Public chat (Enter) shows above the speaker and in the other's Public tab. `/m <name> hi` sends a
   private message; Tab replies.
3. Right-click the other player → **Trade with**, and do the same back. Offer an item, Accept on both
   screens, and check both bags.
4. Move one browser to world 2 (Exit, re-enter, pick world 2) and PM across worlds. Add each other as
   friends in the Settings tab and check the world shown.
5. Watch the Nakama log for `[pb_world N] P players, loop avg X ms, worst Y ms` (about once a minute).

## 3. Before advertising more than about 50 players per world

Run the bot load test against staging (or the VPS) and pick the node size:
```bash
NAKAMA_URL=https://<domain> NAKAMA_SERVER_KEY=<server key> BOTS=100 SECONDS=120 node scripts/pb-bots.mjs
```
On a dev machine in Docker, 100 bots clicking 30 times a tick used about 440 ms of the 600 ms tick
(loop avg 146 ms). If the logged loop average on your node stays above about 180 ms with a full
world, keep worlds smaller: lower `NET.overflowAt` / `NET.maxPlayersPerWorld` in
`src/config/balance.ts`, rebuild the bundle (step 1.2) and redeploy. Bots are guest accounts; they
add rows to the hub database.

## 4. Optional

- Extend the chat word lists in `src/data/chatfilter.json` (a seed list ships: slurs always blocked,
  profanity masked on the client, reserved nameplates).
- DESIGN.md §4/§5/§10/§12 still describe the older Ranch story (an existing TODO); it matters more
  now that players talk to each other about zones.
