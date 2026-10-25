# AI Spatial Soundscape

CalHacks 13.0 project. Describe a place, and an agent builds a 3D room of spatial sound sources you can hear (binaural, over headphones) and drag around. The agent keeps the room tuned while you work.

Live: https://calhacks-2026.vercel.app

See [the blueprint](./AI%20Spatial%20Soundscape%20—%20CalHacks%2013.0%20Blueprint.md) for the plan, scene contract, and team split.

## Stack

- Frontend: Vite, React, TypeScript, React Three Fiber + drei, zustand, zod, Tailwind, BorderBeam. A pixel-art isometric room (see [LAYOUT.md](LAYOUT.md)): drag a prop to move its sound, click it to mute, turn the room visually with the arrows (audio stays fixed), and type into the prompt bar. A prop shows "generating…" while ElevenLabs makes its sound.
- Audio: Web Audio API (one HRTF `PannerNode` per sound object, driven by the scene store)
- AI: self-hosted Node.js Claude Agent SDK worker for pxl/chirp worlds; Claude Managed Agents remains a rollback option; the existing Gemini fallback is preserved

## Setup

```sh
npm install
cp .env.example .env   # PowerShell: Copy-Item .env.example .env
docker compose -f compose.agent.yaml up -d --build  # after setting keys below
npm run dev            # http://localhost:5173, serves api/ too
npm run build          # typecheck + production build
npm test               # scene store, layout and room unit tests (vitest)
```

Browser tests need the dev server running (set `TEST_URL` if it isn't on :5173; `PLAYWRIGHT_CHANNEL=chrome`
uses installed Chrome): `npm run test:browser`, `test:frontend`, `test:window` and `test:prompt`.

