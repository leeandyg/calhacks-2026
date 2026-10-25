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
- The browser picks the world agent backend with `?mode=local|cloud` (default `cloud`; read once in `src/ai/mode.ts` like `?demo`, no UI control) and tags every `/api/scene` and `/api/world` call with it. `?mode=cloud` forces Claude Managed Agents (#86) via `ANTHROPIC_API_KEY`, running code only in its remote sandbox. `?mode=local` forces the self-hosted Node Agent SDK worker (#114) via `WORLD_AGENT_URL` and `WORLD_AGENT_API_KEY`, running generated pxl/chirp code only in its dedicated container, never in the app server or browser. Each mode returns a clear 503 when its backend is unconfigured and never silently falls back to the other (`api/world.ts` `agentSettings`); a request with no mode keeps the legacy worker-then-cloud precedence for tests and direct callers. Both backends keep the same model, scene and session/events/files protocol; consume validated manifests and compiled PNG/audio through the signed session proxy. Preserve the canonical scene and resolver ownership of sound IDs. Media metadata belongs in browser art/audio state, never model-written JavaScript in the frontend.
- Do not set up or run the local agent. Most of the team has no Docker and does not want to run the worker, so never install Docker, pull or build images, or add dependencies to stand up the self-hosted worker, and never attempt to provision it — there should be no attempt that results in the local agent being set up. Develop and demo on `?mode=cloud` (the managed agent). Owners outside the local-agent area may own and change the app code and the `api/` env/key wiring, but never the local worker setup; standing up `?mode=local` is the local-agent owner's responsibility alone.
- New live worlds (#91) start from an empty canonical scene, never the starter fixture. Recorded rooms load only through the four explicit captured demo choices or `?demo`. Keep the fixed floor/wall slabs and flush corners for every generated theme; `openAir` cannot hide structure. Managed source art follows object IDs across moves and never falls back to stock props. Explicit fallback-AI additions to these rooms paint only their missing sprites; a failed new painting may use stock geometry without replacing original managed artwork.
- The Gemini live pxl path (#76) generates art only in `api/` and `server/`, executing model-written code only inside the QuickJS/WASM renderer, never Node `eval`/`vm`. The Agent SDK path compiles pxl/chirp only in the separate worker container. Keep PNGs in `src/art/` browser state; scene JSON carries only `room.art` and canonical `room.terrain`. For self-hosted creation, run environment and source-asset jobs concurrently and render each validated branch as soon as it is ready; late terrain goes through the canonical store without resetting manual edits. The Gemini fallback retains its existing pipeline. Keep waiting portals tied to canonical source positions.
- Never set `sound.assetId` outside the resolver (`src/audio/resolve.ts`), except in hand-made presets or recordings. Objects without one are resolved automatically: a pack sound, or a `gen:` id that is generated with ElevenLabs (each generation costs credits).
- Relative imports use `.js` extensions (`./scene.js`) so `api/` works on Vercel.
- Check with `npm run build` before opening a PR.

## Frontend (pixel room)

Read and follow [LAYOUT.md](LAYOUT.md) before changing the room, source objects, camera, or interactions. Keep the frontend to the room, two plain left/right rotation arrows beside it, one BorderBeam-wrapped prompt bar with its status line, and an Assets panel pinned top-right (same BorderBeam frosted style) that lists each sound source with its sprite, label, a live volume slider, a hide-from-environment toggle and a delete button. Hiding removes a source from the environment — its prop and portal stop rendering (view-only state in `useRoomStore`) and it goes silent (`set_muted`) — reversibly; volume and delete go through `applyOps`. A fresh page shows the centered prompt and four captured demo choices. After the first submission, show the fixed empty shell with the img-fx loading mosaic on its floor and two visible walls, with the prompt below; this is view-only and adds no scene content. Stop the mosaic and reveal generated content, rotation arrows and Assets panel as soon as the first validated creation branch is ready (the other branch continues) or a demo is selected. Errors before any result hide the loading shell and recenter the prompt. The rotation arrows stay above the Assets panel so they remain clickable. Prompt submission or demo selection unlocks audio; there is no Enter-room overlay. The captured choices are Rainy café, Beach, Cyberpunk city and Zen garden; legacy preset/recorded prompt replay stays in `?demo`.

- Keep view rotation separate from canonical source positions and audio: rotation arrows change only the visual view and bear direction, never listener orientation or panner positions. Source drags still move their sound through the canonical scene store. Room rotation is manual only, through the arrows; no edge-triggered, delayed, or automatic turns.
- No shadows and no decorative non-source objects, except the persistent Berkeley bear listener avatar at the room center. The avatar is view-only, sits on canonical terrain, and keeps its reference silver/black/red headphones unchanged across themes; it is never a scene sound source. Keep its permanent You row in Assets even with zero sound sources; it has no hide/delete/volume controls. Manual room rotation selects two front and two back bear views and updates the sidebar portrait. Agent-created/explicitly moved sources reserve a one-meter center radius plus their scaled half-width; agents choose scale from 1x to 4x, while unrelated manual state stays untouched. Every other model is one sound object.
- Optional floating voice controls share the original scene/controller through a portal. Hey agent listening is opt-in cloud transcription with visible mic state and explicit stop controls; unaddressed speech never reaches the room agent.
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
