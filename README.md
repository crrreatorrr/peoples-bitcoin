# The People's Bitcoin

A satirical, OSRS-inspired browser MMO-lite built with Three.js, TypeScript and Vite.
All currencies are fictional and in-game only. See [DESIGN.md](DESIGN.md) for the full design.

**Status:** Phase 1 sandbox plus the owner's revisions: 10 interconnected skills, the Trading Terminal, combat in The Trenches, Sproto summons, the bunker, an OSRS-style tutorial guided by Morelight, eight quests that lead out of the locked-down Treasury, and a low-poly 3D cast made with Higgsfield. See `DESIGN.md` → Revisions, [CHANGELOG.md](CHANGELOG.md) and [TODO.md](TODO.md).

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
| `npm run preview`                 | Serve the production build                              |
| `npm test`                        | Run the Vitest suite (sim only)                         |
| `npm run coverage`                | Tests with a coverage report for `src/sim`              |
| `npm run lint` / `npm run format` | ESLint / Prettier                                       |

## Controls

Clicks act on press, like OSRS.

- **Left-click:** walk, or the default action (Mine, Attack, Talk-to, Bank, Take...)
- **Right-click:** every option for everything under the cursor; the top-left text shows the
  left-click option. Monsters show `(level-N)`, colored against your combat level.
- **Middle-drag, arrow keys, or a sideways two-finger trackpad swipe:** rotate and tilt the camera
- **Mouse wheel:** zoom
- **F-keys:** F1 Equipment, F2 Skills, F3 Quests, F4 Inventory, F5 Summoning, F10 Settings
- **Minimap:** click to walk, scroll to zoom; click the compass to face north
- **Chat:** start typing (or press Enter), Enter to send. Space continues NPC dialogue; number
  keys 1–5 pick a "Select an Option" answer.
- **Inventory:** left-click uses (Wield, Wear, Drink, Recite, Summon, Read...), shift-click drops,
  drag to rearrange, right-click for options. **Use** an item, then click an object or NPC to use
  it on that ("Use X -> Y").
- **Trading Terminal** (main hall): left-click shows the price, right-click buys; with it open,
  inventory clicks sell
- **Equipment tab:** combat styles, Auto Retaliate; click (or right-click) a slot to remove gear
- **Quests tab:** quest list and points; click a quest for its journal. Follow the yellow arrow.
- **Bank:** use a bank booth in the Treasury hall. 1/5/10/All set the left-click amount;
  right-click for more (including All-but-1).
- **Skills:** click a skill for its guide
- **Orbs** (beside the minimap): XP counter toggle, Hitpoints, run, Sproto special
- **Esc:** close windows and return to the Inventory tab

Progress autosaves to `localStorage` every 10 ticks and when the tab is hidden or closed.
Settings → Reset progress starts over.

## Layout

```
src/
  config/   branding.ts (names), balance.ts (every tunable number), assets.manifest.json
  data/     items, objects, npcs, skills, zones (JSON, validated with Zod at load)
  sim/      pure game logic: tick loop, pathfinding, skills, combat, quests, economy, saves
  render/   Three.js: low-res renderer, camera, world, code-built props, rigged GLB characters,
            procedural animation, gear, chat heads, picking
  assets/   character GLBs (Higgsfield), sprites and icons
  ui/       HTML overlay: ticker HUD, chat, inventory, skills, tooltips, context menu
  input/    mouse and keyboard
  main.ts   wires it together and runs the 600 ms tick loop
tests/      Vitest tests for src/sim
tools/      shrink_glb.py and turn_glb.py for the GLB pipeline (see ART_GUIDE.md)
```

`src/sim` has no DOM or Three.js imports (enforced by `tsconfig.sim.json` and an ESLint rule), so
the same code can run on the Phase 5 server.

## Swapping art

Code refers to art only by id. Edit `src/config/assets.manifest.json`: change a character's
`look` or a prop's colors, or add `"path": "models/thing.glb"` (relative to `src/assets/`) to
load a GLB instead.
See [ART_GUIDE.md](ART_GUIDE.md).

## Deploy

The client is a static site: `npm run build` and deploy `dist/` (Vercel works with zero config).
