# AI Spatial Soundscape

CalHacks 13.0 project. Describe a place, and an agent builds a 3D room of spatial sound sources you can hear (binaural, over headphones) and drag around. The agent keeps the room tuned while you work.

Live: https://calhacks-2026.vercel.app

See [the blueprint](./AI%20Spatial%20Soundscape%20—%20CalHacks%2013.0%20Blueprint.md) for the plan, scene contract, and team split.

## Stack

- Frontend: Vite, React, TypeScript, React Three Fiber + drei, zustand, zod, Tailwind, BorderBeam. A pixel-art isometric room (see [LAYOUT.md](LAYOUT.md)): drag a prop to move its sound, click it to mute, turn the room with the arrows (your ears turn with it), and type into the prompt bar. A prop shows "generating…" while ElevenLabs makes its sound.
- Audio: Web Audio API (one HRTF `PannerNode` per sound object, driven by the scene store)
- AI: Claude Managed Agents for pxl/chirp worlds when configured; Gemini 3.8 Flash remains the fallback backend when no Anthropic key is set

## Setup

```sh
npm install
cp .env.example .env   # PowerShell: Copy-Item .env.example .env
npm run check:gemini   # after adding GEMINI_API_KEY to .env
npm run dev            # http://localhost:5173, serves api/ too
npm run build          # typecheck + production build
npm test               # scene store, layout and room unit tests (vitest)
```

Browser tests need the dev server running (set `TEST_URL` if it isn't on :5173; `PLAYWRIGHT_CHANNEL=chrome`
uses installed Chrome): `npm run test:browser`, `test:frontend`, `test:window` and `test:prompt`.

