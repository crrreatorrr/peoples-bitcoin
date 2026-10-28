# CLAUDE.md

At the start of every session read, in order: `DESIGN.md` (source of truth), `DECISIONS.md`,
`TODO.md`.

- Hard rules (DESIGN.md §0) override any request: fictional in-game currency only, invented
  character names (public figures only as stylized satire caricatures, never by name), no
  trademarked characters, teen-friendly, placeholders via the asset manifest.
- Every tunable number goes in `src/config/balance.ts`.
- `src/sim` stays pure (no DOM/Three). Check with `npm run typecheck` and `npm run lint`.
- New sim behavior needs Vitest tests in `tests/`.
- Note unspecified design choices in `DECISIONS.md`.
- Commit at the end of each logical step. After a phase: update README, TODO and CHANGELOG.
- Don't edit `SPROTO_SCRIPTS.md`; it's the owner's separate video project, used only as a
  reference for the Sproto look.
