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
- **Static NPCs block their tile** until NPCs get movement.
- **Entity ids** are placement indices in the zone (`o12`, `n0`). Saves key object depletion by
  these ids, so reordering a zone's `objects` array only resets depletion timers. Harmless.
- **Run energy** is 0–100. Running only happens when at least 2 steps remain; the last single
  step is walked and doesn't drain energy. Energy hitting 0 turns run off.

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
