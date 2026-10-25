#!/usr/bin/env node
// Builds the sound pack (#4): assets/raw/<slug>/*.{mp3,wav,flac,aif} -> public/sounds/<slug>.mp3,
// plus public/sounds/manifest.json and public/sounds/CREDITS.md.
//
//   node scripts/pack.mjs                  rebuild everything (needs ffmpeg on PATH)
//   node scripts/pack.mjs fireplace sparrow  rebuild only these; the rest of the pack is kept
//
// Keep one candidate per assets/raw/<slug>/ folder (see fetch-freesound.mjs). If a folder still
// has several, an ElevenLabs-generated one (see generate-pack.mjs) wins, else the most-downloaded.
// Files downloaded by hand keep Freesound's name (<id>__<author>__<name>.wav); describe them in
// candidates.json first with `npm run sounds:fetch -- --describe`.
//
// Beds: mono, a 30 s slice whose tail is crossfaded into its head so it loops seamlessly,
//       loudness-normalized. Generated beds are already seamless loops, so they're only made mono.
// Events: mono, leading/trailing silence trimmed, normalized.
// CROP picks the part of a recording to use. Noise beds without a recording are synthesized here.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const RAW_DIR = process.env.RAW_DIR ?? "assets/raw";
const OUT_DIR = "public/sounds";
const BED_SEC = 30; // loop length
const XFADE_SEC = 1.5; // tail-into-head crossfade
const SKIP_SEC = 2; // skip fade-ins at the start of recordings
const BED_LUFS = -20;
const EVENT_LUFS = -18;

// Tags are the resolver's whole vocabulary (#17): noun, setting, texture.
const TAGS = {
  rain_window: ["rain", "window", "glass", "steady", "indoor", "cozy", "cafe", "bedroom"],
  rain_roof: ["rain", "roof", "patter", "steady", "indoor", "cabin", "attic"],
  rain_heavy: ["rain", "heavy", "downpour", "storm", "steady", "masking", "outdoor"],
  thunder_distant: ["thunder", "storm", "rain", "distant", "rumble"],
  cafe_murmur: ["cafe", "coffee shop", "murmur", "chatter", "crowd", "indoor", "busy"],
  espresso: ["espresso", "coffee machine", "steam", "hiss", "cafe", "barista"],
  fireplace: ["fire", "fireplace", "crackling", "cozy", "cabin", "warm"],
  wind: ["wind", "gusts", "howling", "outdoor", "storm"],
  wind_trees: ["wind", "trees", "leaves", "rustling", "forest", "breeze", "outdoor"],
  creek: ["creek", "stream", "water", "brook", "flowing", "forest", "river"],
  ocean: ["ocean", "waves", "sea", "beach", "surf", "shore"],
  fan: ["fan", "electric fan", "hum", "steady", "masking", "bedroom"],
  ac_hum: ["air conditioner", "hum", "hvac", "drone", "steady", "masking", "office"],
  library: ["library", "quiet", "room tone", "indoor", "study"],
  office: ["office", "workplace", "murmur", "indoor", "typing"],
  keyboard: ["keyboard", "typing", "computer", "office", "clicks"],
  clock: ["clock", "ticking", "tick tock", "quiet", "indoor", "library"],
  traffic_distant: ["traffic", "city", "cars", "urban", "distant", "street"],
  crickets: ["crickets", "night", "insects", "outdoor", "summer", "countryside"],
  forest: ["forest", "birds", "nature", "woods", "outdoor", "morning"],
  brown_noise: ["brown noise", "noise", "deep", "rumble", "masking", "steady", "focus"],
  pink_noise: ["pink noise", "noise", "soft", "masking", "steady", "focus"],
  white_noise: ["white noise", "noise", "hiss", "static", "masking", "bright"],
  bird_chirp: ["bird", "chirp", "tweet", "songbird", "outdoor", "forest"],
  sparrow: ["sparrow", "bird", "chirp", "tweet", "outdoor"],
  songbird: ["songbird", "bird", "song", "call", "forest", "morning"],
  cup_clink: ["cup", "clink", "ceramic", "mug", "cafe", "dishes"],
  spoon_stir: ["spoon", "stir", "cup", "tea", "coffee", "cafe"],
  door_distant: ["door", "close", "distant", "indoor", "building"],
  page_flip: ["page", "turn", "book", "paper", "library", "study"],
  owl: ["owl", "hoot", "night", "forest", "bird"],
  fire_pop: ["fire", "crack", "pop", "wood", "fireplace", "campfire"],
  thunder_clap: ["thunder", "clap", "storm", "lightning"],
  dog_distant: ["dog", "bark", "distant", "neighborhood", "outdoor"],
  chair_creak: ["chair", "creak", "wood", "indoor", "furniture"],
  distant_siren: ["siren", "ambulance", "police", "emergency", "city", "urban", "distant", "street"],
  seagull_call: ["seagull", "gull", "bird", "call", "beach", "ocean", "sea", "coast"],
  alarm_clock: ["alarm clock", "alarm", "beeping", "digital", "wake up", "bedroom", "morning"],
};

