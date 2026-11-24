# TODO

## Next

- [ ] Gun specials from DESIGN.md §8: shotgun 3-tile cone, minigun spin-up, railgun Hopium scaling
- [x] Boss mechanics beyond adds: Sludge Mother floor sludge, Wrong-Namer Chief ticker typing,
      Captain Motion rage-quit run (2026-11-11; DESIGN.md §11 is now out of step: owner to edit)
- [ ] Mechanics for the other weapon-locked bosses (Rogue Process, Pundit, Corporate Raider,
      Gatecrasher, Lockdown Warden, Rugmancer, Grizz, the Extractor): the wrong weapon now does
      40%, and they have nothing but their HP to answer it
- [ ] Sprotos 6–12 (Engineer, Scout, Shield, Commander, Paratrooper, Golden Sproto)
- [ ] Champion Sproto art: Higgsfield sprite to `src/assets/sprites/sp_champion.png` and the rigged
      GLB to `src/assets/models/sp_champion.glb` (paths already in the manifest; the CDN was
      blocked when the summon shipped, so it is a code-built placeholder for now)
- [ ] The other hub relic summons in the matrix are not in this game yet: `pb_summon_speed_sproto`
      (hpos10i_core, `summon_run_regen`), `pb_summon_nobu` (cones_tip, `summon_fetch`) and
      `pb_summon_duelist_sproto` (tinubu_crown, `summon_stun`). Add each as a `relic` Sproto in
      `sprotos.json` like `sp_champion`
- [ ] More quests (DESIGN.md §12), and more to do in The World Out There beyond the ferry to Moonward
- [ ] Moonward Academy: library and potions content (spellbooks, brewing) beyond decoration
- [ ] Balance pass: XP rates, drop values, Terminal prices, enemy stats (all in data/balance.ts).
      Done 2026-11-11 from `docs/gameplay-improvement-plan.md`: combat coin ×4, Broker pay,
      Defense XP, idle regen, Med Bay level. Done 2026-11-12: the coin bonus fades from level 65
      to 75, Captain Motion retuned. Still open: hours to The Way Out (plan decision 4)
      and the boss weapon prices, which belong to the hub's price CSV
- [ ] The Diamond Hands Minigun does about 2.7 times the Gremlin Blaster's damage per tick at the
      same level (it fires every tick). The coin fade hides it in the economy; the weapon itself
      still needs a look, along with the spin-up from DESIGN.md §8
- [ ] Dump Golems pay less per hour than Rug Pullers twelve levels below them (about 370 against
      640 Tickets at the level each is fought) and need far more healing
- [x] Captain Motion at Shooting 45 still takes nearly a full pack of Mic Drops: the quest step
      now says to bring one (2026-11-24)
- [x] Melee can stand next to an enemy in the Trenches and never swing (2026-11-24): the
      President walked a stale path onto the tile the enemy had just stepped to, and the two then
      traded places for good. Fixed in the tick loop (`holdIfInReach`); 15 scripted melee runs of
      6,000 ticks against Trench enemies now never go more than 7 ticks without a swing

## Gameplay QA pass leftovers (2026-11-24)

Fixed the same day (DECISIONS.md "Boss fairness pass"): the Raider and the Inspector no longer
attack first, six bosses were retuned for the level of the weapon they fear, neighbors were moved
off the way in to the Chief, Captain Motion and the Rugmancer, quest steps say how much food to
bring, and the death message says the pile is lost on reload.

- [x] Quest bosses that stand where everyone walks (Corporate Raider, Inspector Greysuit)
- [x] Inspector Greysuit against a new character: 70% at Shooting 3 with 4 Soundbites (was 0%)
- [x] Sludge Mother at Shooting 15: 60% on 27 Soundbites or 20 Zingers (was 0%)
- [x] Wrong-Namer Chief at Melee 30 with the Iron Gavel: 65 to 85% on 27 Zingers (was 0 to 25%)
- [x] Gatecrasher at Shooting 40: 83% with 20 shells and 8 Zingers (was 10%)
- [x] Lockdown Warden at Melee 40: 73% on 19 Mic Drops (was 0%)
- [x] Rugmancer: 63 to 68% at Shooting 45 on 27 Mic Drops (was 0 to 10%)
- [x] The Extractor with the Filibuster Mace at Melee 60: 88% on 27 Mic Drops (was 10%)
- [x] Captain Motion in his real surroundings: 68% at Shooting 45 (was 3%)
- [ ] Sockpuppets on the way to the Sludge Mother: a scripted player going up at Shooting 15
      died to one in 4 of 5 runs (they stand at (24,98) and (16,98), four tiles off the
      duckboards). The same kind of nudge as the Brutes would do