Create an API key in [Google AI Studio](https://aistudio.google.com/apikey) and set
`GEMINI_API_KEY` in `.env`. For sounds the pack doesn't have, also set `ELEVENLABS_API_KEY`
(a key restricted to Sound Effects is enough); without it those sounds fall back to the closest
pack sound. Restart the dev server after changing `.env`. On Vercel, add the same environment
variables to the deployment's environment and redeploy.
Node.js 24 is recommended; on Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

`POST /api/scene` sends the prompt and current scene to `gemini-3.8-flash`, which calls
`create_scene` or `edit_scene`. The endpoint validates tool arguments with Zod,
clamps positions to room bounds, and retries invalid output once. Transient provider
and connection errors get up to two retries with increasing delays (about 1s, then
2s, with jitter), with a 20-second timeout per attempt. Timeouts return HTTP 504;
provider overload returns HTTP 503, and quota errors return HTTP 429. A new environment
request creates a world from the empty fixed structure; follow-up changes return edit ops so manual
placements survive. Try "rainy cafe, I'm writing an essay", then "make the rain quieter".

New scenes place masking beds close and in different directions, with event sounds
farther away and quieter. Sound descriptions exclude intelligible speech. These
defaults never rearrange manually positioned objects during unrelated edits.
`npm run check:placement` runs six live requests: cafe, forest, and bedroom creation,
each followed by "make it rainier" after a manual move. It checks placement defaults,
speech restrictions, and preservation of existing positions and unrelated objects.

The agent only supplies `sound.query`. Valid live scenes and additions go into the
scene store without an `assetId`; the active resolver fills it with a pack sound or
a `gen:` ID for ElevenLabs. Existing resolved objects keep their assets during edits.
Six local presets (Rainy café, Bedroom, Forest, Library, Cabin, Coast) are available only in
explicit `?demo` mode. Live requests never load a preset or recorded edit on failure. The app
starts with an empty canonical scene and a centered prompt; errors keep it empty, or preserve
the current generated world and prompt for retry. Missing asset IDs in valid AI output are
resolved normally and do not trigger offline replay.

## Offline demo

Run `npm run dev` locally before disconnecting from the internet, open
http://localhost:5173/?demo and submit a preset or recorded prompt. The app and sound pack are served
from your computer; with `?demo` the prompt bar makes no Gemini requests. The deployed site still needs connectivity
to load its page and sound files; this is not a service-worker offline cache.

Type a preset name (Rainy café, Bedroom, Forest, Library, Cabin, or Coast) to load it.
For the recorded agent sequence, enter these prompts in order:

1. `Rainy Tokyo cafe, I'm writing an essay.`
2. `Make it rainier.`
3. `Push the chatter farther away and add a fireplace.`

`src/ai/recordings.ts` contains real Gemini responses captured on October 24, 2026,
with fixed local sound bindings. Replay adapts object IDs and the rain volume increase
to the current room so manual placements survive. It supports these saved interactions,
not arbitrary offline AI requests. Drop `?demo` from the URL to resume live AI requests.

Run `npm run check:offline` for preset asset checks, the recorded sequence, preservation
of manual edits, and simulated API/timeout failures. This check makes no real API calls.
Run `npm run check:audio` for sound replacement, removal, download recovery, and event
cleanup checks using a simulated audio clock; it does not play through your speakers.
Run `npm run check:reverb` for the room reverb (impulse responses and preset switching),
also with a simulated audio context.

The room reverb follows `room.reverb` (`small-room`, `large-room`, `outdoor`, `none`), which
the agent picks from the prompt. Farther sounds get more of it, which is most of what makes
distance audible.

Intermittent sounds such as cup clinks play once from the start of the clip, then wait
a fresh random silent gap from `intervalSec` before playing again. Each occurrence has
slight pitch and volume variation without exceeding the object's volume. The café
preset's cup clinks wait 8–25 seconds after each clink finishes; rain and room tone loop.

Wear headphones. The spatial effect depends on them.

## Head tracking (webcam)

Tick **Head tracking** in the demo controls and allow the camera. MediaPipe Face Landmarker runs in the
browser (frames never leave it; the model and wasm load from a CDN the first time), and turning your
head turns your ears: the sounds stay where they are in the room. The direction you face when it
starts is straight ahead; **Recenter** resets that. If your face is lost (turned away, out of frame),
the last direction holds, and when it's found again the sound glides back to where your head really
is. The status shows the current angle, e.g. "20° left". Head yaw lives in `src/sensors/headPose.ts`,
never in the scene, so saved rooms don't capture it.

## Save and load rooms with Convex

Run `npm run convex:dev` in a separate terminal and keep it running. The first run
configures a deployment and writes `CONVEX_DEPLOYMENT` and the public
`VITE_CONVEX_URL` to ignored `.env.local`. You can choose local development without
a Convex account. In another terminal, run `npm run convex:auth` once to configure
the deployment's signing keys, then start/restart `npm run dev`.

After creating a room with the prompt, name the current room and click **Save room**. Saving the same
name updates that snapshot. Choose an entry under **Saved room**, then click
**Load room** to replace the active scene. Snapshots include positions, volumes,
sound references, event intervals, listener orientation, room settings and session
state. The existing Zod scene contract validates saves and loads.

An anonymous Convex Auth session keeps each browser's library separate. Its tokens
persist across refreshes in browser storage; clearing that storage or using another
browser starts a new library. Save/load stores scene data, while sound files keep
using the existing pack, generation and cache paths.

Listing and saving never change the playing scene. A delayed load is discarded if
the room changes while it is in flight. Missing configuration or a disconnected
Convex deployment leaves local presets, AI prompts and playback available.

**Cloud project:** `calhacks-2026` in the `andylee0440` Convex team. Ask @leeandyg for an
invite, then run `npx convex login` and `npx convex dev --configure existing --team andylee0440
--project calhacks-2026`. That gives you your own cloud dev deployment in `.env.local`. Run
`npm run convex:auth` once for it.

**Production** (`nautical-dogfish-530`) is what https://calhacks-2026.vercel.app uses:
Vercel's Production environment has its public `VITE_CONVEX_URL`. Its `JWT_PRIVATE_KEY` and
`JWKS` are set (`npm run convex:auth -- --prod`); the setup script generates them without
printing them and preserves existing keys. Vercel builds with `scripts/vercel-build.mjs`
(`vercel.json`):
- With `CONVEX_DEPLOY_KEY` set (Vercel, Production only), each production build first
  runs `npx convex deploy`, so `convex/` changes go live with the site.
- Without it (previews and local builds), it's a plain `npm run build`, and `convex/` changes
  reach production only with a manual `npx convex deploy`. Previews have no Convex.

Server-side keys for Convex functions (e.g. `ELEVENLABS_API_KEY` for the sound cache) go in
each deployment's environment: `npx convex env set <NAME>` (add `--prod` for production).

`npm run check:convex` checks round-trip persistence, named updates, validation,
unauthenticated rejection and isolation between two anonymous users. It requires a
running local deployment configured in `.env.local` and creates isolated test data.

In dev, the scene store is on `window.sceneStore`, so you can try edits from the browser console:

```js
sceneStore.getState().applyOps([{ op: "move", id: "rain-1", position: [3, 1.5, 0] }])
```

## Voice agent and environment memory

Enter the room, then click **Talk to agent** to start listening and **Stop & send**
to submit the final transcript. Alternatively, hold **Ctrl+Shift+Space** while the
page is focused and the cursor is outside text fields; releasing any key in the
shortcut ends the turn. **Esc** or leaving the page cancels it. The microphone is
off between turns, and a turn is limited to 30 seconds. This shortcut works within
the active tab; a system-wide shortcut and an always-listening wake word are later work.
Allow the site's microphone permission when you first use it. No raw recordings
are saved. Ink-2 streaming transcription feeds the same command path as typed input.

Add `CARTESIA_API_KEY`, `MOSS_PROJECT_ID`, and `MOSS_PROJECT_KEY` to ignored `.env`,
then restart the dev server and reload the page. Obtain Moss project credentials
from its portal; the old `MOSS_API_KEY` placeholder is unused. Optionally set
`CARTESIA_VOICE_ID` from the Cartesia voice library, then enable **Spoken replies**
for short Sonic acknowledgements. API keys stay on the server; the browser receives
only a short-lived STT token. Configure the same variables on Vercel for a deployment.
This feature also needs the existing authenticated Convex connection. Push the new
`preferences` backend functions with `npx convex dev --once` on your configured
development project; this does not require a new production deployment.

Under **Environment memory**, choose a task and a local time bucket. Tune the room,
optionally describe what you like, and click **Remember this room**. Saving the same
task/time replaces the preference, so you can teach it a correction. Click **Use my
usual setup** to generate an environment from those preferences, and **Forget** to
remove a memory. **Current local time** uses the browser's timezone; explicit
morning/evening choices are useful when testing the demo.

You can also type or say **“Remember this for coding in the morning”**, then later
**“Set up my usual coding environment in the morning”** or **“Forget my coding
morning preference.”** Remember commands save the current room and the supplied
preference notes; they do not edit the room. Manual changes become lasting preferences
only when you explicitly remember the result. The automatic mic-noise/Pomodoro
agent (#20) and automatic feedback suggestions remain separate work.

Convex stores the user's preference records; Moss reconciles a per-user persistent
index and searches it alongside a temporary index of recent spoken commands. A
fresh Convex check excludes deleted or superseded search results. During a Moss
outage, exact task/time matches still work and the UI labels semantic recall as
unavailable. If scene AI is down, an explicit request for a usual setup can restore
its exact task/time snapshot; unrelated edits never use that replacement fallback.
Requests for an unknown “usual setup” keep the room unchanged. Ordinary
typed prompts and local presets continue if memory or voice cannot connect. Offline
demo mode makes no voice or memory calls. Delayed scene replacements are discarded
if the room changed while they were running. Safe edits use the latest scene,
preserving manual moves and mute changes; conflicting moves and removals are rejected.

Run `npm run check:agent` for provider-free memory, fallback and mic lifecycle checks.
Run `npm run check:preferences` for persistence and isolation on a local Convex backend.
To use the configured cloud development backend explicitly, append `-- --cloud-dev`;
this creates separate anonymous test identities and removes their test preference records.
With Moss credentials configured, `npm run check:moss` verifies real semantic recall,
persistence and filtered reload, then deletes its isolated test index.

## Sound pack

`public/sounds/` holds the sound pack: 30 s seamless mono loops (beds), short one-shots (events), `manifest.json` and `CREDITS.md`. To rebuild it (needs ffmpeg and `FREESOUND_API_KEY` in `.env`):

```sh
npm run sounds:fetch   # downloads 3 candidates per sound into assets/raw/<sound>/ (gitignored)
# listen and delete the candidates you don't want; keep one per folder
npm run sounds:pack    # builds public/sounds/ + manifest.json + CREDITS.md
```

Add a sound by adding it to `SOUNDS` in `scripts/fetch-freesound.mjs` and `TAGS` in `scripts/pack.mjs`. Tags are what the resolver matches the agent's descriptions against.

To replace a weak sound with an ElevenLabs-generated one (rain_window, fireplace, cup_clink and sparrow already are):

```sh
node --env-file=.env scripts/generate-pack.mjs fireplace "crackling fireplace in a small wooden cabin"   # costs credits
node scripts/generate-pack.mjs fireplace "<prompt>" --file take.mp3   # or use a take you already have
npm run sounds:pack -- fireplace   # rebuilds only that sound; the rest of the pack is kept
```

The Freesound candidates move to `assets/raw/<sound>/_unused/`; move them back and rebuild to undo.

### Sounds on command

The agent only describes sounds (`sound.query`). In the browser, `src/audio/resolve.ts` fills in `assetId` for every object that doesn't have one, **library first**: a pack sound when the tags match well; otherwise the sound the Claude agent composed for that object with chirp (`managed:…`); otherwise `gen:<kind>:<query>`. A `gen:` id plays the closest pack sound unless live ElevenLabs generation is switched on with `VITE_ELEVENLABS_SOUNDS=on` (then v2 for 15 s loops, v3 for 2 s one-shots). Generated and agent sounds are converted to mono and matched to pack loudness, and fall back to the closest pack sound if they can't load, including after a reload, when the page no longer has an agent's file.

With Convex connected (see **Save and load rooms with Convex**), each generated sound is stored once in Convex file storage (`convex/sounds.ts`) and shared by every browser and deployment, so a description is paid for once. Two browsers asking for the same new sound at once wait for one generation. Set the key in the Convex deployment, not just `.env`:

```sh
grep '^ELEVENLABS_API_KEY=' .env | cut -d= -f2- | npx convex env set ELEVENLABS_API_KEY        # dev deployment
grep '^ELEVENLABS_API_KEY=' .env | cut -d= -f2- | npx convex env set ELEVENLABS_API_KEY --prod # production
```

Without Convex, or if it fails, the browser generates through `GET /api/sound?kind=bed|event&q=...`, which only the browser and Vercel's CDN cache. `useSoundStatus` in `src/audio/generated.ts` says which sounds are still generating.

Run `npm run check:resolver` to see which descriptions use a pack sound and which get generated; it reads the local manifest and makes no API calls. Each generation costs ElevenLabs credits (40 per second of audio). `scripts/test-elevenlabs.mjs` is the listening test used to pick the models; it writes a comparison page to `assets/raw/elevenlabs/listen.html`.

## Layout

| Path | What | Owner |
| --- | --- | --- |
| `src/scene/` | Scene schema (`scene.ts`), store with `setScene` / `applyOps` (`store.ts`), grid placement rules (`layout.ts`), presets and fixtures | @OakleySun |
| `src/scene/SavedRooms.tsx`, `convex/` | Named scene save/load and anonymous session ownership | @OakleySun |
| `src/audio/` | Store-driven audio engine, AudioContext, sound manifest, resolver (`resolve.ts`), generated sounds (`generated.ts`) | @leeandyg |
| `src/sensors/` | Head pose store (`headPose.ts`); webcam head tracking with MediaPipe (`webcamHeadTracking.ts`, `headYaw.ts`) | @leeandyg |
| `src/room/` | Pixel room view, view-only camera/rotation store (`useRoomStore.ts`), "generating…" labels (see [LAYOUT.md](LAYOUT.md)) | @coinleftt |
| `src/ui/` | Prompt-first creation flow, prompt bar and rotation arrows | @coinleftt |
| `src/ai/`, `api/scene.ts` | Browser client and server endpoint for `POST /api/scene` | @OakleySun |
| `api/sound.ts` | `GET /api/sound`: ElevenLabs generation for sounds the pack lacks | @leeandyg |
| `public/sounds/` | Sound pack + `manifest.json` | @leeandyg |

`api/*.ts` files export `POST` or `GET(request: Request): Response`. They run as Vercel functions in production and through a Vite middleware in dev. API keys are read there from `process.env`, never in `src/`.

## Claude Managed Agent (#86)

Set `ANTHROPIC_API_KEY`, `ANTHROPIC_AGENT_ID` and `ANTHROPIC_ENVIRONMENT_ID` in the server's
`.env` (or deployment environment), then restart the dev server. The supplied IDs are in
`.env.example`. With this key configured, the prompt uses the **AI Pixel World Director** managed
agent instead of the Gemini scene/art pipeline. `?demo` stays offline. No provider key reaches
frontend code, HTML, client requests or generated assets.

`AGENT_CONFIG.yaml` records the supplied architecture. Each new session uses that file's system
instructions; the managed agent resource owns its model and tool configuration (currently
Claude Opus 5.5, low effort, with the built-in agent toolset). The agent reads the actual pxl and
chirp skills, writes and builds code inside Anthropic's sandbox, and publishes PNG strips, audio
and a validated scene manifest. Generated JavaScript is never executed by this app's backend or
browser. The existing room/terrain, manual rotation, drag/mute behavior, portals and HRTF audio
engine consume the compiled results. Every theme retains the fixed 10×10×7 shell, 0.42-block slabs and complete flush corners.
Generated artwork paints its real surfaces; legacy `openAir` metadata cannot hide the walls. Sprite/environment strips animate in the room's pixel
pass; event-source animation plays with its audio and mute freezes source motion.

`POST /api/scene` starts a session or sends a follow-up event and returns a signed session token.
Authenticated voice/memory turns through `POST /api/agent` use the same flow, passing recalled
preferences as user data while the current prompt and manually edited scene take precedence.
`GET /api/world?action=stream` forwards safe progress, replays missed history and deduplicates
live events. The browser reconnects after each short stream while the remote job continues;
functions do not need to remain open for the full generation. `POST /api/world` retrieves the
finished scene and assets, waiting for delayed file publication. The same endpoint proxies only
image/audio files belonging to the signed session. Tokens expire after 24 hours. The first room
stays hidden until its output validates and its images have loaded; errors preserve the current
room and prompt. Follow-up prompts reuse the managed session and receive the latest canonical
scene, including manual positions and mute settings. New sound IDs are assigned only by the
existing resolver, using the agent's chirp files.

Run `npm test` for provider/protocol validation and `npm run test:managed` with the dev server
running for deterministic browser coverage (no API credits). `npm run check:managed` reconnects
the completed live run in `test-results/managed-live-run.json`, exercising real session history,
image/audio downloads and animation without rebuilding assets. If that saved run is absent, the check creates and records a fresh managed world;
delete the ignored run file to request a fresh end-to-end generation. This check spends API credits. Generation can take several minutes because the agent builds
both artwork and audio; progress remains visible. The runtime asset bindings live in the current
page, matching the app's existing painted-art lifecycle.

## Live environment art (#76)

The page starts with only a centered prompt, including in `?demo`. The first request sends no
current scene. While creation runs, progress stays above that prompt. Successful creation reveals
the room and rotation arrows and moves the prompt below the room; errors leave the centered
prompt editable. Submitting the prompt unlocks audio, so no Enter-room overlay is needed.

Live creation first drafts the soundscape through `/api/scene`, then calls `POST /api/environment`.
Gemini reasons about the place, its materials, light and ground height, then five painters generate
distinct pxl paintings for the floor and each wall. An NDJSON stream delivers the plan and each PNG
as it finishes. The interactive room displays the terrain and paintings before a second scene pass
places the physical sound sources in that environment. `/api/sprite` paints each source, while a
portal and a “generating…” label hold its position; the finished prop emerges through that portal.
Follow-up edits preserve the environment. Only explicit `?demo` mode uses preset rooms and props; live failures preserve the current scene.

The art agents receive the pinned [pxl skill and reference](https://github.com/uilianks/pxl)
(MIT), render their code, and get errors, lint coordinates and a PNG preview for up to two further
calls when the deadline allows. All model code and pxl's platform-independent core run inside
QuickJS/WASM in a separate process, without host functions, module imports, environment variables,
filesystem or network APIs. Each render has a 96 MB interpreter heap, an 8-second interrupt and a
12-second process kill limit. The trusted parent only encodes bounded pixel data as PNG.

`npm install`, `npm install`, `npm run dev` and `npm run build` generate the sandbox bundle automatically. Art uses
`GEMINI_API_KEY`; optional `GEMINI_ART_MODEL` overrides its default `gemini-3.8-flash`.
`vercel.json` reserves 120 seconds for environment planning/painting and 90 seconds for a sprite,
and includes the renderer, pxl documentation and WASM dependencies in each function bundle.
These routes require a deployment that supports those durations; streaming alone does not extend
a function's deadline. Five textures are painted concurrently, then up to four sprites at a time.

Matching descriptions, mounting, palette and environment reuse a bounded seven-day `/tmp` cache,
including matching concurrent requests. This cache is local to a warm server instance; it does not
prevent regeneration on other Vercel instances or after a cold start. Cross-instance storage remains
future work. Partial surface failures retain the paintings that succeeded; failed sprites use stock
props. Run `npm run check:art` for renderer isolation/cache checks and `npm run test:art` with the
dev server running for the environment/terrain/portal browser flow (no live generation).
