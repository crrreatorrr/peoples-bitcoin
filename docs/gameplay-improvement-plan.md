# Gameplay improvement plan

## 1. Status

Plan only. No game code has changed.

- First audited 2026-11-09 at commit `aa26b51`. Re-validated 2026-11-11 at commit `3597574`.
- Re-validation covered: reading `git diff aa26b51 3597574` for `src`, `tests`, `docs`,
  DECISIONS.md, TODO.md and CHANGELOG.md; re-running the tutorial bot; re-opening a dialogue in
  the browser; re-checking the line numbers quoted in this document. The only change under
  `src/sim`, `src/config` or `src/data` is one shop price, so every other simulated number stands
  as measured at `aa26b51` and was not re-run.
- DESIGN.md section 0 (the hard rules) binds every item here: fictional in-game currency only,
  invented character names with the one documented exception, no trademarked characters, adult
  satire with no explicit content or gore, placeholders through the asset manifest.
- AGENTS.md also binds: every tunable number goes in `src/config/balance.ts`, `src/sim` stays pure,
  and new sim behavior needs Vitest tests in `tests/`.

### Resolved since the first audit

- **The tutorial's mining wall (was finding F1, High).** At `aa26b51` the Campaign Pistol cost 25
  Tickets against the Treasurer's 10 (`src/data/quests.json:34`), so the tutorial bot mined and
  sold 55 Scrap Hash (0.276 Tickets each) before it could arm itself: 5.3 minutes on average
  (4.1–6.3) and three Terminal trips, in a 13.2-minute tutorial. Commit `788c0b8` set the price to
  2 (`src/data/shop_prices.tickets.json:62`). Re-run at `3597574`: 1 Scrap Hash mined, armed at
  1.8 minutes, tutorial done in 8.9 minutes on average (7.1–17.5). No further work needed.

Checked and not resolved:

- Tutorial deaths (F2): the same re-run still died during the combat steps in 22 of 24 runs
  (37 deaths).
- The black rectangle during dialogue (F14): the dialogue layout was reworked in `788c0b8`
  (`src/ui/dialogue.ts`, `src/styles.css`), and the rectangle still appeared in headless Chromium
  at `3597574`.

The other two commits change attack and walk animation only (`src/render`, `src/main.ts`) and
touch nothing this document measures.

## 2. How this was audited and how far to trust it

| Method     | What it covered                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Observed   | Dev server in headless Chromium at 1280x720. Real clicks and keys for the first dialogue, side tabs, context menu and Terminal. Dev-hook intents for the next two tutors, mining, one sale and one gavel fight. |
| Simulated  | The pure sim, driven tick by tick by bots (described below).                                                                                                                                                    |
| Calculated | Arithmetic from data files and simulated rates: loot value per kill, costs, quest payouts, hours to a level.                                                                                                    |
| Read       | Bosses, Sprotos, the bunker, the hub bridge, online worlds.                                                                                                                                                     |

Limits:

- The browser ran at about 7 frames per second on software rendering. Nothing here says how the
  game feels or performs on a real GPU.
- `npm test`, `npm run lint` and `npm run typecheck` were not run.
- Bot numbers are not human play. Bots never hesitate, read dialogue in one tick per line, and
  pick targets by straight-line distance. Human times will be longer; human deaths may be fewer
  (a person can walk away) or more.
- Single-seed combat runs varied by about 20% between seeds for the same stage.
- Nothing past the tutorial was played in the browser.

The scripts were throwaway and are not committed. To rebuild them:

**Importing the sim.** A Vitest config outside the repo with `root` set to the repo, a `define`
for `__PB_SIM_VERSION__`, and test files that import `tests/helpers.ts` (`newGame`, `content`,
`give`), `runTick` from `src/sim/tick.ts`, `changeZone` from `src/sim/zones.ts` and `xpForLevel` /
`levelForXp` from `src/sim/xp.ts`. Content is loaded once and shared, so a script can change
quest or item data in memory to try a proposal without touching the repo.

**Tutorial bot.** 24 seeds (101, 202, ... 2424). It follows the quest's listed order: talks to
the first three tutors; mines the nearest undepleted Dusty Server Rack and sells at the Terminal
until it can pay for the pistol; talks to the Sergeant, buys, wields gun and Rounds;
kills a Sludgeling; unequips and hits one with the gavel; re-equips and kills a Comment Troll and
Sergeant Sandbag; then fundraises 6 Minor Scandals, spins them, eats one, lobbies once, summons,
banks, talks to the Contractor and enters the Trenches. Dialogue advances one line per tick. In the
"current" run it never eats during combat. In the "proposed" run it eats a Soundbite at 4 HP or
less. It records deaths, time to each milestone and the final wallet.

**Combat grind bot.** One seed per run (7; some stages repeated on 8 and 9). The skill starts at a
set level and gains XP normally. The weapon for each stage is given free, Rounds are unlimited, and
the player is moved to the stage's area with `changeZone`. The bot attacks the nearest live enemy
of one type until the target level. Whenever HP falls below half it is reset to full and the
difference is counted as the **healing need** (HP per hour a real player would have to eat). Two
variants: no armor at all, and armor given free at the tier the Defense level allows (Campaign
set, Flak at 20, Kevlar at 40, Diamond Hands at 60). Loot is never picked up.

