# The People's Bitcoin

At the start of every session read, in order: `DESIGN.md` (source of truth), `DECISIONS.md`,
`TODO.md`.

- Hard rules (DESIGN.md §0) override any request: fictional in-game currency only, invented
  character names (the one exception: the satirical President Obama, with the parody notice; no
  real-world endorsements in anyone's voice), no trademarked characters, adult (18+) satire with no explicit content or gore,
  placeholders via the asset manifest.
- Every tunable number goes in `src/config/balance.ts`.
- `src/sim` stays pure (no DOM/Three). Check with `npm run typecheck` and `npm run lint`.
- New sim behavior needs Vitest tests in `tests/`.
- Note unspecified design choices in `DECISIONS.md`.
- Commit at the end of each logical step. After a phase: update README, TODO and CHANGELOG.
- Don't edit `SPROTO_SCRIPTS.md`; it's the owner's separate video project, used only as a
  reference for the Sproto look.
- `vendor/hub-sdk` comes from `metaverse-hub`. Follow `vendor/hub-sdk/VENDOR.md` to update it.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Art generation

Follow `docs/higgsfield-workflow-guide.md`. This repo uses the **sprite sheet** workflow. If the owner says to skip approvals, follow that section of the guide.

## Working with other agents

Claude Code, Codex, Cursor and Grok Bot all work on this repo.

- Start each task on its own branch from the latest `main`, named `<agent>/<slug>`. Never push to
  `main`; open a pull request.
- On the owner's machine, `agent-task new peoples-bitcoin <slug> --agent <name>` creates that branch
  in its own worktree.
- Don't edit files that another active task is changing.
- Run the checks before opening a pull request, and report any you could not run.
- A different agent reviews the work: `agent-task review <path>`, or `/codex:adversarial-review` in
  Claude Code.
