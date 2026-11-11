# Changelog

## Unreleased — Gameplay improvement plan (2026-11-11)

Items from `docs/gameplay-improvement-plan.md`. The sim, config and data changed, so
`SIM_VERSION` moves from `7cd8d3c92b4e2dbc` to the value printed by
`node -e "import('./scripts/simHash.mjs').then(m=>console.log(m.simHash()))"`; the hub needs a
new `pb-sim.js` (`npm run build:sim`) before online worlds accept this client.

**The first fifteen minutes**

- **Rations before the first fight (A1).** Sergeant Retain hands over six Soundbites with the
  Rounds and says what they are for. The tutorial bot (24 seeds, eating at 4 HP or less) went
  from a death in 20 of 24 runs to none, in 9.0 minutes on average. The "spin" step now completes
  on Spin XP, so being handed food does not skip the Press Podium; the "sell" step says about four
  Scrap Hash make one Ticket.
- **The tutors stand still (A2).** Morelight and the Treasurer no longer wander.
- **Every payout says its amount (A3).** A sale, a paid favor or a coin drop that banks only part
  of a Ticket prints it ("You sell 1 × Scrap Hash for 0.28 Tickets."). Whale donations show their
  amount. "1 Ticket", not "1 Tickets".
- **The wallet shows the fraction (C1):** "+0.28" beside the wallet and a thin bar for the source
  closest to its next whole Ticket.
- **Low-health prompt (C3):** one warning line and a pulse on the Hitpoints orb when HP first
  drops to 30% (`UI.lowHpWarnPct`) with food in the pack.

**Economy and sustain**

- **Fighting pays (B1).** `TICKETS.dropUsdMultiplier` = 4 on every enemy coin roll, bosses
  included. Simulated coin over Shooting 1–45 plus Melee 1–40: about 225 → about 900 Tickets.
- **The Broker is trimmed (B2).** `payUsd` [40, 70] → [32, 52]: about 1,130 / 1,600 Tickets an
  hour at Lobbying 40 / 60 → about 860 / 1,220.
- **Defense keeps up (B3).** `COMBAT.defenseXpPerDamageTaken` 1 → 3. Defense at Shooting 45 went
  from 22 to 30 in simulation and the healing need on FUD Wraiths from about 1,530 to about 1,070
  HP an hour.
- **Recover out of combat (B4).** With nothing attacking and your own attack timer clear for
  `COMBAT.idleAfterTicks` (16), you regain 1 HP every `COMBAT.hpRegenIdleEveryTicks` (10) ticks:
  1 → 10 HP in under a minute. Enemies keep the slow rate.
- **The Med Bay is reachable (B5).** It needs Construction 2, so Bunker Down's reward builds the
  Storage Locker and the Med Bay straight away. The Contractor and the skill guide say that
  rebuilding trains Construction.

**Clarity and feedback**

- **Terminal tabs (C2).** Weapons, Armor, Tools, Food & drinks, Contracts, Materials and Travel
  tabs; each item shows its name and the level it needs, and is dimmed until you have it.
  Left-click is still Value and right-click still buys.
- **Sound effects (C4).** Synthesised tones (no sound files) for hits, misses, wounds, mining,
  shopping, level-ups, quest completion and death, with Sound on/off and volume buttons in
  Settings. Only your own actions make noise.

**Bosses**

- **Mechanics for the three Trench bosses (D1).** The Sludge Mother, below half HP, marks the
  ground around you and sludge lands there three ticks later: step off. The Wrong-Namer Chief
  shouts $BITCON every 12 ticks: say $BITCOIN in chat (or the quick-chat line) within 8 ticks or
  be Heckled (accuracy −25% for 10 ticks). Captain Motion rage-quits at 10% HP and runs for the
  north barricade: finish him within 40 ticks or he returns with 30% HP.
- **The wrong weapon does 40%, not 10% (D2).** `BOSSES.offWeaponScale` 0.1 → 0.4, for every
  weapon-locked boss and for Sprotos.

