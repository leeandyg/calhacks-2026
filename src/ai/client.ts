import { SceneResponse, type Scene, type SceneRequest } from "../scene/scene.js";
import { loadManifest } from "../audio/manifest.js";
import { offlineResponse } from "./offline.js";

// Browser side of POST /api/scene. Keys stay on the server; this only sends the prompt and scene.

export async function requestScene(prompt: string, scene: Scene | null, demoMode = false): Promise<SceneResponse & { notice?: string }> {
  function localResponse(reason = "AI unavailable.") {
    try {
      const saved = offlineResponse(prompt, scene);
      return { ...saved.response, notice: `${demoMode ? "Demo mode." : reason} ${saved.notice}` };
    } catch (error) {
      throw new Error(`${demoMode ? "" : reason + " "}${error instanceof Error ? error.message : "Choose a local preset."}`);
    }
  }
  if (demoMode) return localResponse();

  const body: SceneRequest = { prompt, scene };
  let res: Response;
  try {
    res = await fetch("/api/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return localResponse();
  }
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) return localResponse();
    throw new Error(`/api/scene failed: ${res.status} ${await res.text()}`);
  }
  let response: SceneResponse;
  try {
    response = SceneResponse.parse(await res.json());
  } catch {
    return localResponse();
  }
  const additions = response.kind === "create" ? response.scene.objects : response.ops.flatMap((op) => op.op === "add" ? [op.object] : []);
  if (additions.some((object) => !object.sound.assetId)) {
    return localResponse("New AI sounds are not linked to audio files yet.");
  }
  if (additions.length) {
    let missingSounds: boolean;
    try {
      const manifest = await loadManifest();
      missingSounds = additions.some((object) => manifest.get(object.sound.assetId!)?.kind !== object.kind);
    } catch {
      return localResponse("The sound pack could not load.");
    }
    if (missingSounds) return localResponse("Some AI sounds are missing from the local sound pack.");
  }
  return response;
}
