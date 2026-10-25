import { z } from "zod";
import { Scene } from "../scene/scene.js";

export const TimeBucket = z.enum(["any", "morning", "afternoon", "evening", "night"]);
export type TimeBucket = z.infer<typeof TimeBucket>;
export const PreferenceInput = z.object({
  task: z.string().trim().min(1).max(80),
  timeBucket: TimeBucket,
  timezone: z.string().min(1).max(80),
  summary: z.string().trim().min(1).max(600),
  scene: Scene,
});
export type PreferenceInput = z.infer<typeof PreferenceInput>;
export type Preference = PreferenceInput & { _id: string; updatedAt: number };
export type MemoryInfo = { provider: "moss" | "convex"; status: "configured" | "synced" | "pending" | "unconfigured" };

const activities = /\b(code|coding|program|programming|read|reading|study|studying|write|writing|sleep|sleeping|meditate|meditating)\b/i;
const aliases: Record<string, string> = { code: "coding", program: "coding", programming: "coding", read: "reading", study: "studying", write: "writing", sleep: "sleeping", meditate: "meditating" };
export function normalizeTask(task: string) {
  const value = task.trim().toLowerCase();
  return Object.hasOwn(aliases, value) ? aliases[value] : value;
}
const startingActivity = /\b(?:i(?:['’]m|\s+am)\s+(?:(?:going|about)\s+to\s+)?|i(?:['’]ll|\s+will|\s+want\s+to)\s+|(?:when|while)\s+i\s+)(code|coding|program|programming|read|reading|study|studying|write|writing|sleep|sleeping|meditate|meditating)\b/i;
export function startingTask(prompt: string): string | undefined {
  const match = startingActivity.exec(prompt);
  return match ? normalizeTask(match[1]) : undefined;
}
export function isTaskRecall(prompt: string) {
  const match = startingActivity.exec(prompt);
  return Boolean(match && !prompt.slice(0, match.index).trim() &&
    /^(?:[\s,.!?]|\b(?:now|today|this|in|the|at|morning|afternoon|evening|night)\b)*$/i.test(prompt.slice(match.index + match[0].length)));
}
export function taskPlacePreference(prompt: string, selectedTime: TimeBucket | "auto" = "auto") {
  const start = startingActivity.exec(prompt);
  if (!start || prompt.slice(0, start.index).trim() || /\b(?:don['’]t|do not|never|without)\s+(?:remember(?:ing)?|sav(?:e|ing)|learn(?:ing)?)\b/i.test(prompt)) return undefined;
  const task = startingTask(prompt);
  const place = /\b(?:bring|take|put|move)\s+me\s+(?:to|in|at|by)\s+(?:the\s+|a\s+)?(.+?)[.!?]*$/i.exec(prompt)?.[1]?.trim();
  if (!task || !place) return undefined;
  const explicitTime = prompt.match(/\b(morning|afternoon|evening|night)\b/i)?.[1]?.toLowerCase() as TimeBucket | undefined;
  return { task, timeBucket: explicitTime ?? (selectedTime === "auto" ? "any" : selectedTime),
    summary: prompt.trim().slice(0, 600), place: place.slice(0, 160) };
}

export function localContext(date = new Date()) {
  const hour = date.getHours();
  const timeBucket: TimeBucket = hour >= 5 && hour < 12 ? "morning"
    : hour < 17 && hour >= 12 ? "afternoon" : hour >= 17 && hour < 22 ? "evening" : "night";
  return { timeBucket, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

export function commandContext(prompt: string, task: string, timeBucket: TimeBucket) {
  const bucket = prompt.match(/\b(morning|afternoon|evening|night)\b/i)?.[1]?.toLowerCase() as TimeBucket | undefined;
  const activity = prompt.match(activities)?.[1]?.toLowerCase();
  const explicitTask = prompt.match(/^(?:remember|save)\s+(?:this(?:\s+(?:room|setup|environment))?\s+)?for\s+(.+?)(?=\s+(?:in the|at|during the)\s+(?:morning|afternoon|evening|night)\b|[.!?]|$)/i)?.[1]?.trim();
  const chosenTask = (explicitTask ?? activity ?? task.trim()).slice(0, 80);
  return { task: normalizeTask(chosenTask), timeBucket: bucket ?? timeBucket };
}

// Scene examples describe sounds; the resolver remains the only writer of live asset IDs.
export function preferenceExample(preference: Preference) {
  return {
    summary: preference.summary, task: preference.task, timeBucket: preference.timeBucket,
    room: preference.scene.room,
    sounds: preference.scene.objects.map(({ sound, ...object }) => ({ ...object, sound: { query: sound.query } })),
  };
}

export function exactPreferences(preferences: Preference[], task: string, timeBucket: TimeBucket) {
  const normalized = normalizeTask(task);
  return preferences.filter((item) => normalizeTask(item.task) === normalized &&
    (item.timeBucket === timeBucket || item.timeBucket === "any"))
    .sort((a, b) => Number(b.timeBucket === timeBucket) - Number(a.timeBucket === timeBucket) || b.updatedAt - a.updatedAt)
    .slice(0, 3);
}
