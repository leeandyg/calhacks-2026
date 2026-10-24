import assert from "node:assert/strict";
import { createServer } from "vite";

// Reverb checks (#12) with a minimal fake AudioContext: synthesized impulse responses and preset
// switching. No speakers, credentials, or API calls.
class Param {
  value = 0;
  target = 0;
  setTargetAtTime(value) { this.target = value; }
}
class Node {
  connect(node) { return node; }
  disconnect() { this.disconnected = true; }
}
class Gain extends Node { gain = new Param(); }
class Convolver extends Node { buffer = null; normalize = true; }
const context = {
  currentTime: 0,
  sampleRate: 8000,
  createGain: () => new Gain(),
  createConvolver: () => new Convolver(),
  createBuffer: (channels, length, sampleRate) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c) => data[c] };
  },
};
const timers = [];
const originalSetTimeout = globalThis.setTimeout;
const runTimers = () => { while (timers.length) timers.shift()(); };

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
let passed = 0;
const check = (name, test) => { test(); passed++; console.log(`PASS ${name}`); };
try {
  const { Reverb, impulseResponse } = await server.ssrLoadModule("/src/audio/reverb.ts");
  // Fake timers only after Vite has started (it needs real ones); Reverb looks setTimeout up when it runs
  globalThis.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  const rms = (data, from, to) => Math.sqrt(data.slice(from, to).reduce((s, v) => s + v * v, 0) / (to - from));

  for (const [preset, decaySec] of [["small-room", 0.6], ["large-room", 1.8], ["outdoor", 0.4]]) {
    check(`${preset}: ${decaySec} s stereo impulse at unit energy, decaying ~60 dB`, () => {
      const ir = impulseResponse(context, preset);
      assert.equal(ir.numberOfChannels, 2);
      assert.equal(ir.length, Math.ceil(decaySec * context.sampleRate));
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        assert.ok(Math.abs(d.reduce((s, v) => s + v * v, 0) - 1) < 1e-3, "unit energy");
        const tenth = Math.floor(d.length / 10);
        const dropDb = 20 * Math.log10(rms(d, tenth, 2 * tenth) / rms(d, d.length - tenth, d.length));
        assert.ok(dropDb > 40, `decays (dropped ${dropDb.toFixed(0)} dB)`);
      }
      assert.equal(impulseResponse(context, preset), ir, "cached per context");
    });
  }

  const output = new Node();
  const reverb = new Reverb(context, output);
  const convolver = () => reverb.convolver;
  const wet = () => reverb.wet.gain;
  check("starts silent and uses its own scaling, not the convolver's", () => {
    assert.equal(wet().value, 0);
    assert.equal(convolver().normalize, false);
  });
  check("switching to a room fades out, swaps the impulse, then fades in", () => {
    reverb.setPreset("small-room");
    assert.equal(wet().target, 0);
    assert.equal(convolver().buffer, null);
    runTimers();
    assert.equal(convolver().buffer, impulseResponse(context, "small-room"));
    assert.equal(wet().target, 0.08);
  });
  check("a second switch replaces the first one's pending swap", () => {
    reverb.setPreset("large-room");
    reverb.setPreset("outdoor");
    runTimers();
    assert.equal(convolver().buffer, impulseResponse(context, "outdoor"));
    assert.equal(wet().target, 0.08);
  });
  check("none fades the reverb out", () => {
    reverb.setPreset("none");
    runTimers();
    assert.equal(wet().target, 0);
  });
  check("setting the same preset again does nothing", () => {
    reverb.setPreset("none");
    assert.equal(timers.length, 0);
  });
  console.log(`Passed ${passed} reverb checks.`);
} finally {
  globalThis.setTimeout = originalSetTimeout;
  await server.close();
}
