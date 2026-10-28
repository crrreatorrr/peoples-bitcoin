# PROJECT: "The People's Bitcoin" — OSRS-style satirical web MMO-lite

You are building a browser game in Three.js. Read this entire file before writing code. It is the source of truth for design, scope and architecture. When something here conflicts with your instincts, follow this file. When something is unspecified, choose the simplest option that fits Old School RuneScape (OSRS) conventions and note the decision in `DECISIONS.md`.

Build in phases (section 15). Do not start a phase until the previous one passes its acceptance criteria. Ship a playable build at the end of every phase.

---

## Revisions approved by the owner (2026-10-28) — these override the sections below

- **Hard Rule 2 amended:** the player character is **President Obama**, a satirical low-poly caricature (see §0), with a parody notice in game. No other real names.

- **Skills (10):** Shooting, Melee, Defense, Hitpoints, **Summoning** (was Command), Mining, Fundraising, Lobbying, Spin, Construction. **Removed:** Gunsmithing, Policy, Press Dodging, Painting.
- **Skill web:** Mining → Hash (sold at the Terminal at the live price; also cannon ammo; Construction material). Fundraising → raw Scandals (+ rare whale payouts). Spin → Scandals into Talking Points (food that heals in combat). **Lobbying pays $BITCOIN for favors; sometimes you're blackmailed and do it unpaid.** Summoning → Sproto allies from contracts. Construction → **locked behind the Bunker Down quest**; better toolkits unlock better bunker upgrades.
- **No cosmetics in the game; every item is useful.** Gremlin Street painting, the Resort Boutique and cosmetic skins are dropped.
- **The Trading Terminal (a computer):** guns, ammo, armor, tools, food, contracts and building materials are bought there in USD prices paid in $BITCOIN at the live price; anything with a value sells there.
- **Ammo:** one common ammo type (Rounds), bought at the Terminal, works in every gun. **Explosive guns are cannons that fire the Hash you mine** (Hash Cannon, Golden Veto Cannon), with splash damage.
- **Combat ladder:** lots of combat with enemies of increasing difficulty in **The Trenches**, gated by bosses (Sludge Mother, Wrong-Namer Chief, Captain Motion).
- **Tutorial:** "Empty Treasury" teaches every skill quickly, OSRS-style, with hints and a step list; never locked.
- **Bank** is in Phase 1 (pulled forward from Phase 3).
- **Art:** sprites and icons come from Higgsfield (AI-generated, original characters only).
- **Wording:** "jeet" comes from an ethnic slur (Hard Rule 4), so the Dumper Leviathan's adds are "paper-hands fish".

---

## 0. Hard rules (never break)

1. **In-game currency only.** No real money, no crypto wallets, no blockchain calls, no cash-out, no real-money trading. **$BITCOIN is the only currency** and it is fictional. *(Amended by the owner, 2026-10-28: BTC was removed.)* No real-world currencies or coins by name or ticker.
2. **Fictional characters; public figures only as satire.** *(Amended by the owner, 2026-10-28.)* Characters have invented names, with one owner-approved satirical exception: the player character is **President Obama**, a stylized low-poly caricature inspired by Barack Obama. Caricatures of public figures must be low-poly cartoons, never photorealistic, never sexual or demeaning, and must never imply a real person endorses anything (no real-world endorsements, quotes or slogans attributed to them, nothing about real coins or investing in their voice). The game shows a parody notice (`PARODY_NOTICE` in `src/config/branding.ts`). No other real names or handles. Private individuals' faces only with their consent. All other characters are archetypes with invented names.
3. **No trademarked characters on screen.** No wizard boy, no blue hedgehog, no studio characters. The coin's full name is a configurable string constant `COIN_FULL_NAME` in `src/config/branding.ts`; default it to a parody name `"PresidentWizardHedgehog10Inu"` with ticker `"$BITCOIN"`. The owner may change it later.
4. **Content rating: adult (18+) satire.** *(Amended by the owner, 2026-10-28: the game is for adults.)* Crude internet-meme humor is allowed (e.g. COOM vials as staff ammo), but no explicit sexual content, no slurs, no racial or religious jokes, no mutilation threats, no mocking of disabled people. Guns and staffs are cartoon, low-poly, chunky, no gore. Enemies "poof" into sludge when defeated.
5. **Placeholders first.** Every model, sound and texture is a placeholder (primitives or simple GLB) loaded through an asset manifest so final art can be swapped without code changes.

