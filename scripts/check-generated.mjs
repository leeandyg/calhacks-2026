import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

// Real Web Audio, including K-weighting, without speakers, provider calls or credits.
const server = await createServer({
  appType: "custom",
  server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
});
server.middlewares.use("/audio-check", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end("<!doctype html><title>Generated audio checks</title>");
});
let browser;
try {
  // Both provider paths share this request builder. Verify it without spending credits.
  const { requestSound } = await server.ssrLoadModule("/convex/elevenlabs.ts");
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response("audio");
  };
  try {
    await requestSound("bed", "cat purring", "test-key");
    await requestSound("event", "wooden wind chime struck once", "test-key");
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(requests[0].model_id, "eleven_text_to_sound_v2");
  assert.equal(requests[0].loop, true);
  assert.equal(requests[0].duration_seconds, 15);
  assert.equal(requests[1].model_id, "eleven_text_to_sound_v3");
  assert.equal(requests[1].loop, false);
  assert.equal(requests[1].duration_seconds, 3);
  assert.match(requests[1].text, /one isolated occurrence.*natural attack and full decay/);
  for (const request of requests) {
    assert.match(request.text, /Dry recording, no added reverb/);
    assert.equal(request.prompt_influence, 0.5);
  }

  await server.listen();
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}), headless: true });
  const page = await browser.newPage();
  await page.goto(`${server.resolvedUrls.local[0]}audio-check`);
  const checks = await page.evaluate(async () => {
    const { normalize, loudness } = await import("/src/audio/generated.ts");
    const checks = [];
    const check = (name, passes, detail = "") => {
      if (!passes) throw new Error(`${name}: ${detail}`);
      checks.push(name);
    };
    const makeTone = (seconds, amplitude, channels = 1) => {
      const buffer = new AudioBuffer({ numberOfChannels: channels, length: Math.round(seconds * 44100), sampleRate: 44100 });
      for (let c = 0; c < channels; c++) {
        const x = buffer.getChannelData(c);
        for (let i = 0; i < x.length; i++) x[i] = amplitude * Math.sin(2 * Math.PI * 440 * i / 44100);
      }
      return buffer;
    };
    const peak = (buffer) => buffer.getChannelData(0).reduce((max, s) => Math.max(max, Math.abs(s)), 0);
    for (const kind of ["bed", "event"]) {
      const target = kind === "bed" ? -20 : -18;
      const input = makeTone(1, 0.002); // requires >30 dB of gain
      const before = await loudness(input);
      const out = await normalize(input, kind);
      const after = await loudness(out);
      check(`${kind}: quiet recordings reach the target`, Math.abs(after - target) < 0.2, `${before} -> ${after}`);
      check(`${kind}: source data stays unchanged`, peak(input) < 0.00201);
    }
    const short = await normalize(makeTone(0.1, 0.002), "event");
    check("100 ms one-shot is normalized", Math.abs(await loudness(short) + 18) < 0.2);

    const stereo = makeTone(1, 0.002, 2);
    const right = stereo.getChannelData(1);
    for (let i = 0; i < right.length; i++) right[i] *= -1;
    const mono = await normalize(stereo, "event");
    check("opposing stereo phases remain audible", mono.numberOfChannels === 1 && Math.abs(await loudness(mono) + 18) < 0.2);
    const inPhase = await normalize(makeTone(1, 0.002, 2), "event");
    check("ordinary stereo keeps its waveform", mono.getChannelData(0).every((s, i) => Math.abs(s - inPhase.getChannelData(0)[i]) < 1e-6));

    const transient = makeTone(1, 0.001);
    transient.getChannelData(0)[1000] = 0.99;
    const limited = await normalize(transient, "event");
    check("transient peaks stay finite and within full scale", peak(limited) <= 1 && limited.getChannelData(0).every(Number.isFinite));
    check("transient timing and duration stay intact", limited.length === transient.length && limited.sampleRate === transient.sampleRate);

    for (const amplitude of [0, 1e-6]) {
      let rejected = false;
      try { await normalize(makeTone(1, amplitude), "bed"); } catch { rejected = true; }
      check(`${amplitude ? "near-silence" : "silence"} uses the failure/fallback path`, rejected);
    }
    const renderAtReference = async (refDistance, muted = false) => {
      const ctx = new OfflineAudioContext(2, 44100, 44100);
      const source = new AudioBufferSourceNode(ctx, { buffer: makeTone(1, 0.1) });
      const gain = new GainNode(ctx, { gain: muted ? 0 : 0.2 });
      const panner = new PannerNode(ctx, { panningModel: "equalpower", distanceModel: "inverse", refDistance, positionX: 5 });
      source.connect(gain).connect(panner).connect(ctx.destination);
      source.start();
      const out = await ctx.startRendering();
      let energy = 0;
      for (let c = 0; c < out.numberOfChannels; c++) {
        for (const s of out.getChannelData(c)) energy += s * s;
      }
      return energy;
    };
    const oldEnergy = await renderAtReference(1);
    const newEnergy = await renderAtReference(2);
    check("a 5 m event gets 6 dB more level at the same user volume", Math.abs(10 * Math.log10(newEnergy / oldEnergy) - 6.02) < 0.02);
    check("muted events remain silent with the new reference", await renderAtReference(2, true) === 0);
    return checks;
  });
  for (const check of checks) console.log(`PASS ${check}`);
  console.log(`PASS provider requests retain the tested models, seamless beds and isolated events with decay`);
} finally {
  await browser?.close();
  await server.close();
}
