import { z } from "zod";
import { ART_MODEL, ArtError, runArtAgent } from "../server/artAgent.js";
import { cachedArt } from "../server/artCache.js";
import { pxlDocs } from "../server/pxl.js";
import { ART_PX_PER_BLOCK } from "../src/scene/layout.js";

// POST /api/sprite: { label, query, mount, concept, colors } -> { png, w, h, idea }
// Paints the prop for one sound object in a painted environment (api/environment.ts), with pxl.
// The browser shows a portal at the object's spot until this returns, then the prop pops out.
// Server-only: read keys from process.env here, never in src/.

const BUDGET_MS = 80_000;
// Floor props stand up to 3 blocks wide and 4 tall; wall props reach 3 x 3 blocks.
const SIZE = { floor: { w: 3 * ART_PX_PER_BLOCK, h: 4 * ART_PX_PER_BLOCK }, wall: { w: 3 * ART_PX_PER_BLOCK, h: 3 * ART_PX_PER_BLOCK } };

const SpriteRequest = z.object({
  label: z.string().trim().min(1).max(120),
  query: z.string().trim().min(1).max(400),
  mount: z.enum(["floor", "wall"]),
  /** The environment agent's description of the place, so the prop belongs in it. */
  concept: z.string().max(1500).default(""),
  /** The environment's colors, most used first. */
  colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(48).default([]),
});

const paintArgs = z.object({
  idea: z.string().min(1).max(800).describe("1-3 sentences: what this thing looks like in this place, its silhouette, and how it reads at this size."),
});
type PaintArgs = z.infer<typeof paintArgs> & { code: string };

export async function POST(request: Request): Promise<Response> {
  const parsed = SpriteRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send label, query, mount (floor or wall), concept and colors." }, { status: 400 });
  const { label, query, mount, concept, colors } = parsed.data;
  const size = SIZE[mount];
  const brief = `Paint the prop "${label}", the source of this sound: "${query}".
It ${mount === "wall" ? "is mounted on or grows out of a wall, seen from inside the room: its back touches the wall" : "stands on the ground; its bottom rows are where it touches the ground"}.
The place: ${concept || "(no description)"}
The room's colors, most used first: ${colors.join(" ") || "(choose your own)"}.
1 block = 1 meter = ${ART_PX_PER_BLOCK} px; size the prop like the real thing (a cat is about 1 block, a tree fills the height).`;

  try {
    const result = await cachedArt(['sprite-v2', ART_MODEL, parsed.data], () => runArtAgent<PaintArgs>({
      system: systemInstruction(),
      brief,
      args: paintArgs,
      assets: [{ name: "prop", w: size.w, h: size.h, exact: false }],
      budgetMs: BUDGET_MS,
      check: (_args, rendered) => {
        const prop = rendered.prop;
        const filled = prop.w * prop.h - prop.transparent;
        if (prop.transparent === 0) return "The background must be transparent: leave every pixel outside the prop empty.";
        if (filled < prop.w * prop.h * 0.12 || prop.w < 8 || prop.h < 8) return "The prop is too small or nearly empty: make it fill most of its canvas.";
        return undefined;
      },
    }));
    const { prop } = result.assets;
    return Response.json({ png: `data:image/png;base64,${prop.png}`, w: prop.w, h: prop.h, idea: result.args.idea, rounds: result.rounds }, { headers: { 'Cache-Control': 'private, max-age=604800' } });
  } catch (error) {
    if (error instanceof ArtError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

function systemInstruction(): string {
  return `You are the prop artist for an interactive isometric pixel-art room in a focus app. Every
sound in the room comes from a physical thing, and you paint that thing as one pxl sprite named
"prop" (its documentation follows), viewed from the front at eye level, the way a 2D game draws
props in a 3/4 scene.

Think first about what the thing really looks like in this particular place, and put that in
"idea": an old oak with a gnarled trunk in a misty forest, a mossy branch with two sparrows
growing out of a wall of trunks, a chrome espresso machine on a café counter.

Pixel-art rules:
- Use the room's colors (define them with pal or shades), so the prop belongs in the room. Light
  from the top-left; give it form with 2-4 shades per material, not pillow shading.
- A clear silhouette that reads at this size; use a selective outline (selout) or a dark outline.
- Transparent background: paint only the thing. Crop the sprite to the thing, at most the size
  requested.
- No text, no frame, and no ground, shadow or backdrop under or behind it: the room draws those.
- Rendering stops after 12 seconds: use shapes, stamp and mirroring, not per-pixel loops.

${pxlDocs()}`;
}
