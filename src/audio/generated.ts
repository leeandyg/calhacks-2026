import type { ConvexReactClient } from "convex/react";
import { create } from "zustand";
import { api } from "../../convex/_generated/api.js";
import { convex } from "../scene/convex.js";
import type { SoundObject } from "../scene/scene.js";

// Sounds generated on demand (ElevenLabs) when the pack has no good match. Their assetId is
// "gen:<kind>:<query>", so the id alone says what to generate and doubles as the cache key: the same
// description is fetched once per session. The Convex sound cache (convex/sounds.ts) stores each one
// once for every browser and deployment; without Convex, GET /api/sound generates it, cached only by
// the browser and Vercel's CDN.

type Kind = SoundObject["kind"];

const PREFIX = "gen:";
const MAX_QUERY = 300; // api/sound.ts and convex/sounds.ts reject longer queries
const CONVEX_WAIT_MS = 35_000; // generation times out at 25 s on the server
// Loudness targets match scripts/pack.mjs, so generated and pack sounds sit at the same level
const TARGET_LUFS: Record<Kind, number> = { bed: -20, event: -18 };
const MAX_GAIN_DB = 40; // quiet Foley can need >30 dB; still bound amplification of noise
const LIMIT = 0.8; // above this, peaks are softly rounded instead of stopping the boost

export function generatedAssetId(kind: Kind, query: string): string {
  return `${PREFIX}${kind}:${query.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY)}`;
}

export function isGenerated(assetId: string): boolean {
  return assetId.startsWith(PREFIX);
}

export function parseGeneratedAssetId(assetId: string): { kind: Kind; query: string } {
  const rest = assetId.slice(PREFIX.length);
  const colon = rest.indexOf(":");
  return { kind: rest.slice(0, colon) as Kind, query: rest.slice(colon + 1) };
}

/** Load state of generated sounds by assetId, for the room view ("generating…" on an object). */
export type SoundStatus = "generating" | "failed";
export const useSoundStatus = create<Record<string, SoundStatus>>()(() => ({}));

function setStatus(assetId: string, status: SoundStatus | undefined) {
  useSoundStatus.setState((all) => {
    const next = { ...all };
    if (status) next[assetId] = status;
    else delete next[assetId];
    return next;
  }, true);
}

/** Fetches and decodes a generated sound, as mono at pack-like loudness (it skips scripts/pack.mjs). */
export async function loadGenerated(ctx: AudioContext, assetId: string): Promise<AudioBuffer> {
  const { kind, query } = parseGeneratedAssetId(assetId);
  setStatus(assetId, "generating");
  try {
    const res = await fetchGenerated(kind, query);
    const buffer = await normalize(await ctx.decodeAudioData(await res.arrayBuffer()), kind);
    setStatus(assetId, undefined);
    return buffer;
  } catch (err) {
    setStatus(assetId, "failed");
    throw err;
  }
}

/** The sound's mp3: from the Convex sound cache when it's connected, otherwise (or if that fails) GET /api/sound. */
async function fetchGenerated(kind: Kind, query: string): Promise<Response> {
  if (convex?.connectionState().isWebSocketConnected) {
    try {
      const res = await fetch(await storedSoundUrl(convex, kind, query));
      if (res.ok) return res;
      throw new Error(`stored sound ${res.status}`);
    } catch (err) {
      console.warn(`audio: Convex sound cache failed for "${query}"; generating through /api/sound`, err);
    }
  }
  const res = await fetch(`/api/sound?${new URLSearchParams({ kind, q: query })}`);
  if (!res.ok) throw new Error(`/api/sound ${res.status}: ${await res.text()}`);
  return res;
}

/** Asks Convex for the sound (generating it if nobody has), or waits for whoever is generating it. */
function storedSoundUrl(client: ConvexReactClient, kind: Kind, query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let stop: (() => void) | undefined;
    let finished = false;
    const done = (err: unknown, url?: string) => {
      finished = true;
      stop?.();
      clearTimeout(timer);
      if (url) resolve(url);
      else reject(err);
    };
    const timer = setTimeout(() => done(new Error("timed out")), CONVEX_WAIT_MS);
    client.action(api.sounds.request, { kind, query }).then((url) => {
      if (finished) return;
      if (url) return done(undefined, url);
      // Someone else is generating it: wait for theirs instead of paying again
      const watch = client.watchQuery(api.sounds.get, { kind, query });
      const check = () => {
        try {
          const sound = watch.localQueryResult();
          if (sound?.status === "ready" && sound.url) done(undefined, sound.url);
          else if (sound?.status === "failed") done(new Error("generation failed"));
        } catch (err) {
          done(err);
        }
      };
      stop = watch.onUpdate(check);
      check();
    }, done);
  });
}

