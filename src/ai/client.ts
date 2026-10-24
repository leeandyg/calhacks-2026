import { SceneResponse, type Scene, type SceneRequest } from "../scene/scene.js";
import { currentAgentSession, followManagedRun } from './managedClient.js';
import type { ManagedAssets } from './world.js';
import { offlineResponse } from "./offline.js";

// Browser side of POST /api/scene. Keys stay on the server; this only sends the prompt and scene.

export async function requestScene(prompt: string, scene: Scene | null, demoMode = false, progress?: (message: string) => void): Promise<SceneResponse & { notice?: string; managed?: ManagedAssets }> {
  function localResponse() {
    try {
      const saved = offlineResponse(prompt, scene);
      return { ...saved.response, notice: `${demoMode ? "Demo mode." : "AI unavailable."} ${saved.notice}` };
    } catch (error) {
      throw new Error(`${demoMode ? "" : "AI unavailable. "}${error instanceof Error ? error.message : "Choose a local preset."}`);
    }
  }
  if (demoMode) return localResponse();

  const body: SceneRequest = { prompt, scene };
  let res: Response;
  try {
    res = await fetch("/api/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, sessionToken: scene ? currentAgentSession() : undefined }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return localResponse();
  }
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) return localResponse();
    throw new Error(`/api/scene failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json().catch(() => null);
  if (json?.kind === 'managed' && typeof json.token === 'string') {
    const result = await followManagedRun(json.token, scene, progress);
    return { ...result.response, managed: result.assets };
  }
  try {
    // Missing assetIds are expected: the store's resolver assigns pack or generated IDs.
    return SceneResponse.parse(json);
  } catch {
    return localResponse();
  }
}
