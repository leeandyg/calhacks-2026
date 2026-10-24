# AI Spatial Soundscape

CalHacks 13.0 project. Describe a place, and an agent builds a 3D room of spatial sound sources you can hear (binaural, over headphones) and drag around. The agent keeps the room tuned while you work.

Live: https://calhacks-2026.vercel.app

See [the blueprint](./AI%20Spatial%20Soundscape%20—%20CalHacks%2013.0%20Blueprint.md) for the plan, scene contract, and team split.

## Stack

- Frontend: Vite, React, TypeScript, React Three Fiber + drei, zustand, zod, Tailwind, BorderBeam. A pixel-art isometric room (see [LAYOUT.md](LAYOUT.md)): drag a prop to move its sound, click it to mute, turn the room with the arrows (your ears turn with it), and type into the prompt bar. A prop shows "generating…" while ElevenLabs makes its sound.
- Audio: Web Audio API (one HRTF `PannerNode` per sound object, driven by the scene store)
- AI: Gemini 3.8 Flash via the Google GenAI SDK (tool use), called from the backend

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
request can replace the starter scene; follow-up changes return edit ops so manual
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
The prompt bar offers six local presets and an **Offline demo** checkbox. Presets
use bundled sounds and do not need an API key. If an AI request fails, returns bad
output, or takes longer than 15 seconds, supported prompts use a local preset or a
saved edit and show an **AI unavailable** notice. Unsupported edits keep the current
room intact and ask you to choose a preset or a supported demo prompt.
Missing asset IDs in a valid AI response are part of normal live resolution and do
not trigger offline replay. Enable **Offline demo** when you want saved responses.

## Offline demo

Run `npm run dev` locally before disconnecting from the internet, click **Enter room**,
and enable **Offline demo**. The app and sound pack are served from your computer;
the demo does not make Gemini requests. The deployed site still needs connectivity
to load its page and sound files; this is not a service-worker offline cache.

Use **Local preset** to load Rainy café, Bedroom, Forest, Library, Cabin, or Coast.
For the recorded agent sequence, enter these prompts in order (also listed in the UI):

1. `Rainy Tokyo cafe, I'm writing an essay.`
2. `Make it rainier.`
3. `Push the chatter farther away and add a fireplace.`

`src/ai/recordings.ts` contains real Gemini responses captured on October 24, 2026,
with fixed local sound bindings. Replay adapts object IDs and the rain volume increase
to the current room so manual placements survive. It supports these saved interactions,
not arbitrary offline AI requests. Uncheck **Offline demo** to resume live AI requests.

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

## Save and load rooms with Convex

Run `npm run convex:dev` in a separate terminal and keep it running. The first run
configures a deployment and writes `CONVEX_DEPLOYMENT` and the public
`VITE_CONVEX_URL` to ignored `.env.local`. You can choose local development without
a Convex account. In another terminal, run `npm run convex:auth` once to configure
the deployment's signing keys, then start/restart `npm run dev`.

After **Enter room**, name the current room and click **Save room**. Saving the same
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

For cloud storage, sign in using `npx convex login`, then run
`npx convex dev --configure` and select a cloud project. Run `npm run convex:auth`
for that development deployment. For production, run
`npm run convex:auth -- --prod` and `npx convex deploy`; set `VITE_CONVEX_URL` on
Vercel to the production deployment's public `.convex.cloud` URL and rebuild the
frontend. Convex Auth's `JWT_PRIVATE_KEY` and `JWKS` stay in the Convex deployment;
the setup script generates them without printing them and preserves existing keys.

`npm run check:convex` checks round-trip persistence, named updates, validation,
unauthenticated rejection and isolation between two anonymous users. It requires a
running local deployment configured in `.env.local` and creates isolated test data.

In dev, the scene store is on `window.sceneStore`, so you can try edits from the browser console:

```js
sceneStore.getState().applyOps([{ op: "move", id: "rain-1", position: [3, 1.5, 0] }])
```

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

The agent only describes sounds (`sound.query`). In the browser, `src/audio/resolve.ts` fills in `assetId` for every object that doesn't have one: a pack sound when the tags match well, otherwise `gen:<kind>:<query>`, which the audio engine generates through `GET /api/sound?kind=bed|event&q=...` (ElevenLabs: v2 for 15 s loops, v3 for 2 s one-shots). Generated sounds are converted to mono, matched to pack loudness and cached, and fall back to the closest pack sound if generation fails. `useSoundStatus` in `src/audio/generated.ts` says which sounds are still generating.

Run `npm run check:resolver` to see which descriptions use a pack sound and which get generated; it reads the local manifest and makes no API calls. Each generation costs ElevenLabs credits (40 per second of audio). `scripts/test-elevenlabs.mjs` is the listening test used to pick the models; it writes a comparison page to `assets/raw/elevenlabs/listen.html`.

## Layout

| Path | What | Owner |
| --- | --- | --- |
| `src/scene/` | Scene schema (`scene.ts`), store with `setScene` / `applyOps` (`store.ts`), grid placement rules (`layout.ts`), presets and fixtures | @OakleySun |
| `src/scene/SavedRooms.tsx`, `convex/` | Named scene save/load and anonymous session ownership | @OakleySun |
| `src/audio/` | Store-driven audio engine, AudioContext, sound manifest, resolver (`resolve.ts`), generated sounds (`generated.ts`) | @leeandyg |
| `src/room/` | Pixel room view, view-only camera/rotation store (`useRoomStore.ts`), "generating…" labels (see [LAYOUT.md](LAYOUT.md)) | @coinleftt |
| `src/ui/` | Enter-room gate, prompt bar, demo controls, rotation arrows | @coinleftt |
| `src/ai/`, `api/scene.ts` | Browser client and server endpoint for `POST /api/scene` | @OakleySun |
| `api/sound.ts` | `GET /api/sound`: ElevenLabs generation for sounds the pack lacks | @leeandyg |
| `public/sounds/` | Sound pack + `manifest.json` | @leeandyg |

`api/*.ts` files export `POST` or `GET(request: Request): Response`. They run as Vercel functions in production and through a Vite middleware in dev. API keys are read there from `process.env`, never in `src/`.