**Gathering bot.** Two game hours (12,000 ticks) at a fixed skill level (XP is reset every tick)
with the stated tool. It works the nearest undepleted node, waits when all are depleted, and for
Mining walks to the Terminal and sells when the inventory is full.

**Food bot.** Two game hours with Fundraising and Spin fixed at the same level: fill the
inventory with scandals, spin them all at the podium, count the food, empty the inventory.

## 3. What already works and should be kept

- The interface conventions: left-click default action, right-click menu on everything, the
  action text top-left, tabs on F-keys, bank and shop behavior. All worked first time (observed).
- The yellow quest arrow and the Quests tab's "Next:" line. They always pointed at the right
  place (observed).
- The writing. Dialogue is short, in character and funny, and the "ATTENTION ATTENTION" voice
  carries through system messages.
- Unordered tutorial steps, and quest items that cannot be lost.
- Level-up banner and fireworks (`src/main.ts:723`), hit bars over heads, XP drops.
- Stability: no console errors in any session; the page loaded in 1.8 s locally.
- The deterministic, pure sim. It made every measurement in this document possible in seconds.

## 4. Findings

Labels used in the tables: **coin income** is Tickets credited by a kill's USD roll; **loot
income** is the Terminal sale value of the average item drop, if every drop is picked up and sold;
**healing need** is defined in section 2.

### Reference tables

**Conversion.** Repeatable sources pay 1 Ticket per 25 USD-equivalent with the fraction carried
(`TICKETS.usdPerTicket`, `src/config/balance.ts:182`; `addStreamUsd`, `src/sim/ledger.ts:31`).
Quest and step rewards pay `round(sqrt(usd))` Tickets (`questTicketAmount`, `src/sim/ledger.ts:22`).

**Income: combat** (kills and coin simulated; loot calculated from `src/data/droptables.json` and
`src/data/shop_prices.tickets.json`).

| Target        | Weapon, Shooting level    | Kills/hr | Coin T/hr | Loot T/hr if all sold | Total T/hr |
| ------------- | ------------------------- | -------- | --------- | --------------------- | ---------- |
| Sludgeling    | Campaign Pistol, 1–5      | 110–131  | 6–7       | 12                    | 19         |
| Comment Troll | Campaign Pistol, 5–15     | 131–155  | 10–12     | 13                    | 24         |
| Heckler       | Confetti Shotgun, 15–22   | 150–168  | 15–17     | 19                    | 35         |
| Paper-Hands   | Confetti Shotgun, 22–30   | 87–91    | 21–23     | 25                    | 47         |
| Paper-Hands   | Press Pass SMG, 30–35     | 152–158  | 38        | 43                    | 81         |
| FUD Wraith    | Ballot Blaster, 35–45     | 120–121  | 44–46     | 65                    | 110        |
| Sludge Brute  | Ballot Blaster, 40        | 89       | 50        | 79                    | 129        |
| Bear Raider   | Treasury Rifle, 45–53     | 64–71    | 55–61     | 120                   | 178        |
| Rug Puller    | Gremlin Blaster, 60       | 82       | 102       | 196                   | 298        |
| Dump Golem    | Gremlin Blaster, 60       | 34       | 60        | 113                   | 173        |
| Margin Caller | Diamond Hands Minigun, 75 | 152      | 398       | 932                   | 1,330      |

Loot income overstates what a player keeps: much of it is Rounds and food that are better used
than sold, and picking up was not simulated. Shooting also spends 1,500–2,000 Rounds an hour
(45–60 Tickets at 3 per 100), which is more than coin income until about Shooting 45; Round drops
roughly cover it if collected (calculated).

**Income: gathering** (simulated, fixed level, two game hours, trips included).

| Activity                          | Level, tool        | Tickets/hr | XP/hr  |
| --------------------------------- | ------------------ | ---------- | ------ |
| Mining Scrap Hash                 | 1, Rusty Pick      | 184        | 9,900  |
| Mining Scrap Hash                 | 15, Steel Pick     | 403        | 17,600 |
| Mining Warm Hash                  | 15, Steel Pick     | 519        | 20,700 |
| Mining Warm Hash                  | 30, Steel Pick     | 662        | 27,300 |
| Mining Molten Hash                | 30, Steel Pick     | 762        | 19,200 |
| Mining Molten Hash                | 50, Overclocked    | 886        | 21,800 |
| Lobbying, Junior                  | 1, Business Cards  | 98         | 12,300 |
| Lobbying, Junior                  | 19, Gold Cards     | 204        | 25,400 |
| Lobbying, Veteran                 | 20, Gold Cards     | 431        | 31,600 |
| Lobbying, Veteran                 | 39, Platinum Cards | 775        | 57,100 |
| Lobbying, Broker                  | 40, Platinum Cards | 1,193      | 51,800 |
| Lobbying, Broker                  | 50, Diamond Cards  | 1,542      | 64,400 |
| Lobbying, Broker                  | 60, Diamond Cards  | 1,644      | 69,800 |
| Fundraising whale payouts (aside) | 1 to 60            | 15–190     | n/a    |

