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
