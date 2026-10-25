import { readFileSync } from "node:fs";
import { createServer } from "vite";

// Resolver checks against the real pack manifest: which descriptions use a pack sound and which
// get generated. No network, credentials, or credits. Expected: an asset id, "rain_*" for any id
// with that prefix, "any" for any pack sound, or "gen" for generation.
const CASES = [
  // Recorded Gemini queries (offline demo) and live production queries
  ["gentle muffled cafe background walla unintelligible quiet room tone", "bed", "cafe_murmur"],
  ["occasional ceramic coffee cup and saucer clink porcelain tableware", "event", "cup_clink"],
  ["smooth deep warm brown noise static", "bed", "brown_noise"],
  ["steady gentle rain against a cafe glass window", "bed", "rain_window"],
  ["steady rainfall on forest canopy and leaves continuous loop", "bed", "rain_*"],
  ["warm crackling fireplace hearth wood embers burning gently", "bed", "fireplace"],
  ["steady gentle rain against window pane, continuous calming downpour, no thunder", "bed", "rain_window"],
  ["soft indistinct cafe background chatter, gentle coffee shop ambiance, unintelligible murmured voices, no music", "bed", "cafe_murmur"],
  ["gentle warm low hum of an espresso machine and refrigerator in cafe", "bed", "gen"],
  ["occasional gentle clinking of porcelain ceramic coffee cups and saucers in distance", "bed", "gen"],
  ["soft periodic hiss of milk frother espresso steam in distant cafe", "bed", "gen"],
  // Everyday descriptions that the pack covers
  ["steady rain on glass", "bed", "rain_window"], ["heavy rain on a roof", "bed", "rain_*"],
  ["soft indistinct café murmur", "bed", "cafe_murmur"], ["busy coffee shop", "bed", "cafe_murmur"],
  ["ceramic cup clink", "event", "cup_clink"], ["gentle flowing creek", "bed", "creek"],
  ["soft wind through leaves", "bed", "wind_trees"], ["sparrow chirps", "event", "sparrow"],
  ["crackling fireplace", "bed", "fireplace"], ["fire", "bed", "fireplace"], ["rain", "bed", "rain_*"],
  ["distant dog barking", "event", "dog_distant"], ["ocean waves on a beach", "bed", "ocean"],
  ["night crickets", "bed", "crickets"], ["thunder rumbling far away", "bed", "thunder_distant"],
  ["pages turning", "event", "page_flip"], ["keyboard typing", "bed", "keyboard"], ["clock ticking", "bed", "clock"],
  ["white noise", "bed", "white_noise"], ["air conditioner hum", "bed", "ac_hum"], ["library ambience", "bed", "library"],
  ["owl hooting at night", "event", "owl"], ["birds singing in the morning", "event", "any"],
  ["distant city traffic at night", "bed", "traffic_distant"], ["rain falling softly", "bed", "rain_*"],
  ["rain falls on the tent", "bed", "rain_*"], ["wind howling around the cabin", "bed", "wind"],
  // A place or a modifier is not the sound itself
  ["chatter in a busy cafe", "bed", "cafe_murmur"], ["rain in the forest, distant thunder", "bed", "thunder_distant"],
  ["birds singing in the trees", "event", "bird_chirp"], ["a fire crackling in the fireplace", "bed", "fireplace"],
  ["wind chimes on a porch", "bed", "gen"], ["fire alarm beeping", "event", "gen"],
  // Not in the pack: generated
  ["a cat purring softly, close", "bed", "gen"], ["old radiator hissing and ticking", "bed", "gen"],
  ["kids playing in a park", "bed", "gen"], ["typewriter clacking", "bed", "gen"],
  ["train passing over a bridge", "bed", "gen"], ["crackling vinyl record", "bed", "gen"],
  ["seagulls calling", "event", "gen"], ["ambient sound", "bed", "gen"], ["dripping faucet", "event", "gen"],
  ["people talking loudly in a bar, no music", "bed", "gen"], ["steady electric fan hum", "bed", "gen"],
  ["espresso machine steaming milk", "bed", "gen"],
];

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { chooseSound, resolveSound } = await server.ssrLoadModule("/src/audio/resolve.ts");
  const manifest = JSON.parse(readFileSync("public/sounds/manifest.json", "utf8"));
  const failures = [];
  for (const [query, kind, expected] of CASES) {
    const id = resolveSound(query, kind, manifest);
    const got = id.startsWith("gen:") ? "gen" : id;
    const ok = expected === "any" ? got !== "gen" : expected.endsWith("*") ? got.startsWith(expected.slice(0, -1)) : got === expected;
    if (!ok) failures.push(`${kind} "${query}": expected ${expected}, got ${got}`);
  }
  // Two rain beds in one scene get different files
  const taken = new Set([resolveSound("steady rain on glass", "bed", manifest)]);
  const second = resolveSound("rain on the roof", "bed", manifest, taken);
  if (taken.has(second)) failures.push(`second rain bed reused ${second}`);

  // The agent's brief (server/managedAgent.ts) promises that a query starting with a library sound's
  // first three tags plays that sound.
  for (const entry of manifest) {
    const got = resolveSound(entry.tags.slice(0, 3).join(", "), entry.kind, manifest);
    if (got !== entry.id) failures.push(`library tags "${entry.tags.slice(0, 3).join(", ")}" resolve to ${got}, not ${entry.id}`);
  }
  // Library first: the Claude agent's chirp sound is used only where the pack has no good match.
  const chirp = "managed:file_test:bed:a sound";
  const choices = [
    ["wind in oak leaves", "bed", chirp, "wind_trees"],
    ["a woodpecker tapping on bark", "event", "managed:file_test:event:a woodpecker tapping on bark", "managed:file_test:event:a woodpecker tapping on bark"],
    ["a woodpecker tapping on bark", "event", undefined, "gen:event:a woodpecker tapping on bark"],
  ];
  for (const [query, kind, managed, expected] of choices) {
    const got = chooseSound(query, kind, manifest, new Set(), managed);
    if (got !== expected) failures.push(`choose ${kind} "${query}" (agent ${managed ? "has" : "has no"} sound): expected ${expected}, got ${got}`);
  }

  if (failures.length) {
    console.error(failures.map((f) => `FAIL ${f}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Passed ${CASES.length + 1 + choices.length + manifest.length} resolver checks against ${manifest.length} pack sounds.`);
  }
} finally {
  await server.close();
}
