# Hackathon log

- **Project:** roomto.study
- **Event:** Cal Hacks 13.0
- **What it does:** Turns a described place into a pixel-art room whose props are spatial (HRTF) sound sources you can drag, mute, save and recall by voice.
- **Live app:** https://calhacks-2026.vercel.app
- **Repo:** https://github.com/leeandyg/calhacks-2026
- **Frontend:** Vercel
- **Convex deployment:** https://nautical-dogfish-530.convex.cloud
- **Components:** none
- **Convex features:** schema, indexes, queries, mutations, actions, HTTP actions, file storage, realtime useQuery
- **Auth:** Convex Auth
- **AI models:** claude-opus-5-5, gemini-3.8-flash, ink-2, sonic-3.6, eleven_text_to_sound_v2, eleven_text_to_sound_v3
- **Started:** 2026-10-24T03:55:09Z
- **Last updated:** 2026-10-25T14:54:21Z

## How we use Convex

- **Private sign-in per browser:** Convex Auth anonymous sessions (`convex/auth.ts`, `convex/http.ts`, `authTables` in `convex/schema.ts`).
- **Visited places:** every room is saved with mutations and listed by an indexed query (`by_user_updated`) in `convex/savedScenes.ts`. The **Visited places sidebar updates live without a refresh** through `useQuery` in `src/ui/PlacesPanel.tsx`, and typed names like "study cave" match against a live `watchQuery` in `src/scene/savedPlaces.ts`.
- **Kept Claude worlds:** an action copies each generated PNG and sound into Convex file storage once and keeps a manifest per world, so reloads reopen them (`convex/agentWorlds.ts`, tables `agentWorlds` and `agentFiles`).
- **Preference memory:** task/time preferences per user ("coding" → a saved room), indexed by `by_user_context`, read by the voice/memory API with a Convex HTTP client (`convex/preferences.ts`, `api/_lib/auth.ts`).
- **Shared generated-sound cache:** a claim mutation plus an action store each ElevenLabs sound once in file storage; the browser watches its status live (`convex/sounds.ts`, `src/audio/generated.ts`). Off unless live generation is enabled.

## Log

- 2026-10-24 `4148483` App skeleton: scene contract, store, audio engine (src/audio/AudioEngine.ts, src/scene/)
- 2026-10-24 `5c57852` Audio engine: events, crossfades, HRTF (src/audio/AudioEngine.ts)
- 2026-10-24 `cc20585` Gemini scene create/edit tools (api/scene.ts)
- 2026-10-24 `f5727fd` Sound pack and scripts (scripts/pack.mjs, scripts/fetch-freesound.mjs)
- 2026-10-24 `e93a58f` Convex saved rooms with anonymous auth (convex/savedScenes.ts, src/scene/SavedRooms.tsx)
- 2026-10-24 `acfde5b` Pixel room on the unified contract (src/room/RoomScene.tsx)
- 2026-10-24 `ec2daf6` Convex deploys with production builds (scripts/vercel-build.mjs)
- 2026-10-24 `21de96e` Generated-sound cache in Convex storage (convex/sounds.ts, convex/elevenlabs.ts)
- 2026-10-24 `9ad0a7c` Voice commands and preference memory (src/ai/voice.ts, src/ai/AgentControls.tsx)
- 2026-10-24 `5993295` Webcam head tracking (src/sensors/webcamHeadTracking.ts)
- 2026-10-24 `d4b78ff` Claude world director and pxl art (server/managedAgent.ts, api/environment.ts)
- 2026-10-25 `f7c87b0` Room Helper for app audio (helper/Sources/Server.swift)
- 2026-10-25 `ee6dda5` Keep Claude worlds in Convex (convex/agentWorlds.ts)
- 2026-10-25 `1c5bc03` Smoother voice and streamed replies (src/ai/voice.ts)
- 2026-10-25 `043dc9d` Captured demo rooms (src/scene/capturedDemos.ts)
- 2026-10-25 `2441848` Cloud/local agent switch and worker (worker/server.mjs)
- 2026-10-25 `aa940bb` Saved preferences load directly (src/ai/preferences.ts, api/agent.ts)
- 2026-10-25 `715d5a9` Open saved places by name (src/scene/savedPlaces.ts)
- 2026-10-25 `2915604` Task-place learning, Moss fallback (src/ai/preferences.ts)
- 2026-10-25 `1e74ed3` Visited places sidebar and Settings (src/ui/PlacesPanel.tsx)
- 2026-10-25 `312d3f1` UI polish and floating voice (src/ui/PlacesPanel.tsx)
