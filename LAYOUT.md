# Modular room layout contract for AI agents

Read this before generating rooms, source geometry, or interactions. The supplied [My Dream Setup dimension profile](docs/reference-dimensions.json) governs grid behavior. The [measured visual reference](docs/reference-proportions.json) governs the default proportions and camera framing. Keep the frontend to a full-viewport room, two plain left/right rotation arrows beside the room and one bottom prompt bar, plus what the full-stack app needs: a status line above the prompt, a "generating…" label over a prop while its sound is generated, a temporary sound-name label and pixel outline on hover, and an Assets panel pinned top-right that lists each sound source (sprite, label, volume slider, a reversible hide-from-environment toggle, and delete) in the same BorderBeam frosted style as the prompt bar. Hiding removes a source's prop/portal (view-only `useRoomStore` state) and silences it (`set_muted`); volume and delete go through `applyOps`. No labels or panels beyond these, and no room shadows. The rotation arrows render above the Assets panel so they stay clickable when a short viewport makes them overlap. The prompt calls `POST /api/scene` and the audio engine renders the same scene store (`src/scene/store.ts`; see README).

Reference views: [Image 1](docs/references/room-view-1.png) and [Image 2](docs/references/room-view-2.png). Follow their aligned orthographic room presentation. Exclude their clutter and shadows.

