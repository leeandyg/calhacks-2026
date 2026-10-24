import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { createServer, loadEnv } from "vite";
import { api } from "../convex/_generated/api.js";

const env = loadEnv("development", process.cwd(), "");
const url = env.VITE_CONVEX_URL;
if (!url) throw new Error("Configure Convex first.");
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname) && !process.argv.includes("--cloud-dev"))
  throw new Error("Use --cloud-dev explicitly to create isolated test identities on the configured development backend.");
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const clients = []; let passed = 0;
const oldMoss = { id: process.env.MOSS_PROJECT_ID, key: process.env.MOSS_PROJECT_KEY };
delete process.env.MOSS_PROJECT_ID; delete process.env.MOSS_PROJECT_KEY; // Provider-free persistence check.
const client = () => new ConvexHttpClient(url, { logger: false });
async function signIn() {
  const connection = client();
  const { tokens } = await connection.action(api.auth.signIn, { provider: "anonymous" });
  assert.ok(tokens?.token); connection.setAuth(tokens.token); clients.push(connection);
  return { connection, token: tokens.token };
}
async function check(name, test) { await test(); passed++; console.log(`PASS ${name}`); }
try {
  const { cafe } = await server.ssrLoadModule("/src/scene/fixtures.ts");
  const { POST } = await server.ssrLoadModule("/api/agent.ts");
  const first = await signIn(), second = await signIn();
  const preference = { task: "coding", timeBucket: "morning", timezone: "America/Vancouver", summary: "Rain, few clinks", scene: cafe };
  let id;
  await check("unauthenticated preference reads and writes are rejected", async () => {
    await assert.rejects(client().query(api.preferences.context, {}));
    await assert.rejects(client().mutation(api.preferences.save, { preference }));
  });
  await check("task/time preferences persist and replacing a context keeps one record", async () => {
    id = await first.connection.mutation(api.preferences.save, { preference });
    const same = await first.connection.mutation(api.preferences.save, { preference: { ...preference, summary: "No clinks" } });
    assert.equal(same, id);
    const items = (await first.connection.query(api.preferences.context, {})).preferences;
    assert.equal(items.length, 1); assert.equal(items[0].summary, "No clinks");
    assert.deepEqual(items[0].scene, cafe);
    const fresh = client(); fresh.setAuth(first.token);
    assert.equal((await fresh.query(api.preferences.context, {})).preferences[0]._id, id);
  });
  await check("another user cannot read or delete a preference", async () => {
    assert.deepEqual((await second.connection.query(api.preferences.context, {})).preferences, []);
    await assert.rejects(second.connection.mutation(api.preferences.remove, { id }));
  });
  await check("invalid contexts cannot corrupt a stored preference", async () => {
    for (const invalid of [{ task: " " }, { timeBucket: "yesterday" }, { scene: {} }])
      await assert.rejects(first.connection.mutation(api.preferences.save, { preference: { ...preference, ...invalid } }));
  });
  await check("agent memory API authenticates and never returns an arbitrary owner's data", async () => {
    const request = (token) => new Request("http://localhost/api/agent", { method: "POST", headers: {
      "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, body: JSON.stringify({ action: "list", owner: "someone-else" }) });
    assert.equal((await POST(request())).status, 401);
    const response = await POST(request(second.token));
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).preferences, []);
  });
  await check("deleting a preference removes it from subsequent authenticated reads", async () => {
    await first.connection.mutation(api.preferences.remove, { id });
    assert.deepEqual((await first.connection.query(api.preferences.context, {})).preferences, []);
  });
  await check("natural remember and forget commands persist context without emitting scene edits", async () => {
    const command = (prompt) => POST(new Request("http://localhost/api/agent", { method: "POST", headers: {
      "Content-Type": "application/json", Authorization: `Bearer ${first.token}`,
    }, body: JSON.stringify({ prompt, scene: cafe, task: "reading", timeBucket: "night", timezone: "America/Vancouver" }) }));
    const saved = await command("Remember this for exam preparation in the morning");
    assert.equal(saved.status, 200);
    const body = await saved.json(); assert.equal(body.kind, undefined); assert.match(body.message, /exam preparation/);
    const record = (await first.connection.query(api.preferences.context, {})).preferences[0];
    assert.equal(record.task, "exam preparation"); assert.equal(record.timeBucket, "morning");
    const previousGeminiKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const recalled = await POST(new Request("http://localhost/api/agent", { method: "POST", headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${first.token}`,
      }, body: JSON.stringify({ prompt: "Use my usual setup", task: "exam preparation", timeBucket: "morning", scene: cafe }) }));
      assert.equal(recalled.status, 200); const response = await recalled.json();
      assert.equal(response.kind, "create"); assert.deepEqual(response.scene, cafe);
      assert.match(response.notice, /AI is unavailable/);
    } finally {
      if (previousGeminiKey !== undefined) process.env.GEMINI_API_KEY = previousGeminiKey;
    }
    const forgotten = await POST(new Request("http://localhost/api/agent", { method: "POST", headers: {
      "Content-Type": "application/json", Authorization: `Bearer ${first.token}`,
    }, body: JSON.stringify({ action: "forget", id: record._id }) }));
    assert.equal(forgotten.status, 200);
    assert.equal((await first.connection.query(api.preferences.context, {})).preferences.length, 0);
  });
  console.log(`Passed ${passed} real Convex preference persistence and ownership checks.`);
} finally {
  for (const connection of clients) {
    for (const record of (await connection.query(api.preferences.context, {})).preferences)
      await connection.mutation(api.preferences.remove, { id: record._id });
  }
  for (const [name, value] of [["MOSS_PROJECT_ID", oldMoss.id], ["MOSS_PROJECT_KEY", oldMoss.key]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await server.close();
}
