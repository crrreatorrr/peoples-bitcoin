# Changelog

## 0.2.0 — OSRS interface pass (2026-10-28)

- **Minimap** with compass (top-right): turns with the camera, NPC and ground-item dots, bank and
  mining icons, destination flag, click to walk, compass to face north.
- **Orbs:** Hitpoints orb and XP-counter toggle beside the run orb; total XP counter.
- **Chat:** type anywhere to chat; messages appear in the log and above your head. All / Game /
  Public filter tabs.
- **NPC dialogue box:** one line at a time with "Click to continue" (Space works too).
- **Bank** in the Treasury hall: withdraw/deposit 1/5/10/All, deposit inventory, quantity
  buttons, right-click options. Saved; old saves upgrade automatically (save format v2).
- **Ground items:** drops land on the tile, "Take" picks them up, they despawn after 3 minutes.
- **Inventory:** drag to rearrange; hover tooltips; OSRS-style stack counts (100K / 10M).
- **Wandering NPCs:** The Treasurer strolls the hall; players walk through NPCs.
- **Skill guides:** click a skill to see its level unlocks.
- **Polish:** level-up fireworks; right-click menu lists every entity under the cursor.
- **Tests:** 96 (bank, ground items, NPC wandering, chat, dialogue, save migration added).

## 0.1.0 — Phase 1: core sandbox (2026-10-28)

Playable: walk around The Treasury, mine server racks, level Mining, watch $BITCOIN move, reload
and keep your progress.

- **Engine:** Vite + strict TypeScript + Three.js r186. Low-res nearest-neighbor rendering,
  flat-shaded placeholder art, OSRS-style orbit camera (drag / arrows / wheel, pitch 25–75°,
  zoom 7–24).
- **Simulation (`src/sim`, DOM-free):** 600 ms tick loop driven by intents; A* pathfinding
  (8-way, no corner cutting); walking and running with run energy; seeded RNG stored in the save.
- **World:** The Treasury (40×40) with a lawn, fountain and Gremlin statue, a main hall with the
  RoadMap board, a server room, a vault, and The Treasurer.
- **Mining:** three rack tiers (levels 1/15/30), OSRS XP curve, XP drops, level-up banner,
  racks overheat and respawn.
- **Economy:** $BITCOIN random walk with hopium/boss/dump drift, price floor, 200-point
  history, ticker with sparkline and market cap.
- **UI:** hover tooltips, right-click "Choose Option" menu, chat log, 28-slot inventory, skills
  tab (14 skills), settings (save, reset, controls), run orb.
- **Persistence:** versioned, Zod-validated localStorage saves with a migration hook; autosave
  every 10 ticks and on tab hide/close.
- **Data:** items, objects, NPCs, skills and zones as JSON, validated with Zod plus
  cross-reference checks.
- **Tests:** 72 Vitest tests over the sim (pathfinding, XP, mining, economy, tick, save, content);
  ~96% line coverage of `src/sim`.