Lobbying 40 needs 37,224 XP, about 1 to 1.3 hours at these rates (calculated).

**Costs** (`src/data/shop_prices.tickets.json`; weaknesses from `weakTo` in `src/data/enemies.json`).

| Boss (quest)                            | Weapon it fears    | Skill needed | Tickets |
| --------------------------------------- | ------------------ | ------------ | ------- |
| Sludge Mother (Sludge Duty)             | Confetti Shotgun   | Shooting 15  | 65      |
| Wrong-Namer Chief (Name Calling)        | Iron Gavel         | Melee 20     | 88      |
| Rogue Process (Server Meltdown)         | Press Pass SMG     | Shooting 30  | 115     |
| The Pundit (Press Conference)           | Ballot Blaster     | Shooting 35  | 155     |
| The Corporate Raider (Hostile Takeover) | Briefcase Bludgeon | Melee 30     | 155     |
| The Plus-One (Gala Night)               | Hash Cannon        | Shooting 40  | 155     |
| Captain Motion (Motion Denied)          | Treasury Rifle     | Shooting 45  | 182     |
| The Lockdown Warden (The Way Out)       | Veto Hammer        | Melee 40     | 205     |
| **Total to finish The Way Out**         |                    |              | 1,120   |

The Chief also takes full damage from the free Presidential Gavel, but DECISIONS.md says he is
tuned for the Iron Gavel. After The Way Out: Hopium Staff 78 (Rugmancer), and Filibuster Mace 387
or Diamond Hands Minigun 471 (The Extractor).

| Armor tier    | Defense | Pieces                                    | Tickets |
| ------------- | ------- | ----------------------------------------- | ------- |
| Campaign      | 1       | hat, jacket, slacks, loafers, Grip Gloves | 201     |
| Flak          | 20      | helmet, vest, pants, Combat Boots         | 380     |
| Kevlar        | 40      | fedora, suit, trousers                    | 563     |
| Diamond Hands | 60      | helm, plate, greaves, boots, gauntlets    | 1,638   |

| Food      | Heals | Shop price | Tickets per HP |
| --------- | ----- | ---------- | -------------- |
| Soundbite | 4     | 9          | 2.25           |
| Zinger    | 9     | 15         | 1.67           |
| Mic Drop  | 16    | 25         | 1.56           |

**Quest payouts** (`src/data/quests.json`).

| Quest                                                     | USD              | Tickets |
| --------------------------------------------------------- | ---------------- | ------- |
| Empty Treasury (tutorial)                                 | 100 (step) + 669 | 10 + 26 |
| Sludge Duty                                               | 1,500            | 39      |
| Name Calling                                              | 4,000            | 63      |
| Motion Denied                                             | 10,000           | 100     |
| Server Meltdown                                           | 1,500            | 39      |
| Gala Night                                                | 2,500            | 50      |
| Press Conference                                          | 1,500            | 39      |
| The Way Out                                               | 25,000           | 158     |
| Moonward Enrollment                                       | 6,969            | 83      |
| Bunker Down, Hostile Takeover, Sproto Ranch, The Hatchery | none             | 0       |
| **Total**                                                 |                  | 607     |

Hostile Takeover's "leverage" choice adds `round(sqrt(6000))` = 77 (`quests.json:884`). Only 366
of the 607 arrive before the last boss weapon must be bought. First kills of the three Trench
bosses drop about 40, 92 and 180 Tickets of coin and loot if everything is sold (calculated).

**Healing need** (simulated, HP per hour).

| Fight                                   | No armor    | Armor for the Defense level reached |
| --------------------------------------- | ----------- | ----------------------------------- |
| Sludgeling or Comment Troll, pistol     | 235–365     | 157–234                             |
| Heckler, shotgun                        | 647         | 441–486                             |
| Paper-Hands, shotgun or SMG             | 1,603–2,063 | 1,550–1,896                         |
| FUD Wraith, Ballot Blaster              | 1,444       | 1,488–1,911                         |
| Sludge Brute, Shooting 40, Flak         | not run     | 1,481                               |
| Bear Raider, rifle                      | 5,028       | 2,890 (Flak), 1,866 (Kevlar)        |
| Rug Puller, Shooting 60, Kevlar         | not run     | 1,645                               |
| Dump Golem, Shooting 60, Kevlar         | not run     | 4,515                               |
| Margin Caller, Shooting 75, Diamond     | not run     | 2,839                               |
| Paper-Hands, Briefcase Bludgeon (melee) | 1,489–1,892 | 1,203–1,873                         |

**Food production** (simulated; Fundraising and Spin at the same level).

| Food      | Level | Items/hr | HP/hr | Burnt |
| --------- | ----- | -------- | ----- | ----- |
| Soundbite | 1     | 241      | 964   | 49%   |
| Soundbite | 20    | 797      | 3,186 | 0%    |
| Zinger    | 20    | 273      | 2,457 | 51%   |
| Zinger    | 40    | 810      | 7,290 | 0%    |
| Mic Drop  | 40    | 236      | 3,776 | 50%   |
| Mic Drop  | 60    | 621      | 9,936 | 0%    |

**Hours to level** (simulated, non-stop combat, free gear and healing).

