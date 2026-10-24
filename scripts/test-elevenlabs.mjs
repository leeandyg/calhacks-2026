#!/usr/bin/env node
// ElevenLabs sound-effects tests: generates takes, measures each one, and writes a listening page
// that loops them like the app does (loudness-matched, so you compare quality, not volume).
//
//   node --env-file=.env scripts/test-elevenlabs.mjs models    # v2 vs v3 vs the pack (picked the models)
//   node --env-file=.env scripts/test-elevenlabs.mjs prompts   # prompt wording / prompt_influence for loops
//   python3 -m http.server 8000 --bind 127.0.0.1               (from the repo root; localhost only)
//   open http://localhost:8000/assets/raw/elevenlabs/<experiment>/listen.html
//
// Output goes to assets/raw/elevenlabs/<experiment>/ (gitignored). Billed at 40 credits per second,
// so the script prints the cost and refuses to overwrite an experiment that already ran.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const V2 = "eleven_text_to_sound_v2";
const V3 = "eleven_text_to_sound_v3";
const BED_SEC = 15;
const EVENT_SEC = 2;
const CREDITS_PER_SEC = 40;
const CLEAN = "close-up, clean recording, no music, no speech";

// Each take: [section, label, text, kind, model, prompt_influence, pack asset to compare against]
const EXPERIMENTS = {
  models: [
    ["rain_window", "steady rain on a cafe window, no voices", "bed", "rain_window"],
    ["fireplace", "crackling fireplace in a small wooden cabin", "bed", "fireplace"],
    ["cup", "a single ceramic coffee cup set down on a saucer", "event", "cup_clink"],
    ["sparrow", "one sparrow chirp, slightly distant", "event", "sparrow"],
    ["cat_purr", "a cat purring softly, close", "bed", null],
    ["radiator", "old radiator hissing and ticking", "bed", null],
  ].flatMap(([section, text, kind, packId]) => [
    [section, "v2", text, kind, V2, 0.3, packId],
    [section, "v3", text, kind, V3, 0.3, null],
  ]),
  prompts: [
    ["a cat purring softly, close", "cat_purr"],
    ["warm crackling fireplace hearth wood embers burning gently", "fireplace"],
  ].flatMap(([query, section]) => [
    [section, "plain", query, "bed", V2, 0.3, null],
    [section, "clean", `${query}. ${CLEAN}`, "bed", V2, 0.3, null],
    [section, "clean-strict", `${query}. ${CLEAN}`, "bed", V2, 0.7, null],
  ]),
};

const experiment = process.argv[2];
const takes = EXPERIMENTS[experiment];
if (!takes) {
  console.error(`Usage: node --env-file=.env scripts/test-elevenlabs.mjs <${Object.keys(EXPERIMENTS).join("|")}>`);
  process.exit(1);
}
const outDir = path.join("assets/raw/elevenlabs", experiment);
if (existsSync(path.join(outDir, "results.json")) && !process.argv.includes("--again")) {
  console.error(`${outDir} already has results. Add --again to regenerate (and pay for) it.`);
  process.exit(1);
}
const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error("ELEVENLABS_API_KEY missing. Run with: node --env-file=.env scripts/test-elevenlabs.mjs ...");
  process.exit(1);
}

const seconds = takes.reduce((sum, t) => sum + (t[3] === "bed" ? BED_SEC : EVENT_SEC), 0);
console.log(`${experiment}: ${takes.length} takes, about ${seconds * CREDITS_PER_SEC} credits\n`);
mkdirSync(outDir, { recursive: true });
const results = [];

// Sequential, so each timing is clean
for (const [section, label, text, kind, model, influence, packId] of takes) {
  const file = path.join(outDir, section, `${label}.mp3`);
  const r = await generate({ text, kind, model, influence, file });
  const result = { section, label, text, kind, model, influence, packId, file, ...r, ...(r.ok ? analyze(file, kind) : {}) };
  results.push(result);
  print(result);
}

writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2) + "\n");
writeFileSync(path.join(outDir, "listen.html"), listenPage(results));
console.log(`\nWrote ${outDir}/results.json and ${outDir}/listen.html`);

