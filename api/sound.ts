import { z } from "zod";

// GET /api/sound?kind=bed|event&q=<description> -> audio/mpeg
// Generates a sound with ElevenLabs when the local pack has no good match (see src/audio/resolve.ts).
// The response for a given (kind, q) never changes, so it is marked immutable: the browser and
// Vercel's CDN cache it and a repeated description doesn't spend credits again.
// Runs as a Vercel function in production and through the Vite dev middleware locally.
// Server-only: read keys from process.env here, never in src/.

const Params = z.object({ kind: z.enum(["bed", "event"]), q: z.string().trim().min(1).max(300) });

// From the listening test (scripts/test-elevenlabs.mjs): v2 made better loops, v3 better one-shots
const MODEL = { bed: "eleven_text_to_sound_v2", event: "eleven_text_to_sound_v3" } as const;
const DURATION_SEC = { bed: 15, event: 2 } as const; // billed at 40 credits per second
// Kept minimal, like the listening-test winners: "continuous background ambience" seemed to make loops drone
const STYLE = {
  bed: "no speech, no music",
  event: "a single short sound effect, no speech, no music",
} as const;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const parsed = Params.safeParse({ kind: params.get("kind"), q: params.get("q") });
  if (!parsed.success) {
    return Response.json({ error: "Send kind=bed or kind=event and a q of 1-300 characters." }, { status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "Set ELEVENLABS_API_KEY in .env (or in Vercel) and restart the server." }, { status: 503 });
  }

  const { kind, q } = parsed.data;
  let res: Response;
  try {
    res = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `${q}. ${STYLE[kind]}`,
        model_id: MODEL[kind],
        duration_seconds: DURATION_SEC[kind],
        loop: kind === "bed",
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    console.warn("ElevenLabs request failed:", error instanceof Error ? error.name : "unknown error");
    return Response.json({ error: "ElevenLabs took too long or could not be reached." }, { status: 504 });
  }

  if (!res.ok) {
    // Never return provider error bodies: they can contain request details.
    console.warn("ElevenLabs returned", res.status);
    if (res.status === 401 || res.status === 403) {
      return Response.json(
        { error: "ElevenLabs rejected the key, or it is out of credits. Check ELEVENLABS_API_KEY and its sound-effects permission." },
        { status: 502 },
      );
    }
    if (res.status === 429) {
      return Response.json({ error: "ElevenLabs rate limit reached. Try again shortly." }, { status: 429 });
    }
    return Response.json({ error: "ElevenLabs could not generate this sound." }, { status: 502 });
  }

  return new Response(res.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
    },
  });
}
