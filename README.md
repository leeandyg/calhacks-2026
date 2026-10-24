# AI Spatial Soundscape

CalHacks 13.0 project. Describe a place, and an agent builds a 3D room of spatial sound sources you can hear (binaural, over headphones) and drag around. The agent keeps the room tuned while you work.

See [the blueprint](./AI%20Spatial%20Soundscape%20—%20CalHacks%2013.0%20Blueprint.md) for the plan, scene contract, and team split.

## Stack

- Frontend: Vite, React, TypeScript, React Three Fiber + drei, zustand, zod
- Audio: Web Audio API (HRTF `PannerNode` via three.js `PositionalAudio`)
- AI: Claude via the Anthropic API (tool use), called from the backend

## Setup

```sh
cp .env.example .env   # add your API keys
```

Wear headphones. The spatial effect depends on them.
