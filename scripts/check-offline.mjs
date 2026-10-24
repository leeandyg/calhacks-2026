import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createServer } from "vite";

// Exercises the demo and failure paths without Gemini calls or API credentials.
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const originalFetch = globalThis.fetch;
try {
  const { presets } = await server.ssrLoadModule("/src/scene/presets.ts");
  const { requestScene } = await server.ssrLoadModule("/src/ai/client.ts");
  const { offlineResponse, demoPrompts } = await server.ssrLoadModule("/src/ai/offline.ts");
  const { Scene, SceneResponse } = await server.ssrLoadModule("/src/scene/scene.ts");
  const { applyOp } = await server.ssrLoadModule("/src/scene/store.ts");
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
  await check("network outage falls back to a local preset with a visible notice", async () => {
    const result = await requestScene("forest study space", presets[0].scene);
    assert.equal(result.kind, "create"); playable(result.scene);
    assert.match(result.notice, /AI unavailable/);
  });
  for (const status of [429, 502, 503, 504]) await check(`HTTP ${status} replays the recorded rain edit`, async () => {
    globalThis.fetch = async () => Response.json({ error: "Unavailable" }, { status });
    const scene = presets[0].scene;
    const result = await requestScene("make it rainier", scene);
    assert.equal(result.kind, "edit");
    assert.deepEqual(result.ops.reduce(applyOp, scene).objects.map((object) => object.position), scene.objects.map((object) => object.position));
    assert.match(result.notice, /AI unavailable/);
  });
  await check("timeout, malformed JSON, and invalid output fall back locally", async () => {
    for (const fetch of [
      async () => { throw new DOMException("Timed out", "TimeoutError"); },
      async () => new Response("not JSON", { status: 200 }),
      async () => Response.json({ invalid: true }),
    ]) {
      globalThis.fetch = fetch;
      playable((await requestScene("bedroom", presets[0].scene)).scene);
    }
  });
  await check("bad requests surface an error without a fallback", async () => {
    globalThis.fetch = async () => Response.json({ error: "Invalid request" }, { status: 400 });
    await assert.rejects(requestScene("cafe", presets[0].scene), /400/);
  });
  await check("healthy API responses retain the existing scene response contract", async () => {
    const live = { kind: "edit", ops: [{ op: "set_volume", id: "rain-1", volume: 0.2 }] };
    globalThis.fetch = async (_url, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json(live);
    };
    assert.deepEqual(await requestScene("make the rain quieter", presets[0].scene), SceneResponse.parse(live));
  });
  await check("unresolved live creations use a playable fallback instead of a silent room", async () => {
    const unresolved = structuredClone(presets[0].scene);
    unresolved.objects.forEach((object) => { delete object.sound.assetId; });
    globalThis.fetch = async () => Response.json({ kind: "create", scene: unresolved });
    const result = await requestScene("rainy cafe", presets[0].scene);
    playable(result.scene);
    assert.match(result.notice, /not linked to audio files/);
  });
  await check("unsupported unresolved additions preserve the current room", async () => {
    const scene = structuredClone(presets[0].scene);
    const before = structuredClone(scene);
    globalThis.fetch = async () => Response.json({ kind: "edit", ops: [{ op: "add", object: {
      ...scene.objects[0], id: "unknown-sound", sound: { query: "a new mystery sound" },
    } }] });
    await assert.rejects(requestScene("add a mystery sound", scene), /kept unchanged/);
    assert.deepEqual(scene, before);
  });
  await check("unknown or wrong-kind live assets fall back; resolved live assets pass through", async () => {
    let liveScene;
    globalThis.fetch = async (url) => url === "/sounds/manifest.json"
      ? Response.json([...manifest.values()])
      : Response.json({ kind: "create", scene: liveScene });
    for (const assetId of ["missing-file", "cup_clink"]) {
      liveScene = structuredClone(presets[0].scene);
      liveScene.objects[0].sound.assetId = assetId;
      const result = await requestScene("cafe", presets[0].scene);
      playable(result.scene);
      assert.match(result.notice, /missing from the local sound pack/);
    }
    liveScene = structuredClone(presets[0].scene);
    assert.deepEqual(await requestScene("cafe", presets[0].scene), { kind: "create", scene: liveScene });
  });
  console.log(`Passed ${passed} offline checks; no real API requests were sent.`);
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}