async function generate({ text, kind, model, influence, file }) {
  const body = {
    text,
    model_id: model,
    duration_seconds: kind === "bed" ? BED_SEC : EVENT_SEC,
    loop: kind === "bed",
    prompt_influence: influence,
  };
  const start = performance.now();
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const firstByteSec = +((performance.now() - start) / 1000).toFixed(1);
    if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 200), firstByteSec };
    const audio = Buffer.from(await res.arrayBuffer());
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, audio);
    return { ok: true, status: res.status, firstByteSec, totalSec: +((performance.now() - start) / 1000).toFixed(1), bytes: audio.length };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

/** Duration, loudness (LUFS), loop seam jump for beds, and a loudness-matched copy for listening. */
function analyze(file, kind) {
  const durationSec = +parseFloat(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString(),
  ).toFixed(1);
  const ebur = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const lufs = parseFloat([...ebur.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)?.[1]);
  const matched = file.replace(/\.mp3$/, ".matched.mp3");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-ac", "1", "-af", `loudnorm=I=${kind === "bed" ? -20 : -18}:TP=-1.5`, "-ar", "44100", matched]);
  if (kind !== "bed") return { durationSec, lufs, matched };
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-"], { maxBuffer: 1 << 28 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  let sum = 0, n = 0;
  for (let i = 1000; i < x.length - 1000; i += 13, n++) sum += Math.abs(x[i + 1] - x[i]);
  const seamJump = +(Math.abs(x[0] - x[x.length - 1]) / (sum / n)).toFixed(1);
  return { durationSec, lufs, seamJump, matched };
}

function print(r) {
  const head = `${r.section.padEnd(12)} ${r.label.padEnd(13)}`;
  if (!r.ok) return console.log(`${head} FAILED ${r.status}: ${r.error}`);
  const seam = r.seamJump === undefined ? "" : `  seam ${r.seamJump}x`;
  console.log(`${head} first byte ${r.firstByteSec}s, total ${r.totalSec}s, ${r.durationSec}s audio, ${r.lufs} LUFS${seam}`);
}

/** Plays through Web Audio with loop=true (like the app), not <audio loop>, which adds its own gap. */
function listenPage(results) {
  const sections = [...new Set(results.map((r) => r.section))];
  const rows = sections
    .map((section) => {
      const here = results.filter((r) => r.section === section && r.ok);
      const kind = here[0]?.kind ?? "bed";
      const items = here.map((r) => [r.label, `/${r.matched}`, `"${r.text}" · ${r.model.replace("eleven_text_to_sound_", "")} · influence ${r.influence}`]);
      const packId = results.find((r) => r.section === section && r.packId)?.packId;
      if (packId) items.push([`pack: ${packId}`, `/public/sounds/${packId}.mp3`, "current pack sound"]);
      const buttons = items
        .map(([label, url, detail]) => `<div class="take"><span>${label}</span><button data-url="${url}" data-loop="${kind === "bed"}">Play</button>${kind === "bed" ? `<button data-url="${url}" data-loop="true" data-seam="1">Seam</button>` : ""}<small>${detail}</small></div>`)
        .join("");
      return `<section><h2>${section} <small>(${kind})</small></h2>${buttons}</section>`;
    })
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>ElevenLabs listening test</title>
<style>body{font:15px system-ui;max-width:860px;margin:24px auto;padding:0 16px;background:#15171c;color:#e8e8ec}
section{border-top:1px solid #333;padding:8px 0}.take{display:flex;gap:8px;align-items:center;margin:6px 0}
.take span{width:130px}.take small{color:#9a9fac}button{padding:6px 12px;border:0;border-radius:6px;background:#4f8cff;color:#fff;cursor:pointer}#stop{background:#c44}</style>
<h1>ElevenLabs listening test</h1>
<p>Headphones on. All takes are loudness-matched (beds -20 LUFS, events -18). <b>Play</b> loops beds the way the app does. <b>Seam</b> starts 3 s before the loop point.</p>
<button id="stop">Stop</button>
${rows}
<script>
const ctx = new AudioContext(); let current; const cache = {};
async function load(url) { return (cache[url] ??= fetch(url).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b))); }
function stop() { try { current?.stop(); } catch {} current = undefined; }
document.getElementById("stop").onclick = stop;
document.querySelectorAll("button[data-url]").forEach(b => b.onclick = async () => {
  await ctx.resume(); stop();
  const buffer = await load(b.dataset.url);
  const src = new AudioBufferSourceNode(ctx, { buffer, loop: b.dataset.loop === "true" });
  src.connect(ctx.destination);
  src.start(0, b.dataset.seam ? Math.max(0, buffer.duration - 3) : 0);
  current = src;
});
</script>`;
}
