# Changelog

## 0.3.0 — Skill web, combat, tutorial and Higgsfield art (2026-10-28)

- **10 interconnected skills** (owner revision): Shooting, Melee, Defense, Hitpoints, Summoning,
  Mining, Fundraising, Lobbying, Spin, Construction. Gathering skills need tools (picks, donor
  lists, business cards) with three tiers each.
- **Trading Terminal:** 50 items priced in USD (ending in 69), paid in $BITCOIN at the live
  price; sell anything with a value. Hash, scandals, Talking Points, loot all sell.
- **Lobbying** pays $BITCOIN per favor; 1 in 5 favors is blackmail (XP, no pay).
- **Spin** turns raw Scandals into Talking Points (food) at the Press Podium; can fail.
- **Combat:** OSRS-style accuracy/max hit, guns > melee > shields triangle, Accurate / Rapid /
  Longrange and Bash / Block styles, line of sight, auto-retaliate, hitsplats, HP bars, tracers.
  9 guns, 4 melee weapons, 13 armor pieces, common Rounds; the Hash Cannon and Golden Veto Cannon
  fire mined Hash and splash nearby enemies. Death drops your pack where you fell.
- **The Trenches:** 10 enemy types from level 2 to 80 plus three bosses (Sludge Mother with
  adds, Wrong-Namer Chief, Captain Motion) gating barricaded sections. Drops are all useful.
- **Summoning:** five Sprotos (Recruit, Medic, Grunt, Sniper, Heavy) that follow, assist and
  defend, each with a special (Rally, Patch Up, Taunt, Headshot, Suppress).
- **Bunker:** unlocked by the Bunker Down quest; build a Storage Locker, Med Bay, Home Terminal,
  Respawn Bed, Server Farms (passive Hash), Ammo Crate/Armory and a Summoning Circle.
- **Tutorial "Empty Treasury":** 19 quick steps across every skill with tutor NPCs, a yellow
  hint arrow and a Quests tab checklist; hints only, any order.
- **UI:** Equipment tab (gear, stats, styles), Summoning tab, Quests tab, Terminal and build
  windows, Hitpoints and special orbs, skill guides for every skill.
- **Art:** 118 Higgsfield sprites and icons (characters, enemies, Sprotos, props, items).
- **Saves:** format v3; older saves upgrade (Command XP becomes Summoning XP).
- **Tests:** 129.

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