- [ ] The Rogue Process, the Pundit and the Plus-One still attack first inside the Treasury (the
      Plus-One wakes four tiles from Madame Flurry). No deaths seen outside their fights
- [ ] The Hopium Staff is a Shooting 25 weapon, but the Rugmancer is tuned for Shooting 45 (the
      level the story brings you there at). The quest does not say so
- [ ] A full pack of Zingers is 405 Tickets, a lot at Shooting 15 to 30. The Sludge Mother can
      be done on Soundbites; the Chief cannot (Zingers need Spin 20 or the Terminal)
- [ ] Time, after the fixes: five scripted playthroughs with the old training targets reached
      The Way Out in 14.3 to 16.9 game hours and The Hatchery in 51.3 to 53.1 (0 to 7 deaths;
      before 28 to 41). Training only to the levels the bosses are now tuned for: The Way Out in
      12.3 to 14.7 hours and The Hatchery in 33.2 to 34.7 (5 to 9 deaths). A person will take
      longer. Still mostly combat training (57 to 60%)
- [ ] A bankrupt President (no items, 1 Ticket) needs about 54 minutes of gavel work on the
      training yard to afford a 25-Ticket tool again. It is not a dead end, but it is close to one

## Gameplay improvement plan leftovers (2026-11-11)

- [ ] A4: open a dialogue on a real GPU (Chrome, Firefox, Safari) and look for the black
      rectangle over the chat log; headless Chromium showed it
- [ ] D3: bring the coin back as a market mood (step the price walk, Pump and Dump events, XP
      and drop effects that never touch Tickets, the ticker in the HUD). Not started; settle the
      DESIGN.md story question below at the same time
- [ ] H1: say when the hub's session cap is reached and when it resets
- [ ] H2: owner decision on an in-game 18+ confirmation if the plaza does not gate the portal
- [ ] Human playtest of the first 40 minutes on a real GPU (plan section 9), with sound on

## Feedback window (2026-11-11)

