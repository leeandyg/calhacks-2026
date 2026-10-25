import { SceneResponse, type Scene, type SceneRequest } from "../scene/scene.js";
import { currentAgentSession, followManagedRun } from './managedClient.js';
import type { ManagedAssets } from './world.js';

// Browser side of POST /api/scene. Keys stay on the server; this only sends the prompt and scene.

export async function requestScene(prompt: string, scene: Scene | null, demoMode = false, progress?: (message: string) => void, signal?: AbortSignal): Promise<SceneResponse & { notice?: string; managed?: ManagedAssets }> {
  signal?.throwIfAborted();
  if (demoMode) {
    const { offlineResponse } = await import("./offline.js");
    const saved = offlineResponse(prompt, scene);
    return { ...saved.response, notice: `Demo mode. ${saved.notice}` };
  }

  const body: SceneRequest = { prompt, scene };
  let res: Response;
  try {
    res = await fetch("/api/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, sessionToken: scene ? currentAgentSession() : undefined }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
  } catch {
    signal?.throwIfAborted();
    throw new Error("Could not reach the scene agent. Your room was kept unchanged. Please try again.");
  }
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new Error(`Scene agent (${res.status}): ${error?.error || 'Generation failed.'} Your room was kept unchanged.`);
  }
  const json = await res.json().catch(() => null);
  if (json?.kind === 'managed' && typeof json.token === 'string') {
    const result = await followManagedRun(json.token, scene, progress, signal);
    return { ...result.response, managed: result.assets };
  }
  try {
    // Missing assetIds are expected: the store's resolver assigns pack or generated IDs.
    return SceneResponse.parse(json);
  } catch {
    throw new Error("The scene agent returned an invalid scene. Your room was kept unchanged. Please try again.");
  }
}
