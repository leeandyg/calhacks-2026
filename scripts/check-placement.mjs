import assert from "node:assert/strict";
import { createServer } from "vite";

// Live acceptance checks for #16. Uses the server's .env and makes six Gemini requests.
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { POST } = await server.ssrLoadModule("/api/scene.ts");
  const { SceneResponse } = await server.ssrLoadModule("/src/scene/scene.ts");
  const { applyOp } = await server.ssrLoadModule("/src/scene/store.ts");
  const masking = (object) => object.kind === "bed" && /rain|fan|brown noise|creek|flowing water|wind/i.test(object.sound.query);
  const rain = (object) => object.kind === "bed" && /rain/i.test(object.sound.query);
  const distance = (object, scene) => Math.hypot(
    object.position[0] - scene.listener.position[0], object.position[2] - scene.listener.position[2],
  );

  async function ask(prompt, scene) {
    const response = await POST(new Request("http://localhost/api/scene", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, scene }),
    }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return SceneResponse.parse(body);
  }

  for (const [preset, prompt] of [
    ["cafe", "Create a rainy cafe for writing an essay, with rain, brown noise, and occasional cup clinks."],
    ["forest", "Create a forest study space with a flowing creek, wind, and distant birds."],
    ["bedroom", "Create a quiet bedroom for reading with rain, a desk fan, and occasional distant sounds."],
  ]) {
    const result = await ask(prompt, null);
    assert.equal(result.kind, "create");
    const scene = result.scene;
    assert.equal(scene.room.preset, preset);
    const beds = scene.objects.filter(masking);
    assert.ok(beds.length >= 2, `${preset}: expected multiple masking beds`);
    for (const bed of beds) {
      assert.ok(distance(bed, scene) <= 2.5, `${preset}: ${bed.label} is too far away`);
    }
    const angles = beds.map((object) => Math.atan2(object.position[2], object.position[0]));
    const spread = Math.max(...angles.flatMap((a) => angles.map((b) => Math.acos(Math.cos(a - b)))));
    assert.ok(spread >= Math.PI / 3, `${preset}: masking beds are clustered together`);
    const far = Math.min(3, 0.7 * Math.hypot(scene.room.size[0] / 2, scene.room.size[2] / 2));
    for (const event of scene.objects.filter((object) => object.kind === "event")) {
      assert.ok(event.volume <= 0.25, `${preset}: ${event.label} is too loud`);
      assert.ok(distance(event, scene) >= far, `${preset}: ${event.label} is too close`);
    }
    for (const object of scene.objects) {
      const query = object.sound.query;
      if (/speech|conversation|chatter|voices|radio|podcast|lyrics/i.test(query)) {
        assert.match(query, /unintelligible|indistinct|no (?:intelligible )?(?:speech|words|lyrics)|without (?:speech|words|lyrics)/i,
          `${preset}: a speech-related query needs an explicit unintelligible/no-speech restriction`);
      }
    }

    // Deliberately move one object away from the default: an unrelated rain edit must keep it there.
    const moved = applyOp(scene, { op: "move", id: scene.objects[0].id, position: [0.5, 1.2, 0.5] });
    const response = await ask("make it rainier", moved);
    assert.equal(response.kind, "edit");
    const edited = response.ops.reduce(applyOp, moved);
    assert.deepEqual(edited.room, moved.room);
    assert.deepEqual(edited.listener, moved.listener);
    assert.deepEqual(edited.session, moved.session);
    for (const original of moved.objects) {
      const current = edited.objects.find((object) => object.id === original.id);
      assert.ok(current, `${preset}: rain edit removed ${original.id}`);
      assert.deepEqual(current.position, original.position, `${preset}: rain edit moved ${original.id}`);
      if (!rain(original)) assert.deepEqual(current, original, `${preset}: rain edit changed ${original.id}`);
    }
    const originalRain = moved.objects.filter(rain);
    assert.ok(originalRain.length
      ? originalRain.some((original) => edited.objects.find((object) => object.id === original.id).volume > original.volume)
      : edited.objects.some(rain), `${preset}: rain did not increase`);
    console.log(`PASS ${preset}: close/spread beds, distant/quiet events, restricted speech, rain edit preserves manual placements`);
    console.log(JSON.stringify({ preset, sounds: scene.objects.map((object) => object.sound.query), editOps: response.ops }));
  }
} finally {
  await server.close();
}
