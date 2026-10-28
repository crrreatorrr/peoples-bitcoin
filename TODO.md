# TODO

## Next

- [ ] Gun specials from DESIGN.md §8: shotgun 3-tile cone, minigun spin-up, railgun Hopium scaling
- [ ] Boss mechanics beyond adds: Sludge Mother floor sludge, Wrong-Namer Chief ticker typing,
      Captain Motion rage-quit run
- [ ] Sprotos 6–12 (Engineer, Scout, Shield, Commander, Paratrooper, Golden Sproto)
- [ ] More quests (DESIGN.md §12), and more to do in The World Out There beyond the ferry to Moonward
- [ ] Moonward Academy: library and potions content (spellbooks, brewing) beyond decoration
- [ ] Balance pass: XP rates, drop values, Terminal prices, enemy stats (all in data/balance.ts)

## QA leftovers (0.6.1 audit)

- [ ] Lines that hand you something ("Here's a stack, on the house!", "Here's a Donor List")
      replay on every talk. Fix: remember seen variants per player, with an optional `repeat` line set.
- [ ] The coin price is a pure random walk (nothing moves `hopium`; `recentDumps` is never
      incremented), about ±50% an hour. Add a pull back toward a normal price.
- [ ] A wielded Hash Cannon fires any Hash in the inventory, including the Scrap Hash you're
      carrying for Bunker Down or the Chamber.
- [ ] Spent quest leftovers (Photo Negatives, Blackmail Photo) sit in the inventory; let them be
      destroyed or used up.
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
- Phase 5: Grand Exchange (Swamp Exchange), friends/clan chat, world switching
- Phase 6: music player, roof toggle
- Not planned in DESIGN.md: prayer, spellbook, special attack (Command/Sprotos fill that role),
  achievement diaries, collection log, world map (one zone so far), doors

## Later phases

See DESIGN.md §15 for Phases 3–6.