| Stage                                        | Minutes             |
| -------------------------------------------- | ------------------- |
| Shooting 1–5, pistol, Sludgelings            | 7–8                 |
| Shooting 5–15, pistol, Comment Trolls        | 20–24               |
| Shooting 15–22, shotgun, Hecklers            | 22–24               |
| Shooting 22–30, shotgun, Paper-Hands         | 46–48               |
| Shooting 30–35, SMG, Paper-Hands             | 31–32               |
| Shooting 35–45, Ballot Blaster, FUD Wraiths  | 132–134             |
| **Shooting 1–45**                            | 4.3–4.5 hours       |
| Melee 1–10, Oak Gavel, Comment Trolls        | 19–20               |
| Melee 10–20, Oak Gavel, Hecklers             | 40–43               |
| Melee 20–30, Iron Gavel, Sockpuppets         | 68–98               |
| Melee 30–40, Briefcase Bludgeon, Paper-Hands | 84–96 (one run 133) |
| **Melee 1–40**                               | 3.7–4.8 hours       |

Beyond that, Treasury Rifle on Bear Raiders gave about 17,800 Shooting XP an hour; 45 to 58 took
the full 10-hour cap of one run.

### Findings list

**F1. Resolved.** See "Resolved since the first audit" in section 1. The ID is kept so earlier
references still work.

**F2. The tutorial kills the player.** High. Simulated.
The combat steps come before any food, at 10 HP, with regeneration of 1 HP per 100 ticks
(`COMBAT.hpRegenEveryTicks`, `balance.ts:76`). The bot died during those steps in 22 of 24 runs
at both commits (31 deaths at `aa26b51`, 37 at `3597574`). At Shooting 1 the pistol's max hit is 1, a Sludgeling has 6 HP and a Comment Troll
9, and each hits back for up to 1 about every other swing. Observed once in the browser: a gavel
fight with one Sludgeling took about a minute and cost 6 of 10 HP. Death drops the inventory
(`DEATH.dropInventory`, `balance.ts:115`).

**F3. The coin satire is not in play.** High. Read and observed.
`src/sim/economy.ts:1-5` says the price walk is unused; nothing calls `stepEconomy`. The
`ECONOMY` block (`balance.ts:144-163`) is dead, and `TODO.md:49` notes nothing moves Hopium. The
HUD shows "Wallet: N Tickets" (`src/ui/hud.ts:74`). Vow, Induce, Opal, random events and wells
are not built. Shop prices are 25, 78, 155 and so on, so the "ends in 69" gag is gone. The player
meets the theme only in names and dialogue.

**F4. Gathering out-earns fighting by 4 to 10 times.** High. Simulated and calculated.
At the same stage of the game, mining or lobbying pays 400–1,200 Tickets an hour while combat
pays 35–180 including loot (tables above). Coin alone is 6–61 an hour up to Shooting 53. A player
who wants gear stops playing the fun part and stands at a lobbyist.

**F5. Required spending is far above one-time income.** Medium. Calculated.
Boss weapons cost 1,120 Tickets and two armor tiers 581, against 366 quest Tickets in time and
about 312 of boss loot. Roughly 1,000 Tickets must come from repeatable sources. Each of the eight
weapons is needed for one boss.

**F6. Sustain shapes every session.** Medium. Simulated and calculated.
From Paper-Hands onward a fighter needs 1,400–2,000 HP of food an hour, and up to 5,000 with weak
armor. Bought food would cost 2,300–4,500 Tickets an hour, so it must be made. Production is fine
once Fundraising and Spin reach 20 (about 3,200 HP an hour) but poor at level 1 (964). The tighter
limits are carrying capacity (27 Zingers is 243 HP, so six to eight bank trips an hour) and
Defense, which earns 1 XP per damage taken (`COMBAT.defenseXpPerDamageTaken`, `balance.ts:71`)
against 4 per damage dealt. Defense was 22–23 at Shooting 45, so Flak armor arrives late and
Kevlar later still.

**F7. Long, flat levelling for the amount of content.** Medium. Simulated.
The Way Out needs Shooting 45 and Melee 40: 8 to 9.3 hours of non-stop combat, before food,
money and travel. That buys ten quests. Early fights are streams of 0s and 1s. The training yard
is also supply-limited: three Comment Trolls on 25-tick respawns.

**F8. Bosses are weapon checks.** Medium. Read.
The wrong weapon does 10% damage (`BOSSES.offWeaponScale`, `balance.ts:91`;
`damageAfterWeakness`, `src/sim/weakness.ts:14`). The only boss mechanic is periodic adds
(`src/sim/enemies.ts:137`); `TODO.md:5-7` lists the three designed mechanics as not built. Sprotos
also do 10% to bosses.

**F9. Fractional payouts are silent.** Medium. Observed and read.
Selling one Scrap Hash printed nothing and left the wallet at 10; only the quest step ticked
(`src/sim/terminal.ts:142`). Lobbying prints its line only when a whole Ticket lands
(`src/sim/gathering.ts:89`); at the Junior that is about one success in seven. Kill loot does the
same (`src/sim/combat.ts:352-357`).

**F10. No audio.** Medium. Read. No audio code or sound files exist in `src/`.

