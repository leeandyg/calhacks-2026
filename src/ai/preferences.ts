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

export function localContext(date = new Date()) {
  const hour = date.getHours();
  const timeBucket: TimeBucket = hour >= 5 && hour < 12 ? "morning"
    : hour < 17 && hour >= 12 ? "afternoon" : hour >= 17 && hour < 22 ? "evening" : "night";
  return { timeBucket, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

export function commandContext(prompt: string, task: string, timeBucket: TimeBucket) {
  const bucket = prompt.match(/\b(morning|afternoon|evening|night)\b/i)?.[1]?.toLowerCase() as TimeBucket | undefined;
  const activity = prompt.match(/\b(coding|programming|reading|studying|writing|sleeping|meditating)\b/i)?.[1]?.toLowerCase();
  const explicitTask = prompt.match(/^(?:remember|save)\s+(?:this(?:\s+(?:room|setup|environment))?\s+)?for\s+(.+?)(?=\s+(?:in the|at|during the)\s+(?:morning|afternoon|evening|night)\b|[.!?]|$)/i)?.[1]?.trim();
  const chosenTask = (explicitTask ?? activity ?? task.trim()).slice(0, 80);
  return { task: chosenTask.toLowerCase() === "programming" ? "coding" : chosenTask, timeBucket: bucket ?? timeBucket };
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
  const normalized = task.trim().toLowerCase();
  return preferences.filter((item) => item.task.toLowerCase() === normalized &&
    (item.timeBucket === timeBucket || item.timeBucket === "any"))
    .sort((a, b) => Number(b.timeBucket === timeBucket) - Number(a.timeBucket === timeBucket) || b.updatedAt - a.updatedAt)
    .slice(0, 3);
}