Not done: A4 (needs a real GPU), D3 (the coin as a market mood) and the hub items H1–H3. See
DECISIONS.md "Gameplay improvement plan".

## Unreleased — Champion Sproto (Tidebreaker Belt)

- **Champion Sproto** (`sp_champion`, hub item `pb_summon_champion_sproto`) is the summon that
  Sproto Fighter's relic, the **Tidebreaker Belt** (`tidebreaker_belt`), unlocks here. Own the
  relic in the hub and the Summoning tab offers a free Summon: no contract, no Summoning XP, no
  quest progress, and Tickets never change. Ownership is read from the hub's init relics each
  session and is never saved.
- He **throws rocks**: a ranged attack, 4 tiles, every 5 ticks, 0–3 per rock
  (`SUMMONING.rockThrow`, the hub's `summon_rock_throw`). His special, **Title Shot**, makes the
  next rock a sure 6. Rocks lob and tumble in flight; the hit lands on the tick as usual.
- Placeholder look until the Higgsfield art lands: a code-built Sproto with a gold fictional
  title belt (round wave-emblem plate), red fighting wraps and a rock held over the shoulder.
  `sprites/sp_champion.png` and `models/sp_champion.glb` are registered in the manifest; the
  loader keeps the placeholder until those files exist.
- **Offline and hub sessions only:** online worlds don't load hub relics yet, so the Summon card
  doesn't show there (merged 2026-11-09 onto hub-sdk 0.6.3, which lists `tidebreaker_belt`
  itself; the branch's local SDK patch was dropped).

## Unreleased

- hub-sdk 0.6.4 is vendored from hub main (`2a82e9e`, PR #117). It adds the `marina_anchor` and
  `dragon_scale` relic ids. The classic script is `vendor/hub-sdk/dist/hub-sdk.iife.js` (global
  `HubSDK`).
- **Controller support:** any standard-mapping controller works with no setup. Left stick or
  D-pad walks, A does the soft target's left-click option, X its right-click menu, LB / RB change
  target, Y toggles run, B cancels, right stick and triggers move the camera, View opens the
  inventory and Menu opens Settings (Exit to Hub). Menus, windows, dialogue and world select get a
  focus ring (A choose, X options, B back). A button held when the pad appears is ignored until
  released, so the hub's A doesn't leak in; hot-plug works. Layout in the README.
- **Keyboard:** the arrow keys (and W / S / A / D in menus) move the same focus ring through
  right-click menus, world select, "Select an Option" and windows, and Enter or Space chooses;
  Enter also continues dialogue; tapping Shift toggles run. The Settings controls list and the
  README match the bindings. Client only; `SIM_VERSION` is unchanged.
- hub-sdk 0.6.3 is vendored from hub main (`5cc4e48`, PR #90). Same methods and types. The classic
  script is `vendor/hub-sdk/dist/hub-sdk.iife.js` (global `HubSDK`).
- **Fix (hub exchange):** the bridge read `verseCredited` and the test double sent `ticketsDebited`
  and `verseCredited`, but the hub's `ExchangeResult` has neither. The bridge now reads `verse`, the
  Verse wallet after the exchange. Client only; `SIM_VERSION` is unchanged.
- **Godmode (owner):** `?godmode` keeps the offline Ticket wallet at 333,333,333 Tickets and is
  remembered in the browser; `?godmode=0` turns it off. Offline play only; hub sessions and online
  worlds keep the server wallet. Client only, but `GODMODE` sits in `src/config/balance.ts`,
  which feeds the sim hash, so `SIM_VERSION` changed (`7cd8d3c92b4e2dbc` → `3e43004d13df6230`).
- **Test world menu:** Settings has a "Test world: AI players" box: how many AI players (0–99),
  awakening story / quick-chat / silent, story speed, and Start, Restart or Leave test world. The
  test world now joins its one world directly instead of showing world select.
- **Dev (awakening bots):** `?net=loopback&awaken=1` gives the in-page bots names and a story:
  eight Treasury citizens (262 original lines, six scripted scenes) loop, glitch, question, see
  behind the world and wake up, then gather and talk freely. `&pace=` and `&act=` speed it up or
  skip ahead. Dev only, but `AWAKENING` (`src/config/balance.ts`) and `src/data/awakening.json`
  are in the sim hash, so `SIM_VERSION` changed (`d1ba8d9cabf317a9` → `f8910ac055ba8871`) and the
  hub's `pb-sim.js` was rebuilt.
- **Dev (silent bots):** `?net=loopback&chat=0` runs the in-page world with bots that only walk,
  never chat, and `CHAT=0` does the same for the `scripts/pb-bots.mjs` load test. Client and dev
  tools only; `SIM_VERSION` is unchanged.
- **Fix (hub sell):** a Sell-N larger than the stack (for example Sell 10 on 3 items) asked the hub
  for Tickets for all N while only the owned items were removed. The hub sell now clamps to the
  units owned, as the offline sim already did. Client only; `SIM_VERSION` is unchanged.
- **Fix (hub buy):** a hub-session buy now makes the same checks as the offline buy before it
  spends Tickets: whole packs only, 1 to 10,000 packs, and room in the inventory. A full inventory
  used to pay and then drop the goods on the ground. Client only; `SIM_VERSION` is unchanged.
- **Fix (hub sell, item dupe):** a pending hub sale locked only the slot that was clicked, but a
  sale can span several slots (3 pistols are 3 slots). While it waited for a retry, the other units
  could be banked, dropped, used, handed in, built with, traded or left in a death pile, and the
  retry still paid for every pack. Now no removal may leave fewer units of the sold item than the
  sale needs (packs × pack size); surplus units are still free, and you keep the held units when
  you die. This edits `src/sim` and `src/server`, so `SIM_VERSION` changes and the hub's vendored
  `pb-sim.js` must be rebuilt.
- **Fix (tutorial):** the "Deposit something at a Bank Booth" step no longer completes when the
  deposit was refused (an empty slot, a full bank, or units held for a sale). An unrelated item
  put into an emptied sale slot can now be moved.
- **Crash guard:** one error in a frame no longer freezes the game or floods the console. The
  main loop always reschedules; after three failing frames in a row the game pauses and shows a
  "Something broke" panel with Reload. A tick that keeps throwing trips the panel too, its intents
  carry over and earlier ticks keep their events. Uncaught page errors are counted but only pause
  the game together with failing frames (other-origin errors and aborted fetches are ignored), and a
  failed boot shows the same panel with Retry instead of a bare error screen. Each distinct error is logged
  once. `onCrash()` is ready for the opt-in Diagnostics reporter and sends nothing. Client only;
  `SIM_VERSION` is unchanged.

## Unreleased — Foot rigs for the whole cast (2026-11-09)

- **Every rigged character's shoes fixed in Blender** (`tools/fix_foot_weights.py`, all 38
  models). Their soles carried 4–40% shin weight, so their shoes sank 1.5–11 cm into the ground as
  they walked; now 37 of 38 stay within about 1.5 cm (the Contractor 2.5 cm). Dropping the unused baked
  clips shrinks `src/assets/models` from 11 to 7 MB; textures are unchanged.
- **Short-legged characters stay upright:** the hips never sink more than about an eighth of the
  leg length; legs too short for a 1-tile step (Sprotos, the Spam Bot) plant less of it and their
  feet slide instead of the body squatting to the floor.
- Toes stay level through the start of the swing, so long shoe tips don't scrape the ground; the
  toe split in the Blender tool runs straight ahead, catching the big-toe side of the shoe.

## Unreleased — Planted walk and run (2026-11-09)

- **Feet stay on the ground.** Rigged characters and code-built humanoids now step on planted
  feet (`src/render/gait.ts`): each foot follows a path that moves back with the ground, rolls
  heel → flat → toe, swings through and lands moving with the ground; two-bone IK turns that into
  hip, knee, ankle and toe angles, and the hips sit as high as the planted legs reach. Before, the
  legs swung by fixed angles: walking, both feet left the ground 43% of the time (up to 10 cm),
  and the running foot slid at 2.4 m/s against the ground.
- **The run is fully planted** (no slide mid-stance), with a flight phase, a heel kick and a
  bounce lowest mid-stance. **The walk** gives 15% of the ground's travel (a 1-tile step is long
  for the President's legs; fully planted, the hips would bob 14 cm) and bobs about 8 cm.
- **More of the body moves:** rigged characters now turn the hips with the stride (the chest turns
  against them), bend at the ankles and toes, and a lean curves the whole spine instead of
  pivoting at the shoulders. Free arms bend a little more at the elbow on the forward swing.
- Starting, stopping and switching between walk and run blend where the feet go, not joint angles,
  so the feet stay on the ground through the change (0.16 s).
- **President rig fixed in Blender** (`tools/fix_foot_weights.py`): the shoes carried shin weight
  and the toe cap was half foot, half toe, so the sole sank up to 5 cm as the knee bent and the toe
  dug 3 cm into the floor at push-off. Now under 1 cm. The unused baked clip is gone (492 → 342 KB).
- `gait.html` (dev only): the President walking and running on a treadmill at game speed, with
  foot-contact numbers (`window.gaitMeasure()`); `?model=<id>` for other rigged models.

## 0.7.0 — Online worlds (2026-11-04)

- **Worlds of up to 100 players**, run server-side as `pb_world` matches on the hub's Nakama with
  this repo's sim (`npm run build:sim`). More worlds open as they fill (`pb.worlds`).
- **World select** with Quick join and Play offline; `?net=loopback` runs a world in the page.
- **Other players** in the shared President look, in their own gear, with nameplates, speech and
  minimap dots; their Sprotos too. Only what is near you is sent (15-tile view).
- **Chat, RuneScape-style:** public chat in view with overhead text, private messages in and
  across worlds, Private and Trade tabs with On / Friends / Off filters, quick-chat filled in from
  your real stats, friends (with their world) and ignore lists, rate limits and mutes. Slurs, links
  and wallet addresses are blocked on the server; profanity is masked on the client.
- **Trading:** two screens, accept reset on any change, Terminal value on the confirm screen, the
  swap saved for both players at once. Items only, never Tickets.
- **Server-authoritative:** intents only, validated; Tickets earned, spent and sold on the server
  with sealed, idempotent keys; one session per account; OCC saves.
- Multiplayer sim: shared zones, private quest-boss copies and bunkers, loot owned by the top
  damager (private for a minute), single-way "Someone else is fighting that."
- hub-sdk 0.5.0 (realtime) is vendored. Saves stay v7 (online fields are optional).
- Faster pathfinding (no allocation in heap swaps; clicks on blocked tiles aim at the nearest
  walkable ring).

## Unreleased — Hub Tickets

- **Tickets** are the wallet. The live price ticker is gone. Shop prices are per pack in
  `src/data/shop_prices.tickets.json`. Saves are format v7.
- **Hub:** quest relic event, batched Ticket earns, an Exchange window on the Treasury terminals,
  and Exit to Hub. Without a hub session the game still runs, and that standalone shop never syncs.
- Story JSON was left alone, including lines that still say `$BITCOIN`.
- hub-sdk 0.3.0 is vendored. A hub session buys and sells through `spendTickets` and `sellItem`,
  and reads the wallet with `getTicketBalance`.
- Stream batches are sealed in a separate hub ledger before they are sent, so a second tab
  cannot mint another key for the same pending Tickets. A quest reward hits the wallet once.
  `capped: true` is a successful earn. A transport failure is retried on the next init.
- The newest tab is the only writer. An older tab shows "playing in another tab" and does not
  merge inventories. A transport failure retries its sealed batch on the next init. A quest
  the cap rejects keeps its key and is sent again next session.
- Shop Ticket prices now come from Gameplay's v3 CSV (100 rows), including Blue Sproto Coffee
  before that item exists. Drop tables can name tertiary rolls and shared tables. The coin
  drop is still `usd / 25` as `pb_drop`, not the live price.

## 0.6.1 — Gameplay, dialogue and story QA (2026-10-28)

- **Fixed blockers:** wrong-weapon hits on bosses rounded down to 0 (now a tenth on average);
  farming Sergeant Sandbag or respawning bosses pumped the coin price; losing a quest item (death,
  dropping it) could block The Way Out for good. Quest items now stay with you when you die, and
  the NPC who gave you one hands out another.
- **Bosses beatable at their weapon's level:** the Lockdown Warden, the Wrong-Namer Chief (who
  also respects the Veto Hammer), Captain Motion and the Gatecrasher were retuned; the Chamber
  room is no longer a Margin Caller crossfire; the Chamber takes 5 Scrap Hash; the Press Pass SMG and Diamond Hands Minigun
  no longer outclass the Railgun.
- **Bosses stay beaten:** the Sludge Mother, the Wrong-Namer Chief and Captain Motion wake only at
  their quest step. Captain Motion then sits by the Chamber and talks.
- **Story:** one timeline (you were elected in the canteen, 412 days into the Lockdown), the
  sealed Treasury Gates, Expedition One survivors, the Raider's motive, pointers to the side
  quests and the bunker, and epilogues from the Treasurer, the Reporter, the Spin Doctor, the
  Captain and Morelight.
- **Dialogue:** lines that could never show or went stale now show at the right time (the
  Reporter's press-release hint, the Contractor's blueprints, the Scout at every report step);
  boss hints point at the weapon that works; repeated tutorial jokes rewritten; a shorter
  Archmage intro; Moonward's students are adults; barks for the training-yard enemies.
- **Free stuff is offered once:** NPCs who hand you something (petty cash, a pick, Rounds, a Donor
  List, Business Cards, a contract) say shorter lines after the first talk.
- **Steadier price:** the $BITCOIN price drifts back toward normal instead of wandering off.
- **A Hash Cannon no longer fires the Scrap Hash you're carrying for a quest.**
- **Long dialogue lines fit the box:** a line too long for the chat box is split into pages
  (ending on a sentence where it can), and "Click to continue" pages through it.
- **The click cross is where you clicked,** like OSRS: yellow for walking, red for an action, and
  for a right-click menu choice, where you opened the menu.
- **Tests:** 199, including dialogue checks that fail on lines nobody can see.

## 0.6.0 — The Trenches story and Moonward Academy (2026-10-28)

- **The Trenches escape story:** Expedition One dug the Trenches on the first day of the
  Lockdown; the Scout was their lookout and Captain Motion their leader, who found the Teleport
  Chamber dead and has run laps in front of it ever since. Morelight, the Scout (now with a
  question menu), quest journals, enemy examines, signs and crates along the Trenches tell it.
- **Enemies talk:** bosses and many enemies shout a line when a fight starts, when they're hurt
  and when they're beaten, in chat and over their heads.
- **Moonward Academy:** a big new wizard-school zone across the lake from The World Out There:
  Great Hall, library, Duelling Grounds, the Rugmancer's tower, a courtyard with cauldrons, and
  five new Higgsfield wizards (plus students and a professor).
- **Staffs and COOM:** four staffs that fire COOM (small white vials) and train Shooting, spells
  that fly as glowing orbs, a Moonward hat and robe, and the Staffwright's Stall to buy them.
- **Moonward Enrollment:** a new 3-point quest ending in the Rugmancer's tower.
- **Adults only:** the game is now rated 18+ (owner); the parody notice says so.
- **Quest bosses:** every quest now has a boss that fears one weapon, hinted in its dialogue
  (Confetti Shotgun for the Sludge Mother, a gavel for the Wrong-Namer Chief, a veto for the
  Lockdown Warden...). Other weapons do about 10% damage. Six new bosses: Sergeant Sandbag, the
  Building Inspector, the Gatecrasher, the Corporate Raider, the Pundit and the Lockdown Warden.
- **Tests:** 183.

## 0.5.1 — Owner fixes (2026-10-28)

- **Running feels like OSRS:** one footfall per tile, a proper run cycle (bent elbows pumping,
  heel kick, forward lean, bounce in the right place), OSRS turning speed, and the run cycle only
  once you face your way.
- **$BITCOIN is the only currency:** BTC is gone from the wallet, items and dialogue. BTC Shards
  are now Hash Crystals, and the Wrong-Namers shout "$BITCON".
- **Item art:** the 57 items that showed letter placeholders have pixel-art icons.
- **Arrow keys** turn the camera the right way.
- **Saves:** format v6; older saves upgrade.
- **Tests:** 165.

## 0.5.0 — The Way Out, new mechanics and a Higgsfield cast (2026-10-28)

- **Story:** the Treasury has been sealed since the Lockdown, and every quest now builds toward
  getting out. The finale, **The Way Out** (Morelight), has you install the parts, fuel the old
  Teleport Chamber and step through to a new zone, The World Out There.
- **Four skill quests:** Server Meltdown (Sysadmin), Gala Night (Party Planner), Hostile
  Takeover (Fixer) and Press Conference (Spin Doctor, with a new Reporter).
- **Dialogue choices:** OSRS "Select an Option" menus (keys 1–5), with quizzes, branching rewards
  and NPCs who remember what you chose.
- **Use X → Y:** use items on objects and NPCs ("Nothing interesting happens." otherwise).
- **Quest-only enemies and drops,** **teleport tickets** and reusable quest teleports with
  cooldowns.
- **~60 items:** boost drinks (combat, skilling, run energy), tier-4 tools, four skilling
  outfits with XP bonuses and a set bonus, neck/hands/feet gear in new slots, three weapons.
- **Out of ammo** you bash with your gun instead of switching to the gavel.
- **Characters:** the whole cast (President, NPCs, enemies, Sprotos) is now low-poly 3D models
  made with Higgsfield (concept, then Tripo image-to-3D, then the Meshy auto-rig). They use the
  same procedural walks, swings and poses as before, hold their gear, and show worn armor.
- **President Obama:** the President is a satirical caricature, with a parody notice at the start
  and in Settings.
- **Saves:** format v5 (quest choices, new slots); older saves upgrade.
- **Tests:** 164.

## 0.4.0 — 3D characters, Morelight, quests and an OSRS feel pass (2026-10-28)

- **3D everything:** all characters and props are low-poly models built in code, styled like the
  old sprites (which now serve as UI art). Nothing pokes through walls when the camera turns;
  dropped items lie flat.
- **Animation:** walk and run cycles, weapon stances, melee swings, gun recoil with muzzle flash,
  monster lunges, flinches, death falls, and skilling loops (pick swings, hammering, gestures).
- **Gear shows:** your weapon is in your hand (your tool while skilling); helmets, vests, plates
  and greaves change your model.
- **Morelight**, your Chief of Staff, opens the tutorial and guides it step by step, then gives
  the main quests: **Sludge Duty**, **Name Calling** and **Motion Denied** (one per Trenches boss).
- **Dialogue:** every NPC rewritten, with your character's replies, lines that change with quest
  progress, and OSRS-style **chat heads**.
- **Quest list:** quest points, red/yellow/green names, and a journal per quest.
- **Training yard:** Spam Bots and Comment Trolls join the Sludgelings; a Comment Troll step.
- **OSRS feel:** clicks act on press; `(level-N)` tags colored by your level; top-left hover
  text; F-key tabs; attack clicks move on the same tick; direct-step enemy chasing with
  safespots, leashes, give-ups and regen; single-way combat; Auto Retaliate (also while
  skilling); 3-tick food delay; a death fall before respawn; projectiles with hits on arrival;
  merged XP drops with icons; Terminal Value on left-click; Withdraw-All-but-1; minimap zoom and
  instant flag; skilling start messages; NPCs wander to a spot.
- **Fixes:** a dismissed Sproto made another enemy unclickable; lost clicks on tab buttons;
  ranged attackers stuck on their target's tile; bank withdraws hitting a shifted stack; zone
  changes leaked GPU memory; enemies remembered you across zones.
- **Saves:** format v4 (Auto Retaliate); older saves upgrade.
- **Tests:** 153.

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