- [x] Re-vendor hub-sdk from hub **main** (2026-11-12): hub-sdk 0.7.2 at `c6627e5`
      (metaverse-hub #183). `VENDOR.md` and `tests/sdk-hash.test.ts` name that commit.
      `SOURCE.pin.json` and the built package already matched this SDK; only the pin's
      branch and sha changed
- [x] Re-vendor hub-sdk 0.9.0 from hub main at `a3d94f9` (metaverse-hub #196, 2026-11-19)
- [ ] Try the window against a real hub session (sent note, id toast, offline queue); so far it
      was driven with a stubbed transport only
- [ ] The window has no controller navigation: a pad can open it from Settings and close it with
      B, but picking options and sending need a keyboard or mouse

## Controller and keyboard (2026-11-09)

- [ ] Check the layout with a real controller (Xbox, PlayStation, Switch): stick walking feel,
      soft-target choice in crowds, trigger zoom speed. Tested so far with a stubbed pad only.
- [ ] Owner decision: an optional WASD walking mode (today: click to walk, letters start chat)
- [ ] Controller text entry (chat, private messages, adding friends) needs an on-screen keyboard;
      quick-chat and the pad's menus cover the rest
- [ ] Full screen and remapping (2026-11-12): try the Full screen option and Esc / F11 in Chrome,
      Firefox and Safari on a real screen (headless Chromium entered and left it), and remap a
      real controller's buttons. Firefox and Safari may pass the Esc that leaves full screen to
      the page; the game ignores an Esc while in full screen, which covers both cases

## Online (0.7.0) leftovers

- [ ] S1 Clan / channel chat and a Clan tab
- [ ] S2 Swamp Exchange (player buy and sell orders, server-side order book)
- [ ] S3 Hopium shared across worlds; Day chant; wells
- [ ] S4 Raids and group bosses with multi-way areas (DESIGN §11 late bosses, The Old Coin)
- [ ] S5 PvP in The Trenches (skull/risk, single-way PvP)
- [ ] S6 Binary delta encoding; spatial-hash AOI for zones over 100×100
- [ ] S7 Report button, admin mute and kick, a trade audit table, bot heuristics
- [x] S9 Server-side `pb_total_xp` and the `pb.quest_complete` relic event for online characters
      (2026-11-19; live once the hub's `pb_world` shell passes `reportEvent` / `submitScore`)
- [ ] S10 Follow a player, emotes, world hopping with a cooldown, friends' column in world select
- [ ] S11 Mobile layout for world select, the trade window and the friends list
- [ ] Save import ("Bring your offline President online"): off by decision; would need an HTTP RPC
- [x] Exchange (Tickets → Verse) online (2026-11-19; needs the hub shell's `loadProfile` or
      `getRelics` so the client knows the world read its profile)
- [ ] A Friends tab of its own (needs a tab socket painted into the frame art)
- [ ] Goja tick time (2026-11-19: A* scratch buffers, lazy entity JSON, staggered saves; Node
      --jitless bench 21.0 → 16.3 ms/tick, not yet measured in Goja. Next: dirty flags for
      selfPatch, a spatial hash for visibility): 100 players clicking 30 times a tick use ~440 ms of the 600 ms tick on one dev
      machine. Profile the sim phase (pathfinding, enemies) and entity serialization if a world fills
- [ ] Clickable "wishes to trade with you" line (today: Trade with the player back)

## QA leftovers (0.6.1 audit)

- [ ] Nothing in the sim moves `hopium` or increments `recentDumps` yet (DESIGN.md §6 events);
      the price now reverts to normal, but only boss wins push it.
- [ ] DESIGN.md §4, §5, §10 and §12 still describe the older Ranch / Quest to $100bn story; the
      Lockdown → Trenches → Way Out → Moonward story lives in DECISIONS.md. Owner to decide.

## OSRS QA leftovers (0.4.0 audit)

- [ ] Inventory drag with pointer events and a drag delay (now native drag and drop)
- [ ] Withdraw-X / Deposit-X with an "Enter amount" prompt; Deposit worn items
- [ ] Multi-tile bosses (footprint for reach, pathing and blocking) instead of scaled-down models
- [ ] Right-click menus on orbs (Toggle Run) and tab buttons
- [ ] Optional OSRS setting: hide Attack on higher-level monsters (left-click walks)

## Known gaps from Phase 1

- [ ] Draw calls: props are a dozen meshes each, over the Phase 6 budget of 300. Fix: merge
      static meshes per prop by material (or instance racks/trees).
- [ ] Mobile: long-press menu, one-finger camera drag, bottom-drawer panels (Phase 6). Taps already work.
- [ ] Bundle: Three.js is its own chunk now (648 KB, 164 KB gzip, 2026-11-19); the game chunk
      is still 982 KB (364 KB gzip) and Vite warns at 500 KB. Split it further or raise the limit.
- [x] Character GLBs load per zone and are meshopt-compressed (2026-11-19). Still open: the
      GLB textures are 512 px JPEGs (1.4 MB in all); WebP saved only ~25% and was left out.
- [ ] Treasury exit portal once a second zone exists.

## Optimization handoff leftovers (2026-11-19, see CLAUDE_HANDOFF_STATUS.md)

- [ ] Measure the world tick in Goja (the hub's `pb.bench` RPC) after the hub re-vendors the bundle
- [ ] Dirty flags for `selfPatch` (the sim would mark the player keys it writes)
- [ ] Split `src/main.ts` (boot, HUD, online) into focused modules
- [ ] Owner: delete the legacy `src/assets/icons/*.png` if `UI.pixelIcons` stays true

## OSRS features deferred to their phase

- Phase 3: random events, emotes
- Phase 5: Grand Exchange (Swamp Exchange), clan chat (friends, PMs and worlds shipped in 0.7.0)
- Phase 6: music player, roof toggle
- Not planned in DESIGN.md: prayer, spellbook, special attack (Command/Sprotos fill that role),
  achievement diaries, collection log, world map (one zone so far), doors

- Phase 6 sound: effects shipped 2026-11-11 (synthesised, `src/audio`); music is still open

## Later phases

See DESIGN.md §15 for Phases 3–6.
