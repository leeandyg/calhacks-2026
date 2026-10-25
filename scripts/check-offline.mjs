import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { createServer } from "vite";

// Exercises the demo and failure paths without Gemini calls or API credentials.
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const originalFetch = globalThis.fetch;
try {
  const { presets } = await server.ssrLoadModule("/src/scene/presets.ts");
  const { requestScene } = await server.ssrLoadModule("/src/ai/client.ts");
  const { offlineResponse, demoPrompts } = await server.ssrLoadModule("/src/ai/offline.ts");
  const { Scene, SceneResponse } = await server.ssrLoadModule("/src/scene/scene.ts");
  const { applyOp, useSceneStore } = await server.ssrLoadModule("/src/scene/store.ts");
  const { placeObject } = await server.ssrLoadModule("/src/scene/layout.ts");
  const { startResolver } = await server.ssrLoadModule("/src/audio/resolve.ts");
  const manifest = new Map(JSON.parse(readFileSync("public/sounds/manifest.json", "utf8")).map((entry) => [entry.id, entry]));
  let passed = 0;
  async function check(name, test) { await test(); passed++; console.log(`PASS ${name}`); }
  function playable(scene) {
    Scene.parse(scene);
    assert.equal(new Set(scene.objects.map((object) => object.id)).size, scene.objects.length);
    for (const object of scene.objects) {
      const entry = manifest.get(object.sound.assetId);
      assert.ok(entry, `${object.label}: missing asset ${object.sound.assetId}`);
      assert.equal(entry.kind, object.kind, `${object.label}: incompatible asset kind`);
      assert.ok(statSync(`public/sounds/${entry.file}`).size > 100);
    }
  }

  await check("six presets use existing playable assets with matching kinds", () => {
    assert.equal(presets.length, 6);
    presets.forEach((preset) => playable(preset.scene));
  });
  await check("all six presets are reachable through offline prompts", () => {
    for (const preset of presets) playable(offlineResponse(preset.label, presets[0].scene).response.scene);
  });

  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Network disconnected"); };
  await check("recorded creation, rain edit, and fireplace edit need zero API requests", async () => {
    const initial = await requestScene(demoPrompts[0], presets[0].scene, true);
    assert.equal(initial.kind, "create");
    playable(initial.scene);
    assert.match(initial.notice, /Demo mode/);
    const moved = applyOp(initial.scene, { op: "move", id: initial.scene.objects[0].id, position: [0.5, 1.2, 0.5] });
    const before = structuredClone(moved);
    const rainy = await requestScene(demoPrompts[1], moved, true);
    assert.equal(rainy.kind, "edit");
    const wetter = rainy.ops.reduce(applyOp, moved);
    assert.deepEqual(wetter.objects.map((object) => object.position), moved.objects.map((object) => object.position));
    assert.ok(wetter.objects[0].volume > moved.objects[0].volume);
    assert.deepEqual(moved, before);
    const fireplace = await requestScene(demoPrompts[2], wetter, true);
    assert.equal(fireplace.kind, "edit");
    const final = fireplace.ops.reduce(applyOp, wetter);
    playable(final);
    assert.ok(final.objects.some((object) => object.sound.assetId === "fireplace"));
    assert.deepEqual(final.objects[0].position, moved.objects[0].position);
    const repeated = await requestScene(demoPrompts[2], final, true);
    assert.equal(repeated.ops.reduce(applyOp, final).objects.length, final.objects.length);
    assert.equal(requests, 0);
  });
  await check("recorded rain addition preserves existing objects and avoids ID collisions", () => {
    const forest = structuredClone(presets.find((preset) => preset.id === "forest").scene);
    forest.objects[0].id = "rain-bed";
    const before = structuredClone(forest);
    const response = offlineResponse("make it rainier", forest).response;
    const edited = response.ops.reduce(applyOp, forest);
    playable(edited);
    assert.deepEqual(edited.objects.slice(0, forest.objects.length), forest.objects);
    assert.deepEqual(forest, before);
    assert.equal(new Set(edited.objects.map((object) => object.id)).size, edited.objects.length);
  });
  await check("unsupported edits and unknown prompts preserve the room", async () => {
    const scene = structuredClone(presets[0].scene);
    const before = structuredClone(scene);
    await assert.rejects(requestScene("Can you move the cafe rain left?", scene, true), /kept unchanged/);
    await assert.rejects(requestScene("something without a saved response", scene, true), /kept unchanged/);
    assert.deepEqual(scene, before);
  });
  // Live failures: the agent, then Gemini by name, then an offline room whose notice says so (#110).
  const sceneCalls = [];
  const failing = (fail) => async (url, options) => {
    if (url === "/api/scene") sceneCalls.push(JSON.parse(options.body));
    return fail();
  };
  await check("a network outage tries Gemini, then loads a saved room labeled Offline", async () => {
    const scene = structuredClone(presets[0].scene), before = structuredClone(scene);
    globalThis.fetch = failing(() => { throw new Error("Network disconnected"); });
    for (const current of [null, scene]) {
      sceneCalls.length = 0;
      const result = await requestScene("forest study space", current);
      assert.equal(result.kind, "create"); playable(result.scene);
      assert.match(result.notice, /^Offline:/);
      assert.deepEqual(sceneCalls.map((body) => body.engine), [undefined, "gemini"]);
    }
    assert.deepEqual(scene, before);
  });
  for (const status of [429, 502, 503, 504]) await check(`HTTP ${status} tries Gemini, then replays the recorded rain edit`, async () => {
    globalThis.fetch = failing(() => Response.json({ error: "Unavailable" }, { status }));
    sceneCalls.length = 0;
    const scene = structuredClone(presets[0].scene);
    const result = await requestScene("make it rainier", scene);
    assert.equal(result.kind, "edit");
    assert.deepEqual(result.ops.reduce(applyOp, scene).objects.map((object) => object.position), scene.objects.map((object) => object.position));
    assert.match(result.notice, /^Offline:/);
    assert.equal(sceneCalls.length, 2); assert.equal(sceneCalls[1].engine, "gemini");
  });
  await check("timeouts, malformed JSON and invalid output fall back to Gemini, then offline", async () => {
    for (const fail of [
      () => { throw new DOMException("Timed out", "TimeoutError"); },
      () => new Response("not JSON", { status: 200 }),
      () => Response.json({ invalid: true }),
    ]) {
      globalThis.fetch = failing(fail);
      const result = await requestScene("bedroom", null);
      playable(result.scene); assert.match(result.notice, /^Offline:/);
    }
  });
  await check("a Claude world that fails mid-run is rebuilt by Gemini, with a notice", async () => {
    const live = structuredClone(presets[0].scene);
    sceneCalls.length = 0;
    globalThis.fetch = async (url, options) => {
      if (url === "/api/scene") {
        const body = JSON.parse(options.body); sceneCalls.push(body);
        return body.engine === "gemini" ? Response.json({ kind: "create", scene: live }) : Response.json({ kind: "managed", token: "test-run" }, { status: 202 });
      }
      return new Response('data: {"type":"error","error":"Claude could not finish this world."}\n\n');
    };
    const result = await requestScene("a misty forest", null);
    assert.equal(result.kind, "create"); assert.equal(result.managed, undefined);
    assert.match(result.notice, /Gemini built a simpler room/);
    assert.deepEqual(sceneCalls.map((body) => body.engine), [undefined, "gemini"]);
  });
  await check("a Claude start failure (502) is answered by Gemini", async () => {
    const live = { kind: "edit", ops: [{ op: "set_volume", id: presets[0].scene.objects[0].id, volume: 0.3 }] };
    globalThis.fetch = async (_url, options) => JSON.parse(options.body).engine === "gemini"
      ? Response.json(live) : Response.json({ error: "Claude could not complete this request." }, { status: 502 });
    const result = await requestScene("make the rain quieter", presets[0].scene);
    assert.deepEqual(result.ops, live.ops); assert.match(result.notice, /Gemini/);
  });
  await check("bad requests surface an error without a fallback", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ error: "Invalid request" }, { status: 400 }); };
    await assert.rejects(requestScene("cafe", presets[0].scene), /400.*kept unchanged/);
    assert.equal(calls, 1, "no Gemini retry or offline room for the app's own bad request");
  });
  await check("healthy API responses retain the existing scene response contract", async () => {
    const live = { kind: "edit", ops: [{ op: "set_volume", id: "rain-1", volume: 0.2 }] };
    globalThis.fetch = async (_url, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json(live);
    };
    assert.deepEqual(await requestScene("make the rain quieter", presets[0].scene), SceneResponse.parse(live));
  });
  await check("live creations reach the resolver and become playable pack scenes", async () => {
    const unresolved = structuredClone(presets.find((preset) => preset.id === "forest").scene);
    unresolved.objects.forEach((object) => { delete object.sound.assetId; });
    globalThis.fetch = async (url) => url === "/sounds/manifest.json"
      ? Response.json([...manifest.values()])
      : Response.json({ kind: "create", scene: unresolved });
    // This wording has no saved preset/demo match: a healthy API reply must still work.
    const result = await requestScene("A peaceful riverside clearing at night", presets[0].scene);
    assert.deepEqual(result, { kind: "create", scene: unresolved });
    const stop = startResolver();
    try {
      useSceneStore.getState().setScene(result.scene); await setImmediate();
      const resolved = useSceneStore.getState().scene;
      playable(resolved);
      assert.deepEqual(resolved.objects.map((object) => object.position), unresolved.objects.map((object) => object.position));
      assert.deepEqual(resolved.objects.map((object) => object.volume), unresolved.objects.map((object) => object.volume));
    } finally { stop(); }
  });
  await check("live additions reach generated IDs while preserving manually edited objects", async () => {
    // A manual drag goes through the store, which snaps it onto the room grid.
    useSceneStore.getState().setScene(presets[0].scene);
    useSceneStore.getState().applyOps([{ op: "move", id: presets[0].scene.objects[1].id, position: [-1.5, 1.2, 2.5] }]);
    const scene = structuredClone(useSceneStore.getState().scene);
    const before = structuredClone(scene);
    const calls = [];
    const live = { kind: "edit", ops: [{ op: "add", object: {
      ...scene.objects[0], id: "cat-1", label: "Purring cat", sound: { query: "a cat purring softly" },
    } }] };
    globalThis.fetch = async (url) => {
      calls.push(url);
      assert.equal(url, "/api/scene");
      return Response.json(live);
    };
    const result = await requestScene("add a softly purring cat", scene);
    assert.deepEqual(result, live);
    useSceneStore.getState().setScene(scene);
    const stop = startResolver();
    try {
      useSceneStore.getState().applyOps(result.ops); await setImmediate();
      const edited = useSceneStore.getState().scene;
      assert.deepEqual(edited.objects.slice(0, scene.objects.length), before.objects);
      const cat = edited.objects.find((object) => object.id === "cat-1");
      assert.equal(cat.sound.assetId, "gen:bed:a cat purring softly");
      assert.deepEqual(cat.position, placeObject(live.ops[0].object, scene.room.grid).position, "the cat goes where the agent put it, on the grid");
      assert.deepEqual(calls, ["/api/scene"], "Resolving an ID must not trigger paid sound generation in this test");
    } finally { stop(); }
    assert.deepEqual(scene, before);
  });
  await check("resolved pack and generated asset responses pass through without manifest gating", async () => {
    for (const assetId of ["rain_window", "gen:bed:a cat purring softly"]) {
      const liveScene = structuredClone(presets[0].scene);
      liveScene.objects[0].sound.assetId = assetId;
      globalThis.fetch = async (url) => {
        assert.equal(url, "/api/scene");
        return Response.json({ kind: "create", scene: liveScene });
      };
      assert.deepEqual(await requestScene("a custom environment", presets[0].scene), { kind: "create", scene: liveScene });
    }
  });
  console.log(`Passed ${passed} offline checks; no real API requests were sent.`);
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}
