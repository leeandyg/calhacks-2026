import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import { z } from "zod";
import { PreferenceInput } from "../../src/ai/preferences.js";

export async function authenticatedMemory(request: Request) {
  const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
  const url = process.env.VITE_CONVEX_URL?.trim();
  if (!token || !url) throw new Error("AUTH_REQUIRED");
  const client = new ConvexHttpClient(url, { logger: false, fetch: (url, options) =>
    fetch(url, { ...options, signal: AbortSignal.timeout(5_000) }) });
  client.setAuth(token);
  const context = await client.query(api.preferences.context, {});
  const preferences = z.array(PreferenceInput.extend({ _id: z.string(), updatedAt: z.number() })).parse(context.preferences);
  return { client, owner: context.owner, preferences };
}

export function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
