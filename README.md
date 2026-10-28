# The People's Bitcoin

A satirical, OSRS-inspired browser MMO-lite built with Three.js, TypeScript and Vite.
All currencies are fictional and in-game only. See [DESIGN.md](DESIGN.md) for the full design.

**Status:** Phase 1 (core sandbox) complete. See [CHANGELOG.md](CHANGELOG.md) and [TODO.md](TODO.md).

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

- **Left-click:** walk, or the default action (Mine, Talk-to)
- **Right-click:** all options (Mine, Talk-to, Walk here, Examine)
- **Right- or middle-drag, arrow keys:** rotate and tilt the camera
- **Mouse wheel:** zoom
- **Inventory:** left-click examines, shift-click drops, right-click for options
- **Run orb** (top right): toggle running

Progress autosaves to `localStorage` every 10 ticks and when the tab is hidden or closed.
Settings → Reset progress starts over.

## Layout

```
src/
  config/   branding.ts (names), balance.ts (every tunable number), assets.manifest.json
  data/     items, objects, npcs, skills, zones (JSON, validated with Zod at load)
  sim/      pure game logic: tick loop, pathfinding, mining, economy, save format, rng
  render/   Three.js: low-res renderer, camera, world, entities, placeholders, picking
  ui/       HTML overlay: ticker HUD, chat, inventory, skills, tooltips, context menu
  input/    mouse and keyboard
  main.ts   wires it together and runs the 600 ms tick loop
tests/      Vitest tests for src/sim
```

`src/sim` has no DOM or Three.js imports (enforced by `tsconfig.sim.json` and an ESLint rule), so
the same code can run on the Phase 5 server.

## Swapping art

Code refers to art only by id. Edit `src/config/assets.manifest.json`: change a placeholder's
colors, or add `"path": "models/thing.glb"` (relative to `src/assets/`) to load a GLB instead.
See [ART_GUIDE.md](ART_GUIDE.md).

## Deploy

The client is a static site: `npm run build` and deploy `dist/` (Vercel works with zero config).
