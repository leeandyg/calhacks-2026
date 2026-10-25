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

// Recalling a saved room needs no model: a prompt that names a saved task and asks for nothing else
// ("coding", "I'm coding") or asks for the usual setup ("my usual coding environment") loads it as saved.
const RECALL_WORDS = /\b(?:usual|normal|regular|saved|remembered|preset|favou?rite)\b/i;
const USUAL_REQUEST = /\b(?:use|restore|load|set\s+up|bring\s+back)\s+(?:(?:my|the|a)\s+)?(?:usual|remembered|saved)\b/i;
const DECLINED = /\b(?:don['’]t|do not|never)\s+(?:use|restore|load|set\s+up|bring\s+back)\b/i;
/** "Set up my usual …" (and not "don't use my usual …"): load a saved room even when no task is named. */
export function usualRequest(prompt: string) { return USUAL_REQUEST.test(prompt) && !DECLINED.test(prompt); }
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
  const recallWords = keywords("usual normal regular saved remembered preset favorite favourite");
  const rank = (item: Preference) => item.timeBucket === timeBucket ? 2 : item.timeBucket === "any" ? 1 : 0;
  return preferences.flatMap((item) => {
    const taskWords = keywords(item.task);
    const named = taskWords.size > 0 && [...taskWords].every((word) => words.has(word));
    // "Use my usual setup" in the memory panel names its task in the Task field.
    if (!named && !(recall && item.task.toLowerCase() === selected)) return [];
    // Anything beyond the task and recall words ("make the rain quieter than my usual…") is an edit, not a recall.
    const asksForMore = [...words].some((word) => !taskWords.has(word) && !recallWords.has(word));
    return asksForMore ? [] : [{ item, size: taskWords.size }];
  }).sort((a, b) => b.size - a.size || rank(b.item) - rank(a.item) || b.item.updatedAt - a.item.updatedAt)[0]?.item;
}
