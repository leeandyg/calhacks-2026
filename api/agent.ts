import { z } from "zod";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { commandContext, normalizeTask, preferenceExample, PreferenceInput, savedRoomFor, TimeBucket, usualRequest, type Preference } from "../src/ai/preferences.js";
import { Scene } from "../src/scene/scene.js";
import { sceneResponse } from "./scene.js";
import { authenticatedMemory, privateJson } from "./_lib/auth.js";
import { deadline, syncMemory, retrieveMemory, mossConfigured } from "./_lib/moss.js";

const AgentRequest = z.object({
  action: z.enum(["turn", "remember", "forget", "list"]).default("turn"),
  prompt: z.string().trim().max(2000).default(""), scene: Scene.nullable().default(null),
  task: z.string().trim().max(80).default(""), timeBucket: TimeBucket.default("any"),
  timezone: z.string().min(1).max(80).default("UTC"),
  sessionToken: z.string().max(2048).optional(),
  id: z.string().max(100).optional(), turns: z.array(z.string().max(600)).max(6).default([]),
});

// A saved room loads exactly as it was remembered; the kept world's art and sounds reinstall in the browser.
function restoreSaved(saved: Preference, current: Scene | null, notice: string) {
  return privateJson({ kind: "create", restored: true, scene: { ...saved.scene,
    room: { ...saved.scene.room, grid: current?.room.grid ?? saved.scene.room.grid, openings: current?.room.openings ?? saved.scene.room.openings } },
    notice, recalled: [`${saved.task} (${saved.timeBucket})`] });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = AgentRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return privateJson({ error: "Send a valid agent request." }, 400);
  let auth;
  try { auth = await deadline(authenticatedMemory(request), 5_000); }
  catch { return privateJson({ error: "Memory could not authenticate. Check your saved-rooms connection." }, 401); }
  const data = parsed.data;
  const inferred = commandContext(data.prompt, data.task || data.scene?.session?.task || "", data.timeBucket);
  const context = data.action === "remember" ? { task: normalizeTask(data.task) || inferred.task, timeBucket: data.timeBucket } : inferred;
  const action = data.action === "turn" && /^(?:remember|save (?:this|my) preference)\b/i.test(data.prompt) ? "remember"
    : data.action === "turn" && /^forget\b/i.test(data.prompt) ? "forget" : data.action;
  try {
    if (action === "list") return privateJson({ preferences: auth.preferences,
      memory: { provider: mossConfigured() ? "moss" : "convex", status: mossConfigured() ? "configured" : "unconfigured" } });
    if (action === "remember") {
      const preference = PreferenceInput.safeParse({ ...context, timezone: data.timezone, scene: data.scene,
        summary: data.prompt || `I like this room for ${context.task} in the ${context.timeBucket}.` });
      if (!preference.success) return privateJson({ error: "Choose a task and enter a room before remembering a preference." }, 400);
      await deadline(auth.client.mutation(api.preferences.save, { preference: preference.data }), 5_000);
      const latest = await auth.client.query(api.preferences.context, {});
      const notice = await syncMemory(latest.owner, latest.preferences as typeof auth.preferences);
      return privateJson({ message: `Remembered your ${context.task} preference (${context.timeBucket}).`, notice,
        remembered: context, memory: { provider: notice.startsWith("Moss memory") || notice.startsWith("Moss semantic") ? "moss" : "convex", status: notice === "Moss memory synced." ? "synced" : "pending" } });
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
    // "coding" or "my usual coding setup" with coding saved: load that room now instead of asking the world agent to rebuild it.
    const named = savedRoomFor(data.prompt, auth.preferences, context.task, context.timeBucket);
    if (named) return restoreSaved(named, data.scene, `Loaded your saved ${named.task} room.`);
    const memory = await retrieveMemory(auth.owner, auth.preferences, data.prompt, context.task, context.timeBucket, data.turns);
    const fresh = await auth.client.query(api.preferences.context, {});
    memory.preferences = memory.preferences.filter((item) => fresh.preferences.some((record) =>
      record._id === item._id && record.updatedAt === item.updatedAt));
    if (usualRequest(data.prompt)) {
      // No saved task was named; Moss picks the closest saved room for an explicit usual-setup request.
      if (!memory.preferences.length) return privateJson({ error: "No saved preference matches this task and time yet. Choose the task/time you saved or remember a room first." }, 400);
      return restoreSaved(memory.preferences[0], data.scene, `Loaded your closest saved room (${memory.preferences[0].task}).`);
    }
    // Starting or continuing a Claude session makes up to two Anthropic calls of up to 20 s each
    // (server/managedAgent.ts); after auth (5 s) and Moss (8 s) this still fits the 60 s function limit.
    const response = await deadline(sceneResponse(new Request(request.url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: data.prompt, scene: data.scene, sessionToken: data.sessionToken }) }), {
      ...context, preferences: memory.preferences.map(preferenceExample), recentContext: memory.recentContext,
    }), 40_000).catch(() => privateJson({ error: "Scene AI took too long to respond." }, 504));
    const body = await response.json();
    return privateJson({ ...body, notice: memory.notice,
      recalled: memory.preferences.map(({ task, timeBucket }) => `${task} (${timeBucket})`) }, response.status);
  } catch {
    return privateJson({ error: "That operation was not confirmed. Check your memories before retrying; the room was kept." }, 503);
  }
}