**F11. The Terminal is hard to shop in.** Low. Observed.
About 95 icons in one unlabelled grid with a price under each. Left-click states the price;
buying is right-click only. Names appear only on hover.

**F12. Construction trains only by rebuilding, and the Med Bay is gated behind it.** Low.
Simulated (rebuild) and calculated. `build` in `src/sim/bunker.ts:75` lets the same option be
built again for full XP; building the Storage Locker twice gave 120 XP. Bunker Down leaves the
player at level 2 with 100 XP. The Med Bay, the game's only free full heal, needs level 5
(`src/data/objects.json:301`), which is four more locker rebuilds at one 25-Ticket Concrete Bag
each. Nothing tells the player this.

**F13. The first quest giver walks away.** Low. Observed.
Morelight has `wanderRadius: 1` (`src/data/npcs.json:8`) and a 15% chance per tick to move
(`NPCS.wanderChance`, `balance.ts:213`). The first real click of the session missed him.

**F14. A black rectangle covered the top-left of the view during dialogue.** Low. Observed in
headless Chromium only, at both commits; unverified on a real GPU. It is the size of the chat log and disappears
when `.chat-log` is hidden. It may be a compositor artifact.

**F15. Draw calls.** Low. Observed. 346 at the spawn view against the 300 budget in `TODO.md:64`.

**F16. Sprotos add little.** Low. Read, not played. A Recruit contract costs 25 Tickets, is used
up on summoning (`summonFromInventory`, `src/sim/sprotos.ts:43`), and its max hit is 1.

**F17. In hub play the caps set the pace, not the rates.** Medium. Read. See section 7.

## 5. The plan

Effort: S is under a day, M a few days, L a week or more. "Sim hash" means the change touches
`src/sim`, `src/server`, `src/config` or `src/data`, which `scripts/simHash.mjs` hashes; the hub
then needs a new server bundle (`npm run build:sim`) before online worlds accept the client.

### Phase A: the first fifteen minutes and quick wins

**A1. Issue rations before the first fight.** (F2)

- Goal: no death in the tutorial.
- Change, in `src/data/quests.json`:
  - `talk_sergeant` reward (lines 87–94): 150 Rounds → 150 Rounds and 6 `item_tp_soundbite`.
  - `sell` step text (line 68): say that about four Scrap Hash make one Ticket.
- Sergeant's line in `src/data/npcs.json:844`: add that the rations are for when health runs
  low, and how to eat them.
- Leave the pistol step as it is (buy for 2 Tickets).
- Arithmetic: six Soundbites are 24 HP. Tried in memory on the 24 seeds at `3597574`, with the
  bot eating at 4 HP or less: 0 deaths, 8.0 minutes on average (6.9–9.6), against 22 of 24 runs
  with a death today. In an earlier trial at `aa26b51`, 4 Soundbites left one run with a death
  and 8 left none.
- The `eat` step will complete when the player eats a ration, before they have spun their own.
  That is acceptable because steps are unordered, and `spin` still teaches making food.
- Tests: add a case to `tests/progression.test.ts` that the Sergeant's step grants the food. The
  10-Ticket assertion (lines 48–49) is unaffected.
- Acceptance: the tutorial bot, eating at 4 HP or less, survives 24 of 24 seeds and finishes in
  under 10 minutes.
- Effort S. Dependencies: none. Risk: sim hash. No Ticket payout changes, so no hub economy
  effect. Docs to update: CHANGELOG, DECISIONS (tutorial section).

**A2. Keep the tutorial's quest givers still.** (F13)

- Change: `wanderRadius` 1 → 0 for `npc_morelight` (`src/data/npcs.json:8`); check the other
  tutors' values in the same file and set any non-zero ones to 0.
- Tests: `tests/npcs.test.ts`, assert Morelight's position is unchanged after 200 ticks.
- Effort S. Risk: sim hash. Docs: CHANGELOG.

**A3. Say what a fractional payout was worth.** (F9)

- Change, three places that call `addStreamUsd` and stay silent when it returns 0:
  `src/sim/terminal.ts:142`, `src/sim/gathering.ts:89`, `src/sim/combat.ts:352`. Add a helper in
  `src/sim/ledger.ts` that returns the fraction just added, and always print, for example "You
  sell 1 × Scrap Hash for 0.28 Tickets." Fix "1 Tickets" while there.
- Tests: `tests/economy-items.test.ts` (sale of one sell-only item emits a message),
  `tests/skills.test.ts` (unpaid-fraction lobbying emits a message).
- Acceptance: every sale, paid favor and coin drop produces a chat line with an amount.
- Effort S. Risk: sim hash; message volume in chat rises for lobbying, so keep it to one line.
  Docs: CHANGELOG.

**A4. Check the dialogue black rectangle on a real GPU.** (F14) Open any dialogue in desktop
Chrome, Firefox and Safari. If it reproduces, the chat log's scroll layer under `.dialogue`
(`src/styles.css:411`) is the place to look. Effort S. No sim change.

### Phase B: economy and sustain

**B1. Make fighting pay for fighting.** (F4, F5)

