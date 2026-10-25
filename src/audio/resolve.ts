import type { SoundObject } from "../scene/scene.js";
import { useSceneStore } from "../scene/store.js";
import { managedSoundFor } from './managed.js';
import { generatedAssetId, isGenerated } from "./generated.js";
import { loadManifest, type ManifestEntry } from "./manifest.js";

// The resolver (#17): turns each object's sound.query (the agent's words) into an assetId.
//   1. Score every pack sound of the same kind by how many query words its tags share.
//   2. A good enough match -> that pack file (instant, offline).
//   3. Otherwise -> a "gen:<kind>:<query>" id, which the audio engine generates with ElevenLabs.
// startResolver() fills in any object that arrives without an assetId; objects that already
// have one (presets, recorded demo responses, earlier resolutions) are left alone.

type Kind = Exclude<SoundObject["kind"], "live">; // only beds and events are files

/** Words that describe how a sound is played or heard rather than what it is. */
const GENERIC = new Set(
  ("a an the of on in at to with and or for from against near by into over under through some very slightly " +
    "soft softly gentle gently quiet quietly loud steady continuous constant occasional distant far close nearby " +
    "background ambient ambience ambiance sound sounds effect loop looping seamless low high light subtle faint " +
    "smooth small large big little old new like room tone away").split(" "),
);
const NEGATIONS = new Set(["no", "not", "without", "never"]);
/** Words after these say where a sound is, not what it is: "hum of a fridge in a cafe" isn't a cafe. */
const LOCATIONS = new Set(["in", "at", "inside", "within", "around", "throughout", "outside", "across", "near", "by", "behind", "beside", "from"]);
/** Verbs that can follow a sound's noun ("rain falls", "birds sing") without making it a modifier. */
const SOUND_VERBS = new Set(
  ("fall drip patter pour tap flow run blow howl rustle crackle pop hum buzz whir sing chirp call bark purr " +
    "tick ring roar rumble crash splash hiss creak rattle whistle murmur chatter beep clink clatter echo").split(" ").map(stem),
);

/** Query words that should count as a tag word. */
const SYNONYM_WORDS: Record<string, string> = {
  rainfall: "rain", raindrop: "rain", drizzle: "rain", downpour: "rain",
  hearth: "fireplace", ember: "fire", burn: "fire", flame: "fire", campfire: "fire",
  walla: "murmur", conversation: "chatter", talk: "chatter", coffeeshop: "cafe", coffeehouse: "cafe",
  brook: "creek", birdsong: "bird", porcelain: "ceramic", saucer: "cup", teacup: "cup",
  keystroke: "keyboard", aircon: "air",
};
const SYNONYMS = new Map(Object.entries(SYNONYM_WORDS).map(([from, to]) => [stem(from), stem(to)]));

const MIN_WORDS_MATCHED = 3; // without the entry's main noun, this much overlap still counts
const PRIMARY_WEIGHT = 3; // words from an entry's first tag (its main noun) count triple
const TAKEN_PENALTY = 1.5; // prefer a sound not already used in the scene

export type Match = { assetId: string; score: number; matched: string[]; good: boolean };

/** The best pack sound of the right kind, or undefined if no word matches at all. */
export function matchSound(
  query: string,
  kind: Kind,
  manifest: Iterable<ManifestEntry>,
  taken: ReadonlySet<string> = new Set(),
): Match | undefined {
  const tokens = queryTokens(query);
  const words = [...new Set(tokens.filter((t) => !t.generic).map((t) => t.word))];
  let best: Match | undefined;
  for (const entry of manifest) {
    if (entry.kind !== kind) continue;
    const primary = new Set(tagWords(entry.tags[0] ?? ""));
    const all = new Set(entry.tags.flatMap(tagWords));
    const matched = words.filter((w) => all.has(w));
    if (!matched.length) continue;
    // The entry's main noun appears as the thing itself, not as a modifier or a place: "wind chimes",
    // "fire alarm" and "hum of a fridge in a cafe" don't count as wind, fire or cafe, but
    // "rainfall on forest leaves" and "rain falling" count as rain.
    const nounMatched = tokens.some((t, i) => {
      const next = tokens[i + 1];
      return !t.generic && !t.location && primary.has(t.word) && (!next || next.generic || next.verb || all.has(next.word));
    });
    const score =
      matched.reduce((sum, w) => sum + (primary.has(w) ? PRIMARY_WEIGHT : 1), 0) -
      (taken.has(entry.id) ? TAKEN_PENALTY : 0);
    const good = nounMatched || matched.length >= MIN_WORDS_MATCHED || matched.length === words.length;
    const better = !best || (good && !best.good) || (good === best.good && score > best.score);
    if (better) best = { assetId: entry.id, score, matched, good };
  }
  return best;
}

