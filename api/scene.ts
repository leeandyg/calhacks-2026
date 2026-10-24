import { fixtures } from "../src/scene/fixtures.js";
import { SceneRequest, type SceneResponse } from "../src/scene/scene.js";

// POST /api/scene: { prompt, scene } -> { kind: "create", scene } | { kind: "edit", ops }
// Runs as a Vercel function in production and through the Vite dev middleware locally.
// Server-only: read keys from process.env here, never in src/.
//
// TODO(#15): replace this stub with Claude (create_scene / edit_scene tools).
// For now it picks a fixture by keyword so the UI and audio can be built against it.

export async function POST(request: Request): Promise<Response> {
  const parsed = SceneRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }

  const prompt = parsed.data.prompt.toLowerCase();
  const key = (Object.keys(fixtures) as (keyof typeof fixtures)[]).find((k) => prompt.includes(k));
  const response: SceneResponse = { kind: "create", scene: fixtures[key ?? "cafe"] };
  return Response.json(response);
}