- Goal: combat coin over the story covers the roughly 1,000-Ticket gap in F5 without gathering.
- Change: new constant `TICKETS.dropUsdMultiplier` in `balance.ts`, value 4, applied to the USD
  roll in `dropLoot` (`src/sim/combat.ts:351`). One number instead of 26 table edits. Bosses are
  included.
- Arithmetic: simulated coin over Shooting 1–45 was about 149 Tickets and over Melee 1–40 about
  75: 224 in about 8 hours. Times 4 is about 896. Per hour: Hecklers 60, Paper-Hands with the SMG
  152, FUD Wraiths 184, Bear Raiders about 239, Rug Pullers 408. With loot, mid-game combat
  becomes 250–360 an hour against 430–775 for the Veteran lobbyist: gathering still pays more for
  zero risk, but by about 2 times, not 4 to 10.
- Tests: `tests/combat.test.ts` or `tests/drops-shared.test.ts`, a kill credits `usd ×
multiplier / 25`.
- Acceptance: the grind bot's coin over Shooting 1–45 plus Melee 1–40 is 800–1,000 Tickets.
- Effort S. Risk: sim hash; raises Ticket inflow, which matters to the hub (section 7, decision
  1). Docs: CHANGELOG, DECISIONS (Hub Tickets), TODO (balance pass line).

**B2. Trim the Broker.** (F4) Optional; do after B1 and only if the owner agrees.

- Change: `payUsd` for `lobby_broker` [40, 70] → [30, 50] (`src/data/skills.json:178`).
- Arithmetic: mean 55 → 40, so 1,193 / 1,542 / 1,644 become about 868 / 1,121 / 1,195.
- Tests: `tests/skills.test.ts`. Effort S. Risk: sim hash. Docs: CHANGELOG.

**B3. Let Defense keep up.** (F6)

- Change: `COMBAT.defenseXpPerDamageTaken` 1 → 3 (`balance.ts:71`).
- Arithmetic (simulated by setting the constant in the harness, two seeds): Defense at Shooting
  45 rose from 22–23 to 28–30; Flak was worn from about Shooting 30 instead of 40; healing need
  on FUD Wraiths fell from 1,488–1,911 to 717–1,125 HP an hour. At 4 the result was 30 and
  693–758. Time to level did not change.
- Tests: update any Defense XP assertion in `tests/combat.test.ts`.
- Acceptance: Defense is at least 28 when the armored grind bot reaches Shooting 45.
- Effort S. Risk: sim hash; combat level rises a little sooner, so low enemies stop being
  aggressive sooner (`COMBAT.aggroLevelMultiplier`). Docs: CHANGELOG, DECISIONS (combat math).

**B4. Recover out of combat.** (F2, F6)

- Change: new `COMBAT.hpRegenIdleEveryTicks` = 10 and `COMBAT.idleAfterTicks` = 16. In the regen
  block at `src/sim/tick.ts:381`, use the idle rate when the player has not been hit
  (`player.lastHitBy.tick`) or attacked (`player.nextAttackTick`) for `idleAfterTicks`. No new
  saved field.
- Arithmetic: 1 → 10 HP takes 54 seconds, not 15 minutes; a 40 HP player refills in 4 minutes.
  At most 600 HP an hour while standing still, so food still matters in the Trenches. Not
  simulated.
- Tests: extend `tests/osrs.test.ts:97` with idle and in-combat cases.
- Effort S. Risk: sim hash; departs from the OSRS convention the project follows, so record it.
  Docs: CHANGELOG, DECISIONS.

**B5. Make the Med Bay reachable and Construction legible.** (F12)

- Change: Med Bay `levelReq` 5 → 2 (`src/data/objects.json:301`). Bunker Down's reward (basic
  toolkit, 3 Concrete Bags, 100 XP) then builds the locker and the Med Bay straight away. Add a
  line to the Contractor's post-quest dialogue and the Construction skill guide saying rebuilding
  trains the skill.
- Tests: `tests/progression.test.ts` near line 221, the quest reward is enough to build both.
- Effort S. Risk: sim hash. Docs: CHANGELOG, DECISIONS.

Tried and not recommended: raising the Campaign Pistol's damage from 8 to 16 so the first max hit
is 2. Simulated on three seeds, Shooting 1–15 fell only from 28–32 minutes to about 25, because
the training yard runs out of targets. If early pace still feels slow after A1, add Comment Troll
spawns in `src/data/zones.json` instead.

### Phase C: feedback and clarity

**C1. Show the fraction in the wallet.** (F9) `src/ui/hud.ts:70-74`: show the banked fraction
beside the wallet, or a thin progress bar to the next Ticket, read from
`player.ledger.offlineRemainder` (standalone) or the stream remainders (hub). Effort S. No sim
change. Docs: CHANGELOG.

**C2. Terminal categories and labels.** (F11) In `TerminalWindow` (`src/ui/terminal.ts:26`): tabs
for weapons, armor, tools, food and drinks, contracts, materials and travel; item name under each
icon or a list view; dim items whose `requires` the player does not meet and show the level
needed. Keep left-click = price and right-click = buy. Acceptance: a new player can find the
Confetti Shotgun and its level requirement without hovering. Effort S–M. No sim change. Docs:
CHANGELOG, README (controls).

