import { SceneResponse, type Scene } from "../scene/scene.js";
import { CLAUDE_BUDGET_MS, fallbackScene, requestScene } from "./client.js";
import type { ManagedResult } from './world.js';
import type { WorldPart } from './managedClient.js';
import { currentAgentSession, followManagedRun } from "./managedClient.js";
import { localContext, USUAL_REQUEST, type Preference, type TimeBucket } from "./preferences.js";

export type AgentContext = { token: string; task: string; timeBucket: TimeBucket | "auto"; turns: string[] };
export type AgentReply = { response?: Awaited<ReturnType<typeof requestScene>>; message?: string; notice?: string; recalled?: string[]; restored?: boolean };
export type CommandOptions = { signal?: AbortSignal; onProgress?: (phase: "understanding" | "updating", message?: string) => void; correction?: string };
class AgentError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export function memoryCommand(prompt: string) { return /^(?:remember|forget|save (?:this|my) preference)\b/i.test(prompt.trim()); }

export async function memoryRequest(context: AgentContext, body: Record<string, unknown>, signal?: AbortSignal) {
  const local = localContext();
  const response = await fetch("/api/agent", { method: "POST", headers: {
    Authorization: `Bearer ${context.token}`, "Content-Type": "application/json",
  }, body: JSON.stringify({ ...local, ...context, token: undefined,
    timeBucket: context.timeBucket === "auto" ? local.timeBucket : context.timeBucket, ...body }),
  // Outlasts /api/agent's own budget (auth, Moss and a 40 s session start) within Vercel's 60 s limit.
  signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(58_000)]) : AbortSignal.timeout(58_000) });
  const result = await response.json();
  if (!response.ok) throw new AgentError(result.error || "The agent is unavailable.", response.status);
  return result as AgentReply & { kind?: string; token?: string; preferences?: Preference[] };
}

export async function requestAgent(prompt: string, scene: Scene | null, context?: AgentContext, demoMode = false, progress?: (message: string) => void, signal?: AbortSignal, partial?: (result: ManagedResult, part: WorldPart) => void): Promise<AgentReply> {
  signal?.throwIfAborted();
  if (demoMode || !context?.token) {
    if (memoryCommand(prompt)) throw new Error(demoMode ? "Memory commands need a live connection. Turn off Offline demo." : "Connect to saved rooms to use memory.");
    const response = await requestScene(prompt, scene, demoMode, progress, signal, 'agent', partial);
    return { response, notice: response.notice };
  }
  let startedManaged = false, published = false;
  try {
    const result = await memoryRequest(context, { prompt, scene, sessionToken: scene ? currentAgentSession() : undefined }, signal);
    if (result.kind === 'managed' && result.token) {
      startedManaged = true;
      const generated = await followManagedRun(result.token, scene, progress, signal, CLAUDE_BUDGET_MS, partial ? (ready, part) => { partial(ready, part); published = true; } : undefined);
      return { ...result, response: { ...generated.response, managed: generated.assets } };
    }
    return result.kind ? { ...result, response: SceneResponse.parse(result) } : result;
  } catch (error) {
    signal?.throwIfAborted();
    if (published || memoryCommand(prompt)) throw error;
    if (!startedManaged && error instanceof AgentError && error.status === 401) {
      if (USUAL_REQUEST.test(prompt)) throw error;
      const response = await requestScene(prompt, scene, false, progress, signal, 'agent', partial);
      return { response, notice: response.notice ?? "Memory is offline. This command used the current room and prompt." };
    }
    if (!startedManaged && error instanceof AgentError && error.status < 500 && error.status !== 429) throw error;
    // The agent errored, ran out of time or couldn't be reached: Gemini, then the offline room (client.ts).
    console.warn('agent: falling back', error);
    const response = await fallbackScene(prompt, scene, progress, signal);
    return { response, notice: response.notice };
  }
}
