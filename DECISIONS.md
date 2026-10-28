# Decisions

Choices made where DESIGN.md was silent or ambiguous, following "the simplest option that fits
OSRS conventions". Newest at the bottom of each section.

## Simulation

- **Tick order.** inputs → movement → actions (skilling, Talk-to) → regen/timers → economy →
  autosave. DESIGN.md's order has no explicit skilling step; actions run right after movement so a
  player who arrives this tick starts acting this tick. Combat, Sproto AI, bosses and random events
  will slot in after actions. Run-energy regen lives in the movement step because it depends on
  whether the player ran that tick.
- **Intents** are queued by the client and applied at the start of the next tick, in order, so the
  last walk/interact click in a tick wins. Every intent is validated (unknown target, or an action
  the target doesn't offer, is ignored), which is the shape the Phase 5 server needs.
- **Pathfinding cost.** Every step, straight or diagonal, costs one tick, so paths minimize step
  count. Diagonals cost 11 vs 10 for straights only to break ties. Clicking an unreachable or
  blocked tile walks to the closest reachable tile (OSRS behavior).
- **Interaction range.** Objects and NPCs are used from tiles that share an edge with them (no
  diagonal use), like OSRS scenery.
- **NPCs don't block paths** (changed 2026-10-28). Players walk through NPCs, as in OSRS. Idle
  NPCs wander one tile at a time within `wanderRadius` of their spawn, never onto the player or
  another NPC, and stand still while the player is using or talking to them.
- **Entity ids** are placement indices in the zone (`o12`, `n0`). Saves key object depletion by
  these ids, so reordering a zone's `objects` array only resets depletion timers. Harmless.
- **Run energy** is 0–100. Running only happens when at least 2 steps remain; the last single
  step is walked and doesn't drain energy. Energy hitting 0 turns run off.

- **Open interfaces close on movement.** Walking or starting another action closes the bank and
  any dialogue, as in OSRS.

## Bank, items, chat

- **Bank pulled forward from Phase 3** (approved by the owner on 2026-10-28). Booths are in the
  Treasury hall. Every item stacks in the bank; empty stacks are removed (no placeholders);
  400 distinct stacks. Save format moved to v2 with a v1 → v2 migration that adds an empty bank.
- **Ground items** are not saved (like OSRS items vanishing on logout) and despawn after 300 ticks.
  Stackables merge into one pile per tile; non-stackables get one pile each. "Take" walks onto
  the tile.
- **Public chat** is an intent, so the Phase 5 server can relay it. Max 80 characters, whitespace
  collapsed, shown above the head for 5 ticks. Typing anywhere starts a message.
- **NPC dialogue** shows one line at a time in a box over the chat log. It reads the NPC's linear
  `lines` until node-graph dialogue arrives in Phase 3. NPC lines no longer go to the chat log.
- **Optimistic UI.** Inventory swaps and closing the bank show immediately; the next tick
  confirms them. Everything else waits for the tick, like OSRS.

## Mining

- **Output** is "hash" items (Scrap/Warm/Molten Hash), non-stackable like OSRS ore, so a full
  inventory stops mining. Turning hash into BTC needs the bank/terminal from Phase 3.
- **Success** per attempt = `successAtReq + (level − levelReq) × successPerLevel`, capped at
  `successMax`; one attempt every 3 ticks. Depletion chance and respawn time are per rack in
  `skills.json` (dusty racks deplete 50% of the time so the tutorial area flows).
- **Drop** destroys the item. Ground items come later.

## Economy

- **Price** is a multiplicative random walk: each update multiplies by `exp(drift + σ·N(0,1))`,
  so drift and volatility are log-returns. Start price $0.0691, floor $0.0069.
- **recentBossWins / recentDumps** decay by ×0.98 each price update. Both are 0 in Phase 1.
- **Ticker % change** is measured across the 200-point history window.

## Client

- **Tick loop** runs inside `requestAnimationFrame` with an accumulator. It pauses while the tab is
  hidden and resumes without a catch-up burst (more than 5 missed ticks resets the clock). Offline
  progress is Opal charging in Phase 3.
- **Low-res rendering** sets the WebGL pixel ratio to 0.55 of CSS pixels and lets CSS
  `image-rendering: pixelated` upscale it. Same result as a render target with less code.
- **Context menu** opens on right-button release, so a right-drag can rotate the camera instead.
  It lists every entity under the cursor (actions first, then Walk here, then each Examine), and
  left-click runs the top option, as in OSRS.
- **Minimap** is a 2D canvas drawn from the tile data (terrain colors, blocking objects, dots),
  not a second WebGL camera: cheaper, crisp, and no extra draw calls. It turns with the camera.
- **Hitpoints orb** shows the Hitpoints level until combat adds damage in Phase 2.
- **Esc** closes windows and returns the side panel to Inventory (an OSRS setting).
- **Inventory** left-click is Examine (there is no "Use" yet); shift-click drops.
- **Talk-to** prints the NPC's `lines` in chat until the dialogue system arrives in Phase 3.
- **Saves** store only persistent data; path and current action are dropped. On load, unknown
  items/skills are dropped, new skills get their start level, and an unwalkable position falls
  back to the spawn. An unreadable save is copied to `peoples-bitcoin.save.unreadable` instead of
  being silently lost.
- **Dev hook.** In dev builds only, `window.__game` exposes `{ state, queue, content }` for
  debugging.

## Art & UI

- **Original look.** OSRS conventions are used (600 ms tick, XP formula, "Choose Option" menu,
  object/NPC name colors), but no OSRS assets, fonts or UI art. Fonts are Press Start 2P (headers)
  and VT323 (body).
- **UI icons** (tabs, skills, run orb) are emoji `glyph` entries in the asset manifest, so they are
  swappable like any other placeholder.
- **GLB paths** in the manifest are relative to `src/assets/` and resolved with
  `import.meta.glob`, matching DESIGN.md's folder layout.
- **Zone size.** The Treasury is 40×40 (DESIGN.md says "e.g. 64×64"); that's enough for the
  tutorial area.

## Tooling

- **Sim purity is enforced**, not just intended: `tsconfig.sim.json` type-checks `src/sim` without
  DOM types, and ESLint forbids `three`, `render`, `ui` and `input` imports there.
- **Dev preview port.** `.claude/launch.json` uses port 5181 because 5173 was taken by another
  local project. `npm run dev` still defaults to 5173.

## Skill web, combat, tutorial (2026-10-28)

The owner's revisions are recorded at the top of DESIGN.md. Choices made while building them:

- **Multiple zones.** `GameState.zone` is the zone you're in; zones you've left stay in
  `otherZones` for the session, so loot and death piles persist while you're away. Only the
  current zone simulates. Zones, enemies, ground items and the active Sproto aren't saved.
- **Portals and gates are objects.** Portals (`role: portal`) carry a `to` in the zone placement;
  barricades (`role: gate`) sit in a wall and move you to the mirrored tile on the other side.
  Both can require an unlock flag (`boss:<enemyId>`, `bunker`).
- **Combat math** follows DESIGN.md §8 with OSRS formulas: effective level = level + 8 + style
  bonus; accuracy roll × triangle modifier; max hit = floor(0.5 + eff × (damage + 64) / 640);
  damage 0..max on a hit. Defense trains both from Block/Longrange and from damage taken.
  Enemies use the same math; they ignore players above 2× their level unless they're bosses.
- **Common ammo** is one item (Rounds) in the ammo slot. Explosive cannons take no ammo slot; they
  fire the best Hash in the inventory (Molten > Warm > Scrap) and splash enemies within 1 tile for
  up to half the max hit. Out of ammo means the gavel.
- **Death** drops the whole inventory where you fell (DESIGN.md says configurable:
  `DEATH.dropInventory`); equipment is kept. You wake at the bunker bed if built, else the
  Treasury.
- **Combat level** = 0.25 × (Defense + Hitpoints + Summoning/2) + max(0.65 × Melee,
  0.325 × floor(1.5 × Shooting)); starts at 3 like OSRS.
- **Prices** are USD in shops.json; the Terminal charges ceil(USD / price) $BITCOIN and pays
  floor(value / price). Item `value` is what the Terminal pays (gear ≈ 40% of its price).
- **Lobbying** pays USD-denominated $BITCOIN per success; 20% of successes are blackmail.
- **Spin** failures destroy the scandal (no junk items, per "everything is useful").
- **Tutorial** steps complete in any order; each tutor gives the tool for their skill. New saves
  start with it active; upgraded saves get it too. Bunker Down is ordered: talk, then deliver.
- **Sprotos** use DESIGN.md §9's priorities (assist > defend > follow); one at a time; a fallen
  Sproto has a short cooldown; specials cost Summoning points that regenerate.
- **Bunker production** counts game ticks, so farms fill only while you play (offline progress
  is Opal charging, Phase 3).
- **Sprites** are camera-facing billboards; they flip by screen direction and bob instead of
  having walk cycles. Terrain stays procedural 3D.
- **Save v3** renames `command` XP to `summoning` and adds HP, equipment, quests, unlocks and the
  bunker.