**C3. Low-health prompt.** (F2) When HP first drops to 30% or less with food in the inventory,
print one warning line and pulse the Hitpoints orb. Threshold as `UI.lowHpWarnPct` in
`balance.ts`. Client-side in `src/main.ts`. Effort S. Changing `balance.ts` changes the sim hash,
so ship it with a sim batch or keep the constant in the batch and the code in a client PR.

**C4. Sound effects.** (F10) A small `src/audio/` module driven by the existing `SimEvent`
stream in `src/main.ts`: hit, miss, level-up, quest complete, mine success, purchase, death.
Synthesized tones need no asset files and no art approval; volumes and a mute toggle in
`src/ui/settings.ts`. Effort M. No sim change. Risk: browsers block audio until the first click.
Docs: CHANGELOG, README, TODO (Phase 6 line).

### Phase D: larger design work

**D1. Boss mechanics.** (F8) The three in `TODO.md:5-7`, sized for 600 ms click-to-move play.
All numbers in a `BOSSES` sub-block per boss; logic beside the adds code in `src/sim/enemies.ts`.

- Sludge Mother: below half HP, every 10 ticks she marks the player's tile and its neighbors;
  3 ticks later sludge lands for up to 4 damage on anyone still there. The marked tiles need a
  render cue (placeholder via the manifest).
- Wrong-Namer Chief: every 12 ticks he shouts the wrong ticker. Sending a chat line containing
  the right one within 8 ticks avoids "Heckled" (accuracy −25% for 10 ticks). DESIGN.md says 3
  ticks, which is 1.8 seconds and too short to type. Offer a quick-chat line as well, since
  controllers have no text entry (`TODO.md:25`).
- Captain Motion: at 10% HP he runs for the north barricade. Finish him within 20 ticks or he
  returns at 50% HP. His weakness is already the long-range rifle. DESIGN.md's one-hour zone lock
  is too harsh for a solo quest.
- Tests: `tests/bosses.test.ts`, one case per mechanic, plus a duel that each boss is beatable at
  the level DECISIONS.md states.
- Acceptance: each fight has a decision other than eating; the grind bot without the mechanic's
  response loses or takes clearly longer.
- Effort L. Risk: sim hash; multi-player behavior in online worlds needs its own tests
  (`tests/combat-multi.test.ts`). Docs: TODO, DECISIONS, CHANGELOG, and DESIGN.md section 11 is
  now out of step (owner edits it).

**D2. Soften the weapon lock.** (F8) `BOSSES.offWeaponScale` 0.1 → 0.4, only together with D1 and
only if the owner agrees (decision 2). `tests/bosses.test.ts:27` derives from the constant.
Effort S.

**D3. Bring the coin back as a market mood.** (F3) "Market mood" here means the fictional coin's
price acting as a world modifier, never as money.

- Step the existing walk again: call `stepEconomy` (`src/sim/economy.ts`) from the tick. The
  state is already saved (`src/sim/save.ts:128`) and carried by worlds (`src/server/host.ts:246`),
  so no save migration is expected; verify.
- Move it with play: first boss wins already feed `recentBossWins`; add Hopium for quest
  completions and a Hopium drop on player death; add Pump and Dump events with a per-update
  chance. New constants beside `ECONOMY`.
- Effects that never touch Tickets: price at least 15% above the anchor gives +10% XP
  (`xpMultiplier`, `src/sim/equipment.ts:250`); at least 15% below gives a better chance of an
  item drop. Bands and sizes in `balance.ts`.
- Show it: restore the ticker and sparkline in `src/ui/hud.ts`, with "ATTENTION ATTENTION"
  messages on events.
- Tests: `tests/economy.test.ts` already covers the walk; add effect and event cases.
- Acceptance: over a simulated hour the price leaves the neutral band at least once and returns;
  a boss win visibly moves it.
- Effort L. Risk: sim hash; must not alter Ticket payouts (hub contract); the price is of a
  fictional coin, so hard rule 1 holds, and no text may read as investment advice in the
  President's voice (hard rule 2). Docs: TODO (line 49), DECISIONS, CHANGELOG, README.

## 6. Suggested order and PR batching

| Batch | Items                             | Sim hash changes | Hub bundle rebuild |
| ----- | --------------------------------- | ---------------- | ------------------ |
| 1     | A4, C1, C2                        | no               | no                 |
| 2     | A1, A2, A3                        | yes              | once, with batch 3 |
| 3     | B1, B3, B4, B5 (B2 if agreed), C3 | yes              | once, with batch 2 |
| 4     | C4                                | no               | no                 |
| 5     | D1, D2                            | yes              | once               |
| 6     | D3                                | yes              | once               |

Merge batches 2 and 3 back to back and re-vendor once. Batch 3 waits on owner decision 1. Each
batch is its own branch and pull request per AGENTS.md.

## 7. Hub integration items

Verified in this repo:

- Earn batches are at most 200 Tickets and quest earns at most 158 (`TICKETS.batchMax`,
  `TICKETS.questCap`, `balance.ts:187-189`). The Way Out's 158 is exactly the quest cap.
- Tickets exchange in steps of 10 up to 500 (`balance.ts:190-191`), which matches 10 Tickets per
  Verse and 50 Verse a day.
