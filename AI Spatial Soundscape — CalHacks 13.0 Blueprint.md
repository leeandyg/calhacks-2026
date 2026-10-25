# AI Spatial Soundscape — CalHacks 13.0 Blueprint

Oct 23, 2026 · @andy

## TL;DR

Build a **browser app** (React + React Three Fiber for the room, Web Audio API with HRTF panners for the sound) where an **LLM emits a scene as JSON** that both the 3D view and the audio engine read. Drag-to-move works on that same JSON, so manual edits and AI edits are the same operation.

Your instinct on order is right: **3D room with draggable spatial audio first, AI second.** But design the scene JSON on hour one so the AI can slot in without a rewrite.

- **Core (must demo):** prompt → room fills with labeled sound objects → drag one and hear it move → "make it rainier" edits the room.
- **Best stretch for a wow moment:** AirPods head tracking, so sources stay fixed in the room as you turn your head.
- **Best stretch for the "agentic" pitch:** mic-level noise sensing + a Pomodoro-style agent that changes the scene on its own.
- **Planned for later (Swift helper):** capture audio from a Mac app like Spotify and place it in the room as a live, visualized sound object. Only after the core demo works.
- **Skip:** meeting speaker separation. It's real, but it can eat the whole weekend.

## The four core problems

Each core problem has a safe default you can ship by Saturday morning and an upgrade for later. Build every default before touching any upgrade.

### 1. Sound library: where the sounds come from

