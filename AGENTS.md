# AI Spatial Soundscape — CalHacks 13.0

Read [the blueprint](./AI%20Spatial%20Soundscape%20—%20CalHacks%2013.0%20Blueprint.md) before starting any task. It is the source of truth for scope, the scene contract, the stack, and the team split.

## Context

- Hackathon project for CalHacks 13.0. Submission closes **Sunday Oct 25, 9:00am PDT**; feature freeze is **Sunday 3:00am**.
- Team of 4, 3 of whom write code. Ownership areas follow the blueprint's "Team split".
- Everything reads and writes one scene JSON (`scene.ts`, zod). Code against that schema; change it only through a PR the whole team sees.

## Scope

- Build what the blueprint and the assigned issue ask for. Do not implement features that aren't needed for the demo.
- Keep changes within this project's scope unless a teammate explicitly asks otherwise.
- Stay on task. Don't refactor, restyle, or "improve" code outside the issue you're working on. If you spot something worth doing, open an issue instead of doing it.
- Prefer the blueprint's safe default over its upgrade until the default works end to end.
- No speculative abstractions, config options, or tests beyond what the demo needs.

## Tasks (GitHub Issues)

Tasks live in GitHub Issues on `leeandyg/calhacks-2026`. Every change maps to an issue.

1. **Find work:** `gh issue list --assignee @me`, or pick an unassigned issue in your area: `gh issue list --label area:<audio|3d|ai|sensors|infra|pitch> --search "no:assignee"`. Labels `first-hour`, `core`, and `stretch` set priority: finish every `core` issue before starting a `stretch` one. `blocked` marks issues waiting on something.
2. **Claim it** before starting: `gh issue edit <N> --add-assignee @me`. Read the issue and any linked comments.
3. **Do only that issue** on a feature branch (see Git below).
4. **Mark it complete** by opening a PR whose body contains `Closes #<N>`. The issue closes when the PR merges. If an issue is finished without code (research, keys, setup), close it with a note: `gh issue close <N> -c "<what was done>"`.
5. **New work you discover** becomes a new issue (`gh issue create`), not part of the current PR.
6. If blocked, comment on the issue saying what blocks it and move on.

## Code layout

- Folder owners are listed in README "Layout". Stay in your folder; changes to `src/scene/scene.ts` (the shared contract) need a PR the AI owner reviews.
- The room view and the audio engine only render the scene store. Change the scene through `setScene` / `applyOps`, never by mutating objects or reading positions from meshes.
- API keys are read only in `api/` (server side). Nothing in `src/` may use a secret.
- Never set `sound.assetId` outside the resolver (`src/audio/resolve.ts`), except in hand-made presets or recordings. Objects without one are resolved automatically: a pack sound, or a `gen:` id that is generated with ElevenLabs (each generation costs credits).
- Relative imports use `.js` extensions (`./scene.js`) so `api/` works on Vercel.
- Check with `npm run build` before opening a PR.

## Git

- Never commit directly to `main`. One branch per issue: `feat/<N>-short-slug`, `fix/<N>-short-slug`, or `chore/<N>-short-slug`.
- Small, focused commits with imperative messages ("Add HRTF panner to sound objects").
- Before opening a PR: `git fetch && git rebase origin/main`, make sure it builds and runs.
- Open PRs with `gh pr create`; keep them small enough to review in a few minutes. Squash-merge.
- Never force-push `main`. Never commit secrets: keys go in `.env` (gitignored); add new variable names to `.env.example`.
- Don't commit large raw audio; trim and encode loops (mp3/ogg) before adding them to the sound pack.

## Shared docs

Update these in the same PR when a change warrants it:

- **Blueprint**: when scope, architecture, or the scene contract changes.
- **README.md**: when setup or run steps change.
- **.env.example**: when a new env variable is needed.
- **CLAUDE.md and AGENTS.md**: when team conventions change. Keep the two files identical.