/** A pack assetId when the pack has a good match, otherwise an id the engine generates. */
export function resolveSound(
  query: string,
  kind: Kind,
  manifest: Iterable<ManifestEntry>,
  taken: ReadonlySet<string> = new Set(),
): string {
  const match = matchSound(query, kind, manifest, taken);
  return match?.good ? match.assetId : generatedAssetId(kind, query);
}

/**
 * Which sound an object plays, library first: a good pack match; otherwise the sound the Claude
 * agent composed for it with chirp (managed:…); otherwise a gen: id, which plays an ElevenLabs
 * generation when that is enabled and the closest pack sound when it isn't (AudioEngine).
 */
export function chooseSound(query: string, kind: Kind, manifest: Iterable<ManifestEntry>, taken: ReadonlySet<string>, managed?: string): string {
  const pick = resolveSound(query, kind, manifest, taken);
  return isGenerated(pick) && managed ? managed : pick;
}

/** Keeps every object in the scene store resolved. Returns a function that stops it. */
export function startResolver(): () => void {
  let manifest: ManifestEntry[] | undefined;
  const run = () => {
    const { scene, applyOps } = useSceneStore.getState();
    if (!manifest) return; // the library decides first, so wait for it (it's local and loads fast)
    // Live app audio is a stream, never a file.
    const missing = scene.objects.filter((o): o is Exclude<SoundObject, { kind: "live" }> => o.kind !== "live" && !o.sound.assetId);
    if (!missing.length) return;
    const taken = new Set(scene.objects.flatMap((o) => (o.sound.assetId ? [o.sound.assetId] : [])));
    // "add" with an existing id replaces that object in place, keeping its position and mute.
    const result = applyOps(
      missing.map((object) => {
        const assetId = chooseSound(object.sound.query, object.kind, manifest!, taken, managedSoundFor(scene, object));
        taken.add(assetId);
        return { op: "add" as const, object: { ...object, sound: { ...object.sound, assetId } } };
      }),
    );
    if (!result.ok) console.warn("resolver: could not bind sounds:", result.error);
  };
  let stopped = false;
  void loadManifest().then((m) => {
    if (stopped) return;
    manifest = [...m.values()];
    run();
  });
  const unsubscribe = useSceneStore.subscribe(run);
  run();
  return () => {
    stopped = true;
    unsubscribe();
  };
}

type Token = { word: string; generic: boolean; verb: boolean; location: boolean };

/**
 * Query words in order (negated ones dropped), stemmed, with generic words, verbs and place words
 * flagged. Each comma-separated clause starts fresh: "rain in the forest, distant thunder".
 */
function queryTokens(query: string): Token[] {
  const tokens: Token[] = [];
  for (const clause of query.split(/[,;.]/)) {
    let negated = false;
    let location = false;
    for (const raw of normalize(clause).split(" ")) {
      if (!raw) continue;
      if (NEGATIONS.has(raw)) {
        negated = true; // "no voices": drop the next word
        continue;
      }
      if (negated) {
        negated = false;
        continue;
      }
      if (LOCATIONS.has(raw)) location = true;
      const w = stem(raw);
      tokens.push({
        word: SYNONYMS.get(w) ?? w,
        generic: GENERIC.has(raw),
        verb: raw.endsWith("ing") || SOUND_VERBS.has(w),
        location,
      });
    }
  }
  return tokens;
}

function tagWords(tag: string): string[] {
  return normalize(tag).split(" ").filter(Boolean).map(stem);
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/** Crude suffix stripping, applied to query and tag words alike so "chirps" meets "chirp". */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && /(s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) word = word.slice(0, -1);
  // "rumble" and "rumbling" both become "rumbl"
  if (word.length > 4 && word.endsWith("e")) return word.slice(0, -1);
  return word;
}