/**
 * Downmixes to mono (spatializes best) and brings the sound to the pack's loudness.
 * Loudness is measured the way ears weigh it (see loudness()), so a bass-heavy purr isn't left
 * quiet, and a soft limiter rounds off loud crackles instead of capping the gain at the peak.
 */
export async function normalize(input: AudioBuffer, kind: Kind): Promise<AudioBuffer> {
  const out = new AudioBuffer({ numberOfChannels: 1, length: input.length, sampleRate: input.sampleRate });
  const mono = out.getChannelData(0);
  let strongestChannel = 0;
  let strongestEnergy = 0;
  for (let c = 0; c < input.numberOfChannels; c++) {
    const data = input.getChannelData(c);
    let energy = 0;
    for (let i = 0; i < data.length; i++) {
      mono[i] += data[i] / input.numberOfChannels;
      energy += data[i] * data[i];
    }
    if (energy > strongestEnergy) { strongestEnergy = energy; strongestChannel = c; }
  }
  // Some generated stereo uses opposing phases. Averaging those channels can erase the source;
  // use the stronger original channel only when the mono mix loses over 10 dB of energy.
  const monoEnergy = mono.reduce((sum, sample) => sum + sample * sample, 0);
  if (input.numberOfChannels > 1 && monoEnergy < strongestEnergy * 0.1) {
    mono.set(input.getChannelData(strongestChannel));
  }
  const lufs = await loudness(out);
  // Let the existing pack fallback handle empty/near-silent output instead of displaying a
  // playable prop that makes no sound. Never turn digital silence into amplified noise.
  if (!Number.isFinite(lufs)) throw new Error("Generated sound is silent or too quiet to normalize.");
  const gain = 10 ** (Math.min(TARGET_LUFS[kind] - lufs, MAX_GAIN_DB) / 20);
  for (let i = 0; i < mono.length; i++) mono[i] = softLimit(mono[i] * gain);
  return out;
}

/**
 * Integrated loudness in LUFS (EBU R128, the scale ffmpeg's loudnorm uses in scripts/pack.mjs):
 * K-weighting filters, 400 ms blocks every 100 ms, absolute gate at -70 LUFS, relative gate 10 LU
 * below the mean. Mono only. Clips shorter than 400 ms use their full length as one block,
 * so a short click doesn't skip normalization altogether.
 */
export async function loudness(buffer: AudioBuffer): Promise<number> {
  const offline = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  const source = new AudioBufferSourceNode(offline, { buffer });
  const shelf = new BiquadFilterNode(offline, { type: "highshelf", frequency: 1682, gain: 4 });
  // Web Audio takes a highpass Q in dB: -6.02 dB is the standard's Q of 0.5
  const highpass = new BiquadFilterNode(offline, { type: "highpass", frequency: 38, Q: -6.02 });
  source.connect(shelf).connect(highpass).connect(offline.destination);
  source.start();
  const x = (await offline.startRendering()).getChannelData(0);

  const block = Math.min(buffer.length, Math.round(0.4 * buffer.sampleRate));
  const hop = Math.round(0.1 * buffer.sampleRate);
  const blocks: number[] = [];
  for (let start = 0; start + block <= x.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + block; i++) sum += x[i] * x[i];
    blocks.push(sum / block);
  }
  const lufsOf = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const loud = blocks.filter((ms) => lufsOf(ms) > -70);
  if (!loud.length) return -Infinity;
  const relativeGate = lufsOf(mean(loud)) - 10;
  const gated = loud.filter((ms) => lufsOf(ms) > relativeGate);
  return lufsOf(mean(gated));
}

/** Linear below LIMIT, then curves smoothly toward 1.0 so it never clips. */
function softLimit(v: number): number {
  const a = Math.abs(v);
  if (a <= LIMIT) return v;
  return Math.sign(v) * (LIMIT + (1 - LIMIT) * Math.tanh((a - LIMIT) / (1 - LIMIT)));
}
