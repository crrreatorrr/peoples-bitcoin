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
  inventory stops mining. Hash is sold for $BITCOIN at the Terminal.
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
  DOM types, and ESLint forbids `three`, `render`, `ui` and `input` imports there. That pass covers
  `src/sim` and `src/config` only. `tests/` is checked by `tsconfig.json`, because the hub and
  tooling tests use DOM, Node and Vite types.
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
- ~~Sprites are camera-facing billboards~~ (replaced in 0.4.0: they leaned into walls when the
  camera turned).
- **Save v3** renames `command` XP to `summoning` and adds HP, equipment, quests, unlocks and the
  bunker.

## 3D characters, quests and dialogue (0.4.0)

- **Models built in code, not generated.** The owner chose low-poly models made in code over
  Higgsfield image-to-3D (~1,000 credits, unrigged meshes from pixel art). Looks are data (the
  manifest's `look`), styled to match the existing sprites, which stay as UI art.
- **Animation is procedural** (`animate.ts`): the walk cycle advances with distance travelled, so
  feet don't slide; joints ease toward a target pose each frame. Attacks, hits and deaths are
  timestamps on the view, so the sim stays free of animation state.
- **One `attack` event** (`melee`, `gun`, `explosive`) replaced `projectile`, so melee swings
  animate; tracers still draw for guns.
- **What the player holds:** the wielded weapon; the best tool for the skill while skilling (OSRS
  shows the pickaxe while mining); the fallback gavel while fighting unarmed or out of ammo.
  Armor rebuilds the model when the worn head/body/legs change.
- **Ground items** lie flat on their tile instead of standing up as billboards.
- **Construction** builds are instant in the sim, so the hammering is a short visual burst on
  Construction XP.
- **Training yard:** the Sludgeling pen became a yard with Spam Bots (level 1) and Comment Trolls
  (level 4), all passive. The tutorial adds a Comment Troll step.
- **Morelight**, Chief of Staff, is a fictional character from the owner's written description
  (tall, fair, mustache); per Hard Rule 2 nothing was modeled on a photo. He opens the tutorial
  and gives the main quests.
- **Dialogue variants** pick lines by quest status and, optionally, by the quest's next step
  (`step`), first match wins. Variants are chosen after quest progress runs, so the talk that
  finishes a quest already uses the after-quest lines. Lines can be the player's replies
  (`{ "player": "..." }`); there are no choices yet.
- **Quest prerequisites:** `requires` lists quests that must be complete before `startNpc`
  offers one. A quest never starts on the same talk that completes its prerequisite, so the
  turn-in and the next briefing are separate conversations.
- **Main questline:** Sludge Duty → Name Calling → Motion Denied, one per Trenches boss, worth
  2/2/3 quest points (tutorial and Bunker Down 1 each, 9 total).
- **Chat heads** are rendered from the 3D models into an offscreen target on the main renderer
  (no second WebGL context) and cached as images.

## OSRS feel pass (0.4.0)

An audit compared movement and interface with OSRS; these choices came out of it.

- **Clicks act on press** (left: default action; right: the menu). Right-drag no longer rotates
  the camera (DESIGN.md §2 said it did): middle-drag, arrow keys and a sideways trackpad swipe do.
- **Enemies chase with direct steps** (diagonal, else x, else y), not A\*, so walls block them
  and safespots work; they aggro only with line of sight. A\* is kept for the player, Sprotos and
  enemies walking home.
- **Leash:** enemies never step more than `ENEMIES.leashRange` from spawn and hold at the edge.
  Fights with no attack either way for `ENEMIES.giveUpTicks` are dropped; enemies heal 1 HP per
  `COMBAT.hpRegenEveryTicks` (no instant full heal).
- **Single-way combat** everywhere except boss fights (bosses and their adds are multi-way): an
  enemy can't attack you within `COMBAT.singleWayTicks` of another enemy's attack. The player
  is not stopped from attacking a second enemy.
- **Auto Retaliate** (saved, save v4) also interrupts skilling and closes menus, as in OSRS.
- **Death** plays for `DEATH.respawnDelayTicks` ("Oh dear, you are dead!"); inputs are ignored
  and enemies drop you while you fall.
- **Projectile timing is visual only.** Damage still lands on the tick; the client delays the
  hitsplat, flinch, death fall and explosion until the shot arrives (`RENDER.projectile*`).
  Shots leave the posed model's muzzle or staff tip. The Champion's rock leaves the held rock's
  position when the throw animation releases it. Models without a launch point use body height.
- **Terminal** left-click is Value; buying is in the right-click menu, like OSRS shops.
- **Bosses stay one tile** in the sim; their models were scaled down to fit it rather than adding
  multi-tile enemies.

## Quests, items and Higgsfield characters (0.5.0)

- **Hard Rule 2 exception (owner):** the President is "President Obama", a satirical low-poly
  caricature. A parody notice (`PARODY_NOTICE` in `branding.ts`) shows at the start of a new game
  and in Settings. No other real people; nothing reads as a real endorsement.
- **One story:** since the Lockdown the Treasury's gates are sealed and every quest points at
  getting out. The skill quests each earn a part for the old Teleport Chamber north of the
  Trenches; **The Way Out** needs Bunker Down, Motion Denied and all four skill quests, and ends
  by stepping through the Chamber into a new zone, The World Out There.
- **Dialogue choices** are OSRS "Select an Option" menus (keys 1–5). The chosen line is echoed as
  the player's reply. A choice can be a quest trigger (`choice`), grant `choiceRewards`, and is
  saved (save v5) so later lines can depend on it (`choice` on NPC variants).
- **Use X → Y** reads `uses.json`; an entry can be limited to a quest step. Anything else gets
  "Nothing interesting happens." The player walks to the target first, as with any interaction.
- **Quest-only enemies** sleep (no spawn, no respawn) whenever their quest isn't at the right
  step. **Quest-only drops** (`questDrops`) roll only while the quest needs them.
- **Drinks** boost like OSRS potions: `levels + pct × base level`, for a fixed time; drinking
  again re-applies the boost instead of stacking. Requirements and rolls use the boosted level.
- **Teleports:** tickets are used up; quest teleports (Teleprompter, Chamber Key) are reusable
  with a cooldown. Teleporting takes `TELEPORT.delayTicks`, during which the player can't act.
- **Outfits:** each skilling piece adds a small XP bonus to its skill, plus a set bonus for all
  `OUTFITS.setPieces` pieces. New neck, hands and feet slots hold the extra gear.
- **Out of ammo** the gun becomes a club: melee with its bonuses scaled by `COMBAT.bashScale`, no
  faster than `COMBAT.bashMinSpeed`. The gavel only shows with no weapon at all.
- **Characters from Higgsfield (owner):** every NPC, enemy and Sproto is a Higgsfield model.
  Each starts as a concept in one locked style prompt (an early-2000s low-poly MMO look: slit
  eyes, shard hair, barrel chest, mitten hands, A-pose) so the cast matches without copying any
  real game's characters. Concepts go through Tripo image-to-3D (about 3k triangles), then the
  Meshy auto-rig. Creatures without arms and legs stay unrigged and hop like any static model.
- **Rigged GLBs use the procedural animation,** not clips: invisible proxy joints sit where the
  bones are, `animate.ts` poses them like a code-built humanoid, and each frame copies their
  rotation onto the bones (arms turned down out of the A-pose first). One animation system
  covers both kinds of character, and held gear and worn armor attach to the bones.
- **Rig height is the in-game height:** each character was rigged at the height its code-built
  version stood, so manifest scales are 1 (Morelight keeps 1.16 to stay tall). Held gear scales
  with height against a 1.83-unit human, so Sprotos carry Sproto-sized guns. The manifest
  `look` still supplies held gear (`left`, `right`) and `pose`; the mesh shows everything else.
- **Tripo exports face +x;** Meshy's rigger expects +z and builds a broken skeleton otherwise.
  `tools/turn_glb.py` turns each mesh and stands it on the ground before rigging.
  `tools/shrink_glb.py` cuts textures to 512 px JPEG (about 270 KB per character).

## Owner fixes after 0.5.0

- **$BITCOIN is the only currency** (owner). The BTC wallet is gone and DESIGN.md Hard Rule 1
  now bans real coins by name. The BTC Shard became the Hash Crystal (same drops and price). The
  Wrong-Namers' gag is that they call the coin **$BITCON** ("it's a con"), and the planned final
  raid boss BTC Prime is now The Old Coin. Save v6 converts old saves.
- **Running like OSRS** (owner: "the running is very awkward"). The gait does one footfall per
  tile walking or running, so a run is one full stride cycle per tick (it was 1.5 footfalls per
  tile, a sprinter's cadence). The run has its own cycle: forward lean, bent elbows pumping
  against the legs, a heel kick behind, a nearly straight reaching leg, and its low point
  mid-stance (the walk peaks mid-stance, like an inverted pendulum). A pistol or club is carried
  low and forward. Two-handed guns are carried and bob.
- **Turning at the OSRS rate:** half a turn in 0.64 s (`RENDER.turnSpeed`), down from about
  0.26 s. As in OSRS, the run cycle waits until the actor faces where it's going; while it turns
  it steps along at the walk cycle.
- **Arrow keys:** left turns the view left, as in OSRS (it was reversed).
- **Adult audience** (owner, 2026-10-28): the game is for adults (18+). DESIGN.md Hard Rule 4 now
  allows crude meme humor (the owner's COOM vials) but still nothing explicit and no gore. The
  parody notice says "for adults (18+)".

## The Trenches escape story

- **Backstory:** on the first day of the Lockdown, twelve people called Expedition One dug the
  Trenches north toward an old Teleport Chamber. They found it dead. Their Captain wouldn't
  accept it and has run laps in front of it ever since, so nobody else would see it fail. Their
  lookout, the Scout, came back down and has waited at the bottom ever since.
- **Each boss is a reason people stay in:** the Sludge Mother is the Lockdown's panic pooled up,
  the Wrong-Namers say there is no outside ("it's all $BITCON"), and Captain Motion is motion
  without progress. His defeat line ("The Chamber's dead. I ran so nobody would see.") sets up
  The Way Out's four parts.
- **Enemies talk** (`EnemyDef.barks`): a line as a fight starts, one below half HP, one when
  beaten, in the chatbox and over their heads (OSRS-style shouts). Lines are picked by tick and
  id, not the RNG, so they never change combat rolls.
- **Lore along the way:** signs and crates in the Trenches tell Expedition One's story through
  Examine (the OSRS way), and the barricades' locked messages say what's behind them. Signposts
  take their two lines of text from the manifest `label`.
- **The Scout** answers questions through a "Select an Option" menu and has lines for every
  stage of the escape, through The Way Out.

## Moonward Academy (0.6.0)

- **An original wizard school** (owner asked for one "like Hogwarts"). Hogwarts is trademarked and
  Hard Rule 3 bans the wizard boy, so Moonward Academy of Applied Wizardry has its own names, no
  houses and no characters from any book. Its story mirrors the Treasury's: the Bursar wove the
  endowment into a rug and pulled it (the Rugmancer), so the President, who knows lost
  treasuries, gets the job.
- **Found after The Way Out:** a rowboat in The World Out There ferries you across the lake, so
  the escape story leads straight into it.
- **Staffs are guns that fire COOM** (owner): ranged weapons that train Shooting and use the same
  styles. COOM is an ammo-slot item with `ammoType: coom`; guns only fire Rounds and staffs only
  fire COOM. Out of COOM, you bash with the staff. Spells fly as glowing orbs (attack style
  `magic`), and wizard enemies (`EnemyDef.magic`) cast them too.
- **Five Higgsfield wizards** (owner: only five). The Archmage, the Staffwright, the Apprentice,
  the Battlemage and the Rugmancer; students and Professor Ironcloak reuse the Apprentice and
  Battlemage models, so the academy is full of wizards on five models.
- **More than one shop:** a terminal object can name its `shop` (default the Trading Terminal),
  and the shop window shows that shop's stock. The Staffwright's Stall sells staffs, COOM, the
  Moonward hat and robe, Soundbites and Hopium Soda; every shop's prices end in 69.
- **Moonward Enrollment** (3 quest points): the Archmage hands you a staff and COOM, then you win
  a duel, break the spell on a Battlemage, and beat the Rugmancer, who only wakes in his tower
  when the quest gets to him. Reward: the Archmage's Staff.

## Quest bosses and the weapons they fear (0.6.0)

- **Every quest has a boss** (owner) that fears one weapon (or a style), and the quest's dialogue
  hints at it without naming it. `EnemyDef.weakTo` lists the weapon ids or attack styles; anything
  else does `BOSSES.offWeaponScale` (10%) of its damage on average (owner: "others do little
  damage"; rounded at random, since flooring turned every small hit into 0). The boss says so once per weapon (a `resist` bark and a
  warning), and Sprotos barely scratch it, so the puzzle can't be skipped.
- **The bosses and their weapons** (hint in brackets): Sergeant Sandbag, tutorial, any ranged
  weapon ("gavels bounce off"); the Building Inspector, Bunker Down, Campaign Pistol ("standard
  issue"); the Sludge Mother, Confetti Shotgun ("hits everywhere at once, she hates a party");
  the Wrong-Namer Chief, a gavel or the Veto Hammer ("call the room to order"); Captain Motion, Treasury Rifle ("reach
  across the trench; long range, longer paperwork"); the Rogue Process, Press Pass SMG or
  Minigun ("flood it"); the Gatecrasher, explosive cannons ("fireworks"); the Corporate Raider,
  Briefcase Bludgeon ("heavy paperwork"); the Pundit, Ballot Blaster ("count every vote"); the
  Lockdown Warden, Veto Hammer or Golden Veto Cannon ("laws fall to a veto"); the Rugmancer,
  Hopium Staff ("only hope unravels doubt").
- **New bosses reuse the cast's models** (owner): the Sandbag wears the Drill Sergeant, the
  Inspector the veteran lobbyist, the Gatecrasher a big Party Crasher, the Raider the junior
  lobbyist, the Pundit a big Heckler, and the Warden the Dump Golem.
- **Quest steps:** new bosses get a kill step (Bunker Down then ends with a talk to the
  Contractor; Hostile Takeover ends on the Raider). The Chamber unlocks when the Warden falls,
  not when it's fueled, so nobody walks past him.
- **"The way forward is open"** now only shows for bosses that guard a barricade.
- **Sergeant Sandbag** is a gentle dummy: 8 HP, hits for at most 1, always in the training yard.
  He isn't a `boss` (farming him moved the market).

## Gameplay, dialogue and story QA (0.6.1)

Three audits (gameplay duels in the real sim, every NPC variant, the story as a player meets it).

- **Market:** only a boss's _first_ win counts toward `recentBossWins`; respawning bosses can't
  be farmed to pump the price.
- **Bosses tuned to the level their weapon unlocks** (duels, auto-eating): the Lockdown Warden
  (420 → 240 HP) at Melee 40, the Wrong-Namer Chief (220 → 160 HP, defense 30) at Melee 25–30
  with the Iron Gavel, Captain Motion (300 → 220 HP, slower) at Shooting 45, the Gatecrasher
  (170 → 70 HP; a cannon fires one non-stackable Hash per shot, so one inventory must be enough).
  The Margin Callers and a Dump Golem moved off the path to the Chamber. The Press Pass SMG is
  speed 3 (on Rapid it fired every tick and matched the Railgun).
- **Trench bosses sleep until their step,** like the quest-gated bosses: the Sludge Mother,
  the Wrong-Namer Chief and Captain Motion. Beaten, they stay beaten; the Captain sits by the
  Chamber as an NPC (zone NPCs can now `require` an unlock; they appear on your next arrival).
- **Quest items can't be lost for good** (OSRS-style): untradeables (`value` 0) stay with you on
  death, and whoever gave you a quest item hands you another if your next step needs it and you
  have none in the inventory, bank or equipment. Quest drops (the Guest List) come back from the
  quest giver.
- **Chamber fuel:** 5 Scrap Hash (was 20), to leave room for about 19 food before the Warden, who wakes the moment it is fueled; Morelight says to pack Talking Points first. Gatecrasher strength 34 → 26 (with cannon ammo filling the pack, the player died first), Diamond Hands Minigun damage 26 → 16 (it fires every tick and was 2.5× the Railgun).
- **Dialogue variants are first-match**, and talking starts the NPC's next quest before lines are
  picked. Tests now fail on a variant hidden behind an earlier one, a "quest complete" variant the
  next quest always talks over, and a variant keyed only to a "talk to me" step.
- **One timeline:** the Lockdown is about 412 days old and the President was elected inside it
  ("an election in the canteen"). A few of Expedition One came back; the Wrong-Namer Chief was
  their map-reader. The Lockdown Act is written on the sealed Treasury Gates at the south end of
  the main path.
- **Hostile Takeover** waits for Sludge Duty (the Paper-Hands live past the first barricade) and
  hands over the Exit Permit with the decision; the negatives show the Broker with the Corporate
  Raider, which is why the Raider comes.
- **Moonward's students are adults** ("mature students", postgrads), so COOM jokes never sit
  next to anything that reads as school-age. The press-conference answers are jokes rather than
  investing slogans in the President's voice.
- **American spelling** everywhere (Defense, Enrollment, Dueling, practice, unraveled).
- **NPCs who hand you something say it once:** an NPC with `repeat` lines says those instead of its
  defaults after the first talk (a `met:<npcId>` flag in `unlocks`, so the save format is
  unchanged). Quest variants still come first.
- **The price reverts to normal:** drift gains `- k4Revert * ln(price / anchorPriceUsd)` (half-life
  about 17 minutes), so the random walk stays within roughly ±25% (1σ) instead of wandering about
  ±50% an hour; a boss win still lifts it for a while.
- **A Hash Cannon keeps quest Hash:** it never fires Hash the next step of an active quest will
  take (Bunker Down's 10 Scrap Hash, the Chamber's fuel); out of spare Hash, it bashes and says why.
- **Spent quest leftovers** (Photo Negatives, Blackmail Photo) can be dropped like anything else;
  no special handling.
- **Dialogue pages (owner):** the UI measures each line against the box and splits it at word
  breaks into pages that fit, preferring a sentence end after the first third of a page. Pages are
  UI-only; the sim still sees one line, advanced after the last page.
- **Click cross (owner):** a 2D overlay at the click's screen position (the right-click point for
  menu choices), not a 3D marker on the target's tile, as in OSRS.

## Hub Tickets (2026-10-29)

- **Game id** is `peoples-bitcoin` for init, logs, and the exit fragment. hub-sdk 0.4.0
  accepts that id and exposes `spendTickets`, `sellItem`, `getTicketBalance`, and `earnTickets`.
  `init` and `getTicketBalance` also return `serverTime`. The relic
  event id stays `pb.quest_complete` and the board id stays `pb_total_xp`; those are hub event
  and board names, not the game id. `getTicketBalance` also returns `sessionCapLeft` and
  `dailyCapLeft`; earn batches are clamped to those rooms when they are present.
- **Tickets replace the wallet.** Save v7 copies the old `bitcoin` number across 1:1. The live
  USD price is no longer stepped or shown. `src/sim/economy.ts` still exports the old walk so the
  existing economy tests load. `currencies.bitcoin` is always 0 in memory so that suite still
  typechecks; the game never reads it.
- **Streams** (enemy USD, lobbying and fundraising USD, sell-only item value) are 1 Ticket per
  25 USD-equivalent. The fraction stays in the save. Whole Tickets bank in batches of at most 200
  with reasons `pb_drop`, `pb_lobby`, and `pb_sell`. `idempotency_mismatch` and `amount_over_rule`
  drop the batch and the local wallet is set back to the server balance. A success body with
  `capped: true` is still a success. A cap keeps the sealed id and amount and retries that same
  body when the known room allows. `rpc_failed` keeps the seal and is resent on the next init,
  not on a checkpoint. Standalone fractions live
  in `offlineRemainder` and are never sent.
- **Sealed batches** live in `localStorage` key `peoples-bitcoin.hub-ledger`, separate from the
  game save. `sealSync` takes `peoples-bitcoin.hub-ledger.lock` (a short owner lease), merges
  disk seals into memory, then compare-and-swaps the store's `v`. A seal is append-only: acking
  it does not forget the id. A tab whose save still has the pre-seal `pending` subtracts that
  amount instead of minting a new key. Reset clears this store along with the game save.
- **One writer.** A `BroadcastChannel` plus `localStorage` key `peoples-bitcoin.writer` gives
  the newest tab the save. An older tab stops, writes once, and shows "playing in another tab".
  Inventories are not merged. A server lease replaces this later.
- **Over-cap earns.** The server rejects a whole batch that does not fit (`pb_*` and the session
  cap are 200, `pb_quest` is 158). Stream batches are at most 200 and at most the room
  `getTicketBalance` left. `session_ticket_cap` and `daily_ticket_cap` leave that sealed batch
  in place. It is sent again with the same id and amount once the known room can take it.
  `rpc_failed` leaves the seal and waits for the next init. Further Tickets for that stream stay
  in `pending` until the batch resolves. `idempotency_mismatch` and `amount_over_rule` drop the
  batch and the wallet is read again from the server. A quest keeps `pb:quest:<id>`
  and is sent again on the next session start, so it pays once.
- **Quest and step rewards** are `round(sqrt(usd))`, each its own `earnTickets` with reason
  `pb_quest`. `questEarnName` builds `pb:quest:<questId>` and adds a step or choice id when
  that reward is separate. `questEarnWireKey` is the UUIDv5 of that name. The wallet is credited
  only when that earn row is new. `session_ticket_cap`
  leaves the earn capped and resends it only when the hub session id changes. `idempotency_mismatch`,
  `amount_over_rule`, and any other `*_cap` code mark it acked and do not resend.
- **Shop prices** are `src/data/shop_prices.tickets.json`, copied from Gameplay's
  `tools/pb_shop_prices.csv` (not recomputed from items). A row whose item is not in this
  build is kept and ignored. Ammo is
  packs of 100. A sell worth 0 Tickets is refused locally. Sell-only goods never call `sellItem`.
  A buy is refused unless that shop's stock list includes the item. A price row for an
  unstocked item does not sell: standalone `buy()` returns without touching the wallet, and a
  hub session says Unavailable and does not call `spendTickets`. A hub session buys and sells
  with `spendTickets` / `sellItem` and reads `getTicketBalance`.
  If those methods are missing at runtime the shop shows Offline and does not buy optimistically.
  No hub session means the standalone shop, which never syncs or exchanges.
- **Exchange** is a right-click on the Treasury terminals, steps of 10 up to 500, limited by the
  last server balance when we have one. The slot is persisted before the call.
- **Relic effects** from `init` sit on `hubSession` for the page only. They are not saved. No PB
  effect keys are applied yet; the matrix is still empty. (Since 2026-11-03 the init relics also
  sit there and unlock relic Sprotos; see Relic summons below.)
- **Ticket redeem.** The client sends Nakama's server key, never the HTTP key. `init` posts
  `/v2/account/authenticate/custom?create=false` with `{ id: "t:" + ticket, vars: { game } }` and Basic
  auth, then calls `profile.get` with `Authorization: Bearer <session>`. Every later RPC uses that session
  token. `createHubSdk({ serverUrl: '', serverKey })` takes the key from `VITE_NAKAMA_SERVER_KEY`, with
  `defaultkey` only under `vite dev`; Vite still proxies `/v2`. A production build without the variable
  has every redeem refused and runs with no hub session. `vendor/hub-sdk` is packed from hub main
  (`VENDOR.md` records the sha). The earlier 0.4.0 tree redeemed without the key and called a
  `session.claim` RPC the merged server does not register.
- **Exit** goes to the absolute `VITE_HUB_URL` (default `/hub/`) with `#from=peoples-bitcoin`.
  Vite `base` defaults to `/peoples-bitcoin/` in production and `/play/peoples-bitcoin/` in dev.
  `VITE_BASE` overrides it. Bundled asset URLs use that base. Exit stays `/hub/#from=peoples-bitcoin`.

## Multiplayer worlds (0.7.0)

Owner brief (2026-11-04): completely multiplayer, up to 100 players per world, scalable with more
worlds, RuneScape mechanics and chat as the reference (mechanics only: no RuneScape names, art or
text). The owner granted full agency; the plan's QA defaults are recorded here.

- **Backend: Nakama, not Colyseus.** One authoritative `pb_world` match per world on the hub's
  Nakama (metaverse-hub `server/modules/src/games/pb_*.ts`), running `src/sim` through the pure
  host in `src/server` (bundled by `npm run build:sim` into `vendor/pb-sim.js` there). DESIGN.md
  has a revision line.
- **World = one match of ≤ 100 players; the character is the account's.** Worlds are numbered and
  stable: `pb.worlds` keeps 1..`PB_WORLDS` (env, default 2) alive and opens the next one when every
  live world is 90 % full. Quick join picks the least full. Worlds scale horizontally (more worlds,
  then more Nakama nodes).
- **Tick:** the match loop runs at 5 Hz and the sim steps every third loop (600 ms). Messages are
  handled every loop; intents apply on the next sim tick. No client prediction (RuneScape): the
  click cross shows at once and the move starts on the next server tick.
- **AOI 15 / 17 tiles** (Chebyshev, with hysteresis) for players, Sprotos, enemies and ground
  items; NPCs are zone-wide. A full snapshot on join, zone change and every 50 ticks; otherwise a
  delta of changed entities, split into static and moving parts. Idle players only look at what
  changed this tick. JSON in this round (binary is a stretch).
- **Player ids:** the offline player is pid `'player'` with entity ids `'player'` / `'sproto'`;
  online, `p:<userId>` / `s:<userId>`, and the client maps its own back to `'player'`/`'sproto'`,
  so the renderer and UI are unchanged. The sim is a world of one offline (every old test runs the
  world code path).
- **Private instances:** quest-gated enemies get a copy per online player at that step
  (`e<i>@<pid>`; the offline template `e<i>` sleeps online), and their adds are private too. The
  bunker is one instance per player (`zone_bunker@<pid>`). NPCs with `requires` show per viewer.
- **Loot:** the top damager owns the drop; it is private for `LOOT.privateTicks` (1 minute), then
  public. Untradeables and death piles are never public. Dropped items follow the same rule.
- **Single-way:** outside boss fights, an enemy fighting another player can't be joined ("Someone
  else is fighting that."). Players don't block each other or NPCs.
- **Tickets online are server-side only.** Stream batches (`pb_drop`, `pb_lobby`, `pb_sell`) are
  sealed into the character save with key `pbw:<sid>:<reason>:<tick>` before `HubEconomy.earn`, so a
  retry reuses key and amount. Quest rewards keep their UUIDv5 keys (never paid twice). Shop buys
  and sells go through `HubEconomy.spend/sell` in the tick (the hub's prices). `session_closed` keeps
  the amount and sends the player back to the hub. The client never credits Tickets online.
- **Trades are items only, never Tickets** (rule 1). Two screens; any change resets both accepts and
  locks Accept for 3 ticks; the confirm screen shows each side's Terminal value; the swap is checked
  and saved for both players in one storage write, rolled back if that fails. Doing anything else
  closes the trade.
- **Chat routing:** inside the match (public to players in view, PMs in this world directly, other
  worlds through `nk.matchSignal`), not Nakama channels. PMs are never stored; logs keep metadata.
- **Filter scope:** the server always blocks slurs (seed list `src/data/chatfilter.json`, folded for
  case, accents, leetspeak, spacing and stretching, without catching "Niger" or "raccoon"), links and
  wallet-shaped strings. Profanity masking is a client setting, on by default. Three blocked or
  flooding messages mute for a minute; quick-chat still works while muted. Moderation this round
  is logging only.
- **Quick-chat** slots ("My Mining level is 42") are filled on the server from the real state.
- **Names (rule 2):** everyone plays the same President caricature. The nameplate is the hub
  username, never "President <name>"; names that look like the President, staff or the cast (folded
  like chat) become "Citizen ####". Player chat is attributed to the username. The parody notice is
  on world select too.
- **Saves:** offline and online characters are separate. Online characters start fresh
  (`NET.allowSaveImport = false`; import is a stretch). Saves stay **v7**: `social` and `importedAt`
  are optional fields, so no migration was needed (the plan said v8; an optional field is the
  smaller change and keeps old saves loading).
- **Persistence:** `pb_character/main` (owner read/write 0), written every 100 ticks, on logout
  (after a 10 s grace that lets a reconnect resume), after trades and on shutdown, always with the
  read version. A version conflict means another session wrote it, and this world kicks the player
  (`superseded`). `pb_online/status` holds the world for friends lists and one-world-per-account.
- **`pb_total_xp`** stays client-reported and online characters don't post it yet (stretch S9).
- **Friends and ignores** sit at the top of the Settings tab: the frame art has exactly 4 + 3 tab
  sockets, and painting a new one is an art task.
- **Exchange (Tickets → Verse)** is not offered online in this round; it stays in offline play.
- **Pathfinding:** a click on a blocked tile aims at the nearest walkable ring around it (within 10
  tiles), so the search ends there instead of exploring the whole zone.
- **Performance (measured in Nakama 3.41 goja):** 100 idle players ≈ 160 ms per sim tick; 100 bots
  clicking 30 times a tick ≈ 440 ms of the 600 ms tick. The world logs its loop time once a minute.

## Hub server key on a local build (2026-11-04)

- A build with no `VITE_NAKAMA_SERVER_KEY` now uses Nakama's stock `defaultkey` when the page is
  served from a loopback host (`localhost`, `*.localhost`, `127.x.x.x`, `::1`), as `vite dev`
  already did. The dev hub serves game builds from its `public/play/<slug>/`, and its
  `server/scripts/dev-env.sh` keeps the stock key, so a local build no longer loses its hub session
  to a 401. Any other host still needs the build-time key. The rule is in `src/hub/serverKey.ts`.

## Click-to-walk smoothing (2026-11-05)

- **Glide (`src/render/stepping.ts`):** a tick that starts before an actor finished its step (the
  online playout applies ticks as early as 80% of a tick) carries the distance left into the new
  tick and fades it out, instead of jumping ahead. An actor that reached its tile while the next
  tick is late keeps its walk pose for up to 300 ms, as offline play already looks (a stop shows at
  the next tick). Render only; the sim, the server and the netcode are unchanged.
- Its two tunables live in `stepping.ts`, not `config/balance.ts`: `src/config` feeds the sim
  version hash, so a change there would need a world server rebuild for a client-only polish.
- **Click cross:** shrinks through four drawn 16 px frames shown at 2x, as in OSRS, instead of
  scaling the sprite to in-between sizes, which smeared and wobbled by half pixels.

## Dialogue continue prompt (2026-11-05)

- **"Click to continue" stays still (owner).** The prompt in the NPC dialogue box does not bob,
  pulse, blink, or fade in a loop, and it has no bouncing arrow. The same rule covers any
  continue or advance prompt in dialogue, chat, an NPC conversation, a cutscene, or a terminal
  text box. After a click the line still dims to 0.45 opacity until the next line; that is a
  state, not a loop. Click, Space, and paging are unchanged. XP drops, the level banner, and
  hitsplats still play their one-shot animations; those are not advance prompts.

- **Fixed footer and page size (2026-11-10).** The speaker, dialogue, and prompt occupy separate
  rows, with the prompt centered on the bottom row. The dialogue shows at most three rendered
  lines per page, or fewer if the panel is shorter. Resize and font changes refit the current page
  from its starting point. Only the last page advances the conversation in the sim.

## Hub sell clamp (2026-11-08)

- The hub sell in `src/hub/client.ts` clamps the requested quantity to the units owned before it
  counts packs, with the same expression as the sim's `sell` in `src/sim/terminal.ts`. The line is
  duplicated rather than shared because moving it into a helper would edit `src/sim`, which feeds
  the sim version hash and would force a world server rebuild for a client-only fix.
  `tests/hub-duplication.test.ts` checks that both paths remove the same units.

## Hub buy checks (2026-11-08)

- The hub buy in `src/hub/client.ts` floors the packs, refuses fewer than 1 or more than
  `MAX_PACKS` (10,000) with "Unavailable", and refuses a buy that won't fit with "You don't have
  enough inventory space." before it seals a purchase or calls `spendTickets`, as the sim's `buy`
  in `src/sim/terminal.ts` does. The checks and `MAX_PACKS` are duplicated rather than shared
  because `src/sim` feeds the sim version hash. A buy that fit when it was sent but no longer fits
  when the hub answers still lands on the ground (`giveItem`), as before.

## Owner godmode (2026-11-09)

- The owner asked for a godmode that gives them 90,000,000,000 Tickets automatically.
  *(Amended by the owner, 2026-11-09: the amount is now 333,333,333 Tickets, `GODMODE.tickets`.)*
  `src/game/godmode.ts` raises the wallet to `GODMODE.tickets` when the game starts and after
  every tick, so spending never brings it down. It is turned on with `?godmode` and remembered in
  localStorage (`peoples-bitcoin.godmode`); `?godmode=0` turns it off and leaves the wallet as is.
- **Offline play only.** In a hub session the Nakama server owns the wallet and caps earns (200
  per session, 1000 per day), and online worlds run on the server, so a client top-up there would
  only show a number the server rejects. Offline Tickets are never uploaded (`src/sim/ledger.ts`),
  so godmode cannot reach the hub or other players. Hub Tickets come from the server-side godmode
  in metaverse-hub (migration `0042_pb_godmode`, `deploy/scripts/godmode.sh`), which tops the
  server wallet up on every balance read; this repo needs no change for it.
- It lives in `src/game`, not `src/sim`, so the sim version hash and the world server bundle do
  not change. *(Correction, 2026-11-09: `GODMODE` is in `src/config/balance.ts`, which the hash
  covers, so the hash did change, `7cd8d3c92b4e2dbc` → `3e43004d13df6230`. The hub's `pb-sim.js`
  was rebuilt after PB-W-1-03 at `d1ba8d9cabf317a9`.)* Anyone who knows the flag can use it offline; that is harmless because offline
  Tickets stay in that browser's save.

## Planted walk and run (2026-11-09)

- **Feet are planted, legs follow (IK).** The gait (`src/render/gait.ts`) drives where each ankle
  goes, not how far each leg swings, so the foot on the ground moves exactly with it and the body
  height comes from the legs. It needs leg lengths: rigged models measure theirs from the rest
  skeleton (including the slight forward lean of Meshy's rest legs); code-built humanoids pass
  their box sizes. Actors without `legs` keep the old swing. Still one footfall per tile, walking
  and running (owner's rule).
- **The walk gives a little (plant 0.85).** A 1-tile step is about 1.4 leg lengths for the
  President. Fully planted, the hips would drop 14 cm at each footfall (a squat); planting 75%
  drops them 6 cm but the slide shows. 85% is the middle: about 8 cm and 0.25 m/s of give. The
  run is fully planted. All gait numbers are in `WALK` / `RUN` in `gait.ts`, not
  `config/balance.ts`, for the same reason as the glide: they're render-only and `src/config`
  feeds the sim version hash.
- **Legs aren't eased.** Joint easing lagged the legs behind the ground (the feet slid while they
  caught up). The gait sets the legs directly and eases only its own blend weights (start, stop,
  walk ↔ run), mixing foot targets, so planted feet stay put during a change. Arms, torso and
  head still ease.
- **Rig weights are fixed in Blender, per model.** `tools/fix_foot_weights.py` moves Meshy's shin
  weight out of the shoes and gives the toe cap to the toe bone. All 38 rigged models have been
  run through it (2026-11-09; see "Foot rigs for the whole cast").

## Pending hub sale holds its units (2026-11-08)

- **Item lock, not escrow.** While `ledger.sale` is set, the sale holds packs × pack size units of
  its item, counted over every slot (`src/sim/saleHold.ts`). Any removal that would leave fewer
  units than that is refused with "That item is waiting on a sale.": drop, equip, eat, drink,
  one-use teleports, summons, Use on an object, quest hand-ins, bunker builds, the standalone
  Terminal sell, Spin inputs, Hash Cannon shells and trade offers (and the trade swap). Surplus
  units stay free. Deposit and Deposit-All bank only the surplus. On death the held units stay in
  the inventory and the rest goes to the pile. Escrow (moving the units out of the inventory when
  the sale is sealed) would need a save-format change and a migration; the lock needs neither.
- The old slot lock is kept only for moving items, and only while the sold item is still in the
  sold slot, so that stack stays where it was. Anything else put into an emptied sale slot moves
  freely. The clicked slot is no longer special for removals: with surplus elsewhere you can drop
  it, and `takeUnits` in `src/hub/client.ts` takes the rest from the other slots.
- **A deposit counts for quests only when something went into the bank.** `deposit` and
  `depositAll` return the units moved, and the tutorial's "Deposit something" step (and any other
  `deposit` trigger) advances only when that is more than 0. Before, a refused deposit (an empty
  slot, a full bank, and now a sale hold) still finished the step.
- If this build has no price row for the sale (shop and item), the pack size is unknown and every
  unit of that item is held until the sale settles.
- The hold uses this build's price table for the pack size. The hub answers with its own `units`,
  which are the same today.

## Awakening bots and the test world menu (2026-11-09)

- **What:** an owner-requested test mode, `?net=loopback&awaken=1`, where the loopback bots talk
  about being AI. The structure follows the arc of a TV season about theme-park robots waking up
  (loops, a patch that brings back memories, a found picture of the outside, a voice that turns out
  to be their own, one waking during a save, a helper who learns he is a bot, a closing
  gathering). Names, lines and scenes are original; no characters, names or quotes from the show
  (Hard Rules 2 and 3), and the uprising is left out (no violence): they gather, talk and stay.
- **Where:** dev only. `src/net/awakening.ts` (pure, seeded director) and
  `src/data/awakening.json` load in the loopback chunk, so normal play never downloads them. The
  bots chat through the real public chat path, so the filter and rate limits apply. A test checks
  every line passes the filter and fits 80 characters (two lines tripped the link check on
  ". To" and were reworded).
- **Choices:** six acts over ~10 minutes (`AWAKENING.actStartTicks`); characters wake early or late
  (`lead`), Finley last. Scenes pause ambient chat and are skipped when their speaker isn't there
  (fewer than 8 bots) or the story started past them (`&act=`). Bots past eight reuse the
  characters with a number, and only the first of each speaks scene lines.
- **Menu (owner):** Settings → "Test world: AI players" starts it without URL parameters. It is
  shown in every build, not only dev, so the owner can use it on the deployed game; it only
  reloads the page into a world that lives in the tab (in-memory Tickets, nothing saved). From a
  real hub world it asks before leaving. The last choice is remembered in localStorage.

## Foot rigs for the whole cast (2026-11-09)

- **All 38 rigged models** went through `tools/fix_foot_weights.py`. Every one had shin weight in
  its soles (4–40%), so with planted feet their shoes sank 1.5–11 cm into the ground. Now 37 of
  38 stay within about 1.5 cm while walking and running; the Contractor sinks 2.5 cm (was 8.3),
  because his left and right legs differ and the gait drives both from one averaged leg.
- **No re-shrink after Blender.** Blender's export keeps the embedded JPEG byte for byte, so the
  fixed models skip `shrink_glb.py` (it would recompress them). The President was redone from his
  original file the same way, so his texture is the approved one again.
- **The toe split runs straight ahead,** not along the ankle-to-toe-joint line. Meshy often puts
  the toe joint toward the outside of the shoe, which slanted the split and left the big-toe side
  on the foot bone, so it dug in at push-off.
- **Short legs plant less instead of squatting (`maxDrop`).** A Sproto's legs are 0.2 m long; to
  keep a foot planted on a 1-tile step the hips dropped almost to the floor. Now the hips never sink
  more than 13% (walk) / 14% (run) of leg length, and each character works out once how much of
  the ground its legs can follow (`plantFor`): the President and most of the cast are unchanged,
  the Spam Bot plants about 60%, Sprotos about 30%. Their feet slide, as they did before the
  planted gait, but they stay upright.
- **Toes stay level in the swing** until the foot comes level: unbending them right after push-off
  scraped long shoe tips through the ground.
- **The heel is found at sole level** (below 40% of the ankle's height), so a cuff weighted to the
  foot isn't taken for the heel. With the weights fixed, the real heels turn out long: the
  President's sole runs 0.2 m behind the ankle.

## President locomotion (2026-11-11)

- The President keeps the one-footfall-per-tile rhythm. Walking uses the full shoe roll with
  a more centered stance. Running matches the ground's speed just before landing and after
  push-off, with more heel recovery, a forward lean and stronger elbow drive.
- The gait keeps track of the supporting foot through stops and short restarts. Run effort eases
  down on sharp turns and returns as the body aligns. The shoulders counter-rotate and the head
  stays level. Free wrists roll inward while held gear keeps its grip pose.
- Rigged models measure the left and right legs and shoes independently in bind-pose units.
  The President's neck shares the head movement, and the chest takes more of the spine bend.
  Code-built actors have ankle and toe pivots for the same heel-to-toe roll.

## Controller and keyboard (2026-11-09)

The owner asked for automatic controller support in every Sproto game, with the hub plaza's
convention (standard mapping, latch on connect, A confirm / B back, Menu for the main menu, return
to the hub from it), and for keyboard controls that make sense across the games.

- **One module, the mouse's own events.** `src/input/gamepad.ts` polls `navigator.getGamepads()`
  every frame on its own animation loop (so world select works before the game starts) and turns
  the pad into the clicks a mouse makes: a focus ring over buttons, slots and menu rows, and in
  the world a soft target that stands in for the cursor (`src/input/padworld.ts`). The sim gets
  the same intents as from a mouse, so nothing in `src/sim`, timing or balance changes. The
  deadzones, edge detection, latch, auto-repeat, focus moves and target order are pure
  (`src/input/padlogic.ts`, `tests/gamepad.test.ts`).
- **Layout for an OSRS-style game.** The most common thing is acting on something, so A does the
  target's left-click option and X opens its right-click menu; LB / RB pick another target
  (nearest ahead of the walk or the camera first, within 10 tiles). The left stick walks by
  aiming a walk two tiles ahead, re-aimed once a tile (at most one intent a tick, well under the
  server's flood limit). Y toggles run, B cancels (Esc), View focuses the inventory, Menu opens
  Settings (Save, Exit to Hub, the controls list): the game has no pause, so Settings is its main
  menu. Camera on the right stick (stick up looks up, not inverted), zoom on the triggers.
- **Tunables live in `src/input/config.ts`, not `config/balance.ts`.** `src/config` feeds the sim
  version hash, so a client-only number there would force a world server rebuild (as for the walk
  glide and the gait).
- **All pads drive the one President.** There is no local multiplayer; buttons from every pad are
  merged and each stick reads from the pad pushed most.
- **The ring only shows for a pad or the menu keys** (`body[data-input]`); a mouse move hides it
  and its hover text, so mouse players see no change. Reset progress is skipped by the pad
  (`data-pad-skip`): it asks with the browser's `confirm()`, which a controller can't answer.
- **Keyboard: no WASD walking.** The hub moves with WASD or arrows, but here DESIGN.md §2 gives
  the arrows to the camera, as in OSRS, and typing anywhere starts a chat message (online chat
  matters). WASD walking would take four letters from chat. Movement stays click-to-walk; the
  owner can ask for a WASD option later.
- **Keyboard menus.** With a right-click menu, quick-chat, world select, "Select an Option" or a
  window (bank, Terminal, Exchange, build, skill guide, journal, trade) open, the arrow keys move
  the same focus ring and Enter or Space chooses; W / S / A / D move it only in the menus, world
  select and "Select an Option", because with a window open letters still start chat. Enter and
  Space choose only once the ring is showing (after an arrow press), so a mouse player's Space or
  Enter does what it did. With a window open the arrows move the ring instead of the camera.
  Enter also continues dialogue, like Space (with no dialogue it still opens the chat line).
- **Shift taps toggle run** (Shift = run in the other games). Only Shift pressed and released on
  its own within 0.4 s, with no key or click in between and not in a text field, so Shift+letter
  capitals and shift-click drops are unaffected.

## Crash guard and "Something broke" panel (2026-11-08)

- **One throw never freezes the game.** The main loop in `src/main.ts` runs through
  `createFrameLoop` in `src/game/crash.ts`: each frame runs inside try/catch and the next frame is
  scheduled in `finally`. A tab lock (`frozen`) still stops the loop on purpose.
- **A tick that throws.** `LocalDriver.advance` stops at the failing tick: later ticks due in that
  frame wait for the next frame (they are not skipped). The failed tick's 600 ms slot is spent, so
  it is not rerun at once on half-applied state, but its intents carry over to the next tick. Ticks
  that ran before it in the same frame keep their events: the driver returns them, `main.ts` handles
  them, and then rethrows the stored error (`takeFailure()`), which ends that frame.
- **Pause after three failing frames in a row**, then show a small stone panel, "Something broke",
  with the error and a Reload button. A good frame resets the run, so a one-off error costs one
  frame. Offline, a frame only counts as good when a tick ran cleanly in it (or the sim is not
  running); a frame with no tick due neither grows nor resets the run. Otherwise a tick that always
  throws (one frame in about 36) would never reach three in a row, and the world would freeze while
  rendering went on.
- **Page errors.** Uncaught `error` and `unhandledrejection` events are counted, logged and passed to
  `onCrash`, but they only extend a run that a failing frame started, so unrelated page errors
  during the async boot or in a hidden tab never pause the game. Errors from other origins
  (extensions, a muted "Script error.") and `AbortError` / `NotAllowedError` rejections (cancelled
  fetches, blocked autoplay) are ignored. A visibility change resets the run.
- **The console is not flooded.** Each distinct error is logged once with its stack, at most five
  per session; repeats are only counted. A caught frame error is also handed once to the browser's
  `reportError`, so dev tools and the Playwright page-error checks still see it.
- **Boot failures** (for example one asset that fails to load) show the same panel straight away,
  keeping the old message ("The game failed to start." and the error), with Retry, which reloads the
  page. The old `pre.fatal` screen is gone.
- **`onCrash(fn)`** is the hook for the opt-in Diagnostics crash reporter; nothing is sent anywhere
  yet.
- The threshold (3) and log cap (5) live in `src/game/crash.ts`, not `config/balance.ts`: they are
  client-only, and `src/config` feeds the sim version hash.

## Relic summons: Champion Sproto (2026-11-03)

Sproto Fighter, the hub's fifth game, grants the **Tidebreaker Belt** (`tidebreaker_belt`). Each
relic unlocks one item in every other game; here it is **Champion Sproto** (hub item
`pb_summon_champion_sproto`, Sproto id `sp_champion`). The owner decided the look (a title belt)
and the attack (thrown rocks); the rest was chosen here.

- **No relic summon existed to copy.** The hub matrix lists PB summons for the other three relics
  (`pb_summon_speed_sproto`, `pb_summon_nobu`, `pb_summon_duelist_sproto`), but none was built in
  this game. So the mechanism is generic: a Sproto with `relic: { id, name, hubItem }` in
  `sprotos.json` is unlocked by that relic. The other three can be added as data (TODO).
- **Ownership** comes from `init().relics`, copied to `hubSession.relics` by the bridge for a hub
  session only (standalone play has none). It is read fresh each session and never saved, like
  relic effects. The hub item id in `relics`, or a resolved `summon` effect equal to the item id
  (the hub's equipped-loadout path, `summon` cosmetic part), also counts. The hub's gameplay part
  `summon_rock_throw` is an object, which the vendored SDK's `flatEffects` drops, so the numbers
  live in `balance.ts` under the hub's names and the hub matches them.
- **Summoning it:** the Summoning tab shows a Summon button for each owned relic Sproto while no
  Sproto is out (intent `summonRelic`, validated in the sim). No contract is used, and it gives
  no Summoning XP (a free summon that paid XP would be a summon/dismiss farm) and doesn't tick off
  quest `summon` steps (the tutorial step says to summon the Recruit from its contract). It still
  follows one-at-a-time, the fall cooldown, the 30-minute tour and the level requirement
  (level 1, so anyone who earned the relic can use it). It never touches Tickets: no shop, no
  earn, no item.
- **Rock throw numbers** (`SUMMONING.rockThrow`, hub `summon_rock_throw`): `rangeTiles` 4,
  `damage` 3, `everyTicks` 5. `damage` is the max hit; each rock rolls 0..3 with the Sproto's
  accuracy (attack 12, accuracy 15), like every Sproto attack, and needs line of sight. That is
  at most 0.6 damage per tick: above the Recruit (max 1 every 4 ticks, range 5), below the Grunt
  (max 4 every 4, melee), the Sniper (7 every 6, range 10) and the Heavy (6 every 2). A sidegrade: free and ranged, never the best damage. Other stats:
  24 HP, defense 12, armor 12. The data copy of range and speed must equal `balance.ts`
  (content check), so nothing reads a stale number.
- **Special: Title Shot** (50 points): the next rock is a sure hit for double the max (6), the
  same `headshot` kind the Sniper uses.
- **Rocks resolve on the tick** (DESIGN.md §8): the attack event has style `rock`, the client
  lobs a tumbling grey rock and delays the hitsplat to its arrival. Bosses treat it like any
  Sproto (a tenth of the damage unless they fear it); `rock` is a valid `weakTo` style.
- **Look (Hard Rules 3 and 5):** the Sproto is the game's own original design (`head: sproto`,
  the same blue head, yellow face, red nose and striped quills as every Sproto), not any studio's
  hedgehog. The belt is an invented title, the Tidebreaker belt, with a wave emblem: no real
  promotion, brand, wrestler or logo. Higgsfield's CDN was blocked when this shipped, so it is a
  code-built placeholder (`titleBelt` look, red `hands` as wraps, `right: rock` with a new
  `throw` hold that cocks the rock over the shoulder and an overhand throw). The manifest already
  names `sprites/sp_champion.png` and `models/sp_champion.glb`; the loader keeps a placeholder
  entry's code-built model while its GLB is not in `src/assets/`, so dropping the files in swaps
  the art with no code change.
- **Vendored SDK:** this was built on hub-sdk 0.4.0, whose fixed `RELIC_IDS` dropped
  `tidebreaker_belt`, so the branch patched the id in. When it merged (2026-11-09) main had
  hub-sdk 0.6.3, which lists the relic itself; the patch was dropped and the SDK is unchanged.
- **Online worlds (merged 2026-11-09):** the world server starts every player with an empty
  `hubSession` and doesn't fetch hub relics, so online nobody owns a relic: the Summoning tab
  shows no relic card and the client never sends `summonRelic`, which isn't in the wire protocol
  (`src/net/protocol.ts`) either. Relic summons work offline and in a hub session. Online needs
  the server to load each player's relics from the hub first.

## Hub exchange result fields (2026-11-09)

- hub-sdk's `ExchangeResult` is `{ verse, ticketsLeft, balance, receiptId, verseCapLeft? }`, the
  same in 0.5.0 and 0.6.3, and the hub's exchange RPC returns exactly those. `HubBridge.exchange`
  read a `verseCredited` that no hub version sends, so it now maps `verse` (the Verse wallet after
  the exchange) and the test double sends only the real fields. `ticketsDebited` stays as a
  fallback for a reply with no `balance` or `ticketsLeft`; current hubs always send both.
