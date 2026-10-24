import { SceneResponse, type Scene } from "../scene/scene.js";
import { requestScene } from "./client.js";
import { currentAgentSession, followManagedRun } from "./managedClient.js";
import { localContext, type Preference, type TimeBucket } from "./preferences.js";

export type AgentContext = { token: string; task: string; timeBucket: TimeBucket | "auto"; turns: string[] };
export type AgentReply = { response?: Awaited<ReturnType<typeof requestScene>>; message?: string; notice?: string; recalled?: string[] };
class AgentError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export function memoryCommand(prompt: string) { return /^(?:remember|forget|save (?:this|my) preference)\b/i.test(prompt.trim()); }

export async function memoryRequest(context: AgentContext, body: Record<string, unknown>) {
  const local = localContext();
  const response = await fetch("/api/agent", { method: "POST", headers: {
    Authorization: `Bearer ${context.token}`, "Content-Type": "application/json",
  }, body: JSON.stringify({ ...local, ...context, token: undefined,
    timeBucket: context.timeBucket === "auto" ? local.timeBucket : context.timeBucket, ...body }),
  signal: AbortSignal.timeout(35_000) });
  const result = await response.json();
  if (!response.ok) throw new AgentError(result.error || "The agent is unavailable.", response.status);
  return result as AgentReply & { kind?: string; token?: string; preferences?: Preference[] };
}

export async function requestAgent(prompt: string, scene: Scene | null, context?: AgentContext, demoMode = false, progress?: (message: string) => void): Promise<AgentReply> {
  if (demoMode || !context?.token) {
    if (memoryCommand(prompt)) throw new Error(demoMode ? "Memory commands need a live connection. Turn off Offline demo." : "Connect to saved rooms to use memory.");
    const response = await requestScene(prompt, scene, demoMode, progress);
    return { response, notice: response.notice };
  }
  let startedManaged = false;
  try {
    const result = await memoryRequest(context, { prompt, scene, sessionToken: scene ? currentAgentSession() : undefined });
    if (result.kind === 'managed' && result.token) {
      startedManaged = true;
      const generated = await followManagedRun(result.token, scene, progress);
      return { ...result, response: { ...generated.response, managed: generated.assets } };
    }
    return result.kind ? { ...result, response: SceneResponse.parse(result) } : result;
  } catch (error) {
    if (startedManaged || memoryCommand(prompt)) throw error;
    if (error instanceof AgentError && error.status === 401) {
      if (/\b(?:usual|remembered|saved setup)\b/i.test(prompt)) throw error;
      const response = await requestScene(prompt, scene, false, progress);
      return { response, notice: response.notice ?? "Memory is offline. This command used the current room and prompt." };
    }
    if (error instanceof AgentError && error.status < 500 && error.status !== 429) throw error;
    throw new Error("The scene agent is unavailable. Your room was kept unchanged. Please try again.");
  }
}
