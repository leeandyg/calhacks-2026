import { z } from "zod";
import { requestSound } from "../convex/elevenlabs.js";

// GET /api/sound?kind=bed|event&q=<description> -> audio/mpeg
// Generates a sound with ElevenLabs when the local pack has no good match (see src/audio/resolve.ts).
// The browser uses it when the Convex sound cache (convex/sounds.ts) isn't configured or reachable.
// The response for a given (kind, q) never changes, so it is marked immutable: the browser and
// Vercel's CDN cache it and a repeated description doesn't spend credits again.
// Runs as a Vercel function in production and through the Vite dev middleware locally.
// Server-only: read keys from process.env here, never in src/.

const Params = z.object({ kind: z.enum(["bed", "event"]), q: z.string().trim().min(1).max(300) });

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
    res = await requestSound(kind, q, apiKey);
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
