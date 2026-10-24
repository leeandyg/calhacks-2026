# Pixel Room

A full-viewport isometric room with two plain **left/right rotation arrows** and one bottom **BorderBeam prompt bar**. Room construction follows the supplied [My Dream Setup dimension profile](docs/reference-dimensions.json): modular blocks, Square/Rectangle blueprints, independent width/length/wall-height counts, and grid-based door/window openings.

Default: **10 × 10 floor cells with 7-block walls**, calibrated to the supplied image. The orthographic camera uses 45° azimuth and 30° elevation, matching its 1:2 floor-edge slope. The [reference measurements](docs/reference-proportions.json) record the silhouette and framing targets. The dimension profile itself does not specify exact counts or game limits. One renderer unit is one fixed block, approximately a meter/yard. There is no custom metric input or forced cube constraint.

Walls and floor form a continuous shell with the same fixed **0.42-block thickness**. Plain rooms use one clean gray finish, with no trim or visible grid seams. Environment presets adapt the shared surface palette; forest adds sparse deterministic dirt/moss pixels that respect openings and wall visibility. Thickness stays fixed for all room sizes and presets.

Only sound-source models are rendered: rainy window, fan, birds, or speaker. No navigation, panels, decorative furniture, room shadows, backend, AI integration, or audio engine. The prompt uses only React state: Enter or Send trims/logs its value and clears the input. BorderBeam provides the requested UI border glow. Mute is canonical frontend state for a future audio consumer.

**Agent rules: [LAYOUT.md](LAYOUT.md)**, discovered through [AGENTS.md](AGENTS.md).

## Run

Use Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

Open **http://localhost:5173** or the URL Vite prints.

```sh
npm run build
npm test
npm run preview
```

## Interaction

- Click/tap a source to mute/unmute. Muted models turn gray and fade, and the fan's blades stop. Saved volume is preserved.
- Drag a source to place its complete footprint on grid cells. All models, including windows, move to any wall. The window's modular cutout follows it.
- Release to keep placement; Escape/cancel restores the starting placement. A drag never toggles mute.
- **Rotation is manual only.** Edge holds, hover, dragging and dropping never turn the room. Click Rotate right for a smooth exact 90° clockwise turn. Four turns restore the original orientation.

The room/camera stay stationary during dragging. Manual rotation is disabled until the gesture ends. The camera fits square and rectangular rooms at all orientations, with no perspective distortion or shadows.

## Grid contract

```json
{
  "preset": "bedroom",
  "grid": {
    "mode": "Rectangle",
    "columns": 10,
    "rows": 6,
    "wallHeight": 4
  },
  "openings": [
    { "id": "entry", "kind": "door", "wall": "west", "column": 1, "level": 0, "span": 1, "height": 2 }
  ],
  "reverb": "small-room"
}
```

This is `scene.room`. Floor counts and wall height must be integers. Square requires equal column/row counts; Rectangle permits independent axes. Doors start at level zero; every opening must fit its wall's segment range. Source windows derive their cutouts from the same object data that positions their models, without duplicate placement state. They stop at the nearest safe end cell, preserving one solid corner segment on both ends; large windows are fitted to that usable span.

Room dimensions can be adjusted through the scene configuration or validated `set_room` operations. The minimal page intentionally has no room-builder panels. See [docs/FRONTEND_ARCHITECTURE.md](docs/FRONTEND_ARCHITECTURE.md).

## Implementation

- `src/shared/scene.ts`: grid/opening/source schemas and validated edit contract.
- `src/shared/layout.ts`: dimension derivation, footprint snapping, wall attachment, opening ranges, wall modules and isometric camera geometry.
- `src/components/room/Floor.tsx`: one seamless square slab module per cell, with flush perimeter geometry.
- `src/components/room/Wall.tsx`: instanced 1×1 wall panels with actual modular cutouts and flush corners; no baseboards or caps.
- `src/components/room/SurfacePixels.tsx`: seeded sparse environment marks, shared by walls and floor.
- `src/config/room.ts`: adaptive surface palettes.
- `src/components/room/RoomScene.tsx`: the original live frontend, including a shared pixel grid and palette for walls, slabs, all inner/outer edges and independently draggable props.
- `src/components/room/useObjectLoop.ts`: 16-frame prop animation, paused while muted; the renderer refreshes continuously during drag/rotation.
- `src/components/room/SoundObjects.tsx`: recognizable movable models, mute treatment and window fading.
- `src/components/room/useSourceDrag.ts`: mouse/touch grid placement, click distinction and cancellation; no dwell timers or automatic rotation.
- `src/store/useSceneStore.ts`: canonical JSON and immutable validated actions.
- `src/store/useRoomStore.ts`: separate camera, manual quarter turns and interaction locks.

## Verification

62 logic tests cover Square/Rectangle validation, independent height, rejection of fractional/custom-metric/custom-shape input, aligned footprints, source/window/door openings, complete bounds, mute and atomic edits, reference projection and silhouette, constant slab thickness, environment surface details and cutouts, wall fading and exact manual turns.

With the development server running:

```sh
npx playwright install chromium
npm run test:browser
npm run test:frontend
```

Or prefix commands with `PLAYWRIGHT_CHANNEL=chrome` for installed Chrome; `TEST_URL` can override the server address.

Browser checks cover the reference proportions, 10×10 and 10×6 rooms, tile/panel counts, door/window cutouts, all four orientations, desktop/mobile/landscape framing, real mouse/touch dragging and mute, window cutout relocation, sustained edge holds without rotation, cancellation, rotation-icon and single-prompt UI, no shadows and no runtime/console errors. Development-only inspection/configuration helpers are omitted from production. Screenshots go to ignored `test-results/`.

## Pixel-art animation

The live room at **http://localhost:5173/** uses pixel art across the whole room, including wall/floor slabs and every inner/outer edge. Sources stay draggable to all walls, click-mutable and attached during rotation. The original `index.html`, `App.tsx` and `RoomScene.tsx` are the only frontend; pixel rendering lives in the original scene file. There are no separate pixel HTML players or redirect pages. Asset exports are a 20-color, 16-frame loop at 10 fps (1.6 seconds). Rain, rotating fan blades with a slight base wobble, and offset bird bobs/blinks are patches over one static base. Run `npm run art:build`, `npm run art:lint`, or `npm run art:verify`. See [art/pixel-room/README.md](art/pixel-room/README.md) for source, GIF/still exports, and patch metadata. `PLAYWRIGHT_CHANNEL=chrome npm run test:window` checks actual drags to both ends of every wall, raycasts the corner posts, and covers four orientations, rectangles and mobile.

The prompt is a 76px dark pill with a single-line input, colorful BorderBeam and 44px send button. The room is framed higher to clear both controls. Only `border-beam` was added for this UI; its peers are React and React DOM. `PLAYWRIGHT_CHANNEL=chrome npm run test:prompt` covers input guards, trimmed click/Enter submission, clearing, exact styles and responsive control clearance.
