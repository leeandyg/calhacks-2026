import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createServer } from "vite";
import { MossClient } from "@moss-js/moss";

// No real provider calls or microphone access. Cloud persistence has a separate check.
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const originalFetch = globalThis.fetch;
const originalEnv = { id: process.env.MOSS_PROJECT_ID, key: process.env.MOSS_PROJECT_KEY };
const originalMoss = { session: MossClient.prototype.session, close: MossClient.prototype.close, deleteIndex: MossClient.prototype.deleteIndex,
  getJobStatus: MossClient.prototype.getJobStatus };
let passed = 0;
async function check(name, test) { await test(); passed++; console.log(`PASS ${name}`); }
try {
  const preferences = await server.ssrLoadModule("/src/ai/preferences.ts");
  const agent = await server.ssrLoadModule("/src/ai/agent.ts");
  const moss = await server.ssrLoadModule("/api/_lib/moss.ts");
  const { cafe } = await server.ssrLoadModule("/src/scene/fixtures.ts");
  const room = structuredClone(cafe); room.objects[0].position = [1.4, 1.2, -1.7];
  const morning = { _id: "one", task: "coding", timeBucket: "morning", timezone: "America/Vancouver", summary: "Close rain and few clinks.", scene: room, updatedAt: 1 };
  const evening = { ...morning, _id: "two", timeBucket: "evening", summary: "Quiet fireplace.", updatedAt: 2 };
  const context = { token: "test-only", task: "coding", timeBucket: "morning", turns: [] };
  await check("local time buckets include night across midnight", () => {
    for (const [hour, expected] of [[0,"night"],[5,"morning"],[11,"morning"],[12,"afternoon"],[17,"evening"],[22,"night"]])
      assert.equal(preferences.localContext(new Date(2026, 9, 24, hour)).timeBucket, expected);
  });
  await check("spoken context overrides the selected task/time", () => {
    assert.deepEqual(preferences.commandContext("Remember this for programming in the evening", "reading", "morning"), { task: "coding", timeBucket: "evening" });
  });
  await check("outage recall keeps task/time boundaries and favors specific preferences", () => {
    assert.deepEqual(preferences.exactPreferences([evening, { ...morning, _id: "any", timeBucket: "any", updatedAt: 5 }, morning], " CODING ", "morning").map((p) => p._id), ["one", "any"]);
    assert.deepEqual(preferences.exactPreferences([morning], "reading", "morning"), []);
  });
  await check("memory examples never supply resolver asset IDs", () => {
    assert.ok(!JSON.stringify(preferences.preferenceExample(morning)).includes("assetId"));
  });
  await check("offline memory commands cannot silently edit the room", async () => {
    globalThis.fetch = async () => { throw new Error("Unexpected network"); };
    await assert.rejects(agent.requestAgent("remember this for coding", room, context, true), /live connection/);
    await assert.rejects(agent.requestAgent("forget my coding preference", room), /Connect/);
  });
  await check("an agent outage replays rainier without moving existing objects", async () => {
    globalThis.fetch = async () => Response.json({ error: "Service down" }, { status: 503 });
    const reply = await agent.requestAgent("make it rainier", room, context);
    assert.equal(reply.response.kind, "edit");
    assert.ok(reply.response.ops.every((op) => op.op === "set_volume"));
    assert.deepEqual(room.objects[0].position, [1.4, 1.2, -1.7]);
  });
  await check("unavailable memory authentication leaves live typed commands usable", async () => {
    const paths = [];
    globalThis.fetch = async (url) => { paths.push(url); return url === "/api/agent"
      ? Response.json({ error: "Memory offline" }, { status: 401 })
      : Response.json({ kind: "edit", ops: [{ op: "set_volume", id: room.objects[0].id, volume: 0.5 }] }); };
    assert.equal((await agent.requestAgent("make it rainier", room, context)).response.kind, "edit");
    assert.deepEqual(paths, ["/api/agent", "/api/scene"]);
  });
  await check("unknown usual setups return a clear error without replacing the room", async () => {
    globalThis.fetch = async () => Response.json({ error: "No saved preference matches" }, { status: 400 });
    await assert.rejects(agent.requestAgent("Use my usual setup", room, context), /No saved preference/);
  });

  await check("authenticated turns follow managed world progress and keep memory notices", async () => {
    const paths = [], updates = [];
    globalThis.fetch = async (url) => {
      paths.push(String(url));
      if (url === "/api/agent") return Response.json({ kind: "managed", token: "safe-capability", recalled: ["coding (morning)"] }, { status: 202 });
      if (String(url).includes("action=stream")) return new Response('data: {"type":"progress","message":"Painting…"}\n\ndata: {"type":"complete"}\n\n');
      return Response.json({ response: { kind: "edit", ops: [{ op: "set_volume", id: room.objects[0].id, volume: 0.4 }] }, assets: { envId: "agent-test", sprites: [], sounds: [] } });
    };
    const result = await agent.requestAgent("make it rainier", room, context, false, text => updates.push(text));
    assert.equal(result.response.kind, "edit"); assert.equal(result.response.managed.envId, "agent-test");
    assert.deepEqual(result.recalled, ["coding (morning)"]); assert.ok(updates.includes("Painting…"));
    assert.ok(paths.some(path => path.startsWith("/api/world?"))); assert.ok(!paths.includes("/api/scene"));
  });
  await check("a failed started managed turn keeps the room and reports its error", async () => {
    globalThis.fetch = async (url) => url === "/api/agent"
      ? Response.json({ kind: "managed", token: "safe-capability" }, { status: 202 })
      : new Response('data: {"type":"error","error":"Generated output invalid"}\n\n');
    await assert.rejects(agent.requestAgent("make it rainier", room, context), /Generated output invalid/);
  });

  process.env.MOSS_PROJECT_ID = "test-project"; process.env.MOSS_PROJECT_KEY = "test-key";
  const cloud = new Map(); let closes = 0, pushStatus = "completed";
  MossClient.prototype.session = async function (name) {
    let docs = new Map();
    return { name,
      loadIndex: async () => { docs = new Map(cloud.get(name) ?? []); return docs.size; },
      getDocs: async () => [...docs.values()],
      deleteDocs: async (ids) => { ids.forEach((id) => docs.delete(id)); },
      addDocs: async (items) => { items.forEach((item) => docs.set(item.id, item)); },
      pushIndex: async () => { cloud.set(name, new Map(docs)); return { status: pushStatus, jobId: "test-job" }; },
      query: async (_query, options) => ({ docs: [...docs.values()].filter((item) => !options.filter || options.filter.condition.$in.includes(item.metadata.timeBucket)).slice(0, options.topK) }),
    };
  };
  MossClient.prototype.close = async () => { closes++; };
  MossClient.prototype.deleteIndex = async (name) => cloud.delete(name);
  MossClient.prototype.getJobStatus = async () => ({ status: "failed" });
  await check("Moss indexes are owner-specific and remove stale records before retrieval", async () => {
    assert.notEqual(moss.memoryIndexName("owner-a"), moss.memoryIndexName("owner-b"));
    cloud.set(moss.memoryIndexName("owner-a"), new Map([["deleted", { id: "deleted", text: "Old preference", metadata: { updatedAt: "0", timeBucket: "morning" } }]]));
    const result = await moss.retrieveMemory("owner-a", [morning, evening], "usual coding setup", "coding", "morning", []);
    assert.equal(result.notice, "Moss memory ready.");
    assert.deepEqual(result.preferences.map((item) => item._id), ["one"]);
    assert.equal(cloud.get(moss.memoryIndexName("owner-a")).has("deleted"), false);
    assert.equal(closes, 1);
  });
  await check("correcting and forgetting preferences updates the Moss projection", async () => {
    await moss.syncMemory("owner-a", [{ ...morning, summary: "No clinks", updatedAt: 3 }]);
    assert.match(cloud.get(moss.memoryIndexName("owner-a")).get("one").text, /No clinks/);
    await moss.syncMemory("owner-a", []);
    assert.equal(cloud.has(moss.memoryIndexName("owner-a")), false);
  });
  await check("an unfinished cloud index build cannot report memory as synced", async () => {
    pushStatus = "building";
    const notice = await moss.syncMemory("owner-pending", [morning]);
    assert.match(notice, /sync is pending/);
    assert.doesNotMatch(notice, /Moss memory synced/);
    pushStatus = "completed";
  });

  await check("mic PCM conversion flushes the last partial chunk before finalization", async () => {
    let Processor; const messages = [];
    vm.runInNewContext(await readFile("public/voice-pcm.js", "utf8"), {
      AudioWorkletProcessor: class { port = { postMessage: (data) => messages.push(data) }; },
      registerProcessor: (_name, type) => { Processor = type; }, Int16Array, Math,
    });
    const processor = new Processor(); processor.process([[new Float32Array([-1, 0, 1])]]);
    processor.port.onmessage({ data: "flush" });
    assert.deepEqual([...new Int16Array(messages[0])], [-32768, 0, 32767]);
    assert.equal(messages[1].flushed, true);
  });
  const globals = new Map(["window", "navigator", "AudioContext", "AudioWorkletNode", "WebSocket"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const sockets = []; let tracks = [], getMic;
  class Socket {
    static OPEN = 1; readyState = 0; bufferedAmount = 0; sent = [];
    constructor() { sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    close() { this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
    send(data) {
      this.sent.push(data);
      if (data === "finalize") queueMicrotask(() => {
        for (const text of ["make", " it rainier"]) this.onmessage?.({ data: JSON.stringify({ type: "transcript", is_final: true, text }) });
        this.onmessage?.({ data: JSON.stringify({ type: "flush_done" }) });
      });
    }
  }
  class Context {
    sampleRate = 16000; state = "running"; destination = {}; audioWorklet = { addModule: async () => {} };
    async resume() {} async close() { this.state = "closed"; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  }
  class Worklet {
    port = { postMessage: () => queueMicrotask(() => {
      this.port.onmessage({ data: new ArrayBuffer(2) }); this.port.onmessage({ data: { flushed: true } });
    }) };
    connect() {} disconnect() {}
  }
  try {
    for (const [name, value] of [["window", { AudioWorkletNode: Worklet }], ["navigator", { mediaDevices: { getUserMedia: () => getMic() } }],
      ["AudioContext", Context], ["AudioWorkletNode", Worklet], ["WebSocket", Socket]])
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    getMic = async () => { const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track); return { getTracks: () => [track] }; };
    globalThis.fetch = async () => Response.json({ token: "test-only", version: "2026-08-14" });
    const { startVoice } = await server.ssrLoadModule("/src/ai/voice.ts");
    await check("release flushes mic audio, stops tracks and submits only the final transcript", async () => {
      const result = new Promise((resolve, reject) => {
        startVoice("test", new AbortController().signal, resolve, (message) => reject(new Error(message)))
          .then((session) => session.stop()).catch(reject);
      });
      assert.equal(await result, "make it rainier");
      assert.ok(sockets.at(-1).sent[0] instanceof ArrayBuffer);
      assert.equal(sockets.at(-1).sent[1], "finalize");
      assert.ok(tracks.at(-1).stopped);
    });
    await check("cancelling a turn stops microphone access without applying a command", async () => {
      let received = false;
      const session = await startVoice("test", new AbortController().signal, () => { received = true; }, () => {});
      session.cancel(); await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(received, false); assert.ok(tracks.at(-1).stopped);
    });
    await check("releasing while permission is pending cannot leave a live microphone", async () => {
      let release; getMic = () => new Promise((resolve) => { release = resolve; });
      const abort = new AbortController();
      const starting = startVoice("test", abort.signal, () => assert.fail("Cancelled turn submitted"), () => {});
      while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
      abort.abort(); const track = { stopped: false, stop() { this.stopped = true; } };
      release({ getTracks: () => [track] });
      await assert.rejects(starting, { name: "AbortError" }); assert.ok(track.stopped);
    });
  } finally {
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
  console.log(`Passed ${passed} agent, memory and audio-input checks (provider calls mocked).`);
} finally {
  globalThis.fetch = originalFetch;
  Object.assign(MossClient.prototype, originalMoss);
  for (const [name, value] of [["MOSS_PROJECT_ID", originalEnv.id], ["MOSS_PROJECT_KEY", originalEnv.key]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await server.close();
}
