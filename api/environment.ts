import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ART_MODEL, ArtError, planAgent, runArtAgent } from "../server/artAgent.js";
import { cachedArt } from "../server/artCache.js";
import { pxlDocs } from "../server/pxl.js";
import { ART_PX_PER_BLOCK as PX } from "../src/scene/layout.js";
import { RoomGrid, RoomPreset, TERRAIN_MAX, WallId } from "../src/scene/scene.js";

// POST /api/environment: { prompt, preset, grid, objects } -> NDJSON stream, one event per line:
//   { type: "plan", id, title, concept, shell, colors, terrain }      the ground's shape, as soon as it's planned
//   { type: "texture", surface, png, colors } | { type: "texture", surface, error }   floor, north, east, south, west
//   { type: "done" }
// Called after /api/scene creates a scene, so the room appears before its sound objects do.
//
// 1. Plan (thinking "medium"): the environment agent reasons about the real place and returns its
//    concept, palette, uneven terrain and what to paint on each surface. No pixels yet.
// 2. Paint: five painters (thinking "low", in parallel) each write pxl for one surface from the
//    plan, render it in the sandbox and fix errors (server/artAgent.ts).
// Server-only: read keys from process.env here, never in src/.

const PLAN_TIMEOUT_MS = 35_000;
const PAINT_BUDGET_MS = 80_000;
const SURFACES = ["floor", ...WallId.options] as const;
type Surface = typeof SURFACES[number];

const EnvironmentRequest = z.object({
  prompt: z.string().trim().min(1).max(1000),
  preset: RoomPreset,
  grid: RoomGrid,
  /** What /api/scene put in the room, so the painting leaves space for it. */
  objects: z.array(z.object({ label: z.string().max(120), wall: WallId.nullable().optional() })).max(12).default([]),
}).refine(({ grid }) => grid.mode !== 'Square' || grid.columns === grid.rows, 'Square grid needs equal columns and rows.');

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Plan = z.object({
  title: z.string().trim().min(1).max(60).describe("A short, literal 1–4 word environment label for Visited places, such as Rainy Cafe, Beach, Cyberpunk City, or Zen Garden. Use the place type and defining atmosphere. No poetic names, slogans, metaphors, invented venue names, quotes, or rendering terminology."),
  concept: z.string().min(1).max(1500).describe("2-5 sentences: what this place really looks like around a person standing in it, the ground, the light, and why."),
  palette: z.array(hex).min(8).max(24).describe("8-24 colors for the whole room, as ramps from dark to light."),
  shell: hex.describe("Color of the wall tops and the floor's outer edge, from the palette."),
  // Flatten only the model's tool argument to keep Gemini's constrained decoder small. The
  // streamed/shared contract remains [row][column]. Rows run north to south, columns west to east.
  terrain: z.array(z.number().min(0).max(TERRAIN_MAX)).max(576).describe(`Flat row-major ground heights, one number per cell, north row first, west to east; 0 to ${TERRAIN_MAX} in steps of 0.25.`),
  surfaces: z.object({
    floor: z.string().min(1).max(800),
    north: z.string().min(1).max(800),
    east: z.string().min(1).max(800),
    south: z.string().min(1).max(800),
    west: z.string().min(1).max(800),
  }).describe("For each surface, exactly what to paint on it and where: specific enough that a painter who can't see the others makes them fit together."),
});
type Plan = z.infer<typeof Plan>;

