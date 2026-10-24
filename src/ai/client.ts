import { SceneResponse, type Scene, type SceneRequest } from "../scene/scene.js";

// Browser side of POST /api/scene. Keys stay on the server; this only sends the prompt and scene.

export async function requestScene(prompt: string, scene: Scene | null): Promise<SceneResponse> {
  const body: SceneRequest = { prompt, scene };
  const res = await fetch("/api/scene", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`/api/scene failed: ${res.status} ${await res.text()}`);
  return SceneResponse.parse(await res.json());
}