- Completing the tutorial reports `pb.quest_complete` and total XP is submitted to `pb_total_xp`
  (`src/hub/bridge.ts:246-251`). `TODO.md:37` says neither is done server-side for online
  characters.
- Online worlds run this sim on the server and refuse a client with a different sim hash.

Reported by the hub audit, not verified here: the session cap is 200 Tickets and the daily cap
1,000 per game; the Genesis Shard relic grant is on hold server-side, so the tutorial's relic
event currently earns nothing; the plaza does not use the 18+ flag at launch; Verse buys nothing
yet.

What the caps mean for this game:

- The 1,120 Tickets of boss weapons take at least 6 capped sessions and at least 2 days. With two
  armor tiers (1,701) it is 9 sessions.
- The Broker fills a 200-Ticket session cap in about 10 minutes. After B1, mid-game combat would
  fill it in under an hour. Past the cap, every earning activity pays nothing that session.
- So in hub play B1 and B2 change which activity fills the cap, not how fast gear arrives. They
  still matter: they decide whether the capped Tickets come from fighting or from standing still.
- Not audited: what the wallet shows while earns are held by a cap, and whether shop sales count
  toward the session cap.

Items:

- H1. Tell the player when the session cap is reached and when it resets. Today the only text is
  "You've hit today's Ticket limit." on a purchase (`walletError`, `src/sim/terminal.ts`).
- H2. The game shows its parody and 18+ notice as the first chat line. If the plaza does not gate
  the portal, nothing does. An in-game confirmation on first load is an option for the owner.
- H3. Finish `TODO.md:37` so online characters reach the leaderboard.

## 8. Decisions for the owner

1. **Are the hub caps and the CSV prices meant to pace this game over days?**
   - Yes, as they are: about 9 sessions for the story's gear. B1 still worth doing; B2 optional.
   - Yes, but faster: lower the eight boss weapon prices in the hub's price CSV by about half.
     Hub-side work, no sim change here beyond the copied table.
   - No: raise this game's caps hub-side. Largest effect on the shared economy.
   - Recommendation: keep the caps, halve boss weapon prices, do B1. Fighting then pays for the
     tools the story demands in four or five sessions.
2. **Is the 10% off-weapon rule fixed?** Keep 0.1 (bosses stay locks; cheapest). Or 0.4 with D1
   (wrong weapon is slow, right weapon is a reward; needs D1 so fights are not trivial).
   Recommendation: 0.4, shipped only with D1.
3. **Does the coin price return as a non-wallet mechanic, or is Tickets-only final?** Tickets-only
   costs nothing and leaves F3 standing. D3 costs a week or more and is the only item that puts
   the satire into play. Recommendation: do D3 after phases A to C, and settle `TODO.md:51` (which
   story DESIGN.md describes) at the same time.
4. **How many hours should The Way Out take?** Today about 8 to 9 hours of pure combat, an
   estimated 15 to 20 with food, money and travel (estimate, not measured). Options: keep; or aim
   for about 10 by raising combat XP (`COMBAT.xpPerDamage`, `balance.ts:68`) or lowering the two
   gates (rifle at Shooting 45, Veto Hammer at Melee 40). Recommendation: decide after A and B
   ship and a person has played to the first boss.

## 9. How to verify the changes improved play

Simulations to re-run (rebuild from section 2):

| Check                                      | Today           | Target            |
| ------------------------------------------ | --------------- | ----------------- |
| Tutorial bot, runs with a death (24 seeds) | 22              | 0                 |
| Tutorial bot, average minutes              | 8.9             | under 10          |
| Combat coin, Shooting 1–45 plus Melee 1–40 | about 224       | 800–1,000         |
| Defense when Shooting reaches 45           | 22–23           | 28 or more        |
| Healing need on FUD Wraiths, HP/hr         | 1,488–1,911     | under 1,200       |
| Broker Tickets/hr at 40 / 60 (if B2)       | 1,193 / 1,644   | about 870 / 1,200 |
| Sales and favors with no chat line         | most at level 1 | none              |

Human playtest, one fresh save, about 40 minutes, on a real GPU:

- Did you ever not know what to do next? Where?
- Did you die before entering the Trenches? Did you understand why?
- When you sold your first item, did you know what you got?
- Could you find and buy the Confetti Shotgun without help?
- Did you choose to fight or to gather when you needed Tickets, and why?
- Frame rate in the Treasury and the Trenches; any visual glitch during dialogue.
- With sound on (after C4): is anything annoying after ten minutes?

## 10. Not audited or out of scope

- Feel and performance on real hardware; mobile and touch; controller play.
- Online worlds, trading, chat, friends, and anything needing the hub server.
- Hub-mode wallet behavior under caps; Verse exchange.
- Every boss fight, Moonward Academy, the Sproto Ranch and the Hatchery in play. Their numbers
  were read, not fought.
- Sproto balance beyond reading the data; the higher bunker builds.
- Fundraising and Spin XP pacing on their own; drink boosts; teleports.
- Art, models and animation. `SPROTO_SCRIPTS.md` was not used.
- The project's own test suite was not run, so nothing here says whether it passes today.