| Option | How it works | Trade-off | Use it for |
| --- | --- | --- | --- |
| Curated local pack | 33 sounds today (21 seamless loops, 12 one-shots) tagged in `public/sounds/manifest.json`, built by `scripts/pack.mjs` | Only what's in the pack, but zero latency and works on bad Wi-Fi | **Built (#4).** The instant, offline layer |
| Freesound API | Tag search, download the HQ preview MP3 with an API token (`scripts/fetch-freesound.mjs`) | Slow CDN; quality varies; licenses vary (we keep CC0 and CC-BY only) | **Source of most of the pack** (26 of 33), auto-picked by download count |
| ElevenLabs Sound Effects | Text prompt to audio; `loop: true` makes a seamless loop ([docs](https://elevenlabs.io/docs/capabilities/sound-effects)) | 15 s loop in ~4–7 s, 2 s one-shot in ~1.5–2.5 s; 40 credits per second | **Built (#17): the live fallback** for anything the pack lacks ("a cat purring") |

**Pack source is moving to generated.** In a side-by-side listening test, ElevenLabs beat the auto-picked Freesound sound for every prompt we compared, so those four (rain_window, fireplace, cup_clink, sparrow) are now generated (`scripts/generate-pack.mjs`, #40). The rest stay on Freesound until someone listens through them; any weak one can be regenerated the same way (about 600 credits per 15 s loop, 80 per one-shot). `fan` and `espresso` were removed for strong electrical hum (60 Hz and 100 Hz) until better recordings are found; requests for them are generated instead.

**Resolver (`src/audio/resolve.ts`, built):** the agent writes a description per sound object (`sound.query`). The browser's resolver fills in `assetId` for any object that arrives without one:

1. Score every pack sound of the same kind by words its tags share with the query (stemmed, with filler words like "steady" or "gentle" ignored). An entry's main noun counts triple, and a sound already used in the scene is penalized, so two rain beds get different files.
2. A good match (the entry's main noun is the thing described, or three or more shared words) uses that pack file.
3. Otherwise the id becomes `gen:<kind>:<query>`, and the audio engine fetches `GET /api/sound`, which generates it with ElevenLabs: **v2 for beds** (15 s, `loop: true`) and **v3 for events** (2 s). The models were picked by ear in `scripts/test-elevenlabs.mjs`.
4. Generated audio is downmixed to mono and brought to pack loudness in the browser (EBU R128, the same scale as the pack, with a soft limiter so crackles and bass-heavy sounds still reach it). Responses are immutable, so the browser and Vercel's CDN cache them and a repeated description costs nothing. If generation fails, the closest pack sound plays instead.

`useSoundStatus` (in `src/audio/generated.ts`) reports `"generating"` or `"failed"` per assetId for the room view. Semantic search with Moss is still a possible upgrade for the word scoring.

### 2. Spatial audio

| Option | Notes |
| --- | --- |
| Web Audio `PannerNode`, `panningModel: "HRTF"` | **Pick.** Built into every browser. Binaural over headphones; position per source, orientation on the `AudioListener`. The audio engine sets positions from the scene store, not from the 3D meshes (see below) |
| three.js `PositionalAudio` (drei `<PositionalAudio>`) | Wraps the PannerNode and follows its 3D object. Not used: it ties the audio to the 3D view's component tree |
| Resonance Audio (Google) | Adds room reflections from room size and wall materials. Older library, still works |
| Native `AVAudioEnvironmentNode` / PHASE | Apple's spatial engines. Great with AirPods, but locks the whole app into Swift |

- **Store-driven audio:** the audio engine subscribes to the scene store and diffs objects by id, creating, updating or removing one HRTF voice per object. It never reads the 3D view, so drags, agent edits and presets all reach the audio the same way, and the audio and 3D code can be built independently.
- Two kinds of sound objects: **beds** (continuous loops) and **events** (one-shots on a random timer, like a bird every 20–60 s). Events are what make it feel real.
- Start each loop at a random offset so two similar loops don't phase against each other.
- **Room reverb (built, #12, `src/audio/reverb.ts`):** one shared `ConvolverNode` with synthesized impulse responses (no files) for `room.reverb`: `small-room` (0.6 s), `large-room` (1.8 s), `outdoor` (0.4 s, bright, light) or `none`. The agent picks the preset from the prompt; it doesn't depend on the drawn room's size (#49). Each voice sends to it from before its panner, so far sounds come out wetter: about 14–20 dB of reverb below a source 1 m away, roughly level with it at 6 m indoors. Switching presets fades out, swaps and fades back in.
- Ramp every gain and position change (`setTargetAtTime`) so drags never click.

### 3. The 3D room

| Option | Trade-off |
| --- | --- |
| React Three Fiber + drei | **Pick.** Orthographic camera, drag on the floor plane, `<Html>` labels, fast iteration |
| Plain three.js | Same power, more boilerplate |
| 2D top-down canvas | Cheapest fallback. Audio still works, since positions are just x and z |
| Unity or Godot | Overkill; slows the web deploy |

The room is a floor plane with an isometric orthographic camera. Each sound object is an icon, a label and a ring sized to its volume. Drag by raycasting the pointer onto the floor. The listener is a head avatar in the center with a facing arrow that later turns with head tracking.

### 4. The AI that builds and edits the room

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
| Hybrid | The web app + a \~200-line Swift menu-bar helper streaming to `ws://localhost` | Adds AirPods tracking and app-audio capture without rewriting anything | One more process to run during the demo | **Planned** for app audio (Spotify); AirPods tracking rides on the same helper |
| Native macOS | SwiftUI + RealityKit + `AVAudioEnvironmentNode` or PHASE | Best AirPods integration; native taps | Slow UI iteration, Mac-only, fewer teammates can help | Skip |
| Desktop wrapper | Electron or Tauri around the web app | One installable app | Native plugin setup eats hours | Skip |

**Concrete picks**

- **Frontend:** Vite, React, TypeScript, `@react-three/fiber`, `@react-three/drei`, `zustand` for the scene store, `zod` for schemas.
- **Audio:** Web Audio HRTF `PannerNode` per object, driven by the scene store; `ConvolverNode` room reverb, `AnalyserNode` for visuals and mic level.
- **AI:** Gemini 3.8 Flash through the Google GenAI SDK's Interactions API with tool use, called from the backend so keys stay server-side.
- **Sounds:** local pack (Freesound today) plus live ElevenLabs Sound Effects fallback through the resolver; word-overlap scoring now, with [Moss](https://github.com/usemoss/moss) (sponsor, sub-10 ms search, TypeScript SDK) as a possible upgrade.
- **Voice (optional):** Cartesia [Ink-2](https://docs.cartesia.ai/changelog) streaming STT for spoken commands, Sonic TTS for a spoken focus coach.
- **Realtime state (pick one):** SpacetimeDB if you build shared rooms, Convex if you only need saved scenes and personalization.
- **Swift helper (planned, after core):** Core Audio process taps to detect and capture app audio such as Spotify (macOS 14.2+, [Apple docs](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)); `CMHeadphoneMotionManager` for AirPods pose (macOS 14+, [WWDC23](https://developer.apple.com/videos/play/wwdc2023/10179)). See "App audio in the room" below.
- **Hosting:** Vercel for the frontend; the backend wherever your realtime choice lives.

## Architecture

Everything reads and writes one scene JSON, so the agent, your drags and the adaptive loop all speak the same language. Write this schema in the first hour; every teammate codes against it.

&#91;embedded content: architecture · 10 components around one scene store\]

The agent only emits edit ops into the store. The 3D room and the audio engine simply render whatever the store holds, so manual and AI edits can never drift apart.

### Scene contract

**Self-hosted World Director (#114):** live agent execution now uses a persistent Node.js 24
Claude Agent SDK worker in a dedicated Docker container when `WORLD_AGENT_URL` is configured.
The model remains Claude Opus 5.5 at low effort via Anthropic's inference API; the agent loop,
pxl/chirp builds, working files and SDK session history live on our infrastructure. Toolkits are
installed in the image once. The worker implements the existing session/events/files protocol,
so signed capabilities, validated `WorldOutput` manifests, compiled PNG/audio, canonical scene,
resolver ownership and browser rendering remain unchanged. A volume persists completed worlds
and SDK resumptions; interrupted builds fail visibly. One generation runs at a time. Credentials
stay in server API configuration and worker environment only. Clear `WORLD_AGENT_URL` for the
explicit Managed Agents rollback below; no automatic provider switch occurs on failure.

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
and muting freezes it. First creation remains hidden until the manifest and images are ready.
Follow-up edits receive the latest scene and reuse the session, preserving manual placement.
`AGENT_CONFIG.yaml` holds the supplied system prompt; the configured agent resource supplies
its model/tools. Gemini and offline/demo paths remain available. See README for setup and checks.

**First room (#81):** a fresh page shows only a centered prompt, with no starter environment.
The canonical store initially contains only the fixed structure and listener, with no fixture
objects, artwork, terrain or session. The first request sends `scene: null`. Live failures keep
the empty/current scene unchanged; recorded scenes are available only through explicit `?demo`. Keep the room hidden during creation or errors, then reveal
it with its rotation arrows and move the prompt below it after successful creation. Prompt
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
render failures, lint findings and a preview when time allows (at most three painting calls).
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

The store snaps every position onto the grid (`src/scene/layout.ts`): floor props by their whole footprint, `rain` windows onto a wall. `api/scene.ts` returns positions already snapped, so what you hear is where the prop is drawn. Turning the room with the arrows turns the listener with it: a sound on the left of the screen is on your left.

`assetId` is filled in by the resolver, never by the agent. That keeps the agent describing sounds in words and the resolver owning files. An `assetId` is either a pack id from `manifest.json` (`rain_window`) or a generated sound, `gen:<kind>:<query>` (`gen:bed:a cat purring softly`).

## Stretch features

Build the adaptive agent and camera head tracking first: together they make the "AI manages your study environment" pitch real for under 8 hours. Skip true speaker separation; collab rooms give you the meeting experience without it.

| Priority | Feature | How to build it | Est. hours | Risk | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | Adaptive agent | Mic level via `getUserMedia` + `AnalyserNode`, a Pomodoro state machine, and a loop that sends Gemini {noise level, minutes in session, task, current scene} every few minutes or on a spike. It returns edit ops: raise the masking bed, switch to a break scene, play a spoken cue | 3–5 | Low | **Build — this is the pitch** |
| 2 | Camera head tracking | MediaPipe Face Landmarker in the browser; read yaw and pitch from its transformation matrix and set the `AudioListener` orientation | 2–3 | Low | **Build** — works for any judge with a webcam |
| 3 | Lecture audio into the room | Chrome `getDisplayMedia({audio: true})` captures a tab; feed it into a PannerNode as a "Lecture" object; duck other sounds while it plays | 2–3 | Low–med | **Build** the browser path |
| 4 | AirPods head tracking | Swift helper with `CMHeadphoneMotionManager` streams yaw/pitch/roll over a localhost WebSocket | 3–5 | Medium | **Build if you have a Swift dev** — best wow moment |
| 5 | Collab rooms | Shared scene + avatar positions in SpacetimeDB; voices over a small WebRTC mesh; each remote voice gets a PannerNode at that person's avatar | 6–10 | Med–high | Only if the core is done by Saturday noon |
| 6 | Personalization | Log sessions (task, scene, minutes, thumbs up/down); retrieve the 3 most similar past scenes as examples when generating | 2–3 | Low | Saturday night |
| 7 | Visual polish | Per-object pulse from its `AnalyserNode`; lighting per room preset | 2 | Low | Sunday early morning |
| 8 | App audio in the room (Spotify) | Swift helper detects which apps are playing, taps one with a Core Audio process tap, and streams it to the browser, where it becomes a live, visualized sound object | 6–10 | High | **Planned** after core; see "App audio in the room" |
| 9 | Meeting speaker separation | Diarization only says who spoke when; separating overlapping voices needs a model like Meta's [SAM Audio](https://ai.meta.com/samaudio/) on a GPU | 10+ | High | Skip |

### App audio in the room (Swift helper)

The team decided to add this after the core demo works: music already playing in Spotify (or any Mac app) shows up in the room as a sound object you can drag and see pulse, instead of playing flat over the soundscape.

- **Helper (Swift, macOS 14.2+):** a menu-bar app that lists the processes currently producing audio (Core Audio process objects that report running output) and shows which apps are playing, like Spotify.
- **Capture:** create a process tap on the chosen app with the tap set to mute the original output, so the music plays only from its spot in the room and isn't heard twice. Read the tap through an aggregate device.
- **Transport:** stream PCM frames (for example 48 kHz float32, 20 ms chunks) and "app started/stopped playing" events over the same `ws://localhost` socket that AirPods head tracking will use.
- **Browser:** an `AudioWorklet` buffers the stream into a `MediaStreamAudioDestinationNode` or a source node, routed through an HRTF `PannerNode` like any other object. An `AnalyserNode` on it drives the visualizer pulse.
- **Scene contract:** add a `live` object kind whose `sound` names a stream (e.g. `{ "stream": "app:com.spotify.client" }`) instead of an asset. The agent may place and move it but never resolves it to a file.
- **Fallback:** if the helper isn't running, the browser tab-capture path (stretch #3) shows the same idea for a web player.

**Gotchas to know before you start**

- AirPods head tracking needs head-tracking AirPods (Pro, Max, or 3rd gen and later). Turn off system Spatial Audio during the demo: developers report the yaw recentering when it activates ([Apple forums](https://developer.apple.com/forums/thread/844940)).
- Core Audio taps need `NSAudioCaptureUsageDescription` in the helper's Info.plist and a one-time permission prompt ([Apple docs](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)).
- Mic-based noise sensing hears your own soundscape through open headphones. Use closed headphones, or subtract the app's own output level before deciding.

## CalHacks 13.0 sponsor tracks

Aim for the Cal Hacks judged prizes plus four or five sponsor tracks where the sponsor's tech is core to the demo, not bolted on. Prizes below are from the [Devpost page](https://cal-hacks-13-0.devpost.com/); submissions close **Sunday Oct 25, 9:00am PDT**, with a 3-minute pitch and 2 minutes of questions.

| Track | Prize (as listed) | Fit | What it takes |
| --- | --- | --- | --- |
| Cal Hacks Most Creative Project | Instax camera + film each | Strong | The core loop: prompt to a room you can hear and rearrange |
| Cal Hacks Most Technically Advanced | NuPhy Air60 HE each | Strong | HRTF engine + head tracking + agent loop, explained in one architecture slide |
| Cal Hacks People-First Social Impact | Apple Watch SE 3 each | Strong | Frame it for students in loud dorms, shared housing, and people with ADHD or noise sensitivity |
| Cal Hacks 1st / 2nd / 3rd Overall | $3,600 + laptop each / Switch 2 each / smart glasses each | Strong | Everything above, demoed cleanly |
| Anthropic (anchor sponsor) | Not on Devpost yet; last year's Best Use of Claude was a tungsten cube + $5,000 credits ([12.0 prizes](https://live.calhacks.io/prizes)) | Reassess | The current scene agent uses Gemini; reassess eligibility against this year's rules before targeting this track |
| Moss | AirPods Max or Pro (listed at $996) | Strong | Semantic lookup from "cozy crackling fireplace" to a sound file, in-browser, under 10 ms ([Moss](https://github.com/usemoss/moss)) |
| Cartesia | Listed at $1,516 (prize item TBD) | Strong | Ink-2 voice commands ("make it rain harder") and Sonic spoken break cues placed as a "coach" object in the room |
| SpacetimeDB (anchor sponsor) | Special prize for the most impressive use ([their blog](https://spacetimedb.com/blog/spacetime-at-calhacks)); amount not posted | Strong if collab | Shared scene + live avatar positions for collab rooms; the CEO runs a workshop |
| Meta: Bringing People Closer Together with AI | Invite to Round 2 at Menlo Park, travel covered | Strong if collab | Spatial-audio study rooms where friends sit at different spots |
| Convex | Teenage Engineering EP-133 K.O. II + ESP32 display (listed at $1,308) | Medium | Saved scenes, session log, personalization; pick this *or* SpacetimeDB |
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
4. **1:20–1:50 Edit.** "Push the chatter farther away and add a fireplace." The agent edits; your manual placement survives.
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
| Venue Wi-Fi dies | The pack works offline, and generated sounds fall back to the closest pack sound. Play the demo prompts once before judging so their generated sounds are in the browser cache; keep a "demo mode" with recorded agent responses |
| Agent returns bad JSON or is slow | Validate with zod, retry once, fall back to 6 preset scenes; stream objects in as they arrive |
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
- [WWDC23 session 10179](https://developer.apple.com/videos/play/wwdc2023/10179) — `CMHeadphoneMotionManager` on macOS 14
- [Apple Developer Forums: yaw recenters with Spatial Audio](https://developer.apple.com/forums/thread/844940)
- [Apple: Capturing system audio with Core Audio taps](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)
- [Meta SAM Audio](https://ai.meta.com/samaudio/) — prompted audio separation
