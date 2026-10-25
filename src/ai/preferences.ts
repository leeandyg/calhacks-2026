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

// Recalling a saved room needs no model: a prompt that names a saved task and asks for nothing else
// ("coding", "I'm coding") or asks for the usual setup ("my usual coding environment") loads it as saved.
export const RECALL_WORDS = /\b(?:usual|normal|regular|saved|remembered|preset|favou?rite)\b/i;
export const USUAL_REQUEST = /\b(?:usual|remembered|saved setup)\b/i;
const FILLER = new Set(`a an the i i'm im am is it it's its me my our we us let let's lets ok okay hey agent please now just
  some time to for go going gonna want wanna do doing start starting begin set up setup get ready switch load open bring back
  put on give use with mode session sessions room environment space place vibe this that in at during morning afternoon
  evening night tonight today take show visit enter head there into inside somewhere like would i'd id love again`.split(/\s+/));
const ALIASES: Record<string, string> = { program: "cod" };

function stem(word: string) {
  const stemmed = (word.length > 5 ? word.replace(/ing$/, "") : word)
    .replace(/ies$/, "y").replace(/([^aeiou])\1$/, "$1").replace(/e$/, "");
  return ALIASES[stemmed] ?? stemmed;
}
function keywords(text: string) {
  return new Set(text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/’/g, "'").split(/[^a-z']+/)
    .filter((word) => word && !FILLER.has(word)).map((word) => stem(word.replace(/'/g, ""))));
}

/** True when the prompt names this saved room and asks for nothing else ("take me to the rainy cafe"). */
export function asksOnlyFor(prompt: string, name: string) {
  const words = keywords(prompt), wanted = keywords(name);
  return wanted.size > 0 && [...wanted].every((word) => words.has(word)) && [...words].every((word) => wanted.has(word));
}

/** The saved preference a prompt asks to load, preferring the current time of day without requiring it. */
export function savedRoomFor(prompt: string, preferences: Preference[], task: string, timeBucket: TimeBucket) {
  const words = keywords(prompt), recall = RECALL_WORDS.test(prompt), selected = task.trim().toLowerCase();
  const rank = (item: Preference) => item.timeBucket === timeBucket ? 2 : item.timeBucket === "any" ? 1 : 0;
  return preferences.flatMap((item) => {
    const taskWords = keywords(item.task);
    const named = taskWords.size > 0 && [...taskWords].every((word) => words.has(word));
    // "Use my usual setup" in the memory panel names its task in the Task field.
    if (!named && !(recall && item.task.toLowerCase() === selected)) return [];
    const asksForMore = [...words].some((word) => !taskWords.has(word));
    return recall || !asksForMore ? [{ item, size: taskWords.size }] : [];
  }).sort((a, b) => b.size - a.size || rank(b.item) - rank(a.item) || b.item.updatedAt - a.item.updatedAt)[0]?.item;
}
