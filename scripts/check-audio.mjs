import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { createServer } from "vite";

// Deterministic Web Audio lifecycle checks: no speakers, credentials, or API calls.
let now = 0;
let timerId = 0;
const timers = new Map();
const sources = [];
const requests = new Map();
const held = new Map();
const failures = new Set();
const originals = { fetch, setTimeout, clearTimeout, AudioBufferSourceNode: globalThis.AudioBufferSourceNode, GainNode: globalThis.GainNode, PannerNode: globalThis.PannerNode, AnalyserNode: globalThis.AnalyserNode };
class Param { value = 0; setTargetAtTime(value, _at, timeConstant) { this.value = value; this.timeConstant = timeConstant; } }
class Node { connect(node) { this.output = node; (this.outputs ??= []).push(node); return node; } disconnect() { this.disconnected = true; } }
class Gain extends Node { gain = new Param(); constructor(_ctx, options) { super(); this.gain.value = options?.gain ?? 1; } }
class Panner extends Node { positionX = new Param(); positionY = new Param(); positionZ = new Param(); }
class Source extends Node {
  constructor(_ctx, options) { super(); this.loop = false; Object.assign(this, options); sources.push(this); }
  start(_when = 0, offset = 0) {
    this.started = true; this.startedAt = now; this.offset = offset;
    this.naturalEnd = this.loop ? Infinity : now + this.buffer.duration / 2 ** ((this.detune ?? 0) / 1200);
  }
  stop(at = now) { this.stopsAt = at; }
}
class Convolver extends Node { buffer = null; normalize = true; }
const analysers = [];
// Every sample reads `value`, so a check sets the level an object emits.
class Analyser extends Node { value = 0; constructor(ctx, options) { super(); this.context = ctx; this.fftSize = options?.fftSize ?? 2048; analysers.push(this); } getFloatTimeDomainData(samples) { samples.fill(this.value); } }
const context = {
  get currentTime() { return now; }, destination: {}, sampleRate: 8000,
  createGain: () => new Gain(),
  createConvolver: () => new Convolver(),
  createBuffer: (channels, length, sampleRate) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c) => data[c] };
  },
  listener: Object.fromEntries(["positionX", "positionY", "positionZ", "forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ"].map((key) => [key, new Param()])),
  decodeAudioData: async (data) => ({ duration: 10, asset: new TextDecoder().decode(data) }),
};
const endTime = (source) => Math.min(source.stopsAt ?? Infinity, source.naturalEnd ?? Infinity);
const active = () => sources.filter((source) => source.started && !source.ended && endTime(source) > now);
async function flush() { await setImmediate(); }
async function advance(seconds) {
  const end = now + seconds;
  for (;;) {
    const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    const ending = sources.filter((source) => source.started && !source.ended && endTime(source) <= end)
      .sort((a, b) => endTime(a) - endTime(b))[0];
    if (!next && !ending) break;
    if (ending && endTime(ending) <= (next?.[1].at ?? Infinity)) {
      now = endTime(ending); ending.ended = true; ending.endedAt = now; ending.onended?.();
    } else {
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    await flush();
  }
  now = end;
  await flush();
}

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
let engine;
try {
  const { AudioEngine } = await server.ssrLoadModule("/src/audio/AudioEngine.ts");
  const { soundLevel } = await server.ssrLoadModule("/src/audio/levels.ts");
  const { useSceneStore } = await server.ssrLoadModule("/src/scene/store.ts");
  const { bedroom } = await server.ssrLoadModule("/src/scene/fixtures.ts");
  const { useRoomStore } = await server.ssrLoadModule("/src/room/useRoomStore.ts");
  const { useHeadPose } = await server.ssrLoadModule("/src/sensors/headPose.ts");
  const manifest = JSON.parse(readFileSync("public/sounds/manifest.json", "utf8"));
  const assets = new Map(manifest.map((entry) => [`/sounds/${entry.file}`, entry.id]));
  let manifestFailure = true;
  globalThis.fetch = async (url) => {
    if (url === "/sounds/manifest.json") {
      if (manifestFailure) { manifestFailure = false; return new Response("Unavailable", { status: 503 }); }
      return Response.json(manifest);
    }
    const asset = assets.get(url);
    assert.ok(asset, `Unexpected URL: ${url}`);
    requests.set(asset, (requests.get(asset) ?? 0) + 1);
    if (held.has(asset)) await held.get(asset).promise;
    if (failures.delete(asset)) return new Response("Unavailable", { status: 503 });
    return new Response(asset);
  };
  globalThis.setTimeout = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, at: now + ms / 1000 }); return id; };
  globalThis.clearTimeout = (id) => timers.delete(id);
  globalThis.AudioBufferSourceNode = Source;
  globalThis.GainNode = Gain;
  globalThis.PannerNode = Panner;
  globalThis.AnalyserNode = Analyser;
  function setSound(assetId, kind = "bed", id = "same-object", intervalSec = [1, 1]) {
    useSceneStore.getState().setScene({ ...bedroom, objects: [{
      id, label: assetId ?? "Unresolved", kind, sound: { query: "test sound", assetId },
      position: [1, 1.6, 0], volume: 0.5, ...(kind === "event" ? { intervalSec } : {}),
    }] });
  }
  let passed = 0;
  async function check(name, test) { await test(); passed++; console.log(`PASS ${name}`); }
  setSound("ocean");
  engine = new AudioEngine(context); engine.start(); await flush();
  await check("a failed manifest can recover on the next scene load", async () => {
    assert.equal(active().length, 0);
    setSound("ocean"); await flush();
    assert.deepEqual(active().map((source) => source.buffer.asset), ["ocean"]);
  });
  await check("replacing a bed with an unresolved sound stops the previous loop", async () => {
    const old = active()[0];
    setSound(undefined); await flush(); await advance(0.7);
    assert.equal(active().length, 0); assert.ok(old.disconnected);
    setSound("ocean"); await flush(); assert.equal(active().length, 1);
  });
  await check("an HTTP sound-file failure fades the old bed and can be retried", async () => {
    failures.add("rain_roof"); setSound("rain_roof"); await flush(); await advance(0.7);
    assert.equal(active().length, 0);
    setSound("rain_roof"); await flush();
    assert.deepEqual(active().map((source) => source.buffer.asset), ["rain_roof"]);
    assert.equal(requests.get("rain_roof"), 2);
  });
  await check("rapid A/B/A changes ignore superseded asynchronous loads", async () => {
    let release; const promise = new Promise((resolve) => { release = resolve; });
    held.set("brown_noise", { promise });
    setSound("brown_noise"); await flush(); setSound("ocean"); await flush(); setSound("brown_noise"); await flush();
    release(); held.delete("brown_noise"); await flush(); await advance(0.7);
    assert.deepEqual(active().map((source) => source.buffer.asset), ["brown_noise"]);
  });
  await check("replacing a scene stops removed loops", async () => {
    setSound("wind", "bed", "different-object"); await flush(); await advance(0.7);
    assert.deepEqual(active().map((source) => source.buffer.asset), ["wind"]);
  });
  await check("swapping event sounds stops active one-shots and their old schedule", async () => {
    setSound("cup_clink", "event"); await flush(); await advance(3);
    assert.ok(active().some((source) => source.buffer.asset === "cup_clink"));
    setSound("page_flip", "event"); await flush(); await advance(0.4); // the old clip fades out within 0.3 s
    assert.equal(active().length, 0);
    await advance(2.7); // a new sound plays within 3 s
    assert.deepEqual(active().map((source) => source.buffer.asset), ["page_flip"]);
  });
  await check("a new event plays within 3 s, then waits fresh random gaps, with varied gain/pitch and unchanged placement", async () => {
    const random = Math.random;
    let seed = 41;
    Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    try {
      const first = sources.length;
      setSound("cup_clink", "event", "natural-cups", [2, 5]);
      const scene = structuredClone(useSceneStore.getState().scene);
      const started = now;
      await flush(); await advance(100);
      const hits = sources.slice(first);
      assert.ok(hits.length >= 5);
      assert.ok(hits[0].startedAt - started >= 0.5 && hits[0].startedAt - started <= 3, "the first play comes soon, not after a full gap");
      for (const [index, hit] of hits.entries()) {
        assert.equal(hit.loop, false); assert.equal(hit.offset, 0);
        assert.ok(Math.abs(hit.detune) <= 100);
        assert.ok(hit.output.gain.value >= 0.75 && hit.output.gain.value <= 1);
        if (index) {
          const gap = hit.startedAt - hits[index - 1].endedAt;
          assert.ok(gap >= 2 - 1e-8 && gap <= 5 + 1e-8, `Gap ${gap} is outside intervalSec`);
        }
      }
      assert.ok(new Set(hits.map((hit) => hit.output.gain.value)).size > 1);
      assert.ok(new Set(hits.map((hit) => hit.detune)).size > 1);
      assert.deepEqual(useSceneStore.getState().scene, scene);
      assert.equal(requests.get("cup_clink"), 1, "Reuse the decoded clip for every hit");
    } finally { Math.random = random; }
  });
  await check("long event gaps are capped at 30 s", async () => {
    const first = sources.length;
    setSound("songbird", "event", "rare-birds", [40, 90]);
    const started = now;
    await flush(); await advance(200);
    const hits = sources.slice(first);
    assert.ok(hits[0].startedAt - started <= 3);
    for (let i = 1; i < hits.length; i++) assert.ok(hits[i].startedAt - hits[i - 1].endedAt <= 30 + 1e-8);
    assert.ok(hits.length >= 5, `${hits.length} plays in 200 s`); // 10 s clips + 30 s gaps; uncapped gives at most 4
  });
  await check("moving an event during a slow download does not stack pending copies", async () => {
    let release; const promise = new Promise((resolve) => { release = resolve; });
    held.set("bird_chirp", { promise });
    setSound("bird_chirp", "event", "loading-bird"); await flush(); await advance(3); // a new event plays within 3 s
    const first = sources.length;
    for (let index = 0; index < 5; index++) {
      useSceneStore.getState().applyOps([{ op: "move", id: "loading-bird", position: [index / 5, 1.6, 0] }]);
      await advance(2);
    }
    release(); held.delete("bird_chirp"); await flush();
    assert.equal(sources.length - first, 1);
    assert.equal(active().length, 1);
  });
  await check("changing intervals during a one-shot preserves it and uses the new gap after its end", async () => {
    setSound("page_flip", "event", "interval-change"); await flush(); await advance(3); // a new event plays within 3 s
    const hit = active()[0];
    setSound("page_flip", "event", "interval-change", [4, 4]); await flush();
    assert.equal(active()[0], hit);
    await advance(endTime(hit) - now);
    assert.equal(active().length, 0);
    await advance(3.99); assert.equal(active().length, 0);
    await advance(0.02);
    assert.ok(Math.abs(active()[0].startedAt - hit.endedAt - 4) < 1e-8);
  });
  await check("removing an event prevents an in-flight download from starting later", async () => {
    let release; const promise = new Promise((resolve) => { release = resolve; });
    held.set("owl", { promise });
    setSound("owl", "event"); await flush(); await advance(3); // a new event plays within 3 s
    useSceneStore.getState().setScene({ ...bedroom, objects: [] });
    release(); held.delete("owl"); await flush(); await advance(2);
    assert.equal(active().length, 0);
  });
  await check("an object's level follows what it emits: silence 0, loud near 1, then a gradual fall", async () => {
    setSound("ocean", "bed", "metered"); await flush();
    const analyser = analysers.at(-1);
    assert.equal(soundLevel("metered"), 0, "silence, e.g. before a clip's first sample, reads 0");
    analyser.value = 0.5; await advance(1);
    assert.ok(soundLevel("metered") > 0.95);
    analyser.value = 0; await advance(0.1);
    const falling = soundLevel("metered");
    assert.ok(falling > 0.3 && falling < 0.9, `level ${falling} 0.1 s into silence`);
    await advance(2);
    assert.ok(soundLevel("metered") < 0.01);
    assert.equal(soundLevel("no-such-object"), 0);
  });
  await check("a recreated or removed object's meter follows the object", async () => {
    setSound("ocean", "bed", "metered"); await flush();
    setSound("cup_clink", "event", "metered"); await flush(); // a kind change recreates the voice
    const analyser = analysers.at(-1);
    analyser.value = 0.5; await advance(1);
    assert.ok(soundLevel("metered") > 0.95, "the new voice's meter is the one read");
    useSceneStore.getState().setScene({ ...bedroom, objects: [] }); await flush();
    assert.equal(soundLevel("metered"), 0, "a removed object has no meter");
  });
  await check("muting fades the voice out and unmuting restores its volume", async () => {
    setSound("ocean"); await flush();
    // By name: an earlier check's one-shot may still be fading out.
    const voiceGain = () => active().find((source) => source.buffer.asset === "ocean").outputs[0].outputs[0].gain;
    const mute = (muted) => useSceneStore.getState().applyOps([{ op: "set_muted", id: "same-object", muted }]);
    mute(true);
    assert.equal(voiceGain().value, 0);
    assert.ok(voiceGain().timeConstant >= 0.08, "a fade, not a cut");
    mute(false);
    assert.equal(voiceGain().value, 0.5);
  });
  await check("turning the room view leaves the listener where it is", async () => {
    const forward = () => [context.listener.forwardX.value, context.listener.forwardZ.value].map((v) => Math.round(v * 1000) / 1000);
    // The listener faces scene.listener.yaw (0: toward -z), whatever the view's angle
    assert.deepEqual(forward(), [-0, -1]);
    useRoomStore.setState({ viewAngle: Math.PI / 2 }); // the room turned a quarter counterclockwise
    assert.deepEqual(forward(), [-0, -1]);
    useRoomStore.setState({ viewAngle: 0 });
  });
  await check("turning your head turns the listener; the sounds stay put in the room", async () => {
    const forward = () => [context.listener.forwardX.value, context.listener.forwardZ.value].map((v) => Math.round(v * 1000) / 1000 + 0);
    useHeadPose.setState({ yaw: Math.PI / 2, status: "tracking" }); // head turned a quarter to the left
    assert.deepEqual(forward(), [-1, 0], "facing -x: a sound ahead (-z) is now on your right");
    useHeadPose.setState({ yaw: -Math.PI / 4 });
    assert.deepEqual(forward(), [0.707, -0.707]);
    useRoomStore.setState({ viewAngle: Math.PI / 2 }); // turning the view still changes nothing
    assert.deepEqual(forward(), [0.707, -0.707]);
    useRoomStore.setState({ viewAngle: 0 });
    useHeadPose.setState({ yaw: 0, status: "off" });
    assert.deepEqual(forward(), [0, -1]);
  });
  await check("with ElevenLabs off, a sound the library lacks plays the closest pack sound, with no /api/sound call", async () => {
    const realFetch = globalThis.fetch, urls = [];
    globalThis.fetch = (url, ...rest) => { urls.push(String(url)); return realFetch(url, ...rest); };
    try {
      setSound("gen:bed:rain drumming on an old tin roof", "bed", "tin-roof"); await flush(); await advance(1);
      assert.ok(active().some((source) => source.buffer.asset.startsWith("rain")), "a rain loop from the pack");
      assert.ok(!urls.some((url) => url.includes("/api/sound")), "no generation request");
    } finally { globalThis.fetch = realFetch; }
  });
  await check("an agent sound this page can't load (e.g. after a reload) plays the closest pack sound", async () => {
    setSound("managed:file_gone:event:sparrow chirps", "event", "reloaded-birds"); await flush(); await advance(3);
    assert.deepEqual(active().map((source) => source.buffer.asset), ["sparrow"]);
  });
  await check("engine stop cancels loops and future event callbacks", async () => {
    setSound("ocean"); await flush(); engine.stop(); await advance(3);
    assert.equal(active().length, 0); assert.equal(timers.size, 0);
  });
  console.log(`Passed ${passed} audio lifecycle checks.`);
} finally {
  engine?.stop();
  Object.assign(globalThis, originals);
  await server.close();
}