export async function POST(request: Request): Promise<Response> {
  const parsed = EnvironmentRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send a prompt, a preset, the room grid and its objects." }, { status: 400 });
  const { prompt, preset, grid, objects } = parsed.data;
  const { columns, rows, wallHeight } = grid;

  let plan: Plan;
  try {
    plan = Plan.parse(await cachedArt(['plan-v3-flat', ART_MODEL, parsed.data], () => planAgent({
      system: planInstruction(),
      input: `Plan this environment: "${prompt}" (room preset: ${preset}).
The room is ${columns} blocks wide (x, west to east), ${rows} deep (z, north to south), walls ${wallHeight} blocks high; 1 block = 1 meter.
Sound objects that will be separate props in it (don't plan them into the surfaces): ${objects.length ? objects.map((o) => `${o.label} (${o.wall ? `on the ${o.wall} wall` : "on the ground"})`).join("; ") : "none yet"}.`,
      name: "plan_environment",
      description: "Submit the environment plan.",
      args: Plan,
      thinking: "medium",
      timeoutMs: PLAN_TIMEOUT_MS,
      check: (p) => {
        if (p.terrain.length !== rows * columns) return `terrain must have exactly ${rows * columns} heights (${rows} rows of ${columns}, flattened).`;
        if (p.terrain.some((h, i) => Math.abs(h * 4 - Math.round(h * 4)) > 0.001 || h > Math.max(0, wallHeight - 1.5) || (i % columns > 0 && Math.abs(h - p.terrain[i - 1]) > 0.5) || (i >= columns && Math.abs(h - p.terrain[i - columns]) > 0.5))) return 'Use quarter-block heights, at most 0.5 between neighbors, leaving 1.5 blocks clear below the wall top.';
        return undefined;
      },
    })));
  } catch (error) {
    if (error instanceof ArtError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }

  const terrain = Array.from({ length: rows }, (_, row) => plan.terrain.slice(row * columns, (row + 1) * columns));
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => { if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
      send({ type: "plan", id: `env-${randomUUID().slice(0, 8)}`, title: plan.title, concept: plan.concept, shell: plan.shell.toLowerCase(), colors: plan.palette.map((c) => c.toLowerCase()), terrain });
      await Promise.all(SURFACES.map(async (surface) => {
        try {
          const { png, colors } = await cachedArt(['surface-v2', ART_MODEL, surface, plan, grid, prompt], () => paintSurface(surface, plan, terrain, grid, prompt));
          send({ type: "texture", surface, png, colors });
        } catch (error) {
          console.warn(`environment: painting ${surface} failed:`, error instanceof Error ? error.message : error);
          send({ type: "texture", surface, error: error instanceof Error ? error.message : "Painting failed." });
        }
      }));
      send({ type: "done" });
      if (!cancelled) controller.close();
    },
    cancel() { cancelled = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}

async function paintSurface(surface: Surface, plan: Plan, terrain: number[][], grid: RoomGrid, prompt: string) {
  const width = surface === "floor" || surface === "north" || surface === "south" ? grid.columns : grid.rows;
  const height = surface === "floor" ? grid.rows : grid.wallHeight;
  const name = surface === "floor" ? "floor" : `wall_${surface}`;
  const view = surface === "floor"
    ? `the ground seen from directly above: x runs west to east, y runs north to south (y = 0 is the north edge). Its height map in blocks (rows north to south) is:\n${terrain.map((row) => row.join(" ")).join("\n")}\nPaint it to match: low cells are hollows or water, high cells mounds or rocks, each cell ${PX} px square.`
    : `the ${surface} side seen from inside the room, left to right; y = 0 is the top of the wall and the bottom rows meet the ground.`;
  const result = await runArtAgent<{ code: string; idea: string }>({
    system: paintInstruction(),
    brief: `The place: "${prompt}". ${plan.concept}
Palette (use these colors, with shades() ramps between them): ${plan.palette.join(" ")}.
Paint "${name}", ${view}
What goes here: ${plan.surfaces[surface]}`,
    args: z.object({ idea: z.string().min(1).max(600).describe("One or two sentences: how you'll compose this surface.") }),
    assets: [{ name, w: width * PX, h: height * PX, exact: true }],
    budgetMs: PAINT_BUDGET_MS,
    thinking: "low",
    check: (_args, rendered) => rendered[name].transparent > 0 ? `${name} must be fully painted: every pixel opaque.` : undefined,
  });
  return { png: `data:image/png;base64,${result.assets[name].png}`, colors: result.assets[name].colors.slice(0, 24) };
}

function planInstruction(): string {
  return `You are the environment designer for an interactive isometric pixel-art room in a focus app.
Someone describes a place; you plan the room so it is that place. Treat it as a real environment,
not a box with wallpaper: think about what actually surrounds a person standing there, what the
ground is like underfoot, where the light comes from, before you answer.

Plan:
- title: author a short, literal 1–4 word environment label (at most 60 characters), such as "Rainy Cafe", "Beach", "Cyberpunk City", or "Zen Garden". Use the place type and defining atmosphere from the request. Avoid poetic names, slogans, metaphors, invented venue names, and rendering terminology.
- concept: the place in a few sentences.
- palette: one coherent palette of 8-24 colors, as ramps (dark to light) per material, light from
  the top-left. Muted and natural unless the place is neon or vivid.
- terrain: the ground's height per floor cell, a FLAT row-major list (north row first, west to east).
  Real ground is uneven: a forest has mounds, roots
  and a low creek bed; a beach slopes to the water; indoor floors are flat (0) except maybe a step
  or a platform. Neighboring cells differ by at most 0.5.
- surfaces: what to paint on the floor and on each wall (north, east, south, west, each seen from
  inside). Walls show what surrounds you: a forest's are dense trunks and undergrowth with depth
  and gaps of light, not a flat green plane; a café's are brick, shelves, a rain-streaked window.
  Make the sides differ the way a real place does, and say where things are so the floor matches
  the terrain and the walls meet the ground.`;
}

function paintInstruction(): string {
  return `You paint one surface of an isometric pixel-art room with pxl (documentation below), as
part of a planned environment. Follow the plan and its palette exactly so the surfaces fit together.

Pixel-art rules:
- Read as the real material at this scale: bark, roots, moss, stone, boards, brick. Light from the
  top-left, 2-4 shades per material from shades() ramps, no pillow shading, no noise for its own
  sake, no black outlines on textures.
- Every pixel must be opaque, at exactly the size requested.
- Rendering stops after 12 seconds: use rect/ellipse/line/noise/shapes and parts placed with
  stamp or simple loops over a few dozen shapes, never a loop that sets every pixel one at a time.

${pxlDocs()}`;
}