For the self-hosted world director, follow the setup below. For the Gemini-only path, clear
`WORLD_AGENT_URL`, leave `ANTHROPIC_API_KEY` empty, then create an API key in [Google AI Studio](https://aistudio.google.com/apikey) and set
`GEMINI_API_KEY` in `.env`. For sounds the pack doesn't have, also set `ELEVENLABS_API_KEY`
(a key restricted to Sound Effects is enough); without it those sounds fall back to the closest
pack sound. Restart the dev server after changing `.env`. On Vercel, add the same environment
variables to the deployment's environment and redeploy.
Node.js 24 is recommended; on Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

The browser chooses the world agent with a `?mode` query param (default `cloud`): `?mode=cloud`
uses the Claude Managed Agents backend (`ANTHROPIC_API_KEY`), and `?mode=local` uses the
self-hosted worker (`WORLD_AGENT_URL`/`WORLD_AGENT_API_KEY`). The chosen backend must be
configured or the request returns a clear 503; neither mode silently falls back to the other.
Most contributors stay on `?mode=cloud` and need no Docker or local worker.

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

Four fully captured rooms are available from the buttons above the initial prompt, then from
the **Templates** card above Visited places once a room appears: **Rainy café**,
**Beach**, **Cyberpunk city**, and **Zen garden**. Each has exactly three sounds (two beds and one random event),
pixel artwork, and fixed starting placements. Complete bundles live in `public/demo/<id>/`:
`scene.json`, `assets.json`, capture/provenance notes, PNGs and compressed MP3s. A source the sound
library covers plays that library sound straight from `public/sounds/` (no copy in the bundle), so
library updates reach the demo rooms; only sounds the library lacks are bundled. Assets warm on page
load; selecting a room loads local files without generation calls or a Convex dependency.
The room remains interactive. Normal typed/voice AI follow-ups use the configured services;
`?demo` keeps the existing recorded offline edits. Run locally before disconnecting for a demo
that does not depend on hosting connectivity.

To capture a missing bundle, configure the existing managed-generation credentials, install ffmpeg (or set
`FFMPEG_PATH`), and run `node scripts/capture-demo.mjs cafe beach cyberpunk zen`. The script resumes
completed sessions from ignored `.convex/demo-capture/`, preserves existing reviewed bundles, and writes portable assets to
`public/demo/`; provider tokens stay in the ignored directory. Keep the captured files in Git
so teammates and deployments use the same rooms. `npm run test:captured` checks local loading,
room switching, artwork and audio without generation calls.

Use `node scripts/capture-demo.mjs --staging cafe zen` to recapture rooms into ignored
`.convex/demo-staging/public/demo/` while keeping the current bundles available. Review the staged
scene, sound mix and artwork before copying it into `public/demo/`. The refreshed beach records
hashes of its preserved scene, source icons and sound files/bindings; `test:captured` verifies them.
For a coherent beach repaint, run `node scripts/repaint-beach.mjs`. It paints one continuous
640×112 panorama, cuts it in north/east/south/west order, matches corner pixels and the sandy
floor edges, and preserves the existing scene, sounds and source art. Review all four room
orientations before accepting it. `--reuse` reapplies the last staged result without another
provider call; prior backgrounds are backed up under ignored `.convex/beach-panorama/`.

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

Turn on **Head tracking** in Settings and allow the camera. MediaPipe Face Landmarker runs in the
browser (frames never leave it; the model and wasm load from a CDN the first time), and turning your
head turns your ears: the sounds stay where they are in the room. The direction you face when it
starts is straight ahead; Settings shows the current angle beside the head-tracking switch. If your face is lost (turned away, out of frame),
the last direction holds, and when it's found again the sound glides back to where your head really
is. The status shows the current angle, e.g. "20° left". Head yaw lives in `src/sensors/headPose.ts`,
never in the scene, so saved rooms don't capture it.

## Save and load rooms with Convex

Run `npm run convex:dev` in a separate terminal and keep it running. The first run
configures a deployment and writes `CONVEX_DEPLOYMENT` and the public
`VITE_CONVEX_URL` to ignored `.env.local`. You can choose local development without
a Convex account. In another terminal, run `npm run convex:auth` once to configure
the deployment's signing keys, then start/restart `npm run dev`.

Generated rooms are automatically saved in **Visited places**; selecting a captured template never adds one.
Before a place is shown, saved places appear as a plain list below the centered prompt. Rooms are named by the environment AI agent as part of the same generation request
(`environment.title`). Older recordings without a title retain their existing fallback label. Later edits update that place; switching environments
creates a separate entry. Click an entry to reopen it, or **New Place** to start from an empty
room. Saving uses the existing Convex `savedScenes.save` function. Repeated environment labels
get a numbered suffix so each visit keeps its own snapshot. Snapshots include positions, volumes,
sound references, event intervals, listener orientation, room settings and session
state. The existing Zod scene contract validates saves and loads.

An anonymous Convex Auth session keeps each browser's library separate. Its tokens
persist across refreshes in browser storage; clearing that storage or using another
browser starts a new library. Save/load stores scene data, while sound files keep
using the existing pack, generation and cache paths.

**Claude worlds are kept too** (`convex/agentWorlds.ts`, #112). A Claude world's paintings, sprites and chirp
sounds live in Anthropic's session storage for 24 hours, and only the page that created them knows them. So
right after a world arrives, the browser asks Convex to copy every file into Convex file storage (once per
file) and keep one manifest per world (`room.art`), merging later edits. Reopening a scene that names an
`agent-…` world the page doesn't have (after a reload, **Load room**, or Moss's "usual setup") reinstalls it
from Convex, and a `managed:` sound the page doesn't know plays from its kept copy; without Convex it plays the
closest library sound. No key is involved: Convex fetches the files from the production site's own
`/api/world` proxy with the world's signed token, and accepts a world id only for that token's session.

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

Create a room with the prompt, then click **Talk to agent** to start listening and **Stop & send**
to submit the final transcript. Alternatively, hold **Ctrl+Shift+Space** while the
page is focused and the cursor is outside text fields; releasing any key in the
shortcut ends the turn. **Esc** cancels voice; losing focus cancels a held shortcut.
Click-activated commands can continue while you use another tab. The microphone is
off between explicit turns, and a turn is limited to 30 seconds. This shortcut works
within the active tab; there is no system-wide keyboard shortcut.
Allow the site's microphone permission when you first use it. No raw recordings
are saved. Ink-2 streaming transcription feeds the same command path as typed input.

For homework, click **Float controls** to open a small voice controller. On supported
desktop browsers it stays above other windows; otherwise it opens as a normal separate
window. Its **Talk to agent** button ends a command automatically, and its **Stop voice**
button cancels listening or processing. Keep the original soundscape tab open.

Enable **Hey agent** in either window to keep listening while you work elsewhere.
Say **“Hey agent, mute rain”** in one sentence, or **“Hey agent”** followed by your command.
This is an opt-in Cartesia transcription gate, not an offline wake-word model: the mic
stays active and audio uses Cartesia transcription while enabled. Other speech is
discarded before the room agent and is not shown as a command. Listening pauses during
processing/replies and resumes afterwards; standby does not lower the room volume.
Disable **Hey agent**, press **Stop voice** / **Esc** in the controller, or close the
floating window to stop. Closing/reloading the original page also releases the mic.
Provider/mic errors stop wake listening. Sleeping/closing the browser suspends this
feature; desktop browser background-media policies still apply. No new keys are needed.
Run `npm run test:background-voice` for fake-media, cross-tab, floating-window and
microphone-cleanup checks without provider charges.
On Windows this uses an isolated desktop Edge window; set `PLAYWRIGHT_CHANNEL=chrome`
to check desktop Chrome instead.

Voice startup preloads the worklet file and a short-lived transcription token without
opening the mic. Permission, audio setup and connection run in parallel; initial
audio is buffered and sent at real-time speed. A quiet ready cue and explicit
Listening/Understanding/Updating/Done states show progress. Enable **Finish automatically**
for a click-activated turn that ends when Ink-2 confirms your sentence is complete;
the hold shortcut always uses release-to-send. Automatic mode displays live captions.
It does not listen between turns. **Edit transcript** lets you correct and reapply a
room command; it refuses to overwrite a room you have manually changed meanwhile.

**Mute rain**, **unmute rain**, **turn rain up/down**, **stop**, **unmute all** and
**undo** run locally through validated scene operations when the target is clear.
Unknown or ambiguous requests retain the scene agent and Moss path. Undo restores only the
last command's room change and refuses after later manual edits. While listening or
speaking, the soundscape and its reverb fade down by 12 dB, then return to their
previous level; saved object volumes and mutes are never changed by this ducking.
Optional spoken confirmations play as 24 kHz mono PCM arrives rather than waiting
for an entire file. Esc or a new voice turn interrupts the reply.

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

To use a recording you picked on freesound.org yourself, save its original download (wav, flac, aif or mp3, keeping Freesound's `<id>__<author>__<name>` file name) as the only file in `assets/raw/<sound>/`, then:

```sh
npm run sounds:fetch -- --describe   # records author and license for hand-downloaded files
npm run sounds:pack -- <sound>       # rebuilds only that sound
```

If only part of a recording is usable (a fan spinning up, one bird call out of three), set its window in `CROP` in `scripts/pack.mjs`.

To replace a weak sound with an ElevenLabs-generated one (sparrow already is):

```sh
node --env-file=.env scripts/generate-pack.mjs fireplace "crackling fireplace in a small wooden cabin"   # costs credits
node scripts/generate-pack.mjs fireplace "<prompt>" --file take.mp3   # or use a take you already have
npm run sounds:pack -- fireplace   # rebuilds only that sound; the rest of the pack is kept
```

The Freesound candidates move to `assets/raw/<sound>/_unused/`; move them back and rebuild to undo.

### Sounds on command

The agent only describes sounds (`sound.query`). In the browser, `src/audio/resolve.ts` fills in `assetId` for every object that doesn't have one, **library first**: a pack sound when the tags match well; otherwise the sound the Claude agent composed for that object with chirp (`managed:…`); otherwise `gen:<kind>:<query>`. A `gen:` id plays the closest pack sound unless live ElevenLabs generation is switched on with `VITE_ELEVENLABS_SOUNDS=on` (then v2 for 15 s loops, v3 for 3 s one-shots with room for natural decay; requests ask for natural, dry recordings of one physical source, with prompt influence 0.5). Generated and agent sounds are converted to mono and matched to pack loudness, and fall back to the closest pack sound if they can't load, including after a reload, when the page no longer has an agent's file.

Generated and agent (chirp) sounds are converted to mono with protection against stereo phase cancellation and normalized to pack loudness, including clips shorter than 400 ms and quiet Foley that needs up to 40 dB of gain. Silent output takes the existing pack fallback path. Events use a 2 m distance reference (beds keep 1 m), giving the direct sound of perimeter events about 6 dB more level without changing the saved volume, mute, position or random scheduling. Existing cached recordings receive these playback fixes after a page refresh; new descriptions use the improved generation request. Cached files are reused, not automatically regenerated at additional cost.

With Convex connected (see **Save and load rooms with Convex**), each generated sound is stored once in Convex file storage (`convex/sounds.ts`) and shared by every browser and deployment, so a description is paid for once. Two browsers asking for the same new sound at once wait for one generation. Set the key in the Convex deployment, not just `.env`:

```sh
grep '^ELEVENLABS_API_KEY=' .env | cut -d= -f2- | npx convex env set ELEVENLABS_API_KEY        # dev deployment
grep '^ELEVENLABS_API_KEY=' .env | cut -d= -f2- | npx convex env set ELEVENLABS_API_KEY --prod # production
```

Without Convex, or if it fails, the browser generates through `GET /api/sound?kind=bed|event&q=...`, which only the browser and Vercel's CDN cache. `useSoundStatus` in `src/audio/generated.ts` says which sounds are still generating.

Run `npm run check:resolver` to see which descriptions use a pack sound and which get generated; it reads the local manifest and makes no API calls. `npm run check:generated` checks normalization in headless Chromium without using speakers or provider credits. Each generation costs ElevenLabs credits (40 per second of audio). `scripts/test-elevenlabs.mjs` is the listening test used to pick the models; it writes a comparison page to `assets/raw/elevenlabs/listen.html`.

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
| `helper/` | Optional macOS helper that brings other apps' audio (Spotify) into the room; see [helper/README.md](helper/README.md) | @leeandyg |

`api/*.ts` files export `POST` or `GET(request: Request): Response`. They run as Vercel functions in production and through a Vite middleware in dev. API keys are read there from `process.env`, never in `src/`.

## Self-hosted world director (#114)

The agent loop and all pxl/chirp builds run in a persistent **Node.js 24 + Claude Agent SDK**
Docker worker on your machine/server. Claude model inference still uses Anthropic's API;
self-hosting here moves execution and generated files off Managed Agents, not model inference.
The same model and low effort setting are retained. Toolkit installs are baked into the image,
so each turn can read their references and build immediately.

1. Copy `.env.example` to `.env` if needed. Set `ANTHROPIC_API_KEY` for inference.
2. Generate a separate worker secret with `openssl rand -hex 32` and set it as
   `WORLD_AGENT_API_KEY`. Keep it stable: it also signs the app's 24-hour session tokens.
3. Keep `WORLD_AGENT_URL=http://127.0.0.1:8787/v1` for local development. Run
   `docker compose -f compose.agent.yaml up -d --build`, then `npm run dev`.
4. Submit a room prompt. Follow-ups reuse the SDK session and the latest canonical scene.

The worker binds to localhost by default. For a deployed app, put the worker behind your HTTPS
reverse proxy, forward `/v1/*` without buffering SSE, and set `WORLD_AGENT_URL` on the app server
to that reachable origin plus `/v1`. Set the same `WORLD_AGENT_API_KEY` on both servers.
A Vercel deployment cannot reach your computer's `127.0.0.1`. Only the worker needs the model
key; the app authenticates to it with the separate shared secret. No credentials reach the browser.

New-world creation starts two SDK jobs concurrently: one paints the environment/terrain, the
other builds source sprites and audio. They share the request, fixed grid and palette, with
separate working directories and branch manifests. A `ready` stream event publishes each
validated branch through `POST /api/world` with `part: "environment"` or `part: "objects"`.
The first branch reveals the room immediately; the other appears without resetting manual
positions, volume or mute. The final manifest retains the existing `WorldOutput` contract.
A failed second branch leaves the valid first result visible with an error. Follow-up edits
reuse the source session and remain single turns. A full replacement is routed before any
asset build, then uses the same two concurrent creation jobs and first-ready rendering. Legacy cloud sessions still accept the old
complete-result flow. A single world uses two concurrent model requests; total generation time
is bounded by the slower job rather than their sum, plus coordination and loading overhead.
`npm run test:parallel` covers both completion orders, reconnects and late failure with no credits.

The named `world-agent-data` volume persists SDK transcripts, working files, published assets,
and event history across container restarts. `docker compose -f compose.agent.yaml down` keeps
it; `down -v` deletes it. Interrupted generations report a failure after restart; completed
worlds remain available and follow-up turns can resume. The demo worker runs one generation at
a time; concurrent submissions return a conflict. Model/tool errors publish no transcripts or
partial new assets, and previously published assets remain accessible.

`AGENT_CONFIG.yaml` remains the system-prompt source. The worker supplies SDK tools and defaults
to the same `claude-opus-5-5` model with low effort (`WORLD_AGENT_MODEL` overrides the model).
Integration still requires actual pxl/chirp builds and the existing `WorldOutput` manifest.
Generated code executes only in the dedicated worker container, without the app repository or host Docker socket mounted. The app backend and
browser consume compiled PNG strips/audio through the existing validated, signed proxy.
The renderer, terrain, fixed slabs/corners, animation timing, manual edits, HRTF audio and
resolver ownership of sound IDs are unchanged.

To roll back to Managed Agents (#86), clear `WORLD_AGENT_URL` and configure
`ANTHROPIC_API_KEY`, `ANTHROPIC_AGENT_ID` and `ANTHROPIC_ENVIRONMENT_ID` on the app server.
Clear both the worker URL and Anthropic key to use Gemini. Restart/redeploy after changing
configuration. The worker never switches providers; the app retains its existing fallback behavior and notices.
Tokens created by a different runtime/key cannot be reused; create a new world after switching.

`POST /api/scene` starts a session or sends a follow-up event and returns a signed session token.
Authenticated voice/memory turns through `POST /api/agent` use the same flow, passing recalled
preferences as user data while the current prompt and manually edited scene take precedence.
`GET /api/world?action=stream` forwards safe progress, replays missed history and deduplicates
live events. The browser reconnects after each short stream while the remote job continues;
functions do not need to remain open for the full generation. `POST /api/world` retrieves the
finished scene and assets, waiting for delayed file publication. The same endpoint proxies only
image/audio files belonging to the signed session. Tokens expire after 24 hours. The first room
stays hidden until its output validates and its images have loaded; errors preserve the current
room and prompt. Follow-up prompts reuse the agent session and receive the latest canonical
scene, including manual positions and mute settings. New sound IDs are assigned only by the
existing resolver, using the agent's chirp files.

Run `npm test` for worker HTTP, persistence and provider/protocol validation and `npm run test:managed` with the dev server
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
Follow-up edits preserve the environment. `?demo` replays preset rooms and recorded edits with no AI requests. A live prompt always ends in a playable room (#110): if the Claude agent errors, can't be reached or runs past 5 minutes (`CLAUDE_BUDGET_MS` in `src/ai/client.ts`), Gemini builds the standard room ("The world builder was unavailable…"); if Gemini fails too, the offline preset or recorded edit loads, labeled "Offline: …". A prompt with no offline recording keeps the room unchanged. Bad requests (4xx other than 429) stay errors.

The art agents receive the pinned [pxl skill and reference](https://github.com/uilianks/pxl)
(MIT), compile their code, and publish the first valid result immediately. Only compilation,
dimensions or contract errors trigger up to two repair calls; there is no artwork review call. All model code and pxl's platform-independent core run inside
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

`npm run test:props` checks generated-source grounding during emergence and full sprite containment
at each wall/corner across all four room orientations, using deterministic compiled assets.