---

## 1. Tech stack

- **Engine:** Three.js (latest stable r1xx), TypeScript, Vite.
- **No React for the game view.** UI is a plain HTML/CSS overlay (inventory, chat, minimap, skills, shop) managed by small TS modules. (React Three Fiber is not used, to keep the game loop explicit.)
- **State:** a single authoritative `GameState` object updated only by the tick loop. Rendering reads state; it never mutates it.
- **Persistence (phase 1–3):** localStorage save/load with a versioned schema and migration function.
- **Multiplayer (phase 5+):** Colyseus (Node) authoritative server; client sends intents (click tile, click entity, use item), server runs the same tick logic. Write the tick logic in `src/sim/` as pure TypeScript with no DOM/Three imports so it can run on both client and server.
- **Testing:** Vitest for `src/sim/` (pathfinding, combat math, economy, drop tables). Aim for good coverage of sim code; rendering is not unit tested.
- **Deploy:** static client to Vercel. Server later to Fly.io or Railway.
- **Lint/format:** ESLint + Prettier. Strict TS.

### Folder layout
```
/src
  /config        branding.ts, balance.ts (all numbers live here), assets.manifest.json
  /sim           tick.ts, state.ts, pathfinding.ts, combat.ts, economy.ts, sprotos.ts,
                 bosses/*.ts, quests/*.ts, events.ts, drops.ts, rng.ts (seeded)
  /render        scene.ts, camera.ts, world.ts, entities.ts, effects.ts, loader.ts, lowres.ts
  /ui            hud.ts, inventory.ts, chat.ts, skills.ts, shop.ts, minimap.ts, tooltips.ts, dialogue.ts
  /input         mouse.ts, keyboard.ts, touch.ts
  /data          guns.json, ammo.json, armor.json, sprotos.json, bosses.json, npcs.json,
                 items.json, zones.json, quests.json, dialogue/*.json, droptables.json
  /assets        placeholder glb/png/ogg
/tests
/server          (phase 5)
```
All content (items, guns, NPCs, bosses, drop tables, dialogue) is **data-driven JSON** validated with Zod at load time.

---

## 2. Look and feel

- **OSRS look, reimagined:** low-poly, flat-shaded (`MeshLambertMaterial` / `flatShading: true`), 64×64 textures with `NearestFilter`.
- **Low-res render:** render to a target at ~50–60% resolution, upscale with nearest-neighbor (`image-rendering: pixelated`).
- **Camera:** perspective, orbits the player at a fixed tilt. Drag (middle mouse / right mouse / one-finger drag on mobile) rotates yaw; pitch clamped 25°–75°; scroll/pinch zooms (min 7, max 24 units). Arrow keys rotate.
- **UI:** OSRS-style stone/wood panels. Right side: tabs (Inventory, Equipment, Skills, Military, Quests, Settings). Bottom-left: chat box with colored messages. Top-left: currency ticker. Top-right: minimap (orthographic render of tile grid).
- **Fonts:** a pixel display font for headers, a pixel body font for chat (Google Fonts).
- **Right-click context menu** on every entity: "Attack", "Talk-to", "Examine", "Trade", "Mine", "Walk here".
- **Hover tooltip** at cursor: action + target name (e.g. "Attack Sludge Mother (level 25)").
- **Mobile:** tap to walk/act, long-press for context menu, panels collapse to a bottom drawer.

---

## 3. Core simulation

### Tick loop
- 1 tick = **600 ms**. All game logic runs on ticks. Rendering runs at display rate and interpolates positions between ticks.
- Order per tick: process inputs → movement → combat → Sproto AI → bosses → events → regen/timers → economy → autosave every 10 ticks.

