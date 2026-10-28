# TODO

## Next

- [ ] Gun specials from DESIGN.md §8: shotgun 3-tile cone, minigun spin-up, railgun Hopium scaling
- [ ] Boss mechanics beyond adds: Sludge Mother floor sludge, Wrong-Namer Chief ticker typing,
      Captain Motion rage-quit run
- [ ] Sprotos 6–12 (Engineer, Scout, Shield, Commander, Paratrooper, Golden Sproto)
- [ ] More quests (DESIGN.md §12) and dialogue options (choices; replies exist)
- [ ] Balance pass: XP rates, drop values, Terminal prices, enemy stats (all in data/balance.ts)

## Known gaps from Phase 1

- [ ] Draw calls: every character is ~30 small meshes and props a dozen each, over the Phase 6
      budget of 300. Fix: merge static meshes per joint/prop by material (or instance racks/trees).
- [ ] GLB animation clips: the manifest has `clips`, but only procedural placeholder animation
      plays. Wire an `AnimationMixer` when real art lands (Phase 6).
- [ ] Mobile: long-press menu, one-finger camera drag, bottom-drawer panels (Phase 6). Taps already work.
- [ ] The BTC wallet currency is still unused (BTC Shards are items that sell at the Terminal).
- [ ] Bundle is ~760 KB (mostly Three.js); Vite warns at 500 KB. Split vendor chunk or raise the limit.
- [ ] Treasury exit portal once a second zone exists.

## OSRS features deferred to their phase

- Phase 3: random events, dialogue options, emotes
- Phase 5: Grand Exchange (Swamp Exchange), friends/clan chat, world switching
- Phase 6: music player, F-key tab hotkeys, roof toggle
- Not planned in DESIGN.md: prayer, spellbook, special attack (Command/Sprotos fill that role),
  achievement diaries, collection log, world map (one zone so far), doors

## Later phases

See DESIGN.md §15 for Phases 3–6.
