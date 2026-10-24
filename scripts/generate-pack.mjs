#!/usr/bin/env node
// Makes an ElevenLabs-generated sound the pack's source for one slug (#40).
//
//   node --env-file=.env scripts/generate-pack.mjs <slug> "<prompt>"                 generates it (costs credits)
//   node scripts/generate-pack.mjs <slug> "<prompt>" --file <take.mp3> [--model v2]  uses a take you already have
//   node scripts/pack.mjs <slug> ...                                                 then rebuild those sounds
//
// Saves assets/raw/<slug>/elevenlabs.mp3, moves the Freesound candidates to assets/raw/<slug>/_unused/
// (pack.mjs ignores subfolders, so moving them back undoes this), and records the prompt in
// candidates.json for CREDITS.md. Models follow api/sound.ts: v2 for beds, v3 for events.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const RAW_DIR = process.env.RAW_DIR ?? "assets/raw";
const MODEL = { bed: "eleven_text_to_sound_v2", event: "eleven_text_to_sound_v3" };
const DURATION_SEC = { bed: 15, event: 2 };
const CREDITS_PER_SEC = 40;

const [slug, prompt] = process.argv.slice(2);
const option = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const entry = JSON.parse(readFileSync("public/sounds/manifest.json", "utf8")).find((e) => e.id === slug);
if (!slug || !prompt || !entry) {
  console.error('Usage: node --env-file=.env scripts/generate-pack.mjs <slug> "<prompt>" [--file take.mp3 --model v2|v3]');
  console.error(entry || !slug ? "" : `"${slug}" is not in public/sounds/manifest.json`);
  process.exit(1);
}
const { kind } = entry;
const take = option("file");
const model = option("model") ? `eleven_text_to_sound_${option("model")}` : MODEL[kind];

const dir = path.join(RAW_DIR, slug);
const target = path.join(dir, "elevenlabs.mp3");
mkdirSync(path.join(dir, "_unused"), { recursive: true });

if (take) {
  copyFileSync(take, target);
} else {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    console.error("ELEVENLABS_API_KEY missing. Run with: node --env-file=.env scripts/generate-pack.mjs ...");
    process.exit(1);
  }
  console.log(`${slug}: generating with ${model} (about ${DURATION_SEC[kind] * CREDITS_PER_SEC} credits)`);
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: prompt, model_id: model, duration_seconds: DURATION_SEC[kind], loop: kind === "bed" }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    console.error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  writeFileSync(target, Buffer.from(await res.arrayBuffer()));
}

for (const f of readdirSync(dir)) {
  if (f.endsWith(".mp3") && f !== "elevenlabs.mp3") renameSync(path.join(dir, f), path.join(dir, "_unused", f));
}

const candidatesPath = path.join(RAW_DIR, "candidates.json");
const candidates = existsSync(candidatesPath) ? JSON.parse(readFileSync(candidatesPath, "utf8")) : {};
candidates[`${slug}/elevenlabs`] = {
  slug,
  kind,
  name: prompt,
  author: "ElevenLabs (generated)",
  license: "generated",
  generated: true,
  model: model.replace("eleven_text_to_sound_", ""),
};
writeFileSync(candidatesPath, JSON.stringify(candidates, null, 2) + "\n");
console.log(`${slug}: ${target} is now the source. Rebuild with: node scripts/pack.mjs ${slug}`);