// Seconds into the recording: beds loop from [start]; events keep [start, length], fading out.
const CROP = {
  fan: [16], // after the fan spins up
  rain_window: [10], // the opening is louder than the rest
  thunder_distant: [66], // three claps, quiet at both ends so the loop seam is clean
  songbird: [0.3, 1], // one of the three calls
  seagull_call: [3, 6], // the busiest stretch
};

const NOISES = { brown_noise: "brown", pink_noise: "pink", white_noise: "white" };
const AUDIO = /\.(mp3|wav|flac|aiff?)$/i;
const audioFiles = (slug) => {
  const dir = path.join(RAW_DIR, slug);
  return existsSync(dir) ? readdirSync(dir).filter((f) => AUDIO.test(f)) : [];
};

const candidates = JSON.parse(readFileSync(path.join(RAW_DIR, "candidates.json"), "utf8"));
const only = new Set(process.argv.slice(2));
const build = (slug) => !only.size || only.has(slug);
const manifestPath = path.join(OUT_DIR, "manifest.json");
const creditsPath = path.join(OUT_DIR, "CREDITS.md");
// A partial rebuild starts from the current pack and replaces only the chosen entries
const manifest = only.size ? JSON.parse(readFileSync(manifestPath, "utf8")) : [];
const credits = new Map(
  only.size ? [...readFileSync(creditsPath, "utf8").matchAll(/^\| `([a-z_]+)` \|.*$/gm)].map((m) => [m[1], m[0]]) : [],
);
const setEntry = (entry) => {
  const i = manifest.findIndex((e) => e.id === entry.id);
  if (i >= 0) manifest[i] = entry;
  else manifest.push(entry);
};

// A full rebuild clears previous output so the pack is exactly what's built here
if (!only.size) for (const f of readdirSync(OUT_DIR)) if (f.endsWith(".mp3")) rmSync(path.join(OUT_DIR, f));

for (const [slug, color] of Object.entries(NOISES)) {
  if (!build(slug) || audioFiles(slug).length) continue;
  const out = path.join(OUT_DIR, `${slug}.mp3`);
  const amplitude = color === "white" ? 0.25 : 0.5;
  const src = `anoisesrc=color=${color}:duration=${BED_SEC + XFADE_SEC + SKIP_SEC}:sample_rate=44100:amplitude=${amplitude}`;
  encode(["-f", "lavfi", "-i", src], bedFilter(SKIP_SEC + BED_SEC + XFADE_SEC), BED_LUFS, "96k", out);
  setEntry({ id: slug, file: `${slug}.mp3`, tags: TAGS[slug], kind: "bed", license: "CC0 (generated)" });
  console.log(`${slug}: generated`);
}

