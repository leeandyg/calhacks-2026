import { SceneResponse, type Scene } from "../scene/scene.js";
import { currentAgentSession, followManagedRun } from './managedClient.js';
import { AGENT_MODE } from './mode.js';
import type { ManagedResult } from './world.js';
import type { WorldPart } from './managedClient.js';
import type { ManagedAssets } from './world.js';

// Browser side of POST /api/scene. Keys stay on the server; this only sends the prompt and scene.
//
// A prompt always ends in a playable room, and the notice says how it was made (#110):
//   1. the server's agent: Claude when ANTHROPIC_API_KEY is set, otherwise Gemini;
//   2. if that fails (no reply, 429/5xx, an invalid reply, a Claude world that errors or runs past
//      CLAUDE_BUDGET_MS), Gemini builds the standard room;
//   3. if Gemini fails too (no network, rate limits), the offline preset or recorded edit.
// A bad request (any other 4xx) is the app's own mistake and stays an error.

export type SceneReply = SceneResponse & { notice?: string; managed?: ManagedAssets };
type Engine = 'agent' | 'gemini';

/** How long a Claude world may take before Gemini builds the room instead. */
export const CLAUDE_BUDGET_MS = 5 * 60 * 1000;

/** A failure the next step of the fallback can recover from. */
class Unavailable extends Error {}

const OFFLINE = 'Offline: the scene AI is unavailable.';

export async function requestScene(prompt: string, scene: Scene | null, demoMode = false, progress?: (message: string) => void, signal?: AbortSignal, engine: Engine = 'agent', partial?: (result: ManagedResult, part: WorldPart) => void): Promise<SceneReply> {
  signal?.throwIfAborted();
  if (demoMode) return localResponse(prompt, scene, 'Demo mode.', signal);
  let published = false;
  try {
    return await ask(prompt, scene, engine, progress, signal, partial ? (result, part) => { partial(result, part); published = true; } : undefined);
  } catch (error) {
    signal?.throwIfAborted();
    if (published || !(error instanceof Unavailable)) throw error;
    console.warn('scene: falling back', error);
    return engine === 'agent' ? fallbackScene(prompt, scene, progress, signal) : localResponse(prompt, scene, OFFLINE, signal);
  }
}

/** Steps 2 and 3, also used by voice and memory turns (agent.ts) when their agent fails. */
export async function fallbackScene(prompt: string, scene: Scene | null, progress?: (message: string) => void, signal?: AbortSignal): Promise<SceneReply> {
  signal?.throwIfAborted();
  progress?.('The world builder is unavailable. Building a simpler room with Gemini…');
  try {
    const reply = await ask(prompt, scene, 'gemini', progress, signal);
    return { ...reply, notice: 'The world builder was unavailable, so Gemini built a simpler room.' };
  } catch (error) {
    signal?.throwIfAborted();
    if (!(error instanceof Unavailable)) throw error;
    console.warn('scene: Gemini is unavailable too', error);
    return localResponse(prompt, scene, OFFLINE, signal);
  }
}

async function ask(prompt: string, scene: Scene | null, engine: Engine, progress?: (message: string) => void, signal?: AbortSignal, partial?: (result: ManagedResult, part: WorldPart) => void): Promise<SceneReply> {
  signal?.throwIfAborted();
  let res: Response;
  try {
    res = await fetch("/api/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(engine === 'gemini' ? { prompt, scene, engine } : { prompt, scene, mode: AGENT_MODE, sessionToken: scene ? currentAgentSession() : undefined }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
  } catch {
    signal?.throwIfAborted();
    throw new Unavailable('Could not reach the scene AI.');
  }
  if (!res.ok) {
    const error = await res.json().catch(() => null);
    const message = `Scene AI (${res.status}): ${error?.error || 'Generation failed.'}`;
    if (res.status === 429 || res.status >= 500) throw new Unavailable(message);
    throw new Error(`${message} Your room was kept unchanged.`);
  }
  const json = await res.json().catch(() => null);
  signal?.throwIfAborted();
  if (json?.kind === 'managed' && typeof json.token === 'string' && engine === 'agent') {
    try {
      const result = await followManagedRun(json.token, scene, progress, signal, CLAUDE_BUDGET_MS, partial, AGENT_MODE);
      return { ...result.response, managed: result.assets };
    } catch (error) {
      signal?.throwIfAborted();
      throw new Unavailable(error instanceof Error ? error.message : 'Claude could not finish this world.');
    }
  }
  // Missing assetIds are expected: the store's resolver assigns pack or generated IDs.
  const parsed = SceneResponse.safeParse(json);
  if (!parsed.success) throw new Unavailable('The scene AI returned an invalid scene.');
  return parsed.data;
}

async function localResponse(prompt: string, scene: Scene | null, prefix: string, signal?: AbortSignal): Promise<SceneReply> {
  const { offlineResponse } = await import("./offline.js");
  signal?.throwIfAborted();
  try {
    const saved = offlineResponse(prompt, scene);
    return { ...saved.response, notice: `${prefix} ${saved.notice}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Choose a listed demo prompt.';
    throw new Error(`${prefix} ${message}${/kept unchanged/.test(message) ? '' : ' Your room was kept unchanged.'}`);
  }
}
