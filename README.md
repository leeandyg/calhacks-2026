# AI Spatial Soundscape

CalHacks 13.0 project. Describe a place, and an agent builds a 3D room of spatial sound sources you can hear (binaural, over headphones) and drag around. The agent keeps the room tuned while you work.

Live: https://calhacks-2026.vercel.app

See [the blueprint](./AI%20Spatial%20Soundscape%20—%20CalHacks%2013.0%20Blueprint.md) for the plan, scene contract, and team split.

## Stack

- Frontend: Vite, React, TypeScript, React Three Fiber + drei, zustand, zod
- Audio: Web Audio API (one HRTF `PannerNode` per sound object, driven by the scene store)
- AI: Claude via the Anthropic API (tool use), called from the backend

## Setup

```sh
npm install
cp .env.example .env   # add your API keys
npm run dev            # http://localhost:5173, serves api/ too
npm run build          # typecheck + production build
```

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
