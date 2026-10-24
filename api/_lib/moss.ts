import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocumentInfo, SessionIndex } from "@moss-js/moss";
import { exactPreferences, type Preference, type TimeBucket } from "../../src/ai/preferences.js";

export async function deadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Service timed out")), milliseconds);
    })]);
  } finally { clearTimeout(timer!); }
}

export function mossConfigured() {
  return Boolean(process.env.MOSS_PROJECT_ID?.trim() && process.env.MOSS_PROJECT_KEY?.trim());
}

// The owner comes from Convex authentication, never from a browser-supplied index name.
export function memoryIndexName(owner: string) {
  return `soundscape-${createHash("sha256").update(owner).digest("hex").slice(0, 32)}`;
}

async function reconcile(session: SessionIndex, preferences: Preference[]) {
  const old = await session.getDocs();
  const current = new Map(preferences.map((item) => [item._id, item]));
  const removed = old.filter((item) => !current.has(item.id)).map((item) => item.id);
  if (removed.length) await session.deleteDocs(removed);
  const versions = new Map(old.map((item) => [item.id, item.metadata?.updatedAt]));
  const changed: DocumentInfo[] = preferences.filter((item) => versions.get(item._id) !== String(item.updatedAt))
    .map((item) => ({ id: item._id, text: `Task: ${item.task}. Time: ${item.timeBucket}. ${item.summary}`,
      metadata: { task: item.task, timeBucket: item.timeBucket, updatedAt: String(item.updatedAt) } }));
  if (changed.length) await session.addDocs(changed, { upsert: true });
  return Boolean(removed.length || changed.length);
}

async function search(owner: string, preferences: Preference[], query: string, timeBucket: TimeBucket, turns: string[]) {
  const { MossClient } = await import("@moss-js/moss");
  const client = new MossClient(process.env.MOSS_PROJECT_ID!.trim(), process.env.MOSS_PROJECT_KEY!.trim(),
    { cachePath: join(tmpdir(), "soundscape-moss") });
  try {
    let synced = true;
    const name = memoryIndexName(owner);
    const memory = await client.session(name);
    const loaded = await memory.loadIndex(name);
    const changed = await reconcile(memory, preferences);
    if (changed) {
      if (preferences.length) {
        const job = await memory.pushIndex();
        const until = Date.now() + 4_000;
        let status = job.status;
        while (status !== "completed" && status !== "failed" && Date.now() < until) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          status = (await client.getJobStatus(job.jobId)).status;
        }
        synced = status === "completed";
      }
      else if (loaded) await client.deleteIndex(name);
    }
    const filter = { field: "timeBucket", condition: { $in: timeBucket === "any" ? ["any"] : [timeBucket, "any"] } };
    const matches = preferences.length ? await memory.query(query, { topK: 3, filter }) : { docs: [] };
    // Resolve IDs against the current authenticated Convex records, never trust stale index text.
    const current = new Map(preferences.map((item) => [item._id, item]));
    const recalled = matches.docs.map((doc) => current.get(doc.id)).filter((item): item is Preference => Boolean(item));
    const live = await client.session(`turn-${randomUUID()}`);
    if (turns.length) await live.addDocs(turns.map((text, index) => ({ id: String(index), text })));
    const context = turns.length ? (await live.query(query, { topK: 2 })).docs.map((doc) => doc.text) : [];
    return { preferences: recalled, recentContext: context, synced,
      notice: synced ? "Moss memory ready." : "Moss recall is ready for this request; cloud index sync is pending." };
  } finally { await client.close(); }
}

export async function retrieveMemory(owner: string, preferences: Preference[], prompt: string,
  task: string, timeBucket: TimeBucket, turns: string[] = []) {
  if (mossConfigured()) {
    try { return await deadline(search(owner, preferences, `${task}: ${prompt}`, timeBucket, turns), 8_000); }
    catch { /* Exact, authenticated records remain usable during retrieval outages. */ }
  }
  return { preferences: exactPreferences(preferences, task, timeBucket), recentContext: [],
    notice: "Moss semantic recall is unavailable. Using saved task/time matches when available." };
}

export async function syncMemory(owner: string, preferences: Preference[]) {
  if (!mossConfigured()) return "Convex memory updated. Moss search sync is pending configuration.";
  try {
    const result = await deadline(search(owner, preferences, "environment preferences", "any", []), 8_000);
    return result.synced ? "Moss memory synced." : "Convex memory updated. Moss cloud index sync is pending; exact task/time recall still works.";
  } catch { return "Convex memory updated. Moss search sync is pending; exact task/time recall still works."; }
}