The requested optional floating voice controller (#139) is a portal from the existing app into a small Picture-in-Picture window (or popup fallback), never a separate frontend or scene. Main voice controls may expose Float controls and an opt-in Hey agent toggle. Both windows share listening state, transcript and stop controls.

## 1. Modular dimensions

- Use a **grid of modular blocks**, approximately one meter/yard per segment. The renderer uses a fixed one-unit segment. Do not accept custom metric segment sizes or arbitrary room-size tuples.
- Default layout: **10 columns × 10 rows**, with **7-block wall height**. These integer counts are calibrated to Image 1 with the continuous equal-thickness shell; the supplied game JSON does not specify counts. Do not substitute a shallow 8×8×4 room or force all three axes to match.
- Width, length and wall height are independent. They must not be forced to match.
- Supported modes: `Square` and `Rectangle`. Square requires equal floor counts; Rectangle accepts independent columns and rows. Only a single rectangular footprint is supported. No L shapes, polygons, curved walls or custom floor masks.
- Prototype validation ranges: 4–24 floor segments per axis and 2–12 wall segments. The supplied JSON does not specify game limits.
- Room size is stored only as integer counts:

```json
{
  "room": {
    "preset": "bedroom",
    "grid": { "mode": "Square", "columns": 10, "rows": 10, "wallHeight": 7 },
    "openings": [],
    "reverb": "small-room"
  }
}
```

For a rectangle use, for example, `mode: "Rectangle", columns: 10, rows: 6, wallHeight: 4`. Do not add a separate `room.size` that can disagree with the grid.

## 2. Modular geometry and openings

- Y is up; the floor surface is Y = 0. Center the floor in X/Z: X edges ±columns/2, Z edges ±rows/2.
- North = −Z; east = +X; south = +Z; west = −X.
- Render one 1×1 floor module per grid cell. Cell centers are `[column + 0.5 - columns/2, 0, row + 0.5 - rows/2]`. Keep the placement grid data-driven but visually seamless: full-size cells use one shared surface color. No tile gaps, checkerboard colors, overlay grid, labels or guides.
- Build walls from 1×1 panels stacked to `wallHeight`. North/south have `columns` panels per level; east/west have `rows`. **Walls and floor share exactly one fixed thickness: `SLAB_THICKNESS = 0.42` blocks.** Never scale it with grid counts, wall height, environment, camera or source size. The floor extends half this thickness beyond each wall centerline. Use flush butt joints at corners and one continuous finish at the wall/floor junction. No caps, baseboards, perimeter borders, contrasting edge strips, gaps or stepped plinth. Keep thickness and derived envelope values in the shared layout constants.
- Door/window openings are rectangular module ranges:

```json
{
  "id": "entry",
  "kind": "door",
  "wall": "west",
  "column": 1,
  "level": 0,
  "span": 1,
  "height": 2
}
```

- Opening indices/spans are nonnegative/positive integers and must fit their wall. Doors start at level 0. Columns run along the wall's local X axis, viewed from the interior. Opening IDs are unique.
- Exclude wall modules occupied by openings. Do not cover door openings with geometry or surface details.
- Sound-source windows derive their opening directly from their snapped source position and footprint. Moving the source moves its cutout. Do not duplicate its placement in another store or hardcode it to north.
- A window's geometry must fill its modular opening. Fit its width/height to the occupied segment counts, including after scaling. Source windows reserve one complete wall segment at both ends so their openings cannot remove the structural corner posts. Clamp both placement and scaled width to that usable span; keep the position and cutout derived from the same canonical source.

### Environment surfaces

- Generated themes always paint the existing fixed room shell: all four wall slabs and the floor
  stay 0.42 blocks thick, with complete flush corners and the normal near-wall fading. Legacy
  `openAir` art metadata must never remove structural geometry. Paint outdoor/city themes on the
  surfaces; do not substitute detached flat skyline panels for walls. Environment and source
  strips use horizontal equal-size frames on the shared pixel grid. Bed motion loops; event motion
  runs during playback. Muting freezes source animation. Keep the initial prompt centered before submission. During first creation, show only the base shell with the img-fx loading mosaic on the floor and two visible walls, with the prompt below. Reveal generated content after the first branch validates and its images finish loading while the other branch runs. Start the canonical scene empty:
  no fixture artwork, sources or session. Live generation errors never insert demo content.

- Live generated environments (#76) extend these defaults: `room.art` references five pxl PNGs in
  the browser art store, and `room.terrain[row][column]` raises individual floor cells. The fixed
  structural slab stays `SLAB_THICKNESS`; raised earth is terrain above it. Paint each wall through
  its remaining panels so openings stay empty and artwork fades with its own wall. The self-hosted director creates the
  environment and physical source assets concurrently and renders whichever is ready first. Late terrain
  goes through the canonical store without resetting manual edits. The Gemini fallback retains its existing flow. A generated prop replaces that
  source's stock geometry and uses the same canonical position, drag/mute controls, pixel pass and
  manual rotation. Waiting portals and generating labels remain until the sprite succeeds or
  fails; failure reveals the stock prop. Structural forest paintings may depict distant trees;
  separate branches/trees must be sound sources. No extra decorative objects or controls.
  In captured/managed rooms, fallback-AI additions request only their missing source sprites,
  including when the AI reply carries a fallback notice. If that new painting fails, show its
  stock geometry; original managed sprites are never repainted or replaced by this recovery.

- Use `ROOM_THEMES` in `src/room/roomConfig.ts` for the shared wall/floor finish. The plain bedroom is neutral gray (`#969aa3`) with no marks. Other presets adapt the neutral finish to their environment without changing thickness. Walls and floor must use the same surface color, including exposed slab edges; lighting may shade faces naturally.
- Forest uses muted earth/gray-green slabs with **sparse small dirt and moss pixels** on wall faces, top faces, floor and exposed floor edges. These are structural surface details, not additional scene objects. Normal plain rooms have no texture, speckles, decorative border or grouting.
- Generate pixels deterministically from a seed so they do not shuffle during renders or dragging. Keep their whole footprint outside door/window openings. All wall details must fade and hide with their own wall; no floating marks on invisible walls, no shadows.

## 3. Camera and manual rotation

- Orthographic projection, **45° azimuth and 30° elevation**. Image 1 uses dimetric projection: floor edges rise 1 pixel for every 2 horizontal pixels. Do not replace this with equal XYZ camera offsets or the mathematical 35.264° isometric angle. No perspective or free orbit.
- Preserve the measured silhouette: the outline height/width is approximately **0.9355** (tolerance 0.005), including the uniform slab shell. Approximate native-image landmarks and the calibrated grid are recorded in `docs/reference-proportions.json`. Grid dimensions remain configurable; this ratio governs the default square only.
- Retain the reference proportions while moving the room upward for the bottom prompt bar. Use a 5.5% top inset (minimum 20px), at most 80% viewport height, and at least 160px bottom clearance for the prompt, status line and safe-area spacing. Increase the clearance to the measured controls height when saved-room/voice controls need more space. On short screens, scroll the auxiliary controls while keeping the main prompt visible. On narrow screens, fit the full room width without clipping.
- Fit the complete square or rectangle, independent wall height, and slab at every point of the turn. Use the rectangle's diagonal envelope, not a single-side/cube formula. Reserve the bottom controls area.
- Rotate the complete room as one parent with finite eased 90° turns and exact endpoints. The camera remains stationary during rotation. Four turns return precisely home.
- **Rotation is view-only: never rotate the audio listener or source panners with the room. Canonical source moves (including dragging) still move their sound.**
- **Rotation is manual only, through the left/right arrow buttons. Never rotate on drag, edge proximity, hover, hold, drop, or a timer.** No auto-turn actions, dwell controllers or delayed rotation code.
- Determine near-wall opacity from world-space positions/normals. The near pair fades away and the far pair remains opaque. Near-side windows remain faint and interactive without obstructing the interior.

## 4. Only sound-producing objects

The one permanent exception is the Berkeley golden bear listener avatar: a view-only pixel sprite centered at local X/Z = 0, seated on the highest terrain cell under its feet. It appears in every ready world, survives scene replacement/removal of every source, has no sound or source controls, and keeps its reference silver/black headphones and tiny red accent independent of generated palettes. Render it through the same pixel grid with correct depth occlusion, without shadows. It stays hidden during the initial loading shell. Select front-left, front-right, back-right and back-left sprite views from the current manual view angle; never spin the environment automatically. Keep the corresponding portrait in a permanent You row at the top of Assets, including when the source list is empty. The user row has no mute, volume, hide or delete actions. Agents select source scale from 1x to 4x and keep their full scaled footprint outside the bear’s one-meter central clearance. This agent-only rule does not change manual drag behavior.

Every other non-structural model must correspond to one canonical `scene.objects` entry with a unique ID and sound description. Supported renderers: `rain`, `fan`, `birds`, `speaker`. Use recognizable source geometry and essential supports only. The default rain window occupies 2×3 wall modules on the west (left visible) wall, matching the tall, narrow reference window. No chairs, tables, rugs, shelves, plants, lamps, pictures, additional avatars, rings, floating markers or permanent labels. On pointer hover, outline the visible source silhouette on the shared pixel grid and show its canonical sound label above it; generated sprites retain their transparent cutout. Hover feedback is view-only and disappears on leave, room replacement or rotation.

Sources retain the shared contract: `id`, `model`, metadata `label`, `sound`, `kind`, `position`, `volume`, `muted`, `wall`, `scale`, and event intervals when needed. All sources remain under the room's source group, independently movable to any of the four walls. Display short, direct source names in hover labels ("Ventilation unit", not "Ventilation unit on north wall"); keep existing canonical labels and audio descriptions intact.

## 5. Grid-snapped placement

- Source positions use local **block units**, before view rotation. A floor model occupies a whole-cell footprint that contains its complete scaled geometry.
- Quantize the start of the complete footprint, then derive its center. Do not snap centers blindly: odd/even footprints have different center parity. Full footprints must remain inside the room.
- Floor-object height uses half-block steps within model bounds. Wall-window positions use whole-segment spans, tangent anchors and levels. Wall-normal offsets follow wall thickness/model depth and are calculated by the renderer.
- Generated standing props (fan/speaker hints, including trees) stay upright with their base on the canonical terrain. Their emergence scales from that base, including at room edges; a wall snap does not turn them into centered wall paintings. Keep the complete sprite inside the inner slab faces at every manual rotation. Window and perched-bird art retains its canonical wall anchor.
- Floor models can occupy the interior or snap beside a wall at an edge. Windows stay mounted on their selected wall and face inward. Apply rectangular width/depth independently when choosing/clamping a wall.
- Use validated immutable scene operations. `move` updates position and wall attachment together. Room edits update grid counts/openings and re-clamp sources. Do not mutate only meshes.

## 6. Pointer gestures and mute

- Mouse/touch share pointer capture and a 6 CSS-pixel click/drag threshold. Raycast to a horizontal plane and apply the inverse room transform plus the initial grab offset.
- A click/tap toggles `muted`. A drag snaps to modules and never mutes on release. Holding an object at any edge leaves the camera and room orientation unchanged indefinitely.
- Manual rotation is disabled until the gesture ends. After a turn, a new drag uses the current inverse room matrix.
- Release keeps the new placement. Escape, cancellation, lost capture, blur, unmount or object removal releases locks; cancelled moves restore the starting placement.
- Preserve volume while muted. Muted geometry is gray and partially faded across all parts. The fan's local blade animation stops. Moving a muted source preserves mute. Volume, hide-from-environment (reversible) and delete are available per source in the Assets panel; hiding removes a source's prop and silences it. No mute badges on the geometry and no other extra controls.

## 7. No shadows

Disable renderer/light/mesh shadows. The explicitly requested BorderBeam glow is limited to the prompt UI. No ContactShadows, baked shadows, AO, shadow planes, blobs, drop-shadow filters, box-shadow or text-shadow. Ambient/hemisphere/directional face illumination is allowed without projected shadows.

## 8. Required verification

- TypeScript/build and relevant logic/browser tests pass; no console/runtime errors.
- Square and non-square Rectangle layouts use correct module counts and independent wall height. Fractional counts, unsupported shapes, bad openings and custom metric inputs are rejected.
- Check that walls and floor retain the same fixed thickness after resizing and switching presets. Plain surfaces are gray and clean; forest surfaces have sparse marks that disappear with their wall.
- Modular floor/wall geometry and source footprints align; openings and moved source windows stay synchronized.
- Holding each edge longer than the former delay never rotates. Only the two arrow buttons rotate; four turns in either direction restore home.
- All sources reach every wall, retain mute/volume, support click and touch, and cancel safely.
- Verify the reference floor-edge slope and default silhouette ratio as well as complete desktop/mobile/landscape framing, no shadows, only the requested temporary hover labels, and no added controls beyond the Assets panel. Inspect rendered output before claiming visual verification.

## 9. Pixel-art export

`art/pixel-room/room.px.js` recreates the current plain room as a separate fixed-view pixel asset. Preserve the reference composition and sampled palette, with at most 24 colors across the entire loop. Keep the immutable room shell and window frame separate from 16 local animation patches (100ms each, 1600ms total). Animate pane-clipped rain, identical rotating blades, a one-pixel fan-base wobble, and independently phased bird bobs/blinks. No shadows or added props. Run the actual pxl linter and inspect the art; verify every frame, fixed static pixels and exact patch composition with `npm run art:lint`. The live page must remain interactive. Use the pxl palette across the complete room, including independently raycastable 3D props, wall/floor slabs and all inner/outer edges. Render shell and props on the same low-resolution nearest-neighbor grid, with antialiasing disabled. Pixelated outlines are required; do not add decorative border geometry. Never replace the application with a flattened image, GIF or non-interactive canvas. Prop animation runs at 10 fps, but dragging and manual room rotation must update smoothly. The root `index.html` → `src/main.tsx` → `src/App.tsx` → `src/room/RoomScene.tsx` is the only frontend. Pixel compositing belongs in that original scene module. Do not add a separate HTML player, alternate app, preview entry or redirect page. Files under `art/` and exported PNG/GIF/JSON files are tooling/assets only.

## 10. Prompt controls

The four captured demo choices (Rainy café, Beach, Cyberpunk city, Zen garden) sit in one compact row below
the prompt. Before the first room, position the row independently so the prompt stays centered.
After selection, retain the row for quick switching. Load the entire local scene and its assets
before revealing it; warming bundles must never populate the canonical scene or play audio.
These four explicit demo choices are the exception to the no-preset-controls rule above.

A fresh page shows only the prompt, centered horizontally and vertically. On the first submission, mount the fixed base shell with the Libraries.dev img-fx pixels-organic mosaic mapped onto its floor and two visible walls, and move the prompt below it. This loading effect is view-only; it never adds canonical scene content. Stop the mosaic when the first creation branch validates and its images decode. Audio, rotation arrows and the Assets panel remain gated on that first ready branch. A failure before any result hides the loading shell and recenters the editable prompt. Submit with `scene: null` for the first request and unlock audio from that user gesture. Reveal the room and arrows after the first validated branch and move the same prompt below it; keep it visible if the remaining branch fails. Generated source portals may continue their existing reveal after the room appears. `?demo` follows the same empty start and creates its room on the first supported prompt.

The app includes exactly two plain arrow icons flanking the room and exactly one `BorderBeam size="md" colorVariant="colorful" strength={0.7} theme="dark"` prompt. Use system sans-serif and light text #e8e8f0. The prompt is a 76px-high pill, width min(640px,92vw), background #15151f, radius 999px, padding 16px 6px 16px 20px, gap 8px. Its controlled `input type="text"` is single-line with aria-label Prompt, 15px font, and placeholder Generate anything... in #7a7a90. Never use a textarea. The Send button is a 44px circle with white-to-light-gray gradient and an inline 18px upward-arrow SVG, stroke width 2.5. Disable it for blank/whitespace-only input (opacity .45); enabled hover moves up 1px. Form submission by Enter or click trims the value and sends it with the current scene to `POST /api/scene` through `src/ai/client.ts`; a successful reply updates the scene store and clears the input. One small status line above the prompt reports progress, fallback notices and errors; a failed prompt stays in the input. BorderBeam and img-fx (the first-room surface loader) are the approved UI effect dependencies; do not add icon or other animation packages. Keep the room above both controls at desktop/mobile/landscape sizes.

Rotation arrows have no visible borders, backgrounds, circular containers or text. Use inline 30px horizontal arrow icons in transparent 44px hit targets. Keep them just outside the room silhouette at its vertical center; reserve horizontal viewport space on mobile. Do not bring back the refresh icon.
