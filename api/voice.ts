import { z } from "zod";
import { authenticatedMemory, privateJson } from "./_lib/auth.js";
import { deadline } from "./_lib/moss.js";

const version = "2026-08-14";
export function GET() {
  return privateJson({ configured: Boolean(process.env.CARTESIA_API_KEY?.trim()),
    spokenReplies: Boolean(process.env.CARTESIA_API_KEY?.trim() && process.env.CARTESIA_VOICE_ID?.trim()) });
}

export async function POST(request: Request) {
  try { await deadline(authenticatedMemory(request), 5_000); }
  catch { return privateJson({ error: "Connect to saved rooms before using voice." }, 401); }
  const parsed = z.discriminatedUnion("action", [z.object({ action: z.literal("token") }),
    z.object({ action: z.literal("speak"), text: z.string().trim().min(1).max(200) })])
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return privateJson({ error: "Send a valid voice request." }, 400);
  const key = process.env.CARTESIA_API_KEY?.trim();
  if (!key) return privateJson({ error: "Voice is not configured. Set CARTESIA_API_KEY and restart the server." }, 503);
  const voiceId = process.env.CARTESIA_VOICE_ID?.trim();
  if (parsed.data.action === "speak" && !voiceId) return privateJson({ error: "Set CARTESIA_VOICE_ID for spoken replies." }, 503);
  try {
    const response = await fetch(`https://api.cartesia.ai/${parsed.data.action === "token" ? "access-token" : "tts/bytes"}`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Cartesia-Version": version, "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data.action === "token" ? { grants: { stt: true }, expires_in: 60 }
        : { model_id: "sonic-3.6", transcript: parsed.data.text, voice: { id: voiceId },
          output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24000 } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return privateJson({ error: "Cartesia could not complete this request. Type your command or try again." }, response.status === 429 ? 429 : 502);
    if (parsed.data.action === "token") {
      const body = await response.json();
      if (typeof body.token !== "string") throw new Error("Missing token");
      return privateJson({ token: body.token, version });
    }
    return new Response(response.body, { headers: { "Content-Type": "audio/pcm", "Cache-Control": "no-store", "X-Audio-Sample-Rate": "24000" } });
  } catch { return privateJson({ error: "Voice service timed out or is unavailable. You can still type commands." }, 503); }
}
