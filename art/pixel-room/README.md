# Pixel Room loop

A pixel-art recreation of the current plain gray room: the same left-wall four-pane rainy window, wooden two-bird perch, and pale green fan. Reference capture: [reference.png](reference.png). The 480×270 canvas uses a quarter-scale composition of that capture, without the application button. The exported frames use **20 colors** sampled from the reference, with flat directional face colors and no shadows.

Open **http://localhost:5173/** for the live interactive room: the complete room uses the pxl palette and pixel rendering, including walls, floor, slabs and all inner/outer edges. Dragging, all wall placements, mute and manual rotation remain available. The original `RoomScene.tsx` contains the live pixel rendering. There are no separate frontend HTML files or redirect pages; this directory and its exports are assets/tooling only.

- Source: [room.px.js](room.px.js)
- Downloadable animation: [../../public/pixel-room/room-2x.gif](../../public/pixel-room/room-2x.gif)
- Native animation: [../../public/pixel-room/room.gif](../../public/pixel-room/room.gif)
- Still: [../../public/pixel-room/room-2x.png](../../public/pixel-room/room-2x.png)
- 4×4 frame atlas: [../../public/pixel-room/frames.png](../../public/pixel-room/frames.png)
- Atlas metadata: [../../public/pixel-room/frames.json](../../public/pixel-room/frames.json)
- Patch playback manifest: [../../public/pixel-room/animation.json](../../public/pixel-room/animation.json)
- Verification: [../../public/pixel-room/verification.json](../../public/pixel-room/verification.json)

The loop has **16 frames at 10 fps, lasting exactly 1.6 seconds**. Rain wraps vertically within each pane. Three identical blades advance by one blade pitch per cycle, so their geometry repeats continuously. The guard and fan head remain fixed; the base shifts at most one logical pixel and the short stem tilts with it. The birds bob with a five-frame phase offset and blink at 300ms and 1100ms.

`_shell` is the immutable shared base. Each `frame()` paints only the local moving parts over it. Exported PNG patches contain only pixels that differ from that base. Exported PNG patches reconstruct the same static base without regenerating the room. The application uses live 3D props, so dragging, wall attachment and raycasting remain available in the original scene. Reconstructing each frame from the base and its patch is checked pixel for pixel.

## Build and inspect

Requires Node **22.18+** and the installed `pxl-pixel-art` skill. Its default location is `$HOME/.claude/skills/pxl-pixel-art`; set `PXL_SKILL_DIR` if installed elsewhere. The npm commands invoke the skill's actual CLI and rendering engine; no substitute linter is used.

```sh
npm run art:build
npm run art:lint
npm run art:verify
npm run art:serve
```

`art:serve` opens the pxl live painting viewer at http://localhost:4321. `art:lint` first runs `pxl lint` on the base and animation, then checks **all 16 frames** using pxl's lint engine. It also verifies the palette limit, timing, exact phase wrap, offset blinks, one-pixel base wobble, unchanged static pixels, and exact patch reconstruction. `art:build` exports both GIF sizes, stills, atlas, transparent patches and metadata to `public/pixel-room/`.

Inspect the exported GIF, still and full atlas directly as image assets. Integer upscaling preserves their pixel edges. The application remains the original interactive Three.js frontend.
