# Room agent instructions

Read and follow [LAYOUT.md](LAYOUT.md) before generating or changing the room, source objects, camera, or interactions. It is the layout and behavior contract for this project. Keep the frontend to the room, two plain left/right rotation arrows beside the room and one BorderBeam-wrapped prompt bar.

Use the shared Zod scene schema and Zustand mutation actions. Keep view rotation separate from canonical source positions. Do not add shadows, decorative non-source objects, backend services, AI calls, or audio implementation.

Use integer Square/Rectangle grid counts with independent wall height. Use the same fixed `SLAB_THICKNESS` for walls and floor, with a continuous environment finish and no trim or borders. Plain rooms are gray and unmarked; forest has sparse seeded dirt/moss pixels that fade with their walls. Room rotation is manual only; do not add edge-triggered, delayed, or automatic turns.

Validate with `npm run build`, `npm test`, and the relevant browser scripts with the Vite server running. Installed Chrome can be used with `PLAYWRIGHT_CHANNEL=chrome`.

Pixel-art styling must preserve live object dragging, mute, rotation and world-space wall visibility. Pixelate the whole room on a shared pixel grid using the pxl palette: source props, walls, floor, slabs, and every inner/outer edge. Disable antialiasing; do not leave a smooth shell or smooth border. Never substitute the static animation export for the interactive room.

Use the original root index.html and App/RoomScene frontend only. Keep pixel rendering in the original RoomScene.tsx; do not create alternate HTML players or redirect entrypoints. Source-window openings must preserve one complete corner segment at each wall end, including after room resize and source scaling.
