# TODO

## Next: Phase 2 — Combat + military (DESIGN.md §15)

- [ ] `guns.json`, `ammo.json`, `armor.json` + schemas; Campaign Pistol, Confetti Shotgun, Treasury Rifle
- [ ] `combat.ts`: accuracy/defence rolls, max hit, attack speed, range, Bresenham LOS (unit-tested)
- [ ] Ammo consumption and gavel melee fallback; combat triangle modifier
- [ ] Equipment tab (head/body/legs + weapon), armor values
- [ ] Hitpoints, death → respawn, hitsplats, tracer/projectile visuals, sludge "poof"
- [ ] Sludgeling training enemies (spawns, aggro, simple AI)
- [ ] Command skill, Barracks, Enlistment Papers, `sprotos.json`
- [ ] `sprotos.ts` state machine (FOLLOW / ASSIST / DEFEND / RETURN / SPECIAL), Recruit + Medic + Grunt
- [ ] Shared gremlin placeholder for Sprotos (see the owner's Sproto look in `SPROTO_SCRIPTS.md`)
- [ ] Boss: Sludge Mother (Treasury basement) in `bosses.json` + `sim/bosses/sludgeMother.ts`

## Known gaps from Phase 1

- [ ] Draw calls: ~380 visible in the Treasury, over the Phase 6 budget of 300. Each placeholder
      is many small meshes. Fix: merge static placeholder meshes by material (or instance racks/trees).
- [ ] GLB animation clips: the manifest has `clips`, but only procedural placeholder animation
      plays. Wire an `AnimationMixer` when real art lands (Phase 6).
- [ ] Mobile: long-press menu, one-finger camera drag, bottom-drawer panels (Phase 6). Taps already work.
- [ ] Hash → BTC conversion (Treasury terminal, Phase 3). The bank now stores hash.
- [ ] Draw calls rose slightly with bank booths and ground-item sprites; same merge fix applies.
- [ ] Bundle is ~760 KB (mostly Three.js); Vite warns at 500 KB. Split vendor chunk or raise the limit.
- [ ] Treasury exit portal once a second zone exists.

## OSRS features deferred to their phase

- Phase 2: combat options tab, HP bars, hitsplats, combat level in tooltips, Equipment tab
- Phase 3: quest list, shops, random events, emotes (the Painter boss needs one), dialogue options
- Phase 5: Grand Exchange (Swamp Exchange), friends/clan chat, world switching
- Phase 6: music player, F-key tab hotkeys, roof toggle
- Not planned in DESIGN.md: prayer, spellbook, special attack (Command/Sprotos fill that role),
  achievement diaries, collection log, world map (one zone so far), doors

## Later phases

See DESIGN.md §15 for Phases 3–6.
