import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "vite";
import { MossClient } from "@moss-js/moss";

// Explicit live-provider check: creates and deletes one isolated test index.
const env = { ...process.env, ...loadEnv("development", process.cwd(), "") };
if (!env.MOSS_PROJECT_ID?.trim() || !env.MOSS_PROJECT_KEY?.trim()) throw new Error("Configure Moss project credentials first.");
const client = new MossClient(env.MOSS_PROJECT_ID.trim(), env.MOSS_PROJECT_KEY.trim(), { cachePath: join(tmpdir(), "soundscape-moss") });
const name = `soundscape-check-${randomUUID()}`;
let pushed = false, step = "opening session";
try {
  const live = await client.session(name);
  step = "indexing preferences";
  await live.addDocs([
    { id: "coding", text: "When programming in the morning I prefer nearby rain and brown noise, with very few distracting events.", metadata: { timeBucket: "morning" } },
    { id: "reading", text: "While reading a book in the evening I like a quiet fireplace and no birds.", metadata: { timeBucket: "evening" } },
  ]);
  step = "semantic recall";
  const match = await live.query("My usual environment for software development", { topK: 1 });
  assert.equal(match.docs[0]?.id, "coding");
  console.log("PASS live Moss semantic recall matches a paraphrased task");
  step = "persistent save";
  const job = await live.pushIndex(); pushed = true;
  const until = Date.now() + 30_000;
  let status = job.status;
  while (status !== "completed" && status !== "failed" && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    status = (await client.getJobStatus(job.jobId)).status;
  }
  assert.equal(status, "completed", "Moss index build did not complete");
  console.log("PASS preferences persist in an isolated Moss cloud index");
  step = "persistent reload";
  const fresh = await client.session(`restore-${randomUUID()}`);
  assert.equal(await fresh.loadIndex(name), 2);
  const restored = await fresh.query("My reading setup", { topK: 2, filter: { field: "timeBucket", condition: { $eq: "evening" } } });
  assert.deepEqual(restored.docs.map((doc) => doc.id), ["reading"]);
  console.log("PASS a fresh Moss session recalls only the requested time bucket");
} catch (error) {
  console.error(`Live Moss check failed during ${step}: ${error?.code ?? error?.status ?? error?.name ?? "unknown error"}.`);
  process.exitCode = 1;
} finally {
  if (pushed) {
    try { await client.deleteIndex(name); console.log("Removed the isolated Moss test index."); }
    catch { console.error(`Could not remove isolated test index ${name}; remove it in the Moss portal.`); process.exitCode = 1; }
  }
  await client.close();
}
