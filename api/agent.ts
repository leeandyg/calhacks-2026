import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { commandContext, exactPreferences, preferenceExample, PreferenceInput, TimeBucket } from "../src/ai/preferences.js";
import { Scene } from "../src/scene/scene.js";
import { sceneResponse } from "./scene.js";
import { authenticatedMemory, privateJson } from "./_lib/auth.js";
import { deadline, syncMemory, retrieveMemory } from "./_lib/moss.js";

const AgentRequest = z.object({
  action: z.enum(["turn", "remember", "forget", "list"]).default("turn"),
  prompt: z.string().trim().max(2000).default(""), scene: Scene.nullable().default(null),
  task: z.string().trim().max(80).default(""), timeBucket: TimeBucket.default("any"),
  timezone: z.string().min(1).max(80).default("UTC"),
  id: z.string().max(100).optional(), turns: z.array(z.string().max(600)).max(6).default([]),
});

export async function POST(request: Request): Promise<Response> {
  const parsed = AgentRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return privateJson({ error: "Send a valid agent request." }, 400);
  let auth;
  try { auth = await deadline(authenticatedMemory(request), 5_000); }
  catch { return privateJson({ error: "Memory could not authenticate. Check your saved-rooms connection." }, 401); }
  const data = parsed.data;
  const context = commandContext(data.prompt, data.task || data.scene?.session?.task || "", data.timeBucket);
  const action = data.action === "turn" && /^(?:remember|save (?:this|my) preference)\b/i.test(data.prompt) ? "remember"
    : data.action === "turn" && /^forget\b/i.test(data.prompt) ? "forget" : data.action;
  try {
    if (action === "list") return privateJson({ preferences: auth.preferences });
    if (action === "remember") {
      const preference = PreferenceInput.safeParse({ ...context, timezone: data.timezone, scene: data.scene,
        summary: data.prompt || `I like this room for ${context.task} in the ${context.timeBucket}.` });
      if (!preference.success) return privateJson({ error: "Choose a task and enter a room before remembering a preference." }, 400);
      await deadline(auth.client.mutation(api.preferences.save, { preference: preference.data }), 5_000);
      const latest = await auth.client.query(api.preferences.context, {});
      const notice = await syncMemory(latest.owner, latest.preferences as typeof auth.preferences);
      return privateJson({ message: `Remembered your ${context.task} preference (${context.timeBucket}).`, notice });
    }
    if (action === "forget") {
      const records = data.id ? auth.preferences.filter((item) => item._id === data.id)
        : auth.preferences.filter((item) => item.task.toLowerCase() === context.task.toLowerCase() && item.timeBucket === context.timeBucket);
      if (!records.length) return privateJson({ error: "No matching preference. Choose a saved memory to forget." }, 404);
      for (const record of records) await auth.client.mutation(api.preferences.remove, { id: record._id as Id<"preferences"> });
      const latest = await auth.client.query(api.preferences.context, {});
      const notice = await syncMemory(latest.owner, latest.preferences as typeof auth.preferences);
      return privateJson({ message: "Forgot that preference.", notice });
    }
    if (!data.prompt) return privateJson({ error: "Describe an environment or an edit." }, 400);
    const memory = await retrieveMemory(auth.owner, auth.preferences, data.prompt, context.task, context.timeBucket, data.turns);
    const fresh = await auth.client.query(api.preferences.context, {});
    memory.preferences = memory.preferences.filter((item) => fresh.preferences.some((record) =>
      record._id === item._id && record.updatedAt === item.updatedAt));
    const usual = /\b(?:usual|remembered|saved setup)\b/i.test(data.prompt);
    if (usual && !memory.preferences.length) {
      return privateJson({ error: "No saved preference matches this task and time yet. Choose the task/time you saved or remember a room first." }, 400);
    }
    const response = await deadline(sceneResponse(new Request(request.url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: data.prompt, scene: data.scene }) }), {
      ...context, preferences: memory.preferences.map(preferenceExample), recentContext: memory.recentContext,
    }), 15_000).catch(() => privateJson({ error: "Scene AI took too long to respond." }, 504));
    const body = await response.json();
    // An explicit request for a saved setup can restore its validated snapshot if AI is down.
    // Other edits must never fall back to replacing the user's room.
    const saved = exactPreferences(memory.preferences, context.task, context.timeBucket)[0];
    if (!response.ok && usual && saved) return privateJson({ kind: "create", scene: { ...saved.scene,
      room: { ...saved.scene.room, grid: data.scene?.room.grid ?? saved.scene.room.grid,
        openings: data.scene?.room.openings ?? saved.scene.room.openings } },
      notice: "Scene AI is unavailable. Restored your saved task/time room.", recalled: [`${saved.task} (${saved.timeBucket})`] });
    return privateJson({ ...body, notice: memory.notice,
      recalled: memory.preferences.map(({ task, timeBucket }) => `${task} (${timeBucket})`) }, response.status);
  } catch {
    return privateJson({ error: "That operation was not confirmed. Check your memories before retrying; the room was kept." }, 503);
  }
}