for (const slug of readdirSync(RAW_DIR).sort()) {
  const dir = path.join(RAW_DIR, slug);
  if (!TAGS[slug] || !existsSync(dir) || !build(slug)) continue;
  const files = audioFiles(slug);
  if (!files.length) {
    console.warn(`${slug}: no candidates, skipping`);
    continue;
  }
  // Keyed by Freesound id, so "123.mp3" and "123__author__name.wav" both match "<slug>/123"
  const keyOf = (f) => `${slug}/${f.match(/^\d+/)?.[0] ?? f.replace(AUDIO, "")}`;
  // Candidates were saved most-downloaded first; prefer that order among what's left
  const ranked = Object.keys(candidates).filter((k) => k.startsWith(`${slug}/`));
  const pick = files.find((f) => candidates[keyOf(f)]?.generated) ??
    ranked.map((k) => files.find((f) => keyOf(f) === k)).find(Boolean) ?? files[0];
  if (files.length > 1) console.warn(`${slug}: ${files.length} candidates left, using ${pick} (delete the others to choose)`);

  const info = candidates[keyOf(pick)];
  if (!info) throw new Error(`${slug}: ${pick} isn't in candidates.json; run npm run sounds:fetch -- --describe`);
  const input = path.join(dir, pick);
  const out = path.join(OUT_DIR, `${slug}.mp3`);
  if (info.kind === "bed" && info.generated) encode(["-i", input], "[0:a]aformat=channel_layouts=mono[shaped]", BED_LUFS, "96k", out);
  else if (info.kind === "bed") encode(["-i", input], bedFilter(probeDuration(input), CROP[slug]?.[0]), BED_LUFS, "96k", out);
  else encode(["-i", input], eventFilter(CROP[slug]), EVENT_LUFS, "128k", out);

  const license = info.generated ? "Generated (ElevenLabs)" : shortLicense(info.license);
  setEntry({ id: slug, file: `${slug}.mp3`, tags: TAGS[slug], kind: info.kind, license });
  const original = info.generated ? `"${info.name}" (${info.model})` : `[${info.name}](${info.url})`;
  credits.set(slug, `| \`${slug}\` | ${original} | ${info.author} | ${license} |`);
  console.log(`${slug}: ${pick} (${info.kind}, ${license})`);
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(
  creditsPath,
  [
    "# Sound credits",
    "",
    "Recorded sounds are from [Freesound](https://freesound.org), used under their Creative Commons licenses (CC0, CC-BY or CC-BY-NC).",
    "Sounds marked Generated were made with ElevenLabs Sound Effects from the prompt shown. Noise beds not listed here are synthesized.",
    "Each was converted to mono and loudness-normalized; recorded loops were also trimmed and crossfaded.",
    "",
    "| File | Original | Author | License |",
    "| --- | --- | --- | --- |",
    ...manifest.map((e) => credits.get(e.id)).filter(Boolean),
    "",
  ].join("\n"),
);
console.log(`\n${manifest.length} sounds -> ${OUT_DIR}/manifest.json`);

/**
 * Loop recipe: take BED_SEC + XFADE_SEC of audio, then crossfade the extra tail into the head.
 * The result ends exactly where its head picks up, so it loops with no seam. Output label: [shaped].
 * Recordings only a few seconds long get a shorter crossfade (a third of what's left).
 */
function bedFilter(duration, from) {
  const start = from ?? Math.max(0, Math.min(SKIP_SEC, duration - BED_SEC - XFADE_SEC));
  const xfade = Math.min(XFADE_SEC, (duration - start) / 3);
  const len = Math.min(BED_SEC, duration - start - xfade);
  return [
    `[0:a]aformat=channel_layouts=mono,atrim=start=${start}:duration=${len + xfade},asetpts=PTS-STARTPTS,asplit=3[a][b][c]`,
    `[a]atrim=0:${xfade},asetpts=PTS-STARTPTS,afade=t=in:d=${xfade}:curve=qsin[head]`,
    `[b]atrim=${len}:${len + xfade},asetpts=PTS-STARTPTS,afade=t=out:d=${xfade}:curve=qsin[tail]`,
    `[c]atrim=${xfade}:${len},asetpts=PTS-STARTPTS[body]`,
    `[head][tail]amix=inputs=2:normalize=0[joined]`,
    `[joined][body]concat=n=2:v=0:a=1[shaped]`,
  ].join(";");
}

/**
 * Trim silence at both ends (reverse trick for the tail), cap at 6 s, short fade-out. Output label: [shaped].
 * A crop keeps [start, start + length] instead; recordings with a noise floor have no silence to trim.
 */
function eventFilter([start, length] = []) {
  if (length) {
    const fade = Math.min(0.5, length / 4);
    return `[0:a]aformat=channel_layouts=mono,atrim=${start}:${start + length},asetpts=PTS-STARTPTS,` +
      `afade=t=in:d=0.02,afade=t=out:st=${length - fade}:d=${fade}[shaped]`;
  }
  const trim = "silenceremove=start_periods=1:start_threshold=-50dB";
  return `[0:a]aformat=channel_layouts=mono,${trim},areverse,${trim},areverse,atrim=0:6,afade=t=out:st=5.9:d=0.1[shaped]`;
}

/**
 * Two-pass loudness normalization: measure first, then apply one constant gain (linear=true).
 * Single-pass loudnorm rides the gain over time, which misses the target on transient sounds
 * and leaves loops ending at a different level than they start.
 */
function encode(inputArgs, shapedFilter, lufs, bitrate, out) {
  const target = `I=${lufs}:TP=-1.5:LRA=20`;
  const measure = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", ...inputArgs, "-filter_complex", `${shapedFilter};[shaped]loudnorm=${target}:print_format=json[out]`, "-map", "[out]", "-f", "null", "-"],
    { encoding: "utf8" },
  ).stderr;
  const m = JSON.parse(measure.slice(measure.lastIndexOf("{"), measure.lastIndexOf("}") + 1));
  if (m.input_i === "-inf") {
    // Shorter than one 400 ms loudness block (a single click): normalize the peak instead
    const filter = `${shapedFilter};[shaped]volume=${(-1.5 - Number(m.input_tp)).toFixed(2)}dB,aresample=44100,asetpts=N/SR/TB[out]`;
    ffmpeg([...inputArgs, "-filter_complex", filter, "-map", "[out]", "-ac", "1", "-b:a", bitrate, out]);
    return;
  }
  const measured = `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`;
  const filter = `${shapedFilter};[shaped]loudnorm=${target}:${measured}:linear=true,aresample=44100,asetpts=N/SR/TB[out]`;
  ffmpeg([...inputArgs, "-filter_complex", filter, "-map", "[out]", "-ac", "1", "-b:a", bitrate, out]);
}

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

function probeDuration(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return parseFloat(out.toString());
}

function shortLicense(url) {
  if (url.includes("publicdomain/zero")) return "CC0";
  const m = url.match(/licenses\/(by[a-z-]*)\/(\d\.\d)/);
  return m ? `CC-${m[1].toUpperCase()} ${m[2]}` : url;
}
