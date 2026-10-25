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
- The room view and the audio engine only render the scene store (`src/scene/store.ts`). Change the scene through `setScene` / `applyOps` (both all-or-nothing, returning `{ ok }` or `{ ok: false, error }`), never by mutating objects or reading positions from meshes. The store snaps positions onto the room grid with `src/scene/layout.ts`.
- The room grid is fixed (1 block = 1 m, default 10 × 10 × 7); Gemini never chooses it. Camera and rotation are view-only state in `src/room/useRoomStore.ts`.
- App API keys are read only server side in `api/` or `convex/`; the separate self-hosted worker reads its own credentials from its container environment. Nothing in `src/` may use a secret.
- The self-hosted Node Agent SDK worker (#114) is the live backend when `WORLD_AGENT_URL` and `WORLD_AGENT_API_KEY` are configured. Run generated pxl/chirp code only in its dedicated container, never in the app server or browser. The worker retains the same model, scene and session/events/files protocol. With the worker URL cleared, Claude Managed Agents (#86) remains available via `ANTHROPIC_API_KEY`, running code only in its remote sandbox; consume validated manifests and compiled PNG/audio through the signed session proxy. Preserve the canonical scene and resolver ownership of sound IDs. Media metadata belongs in browser art/audio state, never model-written JavaScript in the frontend.
- New live worlds (#91) start from an empty canonical scene, never the starter fixture. Only explicit `?demo` uses preset content. Keep the fixed floor/wall slabs and flush corners for every generated theme; `openAir` cannot hide structure. Managed source art follows object IDs across moves and never falls back to stock props.
- The Gemini live pxl path (#76) generates art only in `api/` and `server/`, executing model-written code only inside the QuickJS/WASM renderer, never Node `eval`/`vm`. The Agent SDK path compiles pxl/chirp only in the separate worker container. Keep PNGs in `src/art/` browser state; scene JSON carries only `room.art` and canonical `room.terrain`. Render the environment before source generation, and keep waiting portals tied to canonical source positions.
- Never set `sound.assetId` outside the resolver (`src/audio/resolve.ts`), except in hand-made presets or recordings. Objects without one are resolved automatically: a pack sound, or a `gen:` id that is generated with ElevenLabs (each generation costs credits).
- Relative imports use `.js` extensions (`./scene.js`) so `api/` works on Vercel.
- Check with `npm run build` before opening a PR.

## Frontend (pixel room)

Read and follow [LAYOUT.md](LAYOUT.md) before changing the room, source objects, camera, or interactions. Keep the frontend to the room, two plain left/right rotation arrows beside it, and one BorderBeam-wrapped prompt bar with its status line. A fresh page shows only the centered prompt; reveal the room and rotation arrows and move the prompt below the room after successful creation. Prompt submission unlocks audio; there is no Enter-room overlay. No preset or demo controls; the offline demo is `?demo`.

- Keep view rotation separate from canonical source positions. Room rotation is manual only, through the arrows; no edge-triggered, delayed, or automatic turns.
- No shadows and no decorative non-source objects. Every model is one sound object.
- Integer Square/Rectangle grid counts with independent wall height; walls and floor share the fixed `SLAB_THICKNESS`. Plain rooms are gray and unmarked; forest has sparse seeded dirt/moss pixels that fade with their walls.
- Pixelate the whole room on one shared pixel grid with the pxl palette, antialiasing off. Keep pixel rendering in `src/room/RoomScene.tsx`; root `index.html` -> `src/main.tsx` -> `src/App.tsx` is the only entry. Never substitute the static `art/` export for the interactive room.
- Source windows keep one complete corner segment at each wall end, including after room resize and scaling.
- Check with `npm run build`, `npm test`, the `check:*` scripts, and with the dev server running, `npm run test:browser`, `test:frontend`, `test:window` and `test:prompt` (`PLAYWRIGHT_CHANNEL=chrome` uses installed Chrome; `TEST_URL` picks the server).

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
