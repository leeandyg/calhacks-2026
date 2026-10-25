# Berkeley bear listener avatar

Asset: `public/sprites/berkeley-bear.png`. Generated with the built-in imagegen tool using the user's headphone photograph as a visual reference. The sprite is transparent and remains separate from scene-owned sounds. Keep its headphone colors fixed; the renderer bypasses the generated environment palette for this asset.

Generation prompt:

> Create a single game-ready pixel-art sprite, transparent background. Subject: a cute UC Berkeley golden bear cub mascot seated upright comfortably wearing the exact headphones from the reference image. Headphones reference only: preserve metallic silver/light-gray outer shells and headband, black charcoal inner headband and thick ear cushions, a tiny red accent on one silver earcup. Do not recolor headphones blue or gold. Golden warm brown furry bear, round bear ears, friendly face, tiny black eyes and brown muzzle, small navy shirt with a simple golden C (Berkeley nod). One single complete character only, no other objects, no shadow, no ground, no glow, no border. Three-quarter front view appropriate to a 30-degree elevated isometric cozy room, mostly front facing, both headphones visible. Seated compact body, paws resting in lap, feet visible. Crisp authentic low-resolution pixel art with chunky deliberate square pixels, limited palette, hard edges and no anti-aliasing, approximately 64 pixels wide by 80 pixels tall in logical pixels, scaled up neatly. Character occupies 85 percent of the canvas height centered horizontally, complete headphones with headband visible above head. Deliver isolated full character on genuinely transparent alpha background. This will be a small persistent avatar at center of a pixel room. NO photorealism or background.

Browser verification:

```sh
PLAYWRIGHT_CHANNEL=chrome TEST_URL=http://localhost:5173 node scripts/bear-avatar-test.mjs
```


## Directional variants

Saved assets:

- `public/sprites/berkeley-bear.png` (front-left)
- `public/sprites/berkeley-bear-front-right.png`
- `public/sprites/berkeley-bear-back-right.png`
- `public/sprites/berkeley-bear-back-left.png`

Built-in imagegen produced the front-right, back-right and back-left PNG siblings of the original asset under `public/sprites/`. Each used the original bear and headphone photo as references, retaining the seated pose, golden fur, navy shirt, silver/black headphones and red accent. Each directional generation was followed by a transparent-background cleanup that removed exterior glow and shadows without changing the character. The app picks the view from the manual room angle, and uses the same image for the permanent You sidebar entry.

Directional prompt specification: preserve the original character, 2:3 canvas, small margins, pixel scale, pose and headphone colors; create a front-right face view, back-right view with no face visible, or back-left view with no face visible. Keep the rear shirt navy without a front C. No floor, shadow, glow, scene, border or added props. Cleanup prompt: preserve all pixels inside the hard character silhouette and remove all exterior halo, bloom, blurred pixels and drop shadow to transparent alpha=0, including the gaps under the headband and between limbs.
