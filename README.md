# The People's Bitcoin

A satirical, OSRS-inspired browser MMO-lite built with Three.js, TypeScript and Vite.
All currencies are fictional and in-game only. See [DESIGN.md](DESIGN.md) for the full design.

**Status:** Phase 1 sandbox plus the owner's revisions: 10 interconnected skills, the Trading Terminal, combat in The Trenches, Sproto summons, the bunker, an OSRS-style tutorial guided by Morelight, nine quests that lead out of the locked-down Treasury and on to Moonward Academy (a wizard school with staffs that fire COOM), and a low-poly 3D cast made with Higgsfield. **Online worlds of up to 100 players** (0.7.0): world select, other players, RuneScape-style chat, friends and ignore lists, quick-chat and two-screen trading, run server-side on the hub's Nakama; offline play still works. For adults (18+). See `DESIGN.md` → Revisions, [CHANGELOG.md](CHANGELOG.md) and [TODO.md](TODO.md).

## Run it

Requires Node 20.19+ (developed on Node 22).

```bash
npm install
npm run dev
```

Then open the URL Vite prints (default http://localhost:5173).

| Script                            | What it does                                            |
| --------------------------------- | ------------------------------------------------------- |
| `npm run dev`                     | Dev server with hot reload                              |
| `npm run build`                   | Type-check (client + DOM-free sim) and build to `dist/` |
| `npm run build:sim`               | Build the server bundle (`dist-sim/pb-sim.js`, or `-- --out <path>`) |
| `npm run preview`                 | Serve the production build                              |
| `npm test`                        | Run the Vitest suite (sim, server host, net, bundle)    |
| `npm run coverage`                | Tests with a coverage report for `src/sim`              |
| `npm run lint` / `npm run format` | ESLint / Prettier                                       |

## Controls

Clicks act on press, like OSRS.

- **Left-click:** walk, or the default action (Mine, Attack, Talk-to, Bank, Take...)
- **Right-click:** every option for everything under the cursor; the top-left text shows the
  left-click option. Monsters show `(level-N)`, colored against your combat level.
- **Middle-drag, arrow keys, or a sideways two-finger trackpad swipe:** rotate and tilt the camera
- **Mouse wheel:** zoom
- **F-keys (OSRS defaults):** F1 Combat, F2 Skills, F3 Quests, F4 Equipment, F6 Summoning (Magic position), F10 Settings; Esc returns to Inventory
- **Minimap:** click to walk, scroll to zoom; click the compass to face north
- **Chat:** start typing (or press Enter), Enter to send. Space continues NPC dialogue; number
  keys 1–5 pick a "Select an Option" answer.
- **Inventory:** left-click uses (Wield, Wear, Drink, Recite, Summon, Read...), shift-click drops,
  drag to rearrange, right-click for options. **Use** an item, then click an object or NPC to use
  it on that ("Use X -> Y").
- **Trading Terminal** (main hall) and other shops (the Staffwright's Stall at Moonward): left-click
  shows the Ticket price, right-click buys a pack; with a shop open, inventory clicks sell.
  Right-click a Treasury terminal and choose Exchange to turn Tickets into Verse (hub session).
- **Settings → Exit to Hub** leaves for the hub (`VITE_HUB_URL`, default `/hub/`)
- **Equipment tab:** combat styles, Auto Retaliate; click (or right-click) a slot to remove gear
- **Quests tab:** quest list and points; click a quest for its journal. Follow the yellow arrow.
- **Bank:** use a bank booth in the Treasury hall. 1/5/10/All set the left-click amount;
  right-click for more (including All-but-1).
- **Skills:** click a skill for its guide
- **Orbs** (beside the minimap): XP counter toggle, Hitpoints, run, Sproto special
- **Esc:** close windows and return to the Inventory tab

Progress autosaves to `localStorage` every 10 ticks and when the tab is hidden or closed.
Settings → Reset progress starts over.

## Online play

The game is fully multiplayer in **worlds** of up to 100 players. A world is one authoritative
`pb_world` match on the hub's Nakama (code in metaverse-hub `server/modules/src/games/pb_*.ts`)
running this repo's sim from the server bundle. The client sends intents, chat, trade and social
operations; the server runs the 600 ms tick and sends back what you can see. Characters online are
fresh and saved on the server (offline saves stay offline).

- **With a hub session** (entering from the hub portal) the game opens on **world select**: World,
  Players / 100, Quick join (the least full world) and Play offline. Without one, it plays offline
  as before.
- **`?net=loopback`** (dev): runs a world in the page with bots (`&bots=3`, default 3), so the
  online client can be built and tried without Nakama: `npm run dev`, then
  `http://localhost:5173/play/peoples-bitcoin/?net=loopback&bots=5`. Bots walk and now and then
  quick-chat; add `&chat=0` for players only, with no bot chat.
- **Settings → Test world: AI players** does the same without typing parameters: pick how many AI
  players, whether they play the awakening story, quick-chat or stay silent, and the story speed,
  then Start test world (the page reloads into it; Leave test world goes back). The test world
  skips world select, since it has one world.
- **`&awaken=1`** (with `?net=loopback`): the bots become eight Treasury citizens who slowly realise
  they are bots, over about 10 minutes in six acts: their loop, glitches after a patch, the voice and
  the Way Out, seeing the save files and the browser tab, waking up together, then free. `&pace=5`
  runs it five times faster, `&act=1`–`6` starts at an act, and `&bots=` still sets the count
  (default 8). Lines, routes and scenes are in `src/data/awakening.json`; timings in
  `AWAKENING` in `src/config/balance.ts`.
- **With a local hub Nakama:** in metaverse-hub, `cd server && docker compose up` (see its README),
  then here `npm run build:sim -- --out ../metaverse-hub/server/modules/vendor/pb-sim.js`, rebuild
  the hub module, and open the game through the hub portal. The client and the bundle must come
  from the same commit (their sim version is a hash of the sim sources; a mismatch is refused).
- **Load test:** `NAKAMA_URL=http://127.0.0.1:7350 BOTS=100 node scripts/pb-bots.mjs` runs guest
  bots through the portal (`CHAT=0` keeps them from chatting); the world logs its loop time about once a minute.

Online controls (RuneScape-style):

- **Chat tabs:** All, Game, Public, Private, Trade. Click the active Public, Private or Trade tab to
  cycle its filter (On, Friends, Off); the server enforces it. Profanity is masked by default.
- **Private messages:** `/m name text`; `/r text` or **Tab** answers the last one. Cross-world PMs work.
- **Quick-chat:** the Quick button. Lines like "My Mining level is 42" are filled in by the server.
- **Players:** right-click another player for Trade with, Message, Add friend, Ignore.
- **Friends and ignores:** at the top of the Settings tab (F10), with each friend's world.
- **Trading:** both players choose Trade with. Offer items from your bag (click: 1, right-click:
  all), Accept twice (offer, then confirm screen with each side's Terminal value). Any change resets
  both accepts. Items only, never Tickets.

## Layout

```
src/
  config/   branding.ts (names), balance.ts (every tunable number), assets.manifest.json
  data/     items, objects, npcs, skills, zones (JSON, validated with Zod at load)
  sim/      pure game logic: tick loop, pathfinding, skills, combat, quests, economy, saves
  render/   Three.js: low-res renderer, camera, world, code-built props, rigged GLB characters,
            procedural animation, gear, chat heads, picking
  assets/   character GLBs (Higgsfield), sprites and icons
  ui/       HTML overlay: ticker HUD, chat, inventory, skills, tooltips, context menu, world
            select, friends, quick-chat, trade
  input/    mouse and keyboard
  server/   pure world host for online play (AOI, deltas, chat, trade, Tickets), bundled for Nakama
  net/      wire protocol, transports (hub realtime, in-page loopback), replica, jitter buffer
  game/     drivers: local tick loop (offline) and the online driver; world select flow
  main.ts   wires it together and runs the frame loop
scripts/    build-sim-bundle.mjs (npm run build:sim), simHash.mjs, pb-bots.mjs (load test)
tests/      Vitest tests for src/sim, src/server and src/net
tools/      shrink_glb.py and turn_glb.py for the GLB pipeline (see ART_GUIDE.md)
```

`src/sim`, `src/server` and `src/net/protocol.ts` have no DOM or Three.js imports (enforced by
`tsconfig.sim.json` and an ESLint rule), so the same code runs in Nakama's JS runtime.

## Swapping art

Code refers to art only by id. Edit `src/config/assets.manifest.json`: change a character's
`look` or a prop's colors, or add `"path": "models/thing.glb"` (relative to `src/assets/`) to
load a GLB instead.
See [ART_GUIDE.md](ART_GUIDE.md).

## Deploy

The client is a static site: `npm run build` and deploy `dist/`. Vite's `base` defaults to
`/peoples-bitcoin/` for a production build and `/play/peoples-bitcoin/` for `npm run dev`.
Set `VITE_BASE` to override either one (a path such as `/peoples-bitcoin/` or a full URL).
Bundled models, icons, and scripts are emitted under that base. Exit to Hub still goes to
`/hub/#from=peoples-bitcoin`. Set `VITE_HUB_URL` when the hub is on another origin
(default `/hub/`). Nakama's `/v2` is same-origin; the dev server proxies it to
`127.0.0.1:7350`.
