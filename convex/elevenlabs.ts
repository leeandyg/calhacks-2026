// The ElevenLabs Sound Effects request, shared by convex/sounds.ts (the stored cache) and api/sound.ts
// (the fallback when Convex isn't configured or reachable). Not a Convex function: it exports no query,
// mutation or action. Callers read the key server-side and pass it in.

type Kind = "bed" | "event";

// From the listening test (scripts/test-elevenlabs.mjs): v2 made better loops, v3 better one-shots
const MODEL = { bed: "eleven_text_to_sound_v2", event: "eleven_text_to_sound_v3" } as const;
const DURATION_SEC = { bed: 15, event: 3 } as const; // leave room for an event's decay; 40 credits/s
// Kept minimal, like the listening-test winners: "continuous background ambience" seemed to make loops drone
const STYLE = {
  bed: "natural source recording, no music, no intelligible speech",
  event: "one isolated occurrence, natural attack and full decay, no music, no speech",
} as const;

/** Generates one sound; resolves with ElevenLabs' response (audio/mpeg when ok). Throws on timeout or network failure. */
export function requestSound(kind: Kind, query: string, apiKey: string): Promise<Response> {
  return fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `${query}. ${STYLE[kind]}. Dry recording, no added reverb or cinematic effects.`,
      model_id: MODEL[kind],
      duration_seconds: DURATION_SEC[kind],
      loop: kind === "bed",
      prompt_influence: 0.5,
    }),
    signal: AbortSignal.timeout(25_000),
  });
}
