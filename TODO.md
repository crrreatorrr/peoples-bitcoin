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
- [ ] Captain Motion at Shooting 45 still takes nearly a full pack of Mic Drops; decide whether
      the quest should say so or the fight should ask for less food
- [ ] Melee can stand next to an enemy in the Trenches and never swing (seen by a bot beside
      Sockpuppets near 14,97); check `inAttackRange` against the trench walls there

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

- [ ] Re-vendor hub-sdk from hub **main** once the hub's feedback branch
      (`claude/festive-ptolemy-4mg8oe`, `b9ac308`) merges, and update `VENDOR.md`,
      `SOURCE.pin.json` and `tests/sdk-hash.test.ts`
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
- [ ] S9 Server-side `pb_total_xp` and the `pb.quest_complete` relic event for online characters
- [ ] S10 Follow a player, emotes, world hopping with a cooldown, friends' column in world select
- [ ] S11 Mobile layout for world select, the trade window and the friends list
- [ ] Save import ("Bring your offline President online"): off by decision; would need an HTTP RPC
- [ ] Exchange (Tickets → Verse) online
- [ ] A Friends tab of its own (needs a tab socket painted into the frame art)
- [ ] Goja tick time: 100 players clicking 30 times a tick use ~440 ms of the 600 ms tick on one dev
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
- [ ] Bundle is ~1 MB (306 KB gzipped; mostly Three.js plus the code-built models); Vite warns at 500 KB. Split the vendor chunk or raise the limit.
- [ ] Character GLBs total ~9.5 MB and all load at start. Load per zone, or compress meshes with
      `gltf-transform` (meshopt).
- [ ] Treasury exit portal once a second zone exists.

## OSRS features deferred to their phase

- Phase 3: random events, emotes
- Phase 5: Grand Exchange (Swamp Exchange), clan chat (friends, PMs and worlds shipped in 0.7.0)
- Phase 6: music player, roof toggle
- Not planned in DESIGN.md: prayer, spellbook, special attack (Command/Sprotos fill that role),
  achievement diaries, collection log, world map (one zone so far), doors

- Phase 6 sound: effects shipped 2026-11-11 (synthesised, `src/audio`); music is still open

## Later phases

See DESIGN.md §15 for Phases 3–6.
