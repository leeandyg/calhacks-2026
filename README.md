# AI Spatial Soundscape

CalHacks 13.0 project. Describe a place, and an agent builds a 3D room of spatial sound sources you can hear (binaural, over headphones) and drag around. The agent keeps the room tuned while you work.

Live: https://calhacks-2026.vercel.app

See [the blueprint](./AI%20Spatial%20Soundscape%20—%20CalHacks%2013.0%20Blueprint.md) for the plan, scene contract, and team split.

## Stack

- Frontend: Vite, React, TypeScript, React Three Fiber + drei, zustand, zod
- Audio: Web Audio API (one HRTF `PannerNode` per sound object, driven by the scene store)
- AI: Gemini 3.8 Flash via the Google GenAI SDK (tool use), called from the backend

## Setup

```sh
npm install
cp .env.example .env   # PowerShell: Copy-Item .env.example .env
npm run check:gemini   # after adding GEMINI_API_KEY to .env
npm run dev            # http://localhost:5173, serves api/ too
npm run build          # typecheck + production build
```

Create an API key in [Google AI Studio](https://aistudio.google.com/apikey) and set
`GEMINI_API_KEY` in `.env`. Restart the dev server after changing it. On Vercel, add
the same environment variable to the deployment's environment and redeploy.
Node.js 24 is recommended; on Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

`POST /api/scene` sends the prompt and current scene to `gemini-3.8-flash`, which calls
`create_scene` or `edit_scene`. The endpoint validates tool arguments with Zod,
clamps positions to room bounds, and retries invalid output once. Transient provider
and connection errors get up to two retries with increasing delays (about 1s, then
2s, with jitter), with a 20-second timeout per attempt. Timeouts return HTTP 504;
provider overload returns HTTP 503, and quota errors return HTTP 429. A new environment
request can replace the starter scene; follow-up changes return edit ops so manual
placements survive. Try "rainy cafe, I'm writing an essay", then "make the rain quieter".

The agent only supplies `sound.query`. New sounds need the resolver in #17 to fill
`assetId` before they can play; existing resolved objects keep their assets during edits.
API errors leave the current scene intact. Offline presets/demo replay are tracked in #19.

Wear headphones. The spatial effect depends on them.

In dev, the scene store is on `window.sceneStore`, so you can try edits from the browser console:

```js
sceneStore.getState().applyOps([{ op: "move", id: "rain-1", position: [3, 1.5, 0] }])
```

## Layout

| Path | What | Owner |
| --- | --- | --- |
| `src/scene/` | Scene schema (`scene.ts`), store with `applyOps` (`store.ts`), sample scenes (`fixtures.ts`) | @OakleySun |
| `src/audio/` | Store-driven audio engine, AudioContext, sound manifest | @leeandyg |
| `src/room/` | R3F room view | @coinleftt |
| `src/ui/` | Enter-room gate, prompt bar | @coinleftt |
| `src/ai/`, `api/` | Browser client and server endpoint for `POST /api/scene` | @OakleySun |
| `public/sounds/` | Sound pack + `manifest.json` | @leeandyg |

`api/*.ts` files export `POST(request: Request): Response`. They run as Vercel functions in production and through a Vite middleware in dev. API keys are read there from `process.env`, never in `src/`.