### World
- Tile grid. Each zone is a separate map (e.g. 64×64) defined in `zones.json` with: walkable mask, height (flat for now), object placements, NPC spawns, entry/exit portals.
- Pathfinding: A* with 8-directional movement, no corner cutting through blocked tiles. Unit tests required.
- Player walks 1 tile/tick (run toggle: 2 tiles/tick, drains Run Energy).
- Interaction: clicking an entity paths to an adjacent tile, then performs the default action each tick until stopped.

### Seeded RNG
All randomness goes through `rng.ts` (seeded) so tests and server replays are deterministic.

---

## 4. Lore (use for writing, quests, item names, dialogue)

The game parodies a real meme coin community. Keep only the safe, funny parts listed here.

**Premise.** President Obama takes office and opens the national reserve. It is supposed to hold gold. It holds **$BITCOIN** ("The People's Bitcoin"), a meme coin with a 1,000,000,000 supply and 0% tax, because the Treasurer misread the memo. Selling would crash the coin and the country, so the President takes the **Never Sell Vow** and begins **the Quest**: pump the People's Bitcoin to the mythical **$100 billion** and fund the nation on the way.

**Mythology (from the coin's straight-faced "white paper"):**
- **The Quest (of Hallows):** a cosmic event where the universe created a "store of value".
- You relive the Quest by **charging Opal at the core of Neptune while you sleep**, but there is not enough Opal for everyone.
- Refuse the Quest and you lose immunity to **"low vibrational darkness sludge entities"** — the **Sludge**, the game's ambient enemy. It feeds on fear, dumps and wrong tickers.
- The **"10"** is the 10 spirals of the Tree of Life.
- **Three Tenets:** Iron Guidance (resilience), Recursive Gifting (value that breeds value), the Optimistic Flurry (pure speed).
- **Roadmap:** "RoadMap to $100bn (+ ∞%)" with no steps. In-game the roadmap screen is one arrow pointing up.

**Running gags to use:**
- Posts and announcements open with **"ATTENTION ATTENTION"**.
- **"Induce me" / "check DM" / "drop wallet"** = NPCs asking for tips.
- **"It's not $BITCON."** The Wrong-Namers call the coin $BITCON ("it's a con"); saying it puts you on the public **Enemy List**.
- **"Free my Gremlin."** Everyone wants a Gremlin (the mascot).
- **Promises to "cure the malaria"** — turned into a real good deed: funding wells and nets in The Village.
- **Mock "civil wars"** in the community.
- **"Hostage until price target"** — an NPC refuses to leave until the coin hits a price.
- **"Motion"** — rivals brag about "maximum motion" and call you "an object with no motion".
- **Daily chant** — a gentleman NPC chants the coin's full name every in-game day ("Day 847...").
- **Shop prices end in 69.**

**Real-world heart of the lore:** the community funded painted walls and water wells in villages. In-game, **The Village** and the **Well Builder** carry this: building wells is permanent and benefits the whole server.

---

## 5. Characters (all fictional archetypes)

| ID | Name | Role | Personality / bits |
|---|---|---|---|
| npc_president | **President Obama** | Player character (customizable) | — |
| npc_treasurer | **The Treasurer** | Tutorial quest-giver | Bought the wrong coin, nervous, apologetic |
| npc_pa_ranchero | **Pa Ranchero** | Hub leader at The Ranch | Calls you "son". Hosts the Sunday Ranch Show. Fires you when quests fail, rehires you next day |
| npc_kingmaker | **The Kingmaker** | Podcast guild master | Funds your fame, books interviews; main patron |
| npc_squire_froth | **Squire Froth** | Companion / later civil-war rival | "Looks good here!" Never has money |
| npc_sir_daywell | **Sir Daywell** | British gentleman | Chants coin name daily (server Day counter). Wants to send you to Mars |
| npc_painter | **The Painter** | Merchant | Follows you offering to paint your Gremlin |
| npc_patron | **Lord Patronus** | Rich backer | Mood swings between generous and cold |
| npc_bard_general | **The Bard General** | Minstrel | Leads troops in the Civil War; chicken-chasing minigame |
| npc_cat_artisan | **The Cat Artisan** | Student craftsman | Crafts cosmetic pets, always "between exams" |
| npc_well_builder | **The Well Builder** | Village hero | Quiet, sincere. Turns treasure into wells |
| npc_captain_motion | **Captain Motion** | Rival | Maximum Motion. Rage-quits, threatens to sue |
| npc_badger_warlord | **The Badger Warlord** | Frenemy | Ally or enemy by season. Keeps asking for 55 $BITCOIN |
| npc_prophet | **The Prophet** | Rival cult leader | Steals your followers, mosquito swarms |
| npc_wrongnamers | **The Wrong-Namers** | Heckler faction | Shout "$BITCON President!" |
| npc_gloomy_beggar | **The Gloomy Beggar** | Ambient NPC | Asks for 10 coins forever |
| npc_gossip | **The Gossip Broker** | Info vendor | Trades rumors (hints) for coins |
| npc_slitherman | **Slitherman** | Rival candidate | A rapper running against you for president |

Dialogue lives in `/src/data/dialogue/<npc_id>.json` as node graphs (id, speaker, text, options[], conditions, effects).

---

## 6. Currencies and stats

| Key | Name | Source | Use |
|---|---|---|---|
| `bitcoin` | $BITCOIN | Quests, Induce, selling, bosses | Main currency, volatile price in USD |
| `opal` | Opal | Overnight "charging" (offline progress), Neptune boss | Endgame crafting, Opal ammo |
| `induce` | Induce | Fame: NPC and player tips | Converts to $BITCOIN |
| `motion` | Motion | Stat | Actions-per-tick bonuses, run energy |
| `vow` | Vow Meter (0–100) | Holding without selling | Buffs while high; selling reserves drops it |
| `hopium` | Hopium (server-wide 0–100) | Wells, quests, boss wins; drops on Sludge wins | Moves the $BITCOIN price |
| `hp` | Hitpoints | — | Dies at 0 → respawn at The Ranch, drop unbanked loot (configurable) |
| `approval` | Approval | Public events | Optional social stat for press events |

### Price model (`economy.ts`)
- `$BITCOIN` USD price updates every 5 ticks: random walk with drift.
- `drift = k1*(hopium-50) + k2*recentBossWins - k3*recentDumps`. All constants live in `balance.ts`.
- Clamp to a floor; record a 200-point history for the ticker sparkline.
- Shop prices are quoted in USD and charged in $BITCOIN at the current price, so timing matters.
- **Events:** "Halving" (mining yield halves), "Dump" (instant −10–25%), "Pump" (+10–25%), "Ticker Swap" (shop labels swap $BITCOIN/$BITCON for 60 ticks; buying with the wrong one fails with a joke message).

### Gremlins and the Hatchery tax
- **Gremlins** are rare collectible items (mascot). Owning one gives passive income from the Hatchery.
- **The Hatchery:** players launch in-game joke coins. Every trade pays a **3.13%** fee split: 1% to Gremlin owners, 0.5% to that coin's holders, 0.5% to creator, 0.5% to platform (sink), 0.63% to "the venue" (sink).

---

## 7. Skills (1–99, OSRS XP curve)

Use the OSRS XP formula. Skills:

| Skill | Replaces | Train by |
|---|---|---|
| **Shooting** | Ranged | Shooting enemies |
| **Melee** | Attack/Strength | Gavel fallback weapon |
| **Defense** | Defence | Taking hits |
| **Hitpoints** | Hitpoints | Combat |
| **Command** | Summoning | Enlisting and fighting with Sprotos |
| **Mining** | Mining | Server racks → Hash (sold for $BITCOIN) |
| **Fundraising** | Fishing | Donor dinners → $BITCOIN, rare whales |
| **Lobbying** | Woodcutting | Lobbyists → Favors |
| **Spin** | Cooking | Scandals → Talking Points (can burn) |
| **Policy** | Smithing/Crafting | Favors + Talking Points → Bills (server buffs) |
| **Press Dodging** | Agility | Lawn obstacle courses |
| **Construction** | Construction | Oval Office / Presidential Library housing |
| **Painting** | — | Painting Gremlins on Gremlin Street walls |
| **Gunsmithing** | Fletching | Crafting ammo and gun parts |

Each skill gets a definition in `skills.json` with actions, level reqs, XP and outputs.

---

## 8. Combat (shooting)

**OSRS-simple:** click a target and the player auto-attacks every attack-speed ticks. No aiming.

- **Hit chance:** `accRoll = (shootingLvl + 8) * (gunAccuracy + 64)`, `defRoll = (defLvl + 8) * (armor + 64)`; OSRS-style comparison. Constants in `balance.ts`.
- **Damage:** random 0..maxHit, where maxHit derives from Shooting level, gun damage and ammo bonus.
- **Range & line of sight:** must be within range in tiles and have LOS (Bresenham on the tile grid; blocked tiles block).
- **Ammo:** consumed per shot. Out of ammo → auto-swap to gavel (melee).
- **Projectiles:** visual only (tracer line / chunky bullet mesh), hit resolves on tick.
- **Combat triangle:** Guns > Melee enemies, Melee > Shields, Shields > Guns (±25% accuracy modifier).
- **Hitsplats:** OSRS-style red/blue numbers above heads.
- **Death:** enemies poof into sludge particles.

### Guns (`guns.json`)
| id | Name | Lvl | Speed (ticks) | Range | Notes |
|---|---|---|---|---|---|
| gun_campaign_pistol | Campaign Pistol | 1 | 4 | 5 | Starter |
| gun_confetti_shotgun | Confetti Shotgun | 15 | 5 | 3 | 3-tile cone |
| gun_press_pass_smg | Press Pass SMG | 30 | 2 | 5 | Fast, low dmg |
| gun_treasury_rifle | Treasury Rifle | 45 | 5 | 9 | Long range |
| gun_gremlin_blaster | Gremlin Blaster | 60 | 4 | 7 | Applies "Sludge Clear" |
| gun_diamond_minigun | Diamond Hands Minigun | 75 | 1 | 6 | 3-tick spin-up |
| gun_golden_veto | Golden Veto Cannon | 90 | 7 | 8 | Splash |
| gun_flippening_railgun | Flippening Railgun | 99 | 6 | 12 | Dmg scales with server Hopium |

### Ammo (`ammo.json`)
Rubber Rounds (basic), Hopium Rounds (+dmg when Hopium high), Vow Rounds (+dmg when Vow high), Opal Rounds (best).

### Armor (`armor.json`)
Slots: head, body, legs. Suits, flak vests, aviators, campaign hats. Each has armor value and optional set bonus.

---

## 9. Military: Sproto summons

**Skill: Command.** A **Sproto** is a small soldier gremlin that behaves like a pet out of combat and fights automatically in combat. **All Sprotos are placeholders for now.**

### Rules
- One active Sproto at a time.
- Enlist at **The Barracks** (The Ranch) with **Enlistment Papers** (crafted from $BITCOIN + material).
- Lasts N minutes (in `balance.ts`, default 30), then returns to barracks.
- If it dies: returns to barracks, cooldown, nothing lost.
- One **special** per Sproto, triggered by clicking its icon; costs **Command Points** (regen over time).
- Gremlin owners can apply a cosmetic skin.

### AI state machine (`sprotos.ts`)
```
FOLLOW   : stay 1 tile behind player; idle animations
ASSIST   : player attacks target T → move into range of T and attack T
DEFEND   : player not attacking, but something attacks player → attack that attacker
RETURN   : target dead / out of range / player teleported → path back to player
SPECIAL  : on player trigger, perform special, then resume previous state
```
Priority: SPECIAL > ASSIST > DEFEND > RETURN > FOLLOW. Sprotos use the same combat math as players.

### Roster (`sprotos.json`, all placeholder)
| id | Name | Cmd Lvl | Role | Behavior | Special |
|---|---|---|---|---|---|
| sp_01 | Sproto Recruit | 1 | Shooter | Pistol, short range | Rally: +5% dmg 10 ticks |
| sp_02 | Sproto Medic | 10 | Healer | Heals player, no attacks | Patch Up: heal 20 |
| sp_03 | Sproto Grunt | 20 | Tank | Melee, draws aggro | Taunt: boss targets it 5 ticks |
| sp_04 | Sproto Sniper | 30 | Long range | Slow, high dmg | Headshot: one big hit |
| sp_05 | Sproto Grenadier | 40 | AoE | Targets clusters | Barrage: hits all adds |
| sp_06 | Sproto Engineer | 50 | Support | Builds turret | Turret: 20 ticks |
| sp_07 | Sproto Scout | 55 | Utility | Loots, reveals hidden | Recon |
| sp_08 | Sproto Shield | 60 | Defender | Blocks between player & boss | Bulwark: block next 3 hits |
| sp_09 | Sproto Heavy | 70 | Minigun | Spin-up, high DPS | Suppress: slow enemy attacks |
| sp_10 | Sproto Commander | 80 | Buffer | Buffs all Sprotos nearby | Chain of Command |
| sp_11 | Sproto Paratrooper | 90 | Burst | Drops onto target | Air Drop |
| sp_12 | Golden Sproto | 99 | Legendary | All-rounder | Flippening Strike: scales with server market cap |

### Placeholder art spec
One shared low-poly gremlin (~0.6 tiles tall, big head, short legs). Variants differ by **color + one prop** (helmet, red cross, scope, grenade bag, wrench, shield, minigun, parachute, gold). Animations: idle bob/blink, attack, special, poof death. Driven by the asset manifest.

---

## 10. Zones (`zones.json`)

1. **The Treasury** — tutorial; discover the ticker mistake; first server racks.
2. **The Ranch** — hub town: Barracks, bank, Sunday Ranch Show (weekly buff event), church, lab, secret tunnels.
3. **Gremlin Street** — buy wall spots, paint your Gremlin (player housing as street art).
4. **The Village** — build wells; each well is permanent and raises server Hopium.
5. **The Hatchery** — launch joke coins; trading minigame; 3.13% fee split.
6. **Honey Badger Valley** — Badger Warlord territory, alliance flips by season.
7. **The Temple of Belief** — The Prophet's base.
8. **The Trenches** — PvP chart wars; Sludge spawns here.
9. **Neptune's Core** — endgame raid dungeon.

---

## 11. Bosses (`bosses.json` + `/sim/bosses/*.ts`)

Each boss: HP, combat stats, phases (HP thresholds), mechanics (tick-scheduled attacks), add spawns, weaknesses, drop table.

**Early (solo)**
1. **Sludge Mother** (Treasury basement) — spawns Sludgelings that drain Hopium; kill adds or she heals. Phase 2: floor sludge, stand on clean logo tiles. Weakness: "Say the Name" spell. Drops: first Opal shard, Sludge-Stained Tie, 69 $BITCOIN.
2. **Wrong-Namer Chief** (Gremlin Street) — every 5 ticks yells the wrong ticker; player must type the correct ticker in chat within 3 ticks or take a debuff. Sockpuppet adds shield him. Drops: Megaphone, Enemy List page, Induce tokens.
3. **The Painter Gone Wild** (optional joke boss) — wet paint tiles slow you; hits "sell" you paintings for $BITCOIN; win by using "Decline DM" emote 3 times at the right moment. Drops: Gremlin Portrait, paintbrush.

**Mid (solo/duo)**
4. **Captain Motion** (Trenches arena) — 2 actions/tick; phase 2 roots you ("no motion"); at 10% rage-quits and runs — catch him or zone locks 1 hour. Drops: Boots of Motion, Rage-Quit Letter pet.
5. **The Badger Warlord** (Honey Badger Valley) — seasonal ally/boss (server vote). "Dump" attack lowers your $BITCOIN during the fight (block with Iron Guidance). Asks for 55 $BITCOIN mid-fight: paying skips phase 2 but lowers Vow. Drops: Honey Badger pet, Badger Pelt cape, Badger Fact scrolls.
6. **The Prophet** (Temple of Belief) — converts your NPC followers; win them back with Recursive Gifting. Mosquito Swarm DoT; stand under a Net to clear. Drops: Prophet's Robes, Bug Net, Belief Crystals.

**Late (group raids)**
7. **Dumper Leviathan** (Trenches, 4–8) — P1: whole party must "buy the dip" on the same tick; P2: splits into escaping paper-hands fish that carry loot; P3: anyone who sold in 24h takes double damage. Drops: Whale Bone, Diamond Hands gloves, Gremlin chance.
8. **The Civil War** (server event, Ranch) — 3-day faction war (President vs Squire Froth); losing leader becomes a raid boss. Drops: faction banners, titles.
9. **Hatchery Hydra** — each head is a player-launched coin; cutting one grows two copy-coins; burn necks via Recursive Gifting. Drops: Hydra Egg (free launch), Hatchery Fee Pass.

**Endgame**
10. **Guardian of Neptune's Core** — damage boosted by overnight Opal charging; P2: walk the 10 spirals in order; P3: Three Tenets sync — three players act on the same tick. Drops: Neptune Opal, Spiral Staff, Tree of Life cape.
11. **The Old Coin** (final, The Flippening raid) — orange titan. P1 "Store of Value": only damageable while server Hopium > 80. P2 "Halving": halves damage periodically. P3 "The Flippening": server $BITCOIN market cap acts as the damage meter; when it passes The Old Coin, boss falls. Win: roadmap arrow reaches the end; Flippening title. Drops: Golden Gremlin, Presidential Crown, name on the Ticker Monument.

**Extras:** Mars Rocket mini-boss (if server misses a Day chant); weekly Hostage-Taker (holds an NPC until a server price target); 1/5000 pet drops (baby Sludge, mini Badger, mosquito, tiny Gremlin, mini Old Coin).

**Sproto counters (for design/tuning):** Medic vs Sludge Mother; Shield vs Captain Motion; Grunt vs Badger Dump; Grenadier vs Prophet & Hydra; Scout vs paper-hands fish; Commander vs Neptune; Golden Sproto vs The Old Coin.

---

## 12. Quests (`quests.json` + `/sim/quests/*.ts`)

Each quest: id, name, requirements (skills, quests), steps (state machine), dialogue refs, rewards.

1. **Empty Treasury** — tutorial: walk, talk, mine, shoot, enlist first Sproto, bank, shop.
2. **It's Not $BITCON** — correct 10 Wrong-Namers; each converted name is crossed off your Enemy List.
3. **Free My Gremlin** — long chain ending with your first Gremlin.
4. **The Civil War** — pick a side; ties into the server event.
5. **Hostage Price** — NPC stays in your office until the coin hits a target.
6. **Must Stop the Prophet** — boss quest.
7. **Fifty Wells** — long questline with The Well Builder; reward: plaque with your name in The Village.
8. **Day N** — keep Sir Daywell's chant alive (daily).
9. **Mission to Mars** — build the rocket.
10. **Debt Ceiling** — timed negotiation puzzle.
11. **The Flippening** — final raid.

---

## 13. Random events (`events.ts`)
Reporter ambush (approval gamble), Whistleblower, Lost Intern, Rig Power Outage, Viral Post (big Hopium swing), Ticker Swap, Gloomy Beggar. Each: spawn chance per tick, conditions, despawn timer, dialogue, reward/penalty.

---

## 14. Shops, bank, items
- **Bank** at The Ranch and The Treasury (OSRS-style, 28-slot inventory, stackable items).
- **Swamp Market** (general store) and **Gun Shop**, **Barracks**, **Cosmetics** ("Resort Boutique").
- Prices end in 69 (e.g. $69, $169, $669).
- Cosmetics: aviators, gold tie, campaign hat, bald eagle pet, crown, flag cape.
- **Grand Exchange** ("The Swamp Exchange") — phase 5, player buy/sell orders.

---

## 15. Build phases and acceptance criteria

### Phase 1 — Core sandbox
- Vite + TS + Three.js, low-res renderer, OSRS camera, tile grid, A* pathfinding, click-to-walk, tick loop, hover tooltip, right-click menu, chat log, inventory, save/load.
- One zone: The Treasury (placeholder buildings, racks).
- **Mining** skill end-to-end (rack → item → XP → level-up message; racks deplete/respawn).
- $BITCOIN ticker with price model and sparkline.
- ✅ Accept: player can walk, mine, level, see price move, reload page and keep progress. Pathfinding tests pass.

### Phase 2 — Combat + military
- Shooting combat (pistol + shotgun + rifle), ammo, armor, hitsplats, LOS, death/respawn.
- Training enemies: Sludgelings.
- Command skill, Barracks, Sproto AI state machine, Sproto Recruit + Medic + Grunt (placeholder art).
- Boss: **Sludge Mother**.
- ✅ Accept: player + Sproto can kill Sludgelings and Sludge Mother; Sproto follows, assists, defends, returns; combat math unit-tested.

### Phase 3 — Hub, economy, quests
- The Ranch, Gremlin Street, The Village. NPC dialogue system. Bank, shops, cosmetics.
- Vow, Hopium, Induce, Opal (offline charging on load).
- Quests 1–3, random events, wells raise Hopium.
- Bosses: Wrong-Namer Chief, Captain Motion.
- ✅ Accept: full loop: earn → buy → fight → quest → build well → price reacts.

### Phase 4 — Content
- Remaining guns, Sprotos 4–12, zones, bosses 5–10, quests 4–10, Hatchery with 3.13% split.
- ✅ Accept: all data files validate; every boss beatable with intended counters; balance sheet in `balance.ts`.

### Phase 5 — Multiplayer
- Colyseus server running `src/sim`, interest management by zone, chat, trading, Swamp Exchange, Civil War, server-wide Hopium, The Old Coin raid.
- ✅ Accept: two browsers see each other, trade, and raid together; server is authoritative (client cannot set state).

### Phase 6 — Polish
- Final art swap via manifest, sound, mobile controls, settings, accessibility (remappable keys, color-blind hitsplats), performance budget (≤ 300 draw calls, 60fps on a mid laptop, instanced meshes for tiles/trees).

---

## 16. Asset pipeline (placeholders now, AI-assisted later)

- `assets.manifest.json` maps logical ids → file path, scale, rotation offset, animation clip names. Code only references ids.
- Placeholders: Three.js primitives or tiny GLBs generated in code.
- Final art (later, by the owner): concept images and image→3D GLB from an AI tool (e.g. Higgsfield), then cleaned in Blender: decimate to low-poly (Sprotos ≤ 1.5k tris, bosses ≤ 6k tris), flat-shade, 64×64 palette texture, rig/animate (Mixamo or manual), export GLB, compress with `gltf-transform` (meshopt/draco).
- Style guide in `ART_GUIDE.md`: palette, poly budgets, silhouette rules, no trademarked characters, and the satire rules for public-figure caricatures.

---

## 17. Working rules for you (Claude Code)

- Start every session by reading this file, `DECISIONS.md` and `TODO.md`.
- Keep all tunable numbers in `src/config/balance.ts`. No magic numbers in logic.
- Sim code is pure and tested. Render code is thin.
- Commit at the end of each logical step with a clear message.
- After each phase: update `README.md` (how to run), `TODO.md`, and write a short changelog.
- If a request would break the Hard Rules in section 0, stop and say so.

**First task:** scaffold Phase 1. Set up the project, folders, data schemas, tick loop, renderer, camera, pathfinding with tests, The Treasury zone with placeholders, Mining, the ticker, and save/load. Then stop and summarize what's done and what's next.
