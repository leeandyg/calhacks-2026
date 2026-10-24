#!/usr/bin/env node
// Downloads candidate sounds from Freesound for the local sound pack (#4).
//
//   node --env-file=.env scripts/fetch-freesound.mjs [slug ...]
//
// For each sound below, searches CC0 + CC-BY sounds, keeps the most-downloaded few, and saves
// their HQ preview mp3s to assets/raw/<slug>/<freesound id>.mp3 (gitignored). Then:
//   1. Listen (Finder + spacebar) and delete every candidate you don't want, keeping one per folder.
//   2. Run scripts/pack.sh to turn the keepers into public/sounds/.
// assets/raw/candidates.json records author, license and link for every download (for CREDITS.md).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const KEEP_PER_SOUND = 3;
const RAW_DIR = "assets/raw";
const LICENSES = 'license:("Creative Commons 0" OR "Attribution")';
const BED_DURATION = "duration:[20 TO 120]";
const EVENT_DURATION = "duration:[0.2 TO 8]";

// slug: [query, kind]
const SOUNDS = {
  rain_window: ["rain window", "bed"],
  rain_roof: ["rain roof", "bed"],
  rain_heavy: ["heavy rain", "bed"],
  thunder_distant: ["distant thunder rain", "bed"],
  cafe_murmur: ["cafe ambience", "bed"],
  espresso: ["espresso machine", "bed"],
  fireplace: ["fireplace crackling", "bed"],
  wind: ["wind ambience", "bed"],
  wind_trees: ["wind trees leaves", "bed"],
  creek: ["stream water", "bed"],
  ocean: ["ocean waves", "bed"],
  fan: ["electric fan", "bed"],
  ac_hum: ["air conditioner hum", "bed"],
  library: ["library ambience", "bed"],
  office: ["office ambience", "bed"],
  keyboard: ["keyboard typing", "bed"],
  clock: ["clock ticking", "bed"],
  traffic_distant: ["distant traffic city", "bed"],
  crickets: ["crickets night", "bed"],
  forest: ["forest birds ambience", "bed"],
  bird_chirp: ["bird chirp", "event"],
  sparrow: ["sparrow", "event"],
  songbird: ["songbird call", "event"],
  cup_clink: ["cup clink", "event"],
  spoon_stir: ["spoon stir cup", "event"],
  door_distant: ["door close", "event"],
  page_flip: ["page turn", "event"],
  owl: ["owl hoot", "event"],
  fire_pop: ["wood crack fire", "event"],
  thunder_clap: ["thunder clap", "event"],
  dog_distant: ["dog bark distant", "event"],
  chair_creak: ["chair creak", "event"],
};

const token = process.env.FREESOUND_API_KEY;
if (!token) {
  console.error("FREESOUND_API_KEY missing. Run with: node --env-file=.env scripts/fetch-freesound.mjs");
  process.exit(1);
}

const only = process.argv.slice(2);
const slugs = only.length ? only : Object.keys(SOUNDS);
const candidatesPath = path.join(RAW_DIR, "candidates.json");
const candidates = existsSync(candidatesPath) ? JSON.parse(await readFile(candidatesPath, "utf8")) : {};

for (const slug of slugs) {
  const entry = SOUNDS[slug];
  if (!entry) {
    console.warn(`unknown slug "${slug}", skipping`);
    continue;
  }
  const [query, kind] = entry;
  const results = await search(query, kind);
  const picks = results.sort((a, b) => b.num_downloads - a.num_downloads).slice(0, KEEP_PER_SOUND);
  if (!picks.length) console.warn(`${slug}: no results for "${query}"`);

  const dir = path.join(RAW_DIR, slug);
  await mkdir(dir, { recursive: true });
  for (const r of picks) {
    const file = path.join(dir, `${r.id}.mp3`);
    if (!existsSync(file) && !(await download(r.previews["preview-hq-mp3"], file))) continue;
    candidates[`${slug}/${r.id}`] = {
      slug,
      kind,
      name: r.name,
      author: r.username,
      license: r.license,
      url: r.url,
      duration: Math.round(r.duration * 10) / 10,
    };
  }
  console.log(`${slug}: ${picks.map((r) => `${r.id} (${Math.round(r.duration)}s, ${r.num_downloads} dl)`).join(", ")}`);
  await writeFile(candidatesPath, JSON.stringify(candidates, null, 2) + "\n");
}

async function search(query, kind) {
  const params = new URLSearchParams({
    query,
    filter: `${LICENSES} ${kind === "bed" ? BED_DURATION : EVENT_DURATION}`,
    fields: "id,name,username,license,duration,num_downloads,previews,url",
    page_size: "15",
  });
  const res = await fetch(`https://freesound.org/apiv2/search/text/?${params}`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!res.ok) throw new Error(`search "${query}": ${res.status} ${await res.text()}`);
  // Token auth allows 60 requests/minute
  await new Promise((r) => setTimeout(r, 1100));
  return (await res.json()).results;
}

/** Returns false (and skips the file) if Freesound's CDN errors or stalls. */
async function download(url, file) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      return true;
    } catch (err) {
      console.warn(`  download ${url} failed (attempt ${attempt}): ${err.message}`);
    }
  }
  return false;
}
