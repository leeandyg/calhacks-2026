# AI Spatial Soundscape — CalHacks 13.0 Blueprint

Oct 23, 2026 · @andy

## TL;DR

Build a **browser app** (React + React Three Fiber for the room, Web Audio API with HRTF panners for the sound) where an **LLM emits a scene as JSON** that both the 3D view and the audio engine read. Drag-to-move works on that same JSON, so manual edits and AI edits are the same operation.

Your instinct on order is right: **3D room with draggable spatial audio first, AI second.** But design the scene JSON on hour one so the AI can slot in without a rewrite.

- **Core (must demo):** prompt → room fills with labeled sound objects → drag one and hear it move → "make it rainier" edits the room.
- **Best stretch for a wow moment:** AirPods head tracking, so sources stay fixed in the room as you turn your head.
- **Best stretch for the "agentic" pitch:** mic-level noise sensing + a Pomodoro-style agent that changes the scene on its own.
- **Voice and memory (#68):** push-to-talk with Cartesia, Moss context/preference retrieval, Convex persistence and Gemini scene edits. The automatic noise/Pomodoro agent (#20) remains separate work.
- **App audio (Swift helper, #26–#28, built):** an app playing sustained audio, like Spotify, joins the room automatically as a live sound object you can drag and see pulse; the app's own output is muted.
- **Skip:** meeting speaker separation. It's real, but it can eat the whole weekend.

## The four core problems

Each core problem has a safe default you can ship by Saturday morning and an upgrade for later. Build every default before touching any upgrade.

### 1. Sound library: where the sounds come from

| Option | How it works | Trade-off | Use it for |
| --- | --- | --- | --- |
| Curated local pack | 37 sounds today (24 seamless loops, 13 one-shots) tagged in `public/sounds/manifest.json`, built by `scripts/pack.mjs` | Only what's in the pack, but zero latency and works on bad Wi-Fi | **Built (#4).** The instant, offline layer |
| Freesound API | Tag search, download the HQ preview MP3 with an API token (`scripts/fetch-freesound.mjs`) | Slow CDN; quality varies; licenses vary (we keep CC0 and CC-BY only) | **Source of most of the pack** (26 of 33), auto-picked by download count |
| ElevenLabs Sound Effects | Text prompt to audio; `loop: true` makes a seamless loop ([docs](https://elevenlabs.io/docs/capabilities/sound-effects)) | 15 s loops, 3 s one-shots with room for decay; 40 credits per second | **Built (#17): the live fallback** for anything the pack lacks ("a cat purring") |

**Pack source: hand-picked recordings.** In a side-by-side listening test, ElevenLabs beat the auto-picked Freesound sounds, so four were generated (#40). A later listening pass replaced those, except `sparrow`, with hand-picked Freesound recordings, along with other weak sounds. It also brought back `fan` and `espresso` (removed earlier for electrical hum), swapped the brown and white noise beds for recordings, and added `distant_siren` and `seagull_call`. `scripts/pack.mjs` crops recordings where only part is usable. Any weak sound can still be regenerated (`scripts/generate-pack.mjs`, about 600 credits per 15 s loop, 80 per one-shot).

**Resolver (`src/audio/resolve.ts`, built):** the agent writes a description per sound object (`sound.query`). The browser's resolver fills in `assetId` for any object that arrives without one:

1. Score every pack sound of the same kind by words its tags share with the query (stemmed, with filler words like "steady" or "gentle" ignored). An entry's main noun counts triple, and a sound already used in the scene is penalized, so two rain beds get different files.
2. A good match (the entry's main noun is the thing described, or three or more shared words) uses that pack file.
3. Otherwise, if the Claude agent composed a sound for that object with chirp, that file plays (`managed:…`). The library always wins where it has a good match (#97).
4. Otherwise the id becomes `gen:<kind>:<query>`. Live ElevenLabs generation is **off by default** (`VITE_ELEVENLABS_SOUNDS=on` enables it): the engine then plays the closest pack sound. When enabled, it fetches `GET /api/sound`, which generates with ElevenLabs: **v2 for beds** (15 s, `loop: true`) and **v3 for events** (3 s, one occurrence with a natural decay). The models were picked by ear in `scripts/test-elevenlabs.mjs`. Requests describe one physical source, ask for a natural dry recording without added reverb or cinematic effects, and use prompt influence 0.5. Loudness and distance belong in the scene's volume and position rather than in the recording description.
5. Generated audio is downmixed to mono and brought to pack loudness in the browser (EBU R128, the same scale as the pack, with a soft limiter so crackles and bass-heavy sounds still reach it). Responses are immutable, so the browser and Vercel's CDN cache them and a repeated description costs nothing. If generation fails, the closest pack sound plays instead. Those caches are per device and per region, and Vercel's is cleared on each deployment; the planned Convex sound cache makes this durable (see "Saved sounds and saved rooms").

`useSoundStatus` (in `src/audio/generated.ts`) reports `"generating"` or `"failed"` per assetId for the room view. Moss is planned first for voice context and preference memory (see below); semantic sound lookup remains a possible later upgrade to the word scoring.

**Generated sound quality (#96):** mono conversion retains a source channel if stereo phases would cancel it. Normalization includes short clips, allows up to 40 dB of gain for quiet Foley, and sends silent output through the existing fallback. These playback fixes apply to cached recordings after refresh; new descriptions use the revised generation request. Keep cached files rather than automatically spending credits to replace them.

### 2. Spatial audio

| Option | Notes |
| --- | --- |
| Web Audio `PannerNode`, `panningModel: "HRTF"` | **Pick.** Built into every browser. Binaural over headphones; position per source, orientation on the `AudioListener`. The audio engine sets positions from the scene store, not from the 3D meshes (see below) |
| three.js `PositionalAudio` (drei `<PositionalAudio>`) | Wraps the PannerNode and follows its 3D object. Not used: it ties the audio to the 3D view's component tree |
| Resonance Audio (Google) | Adds room reflections from room size and wall materials. Older library, still works |
| Native `AVAudioEnvironmentNode` / PHASE | Apple's spatial engines. Great with AirPods, but locks the whole app into Swift |

- **Store-driven audio:** the audio engine subscribes to the scene store and diffs objects by id, creating, updating or removing one HRTF voice per object. It never reads the 3D view, so drags, agent edits and presets all reach the audio the same way, and the audio and 3D code can be built independently.
- Two kinds of sound objects: **beds** (continuous loops) and **events** (one-shots followed by a random silent gap, like a bird with 20–60 s between clips). Each event finishes before another occurrence of that object can start, with subtle per-occurrence pitch and volume variation. Café cup clinks use 8–25 s gaps. A new event sound plays within 3 s, so its prop is never silent at first, and the engine caps every gap at 30 s. Events are what make it feel real.
- Start each loop at a random offset so two similar loops don't phase against each other.
- **Room reverb (built, #12, `src/audio/reverb.ts`):** one shared `ConvolverNode` with synthesized impulse responses (no files) for `room.reverb`: `small-room` (0.6 s), `large-room` (1.8 s), `outdoor` (0.4 s, bright, light) or `none`. The agent picks the preset from the prompt; it doesn't depend on the drawn room's size (#49). Each voice sends to it from before its panner, so far sounds come out wetter: about 14–20 dB of reverb below a source 1 m away, roughly level with it at 6 m indoors. Switching presets fades out, swaps and fades back in.
- Ramp every gain and position change (`setTargetAtTime`) so drags never click.
- Events use a 2 m reference distance while beds retain 1 m: perimeter one-shots gain about 6 dB in direct sound, while still falling off with distance. Manual volume, mute, positions and random gaps remain authoritative.

### 3. The 3D room

| Option | Trade-off |
| --- | --- |
| React Three Fiber + drei | **Pick.** Orthographic camera, drag on the floor plane, `<Html>` labels, fast iteration |
| Plain three.js | Same power, more boilerplate |
| 2D top-down canvas | Cheapest fallback. Audio still works, since positions are just x and z |
| Unity or Godot | Overkill; slows the web deploy |

A persistent pixel-art Berkeley golden bear wearing the supplied silver/black headphones (with the red accent preserved) sits at the center of every ready world. This is a view-only listener avatar, not a generated sound source; it follows canonical terrain and survives all scene replacements. Its colors bypass generated room palette changes. Two front and two back sprites follow manual room rotation, with a permanent matching You portrait in Assets even after all sources are removed. The agent reserves a one-meter radius around the center plus each standing source’s scaled half-width, chooses source scale deliberately from 1x to 4x, and preserves unrelated manual edits. Both Managed/Self-hosted and Gemini paths apply this agent-only placement guard without changing the canonical scene schema.

The room is a floor plane with an isometric orthographic camera. Each sound object is an icon, a label and a ring sized to its volume. Drag by raycasting the pointer onto the floor. The listener is a head avatar in the center with a facing arrow that later turns with head tracking.

### 4. The AI that builds and edits the room

**Captured demo rooms:** bundle a rainy café, beach, cyberpunk city and Zen garden in `public/demo/`, each
with exactly three sounds (two continuous beds and one randomly spaced event), its validated
scene, painted floor/four walls, source sprites and compressed audio. Four explicit choices
load these pre-generated rooms without provider calls. Reuse the normal scene store, dragging,
spatial playback and live voice/AI edits. Local asset preloading must not change the active room.
Provider capabilities remain in ignored capture scratch files, never in the public bundles.

- Give Gemini two tools: `create_scene(scene)` and `edit_scene(ops)`, where ops are add, remove, move, set\_volume and set\_room.
- Always send the current scene JSON with the user's prompt. "Make the rain quieter" then becomes an edit, and the user's manual drags survive.
- Put placement rules in the system prompt: steady broadband sounds (rain, fan, brown noise) wide and close to mask outside noise; intermittent sounds far and quiet; no intelligible speech, which distracts most.
- Validate the output with a zod schema and clamp positions to the room bounds.
- Use Gemini 3.8 Flash (`gemini-3.8-flash`) for both creation and edits, through the backend with `GEMINI_API_KEY`. Keep the shared scene contract unchanged. Streaming object animations can follow once the request/response path works.

## Tech stack

Go **web-first, with an optional Swift helper** for the Mac-only tricks. Judges can open a link, everyone on the team can work in TypeScript, and the app still runs if the helper never ships.

| Option | Stack | Strengths | Weaknesses | Verdict |
| --- | --- | --- | --- | --- |
| Web app | React + TS, React Three Fiber, Web Audio, small Node backend | Fastest iteration; shareable URL; HRTF built in | No AirPods head pose or system-audio tap from the browser | **Core** |
| Hybrid | The web app + a small Swift helper streaming to `ws://localhost` | Adds AirPods tracking and app-audio capture without rewriting anything | One more process to run during the demo | **Built** for app audio (Spotify, `helper/`); AirPods tracking can ride on the same helper |
| Native macOS | SwiftUI + RealityKit + `AVAudioEnvironmentNode` or PHASE | Best AirPods integration; native taps | Slow UI iteration, Mac-only, fewer teammates can help | Skip |
| Desktop wrapper | Electron or Tauri around the web app | One installable app | Native plugin setup eats hours | Skip |

**Concrete picks**

- **Frontend:** Vite, React, TypeScript, `@react-three/fiber`, `@react-three/drei`, `zustand` for the scene store, `zod` for schemas.
- **Audio:** Web Audio HRTF `PannerNode` per object, driven by the scene store; `ConvolverNode` room reverb, `AnalyserNode` for visuals and mic level.
- **AI:** Gemini 3.8 Flash through the Google GenAI SDK's Interactions API with tool use, called from the backend so keys stay server-side.
- **Sounds:** local pack (Freesound today) plus live ElevenLabs Sound Effects fallback through the resolver; word-overlap scoring now. Moss semantic asset search is a later upgrade, separate from its planned memory role.
- **Voice (#68, contributes to #23):** Cartesia [Ink-2](https://docs.cartesia.ai/changelog) streaming STT for push-to-talk commands, Moss for context, Gemini for scene operations, and optional Sonic TTS for short acknowledgements. Pomodoro coach cues remain part of #20/#23.
- **Memory (#68):** [Moss sessions](https://docs.moss.dev/docs/integrate/sessions) for live conversational context and persistent indexes for recalling preferences across sessions. Keep Gemini as the scene agent; Moss Inference is optional, outside the first implementation.
- **Saved state:** Convex stores named scene snapshots (#51), scoped to an anonymous authenticated browser session. Explicit Save/Load preserves the existing scene contract; Zustand remains the active room. Separate preference records feed Moss retrieval. SpacetimeDB remains an alternative if shared rooms become the priority.
- **Swift helper (`helper/`, built for app audio):** Core Audio process taps to detect and capture app audio such as Spotify (macOS 14.2+, [Apple docs](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)); later `CMHeadphoneMotionManager` for AirPods pose (macOS 14+, [WWDC23](https://developer.apple.com/videos/play/wwdc2023/10179)). See "App audio in the room" below.
- **Hosting:** Vercel for the frontend and `api/`; Convex for stored sounds and rooms.

## Architecture

Everything reads and writes one scene JSON, so the agent, your drags and the adaptive loop all speak the same language. Write this schema in the first hour; every teammate codes against it.

&#91;embedded content: architecture · 10 components around one scene store\]

The agent only emits edit ops into the store. The 3D room and the audio engine simply render whatever the store holds, so manual and AI edits can never drift apart.

**Saved scenes (#51):** Convex persists the same scene JSON, including manual placements,
volumes, listener and session. Saving or updating the reactive library never changes
the active room; only an explicit Load validates a snapshot and calls `setScene`.
Each anonymous authenticated session can read and update only its own saves. Local
presets and playback continue when Convex is unavailable. Generated audio files
remain on the existing resolver/cache path; they are not copied into scene records.

### Moss voice context and preference memory

**Foundation implemented in #68, owned by @OakleySun; plan from #65.** Explicit remember/recall/forget, task/time selection, authenticated Convex storage, Moss retrieval and push-to-talk share the existing scene contract. Configure provider credentials and verify live voice/Moss on the deployed runtime before demoing them. Automatic noise/Pomodoro adaptation (#20), feedback suggestions and spoken break cues remain later work.

**Activation:** hold **Ctrl+Shift+Space** in the focused page outside text fields, or click **Talk to agent** / **Stop & send**. Release to finish; Esc cancels voice, and window blur cancels held shortcuts. Explicit click-activated turns can continue in the background. The mic is off between explicit turns, with a 30-second cap. A browser shortcut does not activate the app from another program.

**Background voice (#139):** **Float controls** portals a compact Talk/Stop/status view of the same controller into a Document Picture-in-Picture window, with a standard popup fallback. The original tab remains the owner of the canonical scene and voice session. Optional **Hey agent** keeps Cartesia automatic-turn transcription active while enabled. Gate confirmed transcripts on a leading wake phrase; accept a command in the same sentence or arm one following sentence. Ignore unaddressed speech before agent/Moss calls. This uses cloud transcription, not a local wake-word model, and the UI explicitly states that the microphone stays on and transcription usage continues. Standby preserves room loudness; activated speech/replies keep normal ducking. Stop/disable/Esc/window close/unmount release capture and cancel pending voice work. Provider errors disable listening; no browser extension or schema change is needed.

**Voice smoothing (#104):** preload the worklet and a short-lived STT token without opening the mic; overlap capture setup with connection and pace buffered first words. The optional **Finish automatically** checkbox uses Ink-2 turn detection for one click-activated turn, with cumulative live captions; the hold shortcut stays manual. Execute only confirmed transcripts. Show listening, understanding, updating and completion states, with a subtle ready cue and editable final transcript. Correcting a room command replaces its previous effect only while its scene is still current; later manual changes are kept. Clear local commands (mute/unmute, volume, stop and guarded undo) use the existing scene operations without the scene agent or Moss; other commands keep the normal backend path. Both direct audio and reverb temporarily duck by 12 dB during capture/replies, independently of saved volumes and mutes. Short acknowledgements stream as 24 kHz mono PCM through the existing server endpoint; cancellation stops pending playback and scene requests. A local wake-word model and Pomodoro coach objects remain later work.

**Experience:** the user can say, "Remember: when I'm coding in the morning, I like close rain, brown noise, and very few cup clinks." Later, "Set up my usual coding environment" recalls that preference using the current task and the user's local time. An evening reading preference can instead favor a quiet fireplace and fewer intermittent sounds. These are examples to learn from the user, not built-in assumptions.

**Voice turn:** Cartesia transcribes a push-to-talk command → the backend gathers the current scene, task and local time bucket → Moss retrieves relevant live context and up to three saved preferences → Gemini produces the existing create/edit response → zod validation and `setScene` / `applyOps` update the room → Cartesia can speak a brief acknowledgement. Keep acknowledgements brief and outside the ambient sound beds; the existing no-intelligible-speech rule still applies to the soundscape.

**Learning and recall**

- The first implementation uses explicit "remember this for…" commands or **Remember this room** with task/time controls and optional notes. It saves the accepted room's sounds, volumes, event spacing and placements plus the local timezone and update time. Use the stated task or `session.task`; do not infer tasks by monitoring other apps. Thumbs-up/down and automatic preference suggestions are later work.
- A manual adjustment changes the current scene immediately. **Remember this room** explicitly accepts the result as a lasting preference; a one-off drag does not become a permanent habit automatically. Remember commands store the current room and supplied notes without editing it.
- Retrieve by task meaning (for example, "essay writing" can match "writing a paper") with task/time metadata, then prefer recent explicit preferences over older conflicting ones. A new command overrides remembered defaults. "Make it rainier" changes the relevant rain objects and preserves unrelated manual placements.
- Use the browser's local timezone to assign time buckets. If task or time context is missing, use an applicable general preference or the normal scene defaults. Memory supplies defaults when the user starts or requests a scene; a clock change alone must not replace the room. The adaptive loop (#20) may reuse the same preferences within its normal edit rules.
- Support "forget my evening preference" and a visible way to review/delete memories. Store concise preference summaries rather than raw microphone recordings. A correction supersedes the old preference; deleted or superseded records must stop appearing in retrieval.

**Storage and index boundary**

- Convex is the durable source for preference records, separate from saved scene snapshots: owner, summary, task, time bucket, timezone, preferred scene settings, feedback source and update time. These are proposed memory fields, not additions to `scene.ts`. Only validated scene operations reach the audio and room view.
- Moss holds the searchable projection. Use a session index for the current conversation's working context, and a per-user persistent index for accepted preferences across sessions. The guide distinguishes these two lifetimes; [sessions](https://docs.moss.dev/docs/integrate/sessions) can be persisted, while [persistent indexes](https://docs.moss.dev/docs/integrate/storage-persistence) are loaded into the serving process for local retrieval. Update/delete indexed documents when their Convex records change, and check returned record versions against Convex before use.
- Authenticate the backend request before selecting the user's index; never accept an arbitrary owner/index from the browser. Use [metadata filtering](https://docs.moss.dev/docs/integrate/metadata-filtering) for task/time selection, not as a substitute for ownership checks. Keep project credentials in `api/`. The existing anonymous identity remembers one browser; cross-device accounts are later work.
- Check the Moss Node SDK on the deployed runtime before wiring it into voice. Load an existing index rather than rebuilding the persistent index on every request, and restore live context from app state after a cold start. Measure the complete voice turn: Moss's advertised retrieval latency does not include transcription, index loading, Gemini or TTS.

**Build and demo checks**

1. Prove basic voice commands against the existing scene contract (#23), then add a typed "remember" path with Convex persistence and Moss recall before connecting spoken memory commands.
2. Save different morning-coding and evening-reading preferences. Reload, ask for each with a paraphrased task, and verify the correct sounds, volumes and event spacing. Use a supplied test time so the demo need not wait for evening.
3. Drag a source, then say "make it rainier." Verify that recalled defaults do not undo the drag. Correct a preference, delete another, and verify both changes after reload; a second authenticated identity must not retrieve the first user's memories.
4. Simulate Moss/voice outages. Typed prompts and local presets still work. A failed Moss lookup can use exact authenticated Convex task/time matches, visibly labeled as a fallback; an unknown "usual setup" leaves the room unchanged. When scene AI is down, only an explicit request for a usual setup may restore its exact saved snapshot. If a memory write has not synced to Moss, report that state instead of claiming recall is ready. Recorded preference-recall examples remain a later demo enhancement.

### Scene contract

**Self-hosted World Director (#114):** live agent execution now uses a persistent Node.js 24
Claude Agent SDK worker in a dedicated Docker container when `WORLD_AGENT_URL` is configured.
The model remains Claude Opus 5.5 at low effort via Anthropic's inference API; the agent loop,
pxl/chirp builds, working files and SDK session history live on our infrastructure. Toolkits are
installed in the image once. New-world environment and source-art/audio jobs run concurrently
from one prompt, fixed grid and palette. Each publishes its own validated manifest immediately;
the first ready branch reveals the renderer while its peer continues. Late terrain is applied by
the canonical scene store, preserving manual source edits. The worker merges the unchanged final
WorldOutput after both finish. Follow-up edits reuse the source SDK session as single turns;
full replacements route before building and then use the same two concurrent jobs.
The worker implements the existing session/events/files protocol,
so signed capabilities, validated `WorldOutput` manifests, compiled PNG/audio, canonical scene,
resolver ownership and browser rendering remain unchanged. A volume persists completed worlds
and SDK resumptions; interrupted builds fail visibly. One world runs at a time, with two concurrent creation jobs. Credentials
stay in server API configuration and worker environment only. Clear `WORLD_AGENT_URL` for the
explicit Managed Agents rollback below. The app retains its existing fallback behavior and notices.

**Managed World Director (#86):** the supplied Claude Managed Agent owns live scene planning in the legacy cloud configuration,
pxl artwork/animation and chirp audio generation when `ANTHROPIC_API_KEY` is configured. The
backend starts/continues its managed session, streams safe progress across bounded connections,
validates a per-turn manifest, and proxies the resulting images/audio with signed session access.
The agent runs code in Anthropic's sandbox; the application only consumes compiled assets. All
objects still use the existing scene store and resolver. Generated media metadata lives alongside
the browser art store, without adding fields to the shared scene JSON. `room.art` identifies that
world; terrain and positions remain canonical. All generated themes retain the fixed volumetric shell, with 0.42-block wall/floor slabs
and complete flush corners. Legacy `openAir` metadata cannot remove structural panels; paintings
cover existing surfaces, including outdoors/cities. Bed sprite motion loops; event motion follows playback,
and muting freezes it. Generated content remains hidden until the manifest and images are ready; the first pending prompt shows the fixed base shell with an Canvas 2D loading mosaic on its floor and two visible walls.
Follow-up edits receive the latest scene and reuse the session, preserving manual placement.
`AGENT_CONFIG.yaml` holds the supplied system prompt; the configured agent resource supplies
its model/tools. Gemini and offline/demo paths remain available. See README for setup and checks.

**First room (#81):** a fresh page shows only a centered prompt, with no starter environment.
The canonical store initially contains only the fixed structure and listener, with no fixture
objects, artwork, terrain or session. The first request sends `scene: null`. Live failures fall back
in steps (#110): Claude, then Gemini (the standard room), then the offline preset or recorded edit, each labeled in the notice; `?demo` replays recorded scenes with no AI requests. Before any valid result, the existing fallback chain applies. After a first valid branch appears, preserve it on later failure. After first submission, show the fixed empty shell with the Canvas 2D loading mosaic on its floor and two visible walls, and move the prompt below it. The effect is view-only and stops when the first validated branch is ready. Errors before any result hide the shell and recenter the prompt. Reveal each validated branch immediately; then show
it with its rotation arrows and the Assets panel, and move the prompt below it after successful creation. Prompt
submission supplies the audio gesture; the engine starts when the created room is revealed.

**Live pxl environments (#76):** new live scenes stage the environment before revealing sources.
`POST /api/environment` reasons about the actual place and streams a plan plus five separately
painted PNGs (floor, north, east, south, west). Natural ground can be uneven; indoor floors remain
flat. A source-planning pass then uses the concept and canonical terrain, and `/api/sprite` paints
each physical source. Waiting portals occupy the chosen positions until art arrives, then sources
emerge. All generated geometry remains structural surfaces or canonical sound objects. Offline
presets retain their existing rendering.

The optional `room.art` string names browser-cached environment PNGs; optional `room.terrain`
stores ground heights as `[row][column]` in blocks, north to south and west to east, matching the
fixed grid, from 0 to 1.5. Missing terrain means flat ground. Placement lifts sources above the
ground in the shared store, so audio and drawing share canonical positions. Changing the preset
or grid clears incompatible art and terrain. These optional contract additions need AI-owner
review in the #76 PR. PNGs never enter scene JSON or Gemini scene requests.

Art code executes with pxl's platform-independent core in QuickJS/WASM in a separate process,
without host APIs, with memory and wall-clock limits. Gemini receives pxl's skill/reference,
compilation and contract failures for repair (at most three painting calls). Publish the first valid
build immediately; no artwork review, image inspection or aesthetic refinement pass runs. The
self-hosted director follows the same build-and-publish policy, skipping toolkit preview/lint steps.
The routes have separate Vercel duration budgets (120 seconds environment, 90 seconds sprite),
and use a bounded warm-instance cache keyed by the description and art context. This cache is
not durable across server instances. See README “Live environment art” for setup and checks.

Units are meters (1 grid block = 1 m), y is up, the floor is centered on the origin, and the listener faces −z at yaw 0 (three.js defaults). The room is a fixed grid drawn by the room view (default 10 × 10 blocks, walls 7 high); the agent picks only its `preset` and `reverb`, never its size (#57).

```json
{
  "room": {
    "preset": "cafe",
    "grid": { "mode": "Square", "columns": 10, "rows": 10, "wallHeight": 7 },
    "openings": [],
    "reverb": "small-room"
  },
  "listener": { "position": [0, 1.6, 0], "yaw": 0 },
  "objects": [
    {
      "id": "rain-1",
      "label": "Rain on window",
      "kind": "bed",
      "sound": { "query": "steady rain on glass", "assetId": "rain_window_02" },
      "position": [-3, 1.5, 1],
      "volume": 0.6
    },
    {
      "id": "birds-1",
      "label": "Distant birds",
      "kind": "event",
      "sound": { "query": "sparrow chirps", "assetId": "birds_03" },
      "position": [4, 2, -3],
      "volume": 0.25,
      "intervalSec": [20, 60]
    }
  ],
  "session": { "task": "writing an essay", "mode": "focus", "minutesLeft": 38 }
}
```

Edits from the agent (and from voice commands) are a list of ops applied in order:

```json
[
  { "op": "move", "id": "rain-1", "position": [-4, 1.5, 0] },
  { "op": "set_volume", "id": "birds-1", "volume": 0.1 },
  { "op": "add", "object": { "id": "fire-1", "label": "Fireplace", "kind": "bed", "sound": { "query": "crackling fireplace" }, "position": [2, 0.5, 2], "volume": 0.4 } },
  { "op": "set_muted", "id": "birds-1", "muted": true },
  { "op": "set_room", "preset": "cabin" }
]
```

Objects also carry room-view fields: `model` (the prop drawn: `rain`, `fan`, `birds`, `speaker`; the agent picks it, otherwise the room derives it from `sound.query`), `muted` (default `false`; silences without changing `volume`), `wall` (default `null`; the wall a prop is mounted on or snapped against) and `scale` (default `1`). `add` with an existing id replaces that object in place (the resolver relies on this); the agent itself may only add new ids. `move` takes an optional `wall`.

The store snaps every position onto the grid (`src/scene/layout.ts`): floor props by their whole footprint, `rain` windows onto a wall. `api/scene.ts` returns positions already snapped, so what you hear is where the prop is drawn. Turning the room with the arrows only moves the camera and turns the bear avatar: the listener sits in the room facing `listener.yaw`, so what you hear doesn't change. Only drags and head tracking do.

A third kind, `live`, is audio playing in another app on the Mac, streamed by the Swift helper: `"sound": { "query": "Spotify", "stream": "app:com.spotify.client" }`. The browser adds and removes these objects itself (`src/audio/live.ts`), and they keep their spot when the scene is replaced; the agent may move them, change their volume or mute them, never add one, and the resolver skips them.

`assetId` is filled in by the resolver, never by the agent. That keeps the agent describing sounds in words and the resolver owning files. An `assetId` is either a pack id from `manifest.json` (`rain_window`) or a generated sound, `gen:<kind>:<query>` (`gen:bed:a cat purring softly`).

## Stretch features

Build the adaptive agent and camera head tracking first: together they make the "AI manages your study environment" pitch real for under 8 hours. Skip true speaker separation; collab rooms give you the meeting experience without it.

| Priority | Feature | How to build it | Est. hours | Risk | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | Adaptive agent | Mic level via `getUserMedia` + `AnalyserNode`, a Pomodoro state machine, and a loop that sends Gemini {noise level, minutes in session, task, current scene} every few minutes or on a spike. It returns edit ops: raise the masking bed, switch to a break scene, play a spoken cue | 3–5 | Low | **Build — this is the pitch** |
| 2 | Camera head tracking | MediaPipe Face Landmarker in the browser; read yaw from its transformation matrix (One Euro smoothing, hold while the face is lost, glide back when found) and add it to the `AudioListener`'s yaw through a head-pose store outside the scene | 2–3 | Low | **Built (#21)**: works for any judge with a webcam. Pitch is left out: HRTF elevation cues are weak |
| 3 | Lecture audio into the room | Chrome `getDisplayMedia({audio: true})` captures a tab; feed it into a PannerNode as a "Lecture" object; duck other sounds while it plays | 2–3 | Low–med | **Build** the browser path |
| 4 | AirPods head tracking | Swift helper with `CMHeadphoneMotionManager` streams yaw/pitch/roll over a localhost WebSocket | 3–5 | Medium | **Build if you have a Swift dev** — best wow moment |
| 5 | Collab rooms | Shared scene + avatar positions in SpacetimeDB; voices over a small WebRTC mesh; each remote voice gets a PannerNode at that person's avatar | 6–10 | Med–high | Only if the core is done by Saturday noon |
| 6 | Moss preference memory | Convex stores accepted task/time preferences; Moss retrieves relevant memories and live voice context for Gemini. Explicit remember, corrections and forgetting preserve manual edits. See above | 3–5 | Medium | Foundation in **#68**; automatic feedback suggestions later |
| 7 | Visual polish | Per-object pulse from its `AnalyserNode`; lighting per room preset | 2 | Low | Sunday early morning |
| 8 | App audio in the room (Spotify) | Swift helper detects which apps are playing, taps one with a Core Audio process tap, and streams it to the browser, where it becomes a live, visualized sound object | 6–10 | High | **Built (#26–#28)**; see "App audio in the room" |
| 9 | Meeting speaker separation | Diarization only says who spoke when; separating overlapping voices needs a model like Meta's [SAM Audio](https://ai.meta.com/samaudio/) on a GPU | 10+ | High | Skip |

### App audio in the room (Swift helper)

**Built (#26–#28).** Music already playing in Spotify (or any Mac app) shows up in the room as a sound object you can drag and see pulse, instead of playing flat over the soundscape. Run `helper/` next to the web app; see [helper/README.md](helper/README.md).

- **Helper (`helper/`, Swift, macOS 14.2+):** a command-line tool (no menu bar or Xcode needed). It polls Core Audio's process objects every 0.5 s and groups them by the app responsible for them, so a browser's audio process counts as that browser.
- **Detection:** an app whose output runs gets a listen-only mono tap that measures its level. About 3 s of real sound in the last 4 s brings it in; a ping never qualifies. A paused app keeps its spot, and 60 s of silence or quitting removes it. Chat and mail apps and non-regular processes are ignored.
- **Capture:** the same tap is switched to muted (`kAudioTapPropertyDescription`), so the music plays only from its spot in the room. The tap is read through a private aggregate device; private taps end with the helper, so a crash never leaves an app muted.
- **Never the room's own browser:** the helper finds the process at the other end of the WebSocket and excludes its app. Chrome plays every tab through one process, so a video in the same browser can't be captured; play it in another browser or app.
- **Transport:** `ws://127.0.0.1:47800`, loopback only and limited to our origins. JSON `start` / `stop` events and binary frames (a `UInt32` channel, then mono float32 at the tap's rate, about 10 ms each). The helper only captures while a page has subscribed after Enter room.
- **Browser (`src/audio/live.ts`, `public/live-stream-worklet.js`):** an `AudioWorklet` buffers each stream (~80 ms) and feeds a voice like any other object: HRTF panner, reverb send and level meter, so the pulse visual works unchanged.
- **Scene contract:** the `live` object kind (see "Scene contract"). The browser adds it when a stream starts, re-adds it at its last spot after an agent create, preset or Load room, and removes it when the stream stops.

**Gotchas to know before you start**

- AirPods head tracking needs head-tracking AirPods (Pro, Max, or 3rd gen and later). Turn off system Spatial Audio during the demo: developers report the yaw recentering when it activates ([Apple forums](https://developer.apple.com/forums/thread/844940)).
- Core Audio taps need `NSAudioCaptureUsageDescription` in the helper's Info.plist and a one-time permission prompt ([Apple docs](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)).
- Mic-based noise sensing hears your own soundscape through open headphones. Use closed headphones, or subtract the app's own output level before deciding.

### Saved sounds and saved rooms (Convex)

For the Convex track. Convex sits **next to** the current app, not under it: the zustand store stays the live scene, `api/scene.ts` stays on Vercel, and the local pack stays the offline layer. The app still runs without Convex: with `VITE_CONVEX_URL` unset or Convex unreachable, saving is unavailable and generated sounds come from `/api/sound` as today.

**Saved rooms (C, @OakleySun, #51, PR #52)**

- Named **Save room** / **Load room** controls in the prompt bar. Loading goes through `setScene`; saving never changes the playing room.
- Convex Auth anonymous sessions keep each browser's library private.
- Scenes are stored as `v.any()` and validated with the zod `Scene`, so `scene.ts` stays the only contract.
- The PR also sets Convex up: the package, `convex/schema.ts`, the browser client (`src/scene/convex.ts`) and `npm run convex:dev`.

**Saved sounds (A, @leeandyg, #53, after #52)**

- **Why:** today a generated sound is cached only by the browser that asked for it and by Vercel's CDN, which is per region and cleared on each deployment. A judge's laptop starts cold, and after a redeploy the same sound can be paid for again (about 600 credits per 15 s loop).
- A `sounds` table, `{ kind, query, status, storageId }`, indexed by `(kind, query)`. The audio lives in Convex file storage (a 15 s loop is about 240 KB).
- A Convex action takes over from `GET /api/sound`. If `(kind, query)` is ready, it returns the stored file's URL. If not, it claims the row as `generating`, calls ElevenLabs with the same models and durations, stores the MP3 and marks the row `ready`.
- The claim is a mutation, which Convex runs as a transaction, so two browsers asking for the same new sound pay once; the second waits on the row through a live query. A `failed` row, or one stuck in `generating` for over a minute, can be claimed again.
- `src/audio/generated.ts` loads the returned URL; decoding, loudness and the pack fallback don't change. `ELEVENLABS_API_KEY` is set in the Convex deployment.
- Result: each sound is generated once for every user, device and deployment, and a saved room's `gen:` sounds reopen instantly with no credits. Later, the resolver could match descriptions against stored sounds as well as the pack, so the library grows with use.

**Kept Claude worlds (A, @leeandyg, #112)**

- **Why:** a Claude world's art and chirp sounds sit in Anthropic's session storage for 24 hours, and only the page that made them knows them, so a reload, a saved room or a Moss "usual setup" lost them. Demo worlds can now be generated in advance and reopened.
- Two tables: `agentFiles` (each generated file stored once, by its Anthropic file id) and `agentWorlds` (one manifest per world, `room.art`, with kept URLs, merged across edits).
- The browser calls the `save` action right after a world arrives. Convex fetches each file from the production site's `/api/world` proxy with the world's signed token, so no secret is needed, and it accepts a world id only for that token's session.
- Reopening: a scene naming an `agent-…` world the page lacks reinstalls it from `world`; a `managed:` sound the page lacks plays from `file`, or the closest library sound.
- With ElevenLabs off by default (#103), the `sounds` table above is used only when `VITE_ELEVENLABS_SOUNDS=on`.

**Deployment:** the cloud project `calhacks-2026` and its production deployment are live (#54, #82); production builds deploy `convex/` automatically.

**Conventions that change** (in #53, the first PR that puts a key in `convex/`)

- Server code and keys live in `api/` or `convex/`; nothing in `src/` uses a secret. `VITE_CONVEX_URL` is public.
- Development runs `npm run convex:dev` next to `npm run dev`. Each teammate gets their own dev deployment, with its own environment variables to set.

## CalHacks 13.0 sponsor tracks

Aim for the Cal Hacks judged prizes plus four or five sponsor tracks where the sponsor's tech is core to the demo, not bolted on. Prizes below are from the [Devpost page](https://cal-hacks-13-0.devpost.com/); submissions close **Sunday Oct 25, 9:00am PDT**, with a 3-minute pitch and 2 minutes of questions.

| Track | Prize (as listed) | Fit | What it takes |
| --- | --- | --- | --- |
| Cal Hacks Most Creative Project | Instax camera + film each | Strong | The core loop: prompt to a room you can hear and rearrange |
| Cal Hacks Most Technically Advanced | NuPhy Air60 HE each | Strong | HRTF engine + head tracking + agent loop, explained in one architecture slide |
| Cal Hacks People-First Social Impact | Apple Watch SE 3 each | Strong | Frame it for students in loud dorms, shared housing, and people with ADHD or noise sensitivity |
| Cal Hacks 1st / 2nd / 3rd Overall | $3,600 + laptop each / Switch 2 each / smart glasses each | Strong | Everything above, demoed cleanly |
| Anthropic (anchor sponsor) | Not on Devpost yet; last year's Best Use of Claude was a tungsten cube + $5,000 credits ([12.0 prizes](https://live.calhacks.io/prizes)) | Reassess | The current scene agent uses Gemini; reassess eligibility against this year's rules before targeting this track |
| Moss | AirPods Max or Pro (listed at $996) | Strong if implemented | Recall a user's task/time preferences during a voice command, then generate the matching environment; demonstrate a correction and later recall. Moss provides retrieval, with actual voice latency measured end to end ([sessions](https://docs.moss.dev/docs/integrate/sessions)) |
| Cartesia | Listed at $1,516 (prize item TBD) | Strong | Ink-2 voice commands ("make it rain harder") and Sonic spoken break cues placed as a "coach" object in the room |
| SpacetimeDB (anchor sponsor) | Special prize for the most impressive use ([their blog](https://spacetimedb.com/blog/spacetime-at-calhacks)); amount not posted | Strong if collab | Shared scene + live avatar positions for collab rooms; the CEO runs a workshop |
| Meta: Bringing People Closer Together with AI | Invite to Round 2 at Menlo Park, travel covered | Strong if collab | Spatial-audio study rooms where friends sit at different spots |
| Convex | Teenage Engineering EP-133 K.O. II + ESP32 display (listed at $1,308) | Medium | Saved rooms (#51) and a shared cache of generated sounds in Convex file storage (#53); see "Saved sounds and saved rooms". Personalization on top. Pick this *or* SpacetimeDB |
| Fetch.ai | $1,500 / $1,000 / $500 | Medium | Wrap the environment agent as an Agentverse agent; last year required Agentverse registration + chat protocol |
| Microsoft: Built for the Real World | $3,800 + Surface laptop each | Medium | Real-world framing and a usable deployed link; criteria not posted |
| Figma: Best Design / Most Creative | $1,000 each (gift cards + recruiter session) | Medium | Design the room UI in Figma first and show it |
| Creao AI (3 tracks) | $3,000 cash + perks each | Unclear | Criteria not posted; ask at their booth |
| MLH Best Domain (GoDaddy Registry) | Gift card | Free | Register a domain, 5 minutes |
| MLH Commit Fellowship | Fellowship interview | Free | Opt in at submission + supplemental form |

Not a fit: Hyphenate (finance), Visa (shopping), Capital One, CRS, Coinbase, Apify, Bitdeer, Elastic, Armadin, SpaceXSI, Factory, Notability.

**Two bundles to choose from**

- **Solo-room bundle (lower risk):** Cal Hacks prizes, Moss, Cartesia, Convex, Figma, GoDaddy. Reassess the Anthropic track after the switch to Gemini.
- **Collab bundle (higher ceiling):** same, but swap Convex for SpacetimeDB and add Meta.

## Execution plan

You have about 39 hours, from 6:00pm tonight to the 9:00am Sunday deadline. The whole demo path must work by Saturday 8pm; everything after that is stretch and polish.

&#91;embedded content: execution plan · 5 phases, 5 gates\]

If a gate slips by more than two hours, cut the next phase's lowest-priority feature rather than pushing the freeze.

### Team split

| Person | Owns | First deliverable (by Fri 10pm) |
| --- | --- | --- |
| A — Audio | Audio engine, sound pack, resolver, reverb presets | One loop on an HRTF panner that follows a 3D object |
| B — 3D and UI | R3F room, drag, labels, listener avatar, visuals | Draggable objects writing positions to the store |
| C — AI | Scene schema, Gemini tools and prompts, adaptive loop, voice | `create_scene` returning valid JSON for 3 test prompts |
| D — Sensors and sponsors | Head tracking (webcam, AirPods helper), Moss / Cartesia / sync integrations, Devpost, video | Live head yaw printed from the webcam |

Three people? Give head tracking to A and the sponsor integrations plus Devpost to C.

**Our team (3 coders):** A — Audio is @leeandyg (also head tracking and the Swift helper), B — 3D and UI is @coinleftt, C — AI is @OakleySun (also voice and sponsor integrations). Assignments live on the GitHub issues.

### First-hour checklist

- [ ] Agree on the scene schema and commit it as `scene.ts` with zod
- [ ] Get API keys: Gemini (Google AI Studio), ElevenLabs, Cartesia, Moss, and SpacetimeDB or Convex
- [ ] Download 40–60 loops and write `manifest.json` (id, file, tags, kind, license)
- [ ] Scaffold Vite + React + R3F and deploy a hello-world to Vercel
- [ ] Join the Devpost as a team and shortlist sponsor tracks
- [ ] Find this year's Anthropic and SpacetimeDB prize rules on Hive or Slack
- [ ] Register a domain for the GoDaddy Registry prize
- [ ] Set up the demo kit: two closed headphones and a splitter

## Demo, pitch and risks

The demo wins or loses on the moment a judge turns their head and the rain stays where it was. Bring two pairs of closed headphones and a splitter so judges hear it themselves.

**One-line pitch:** Noise-cancelling headphones delete the world. We let you design a better one, and an agent keeps it tuned while you work.

### 3-minute demo script

1. **0:00–0:20 Problem.** Play 5 seconds of a loud dorm or the hackathon floor. "This is where you're trying to study."
2. **0:20–0:50 Generate.** Say or type "rainy Tokyo café, I'm writing an essay." Objects pop into the room as the agent places them.
3. **0:50–1:20 Move.** Drag the rain to the left. Then turn your head: the sounds stay fixed in the room.
4. **1:20–1:50 Edit.** "Push the chatter farther away and add a fireplace." The agent edits; your manual placement survives. Once memory ships, use this slot for "Use my usual evening reading setup," recalling a previously saved preference through Moss; keep the original edit as the fallback.
5. **1:50–2:20 Adapt.** Trigger a noise spike; the agent thickens the masking bed. The Pomodoro ends; the coach object speaks a break cue and the room shifts.
6. **2:20–2:45 Lecture.** Drop a lecture tab into the room; it sits front-center and everything else ducks.
7. **2:45–3:00 Close.** One architecture slide naming the sponsor tech, then the pitch line.

### How it maps to the judging criteria

| Criterion | How you score it |
| --- | --- |
| Application | Name the user (students in loud shared spaces) and the moment of use (a 50-minute focus block) |
| Intentionality | Placement rules grounded in masking: steady sounds close and wide, intermittent ones far |
| Functionality | A rehearsed live demo plus the required Devpost video for async sponsor judging |
| Creativity | The room as an editable, agent-managed object, not a playlist |
| Technical complexity | HRTF engine, head-pose pipeline, tool-using agent with a closed feedback loop |

### Risks and fallbacks

| Risk | Fallback |
| --- | --- |
| Venue Wi-Fi dies | The pack works offline, and generated sounds fall back to the closest pack sound. Play the demo prompts once before judging so their generated sounds are cached (in Convex once the sound cache is built, which warms every machine; until then only the browser that played them); keep a "demo mode" with recorded agent responses |
| Agent returns bad JSON or is slow | Validate with zod; if the Claude agent errors or runs past 5 minutes, Gemini builds the standard room; if that fails, the offline preset or recorded edit loads, labeled "Offline" (#110). Pre-generate the demo worlds: live Claude worlds take minutes |
| Moss memory or voice service is unavailable | Keep typed commands and local presets usable. Label exact task/time recall from Convex as a fallback; unknown usual setups leave the room unchanged |
| Spatial effect feels weak to judges | Exaggerate distances, use mono sources, open with a sound moving hard left to right |
| Head tracking jitters | Smooth with a lerp or One Euro filter; add a recenter button |
| Browser blocks audio on load | Gate the app behind an "Enter room" click that resumes the `AudioContext` |
| Too many sources stutter | Cap at about 12 active HRTF panners; mix distant beds into one stereo layer |
| Scope creep | Feature freeze Sunday 3:00am; after that only bug fixes, video and slides |

## Sources

- [Cal Hacks 13.0 on Devpost](https://cal-hacks-13-0.devpost.com/) — prizes, rules, judging criteria
- [Cal Hacks 13.0 schedule on Devpost](https://cal-hacks-13-0.devpost.com/details/dates) — submission window
- [Cal Hacks 13.0 site](https://www.calhacks.io/) — sponsor list
- [Spacetime is Sponsoring Cal Hacks 13.0](https://spacetimedb.com/blog/spacetime-at-calhacks) — SpacetimeDB prize and workshop
- [Cal Hacks 12.0 prizes](https://live.calhacks.io/prizes) — last year's Anthropic prize, for reference
- [ElevenLabs sound effects docs](https://elevenlabs.io/docs/capabilities/sound-effects) — looping, 30 s clips
- [Cartesia changelog](https://docs.cartesia.ai/changelog) — Ink-2 STT, Sonic TTS
- [Moss on GitHub](https://github.com/usemoss/moss) — real-time semantic search SDK
- [Moss sessions](https://docs.moss.dev/docs/integrate/sessions), [storage and persistence](https://docs.moss.dev/docs/integrate/storage-persistence), and [metadata filtering](https://docs.moss.dev/docs/integrate/metadata-filtering) — live context, durable indexes and task/time retrieval; also informed by the supplied *Moss Hackathon Developer Guide*
- [WWDC23 session 10179](https://developer.apple.com/videos/play/wwdc2023/10179) — `CMHeadphoneMotionManager` on macOS 14
- [Apple Developer Forums: yaw recenters with Spatial Audio](https://developer.apple.com/forums/thread/844940)
- [Apple: Capturing system audio with Core Audio taps](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)
- [Meta SAM Audio](https://ai.meta.com/samaudio/) — prompted audio separation
