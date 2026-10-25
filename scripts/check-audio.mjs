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
const originals = { fetch, setTimeout, clearTimeout, AudioBufferSourceNode: globalThis.AudioBufferSourceNode, GainNode: globalThis.GainNode, PannerNode: globalThis.PannerNode };
class Param { value = 0; setTargetAtTime(value, _at, timeConstant) { this.value = value; this.timeConstant = timeConstant; } }
class Node { connect(node) { (this.outputs ??= []).push(node); return node; } disconnect() { this.disconnected = true; } }
class Gain extends Node { gain = new Param(); constructor(_ctx, options) { super(); this.gain.value = options?.gain ?? 1; } }
class Panner extends Node { positionX = new Param(); positionY = new Param(); positionZ = new Param(); }
class Source extends Node {
  constructor(_ctx, options) { super(); Object.assign(this, options); sources.push(this); }
  start() { this.started = true; }
  stop(at = now) { this.stopsAt = at; }
}
class Convolver extends Node { buffer = null; normalize = true; }
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
const active = () => sources.filter((source) => source.started && (source.stopsAt === undefined || source.stopsAt > now));
async function flush() { await setImmediate(); }
async function advance(seconds) {
  const end = now + seconds;
  for (;;) {
    const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
  }
  now = end;
  for (const source of sources) if (source.stopsAt <= now && !source.ended) {
    source.ended = true; source.onended?.();
  }
  await flush();
}

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
let engine;
try {
  const { AudioEngine } = await server.ssrLoadModule("/src/audio/AudioEngine.ts");
  const { useSceneStore } = await server.ssrLoadModule("/src/scene/store.ts");
  const { bedroom } = await server.ssrLoadModule("/src/scene/fixtures.ts");
  const { useRoomStore } = await server.ssrLoadModule("/src/room/useRoomStore.ts");
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
  function setSound(assetId, kind = "bed", id = "same-object") {
    useSceneStore.getState().setScene({ ...bedroom, objects: [{
      id, label: assetId ?? "Unresolved", kind, sound: { query: "test sound", assetId },
      position: [1, 1.6, 0], volume: 0.5, ...(kind === "event" ? { intervalSec: [1, 1] } : {}),
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
    setSound("cup_clink", "event"); await flush(); await advance(1);
    assert.ok(active().some((source) => source.buffer.asset === "cup_clink"));
    setSound("page_flip", "event"); await flush(); await advance(0.7);
    assert.equal(active().length, 0);
    await advance(0.3);
    assert.deepEqual(active().map((source) => source.buffer.asset), ["page_flip"]);
  });
  await check("removing an event prevents an in-flight download from starting later", async () => {
    let release; const promise = new Promise((resolve) => { release = resolve; });
    held.set("owl", { promise });
    setSound("owl", "event"); await flush(); await advance(1);
    useSceneStore.getState().setScene({ ...bedroom, objects: [] });
    release(); held.delete("owl"); await flush(); await advance(2);
    assert.equal(active().length, 0);
  });
  await check("muting fades the voice out and unmuting restores its volume", async () => {
    setSound("ocean"); await flush();
    const voiceGain = () => active()[0].outputs[0].outputs[0].gain;
    const mute = (muted) => useSceneStore.getState().applyOps([{ op: "set_muted", id: "same-object", muted }]);
    mute(true);
    assert.equal(voiceGain().value, 0);
    assert.ok(voiceGain().timeConstant >= 0.08, "a fade, not a cut");
    mute(false);
    assert.equal(voiceGain().value, 0.5);
  });
  await check("room rotation leaves listener orientation and source panners unchanged", async () => {
    const forward = () => [context.listener.forwardX.value, context.listener.forwardZ.value].map((v) => Math.round(v * 1000) / 1000);
    const listener = () => Object.values(context.listener).map(param => param.value);
    const panner = active()[0].outputs[0].outputs[0].outputs.find(node => node instanceof Panner);
    const position = () => [panner.positionX.value, panner.positionY.value, panner.positionZ.value];
    const originalListener = listener(), originalPosition = position();
    // Retain the initial camera-aligned audio frame, regardless of subsequent view turns.
    assert.deepEqual(forward(), [-0.707, -0.707]);
    for (const viewAngle of [0.25, Math.PI / 2, Math.PI, -Math.PI / 2, 2 * Math.PI]) {
      useRoomStore.setState({ viewAngle });
      assert.deepEqual(listener(), originalListener);
      assert.deepEqual(position(), originalPosition);
    }
    useRoomStore.setState({ viewAngle: Math.PI / 2 });
    setSound("ocean"); await flush(); // A scene replacement while rotated must not turn the listener.
    assert.deepEqual(listener(), originalListener);
    assert.ok(useSceneStore.getState().applyOps([{ op: "move", id: "same-object", position: [-3, 1.5, 2] }]).ok);
    const moved = useSceneStore.getState().scene.objects[0].position;
    assert.deepEqual(position(), moved, 'dragged canonical positions still reach the panner');
    assert.notDeepEqual(position(), originalPosition);
    assert.deepEqual(listener(), originalListener);
    useRoomStore.setState({ viewAngle: 0 });
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
