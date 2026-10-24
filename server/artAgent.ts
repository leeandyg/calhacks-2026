import { GoogleGenAI, type Interactions } from "@google/genai";
import { z } from "zod";
import { describeLint, renderPxl, type RenderedAsset } from "./pxl.js";

// The loop behind the art agents (api/environment.ts, api/sprite.ts), following pxl's own agent
// workflow: write pxl code, render it, read the errors and lint, look at the result, fix it.
//   1. Gemini calls `paint` with its reasoning and pxl code.
//   2. The code renders in the sandbox (server/pxl.ts). Errors, wrong sizes or a failed `check`
//      go back as feedback, up to MAX_FIXES times.
//   3. Review, when time allows: Gemini sees its own images and the findings, and
//      either calls `accept` or `paint` again with a fix. Skipped when time is short.
// Thinking costs time: at "high", one 160x112 texture took over two minutes, at "low" about 20 s.
// So the environment reasons once, in planAgent, and the painters work fast in parallel.

export const ART_MODEL = process.env.GEMINI_ART_MODEL?.trim() || "gemini-3.8-flash";
const MAX_FIXES = 2;
type Thinking = "minimal" | "low" | "medium" | "high";

export type ArtAsset = { name: string; w: number; h: number; exact: boolean };
export type ArtResult<T> = { args: T; assets: Record<string, RenderedAsset>; rounds: number };

export class ArtError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function runArtAgent<T extends { code: string }>(options: {
  system: string;
  brief: string;
  /** The paint tool's arguments, besides `code` (which is always required). */
  args: z.ZodObject<z.ZodRawShape>;
  assets: ArtAsset[];
  /** Extra validation of the arguments and images; return a problem to send back, or nothing. */
  check?: (args: T, assets: Record<string, RenderedAsset>) => string | undefined;
  budgetMs: number;
  thinking?: Thinking;
}): Promise<ArtResult<T>> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new ArtError("Set GEMINI_API_KEY in .env (or in Vercel) and restart the server.", 503);
  const client = new GoogleGenAI({ apiKey });
  const started = Date.now();
  const left = () => options.budgetMs - (Date.now() - started);

  const paintArgs = options.args.extend({ code: z.string().min(1).max(60_000).describe("The complete .px.js source.") });
  const paint = { type: "function", name: "paint", description: "Submit pxl code for the requested assets, with your reasoning.", parameters: toolSchema(paintArgs) } as const;
  const accept = { type: "function", name: "accept", description: "Keep the current images as they are.", parameters: { type: "object", properties: {} } } as const;
  const sizes = options.assets.map((a) => `${a.name}: ${a.exact ? "exactly" : "at most"} ${a.w}x${a.h} px`).join("; ");

  let feedback: string | undefined;
  let best: ArtResult<T> | undefined;
  let reviewed = false;
  let previousCode = '';
  for (let round = 1; round <= MAX_FIXES + 1 && left() > 15_000; round++) {
    const reviewing = best && !reviewed;
    const input: Interactions.InteractionCreateParams["input"] = reviewing
      ? [
          { type: "text", text: `${options.brief}\n\nYour previous pxl code:\n${previousCode}\n\nThis is what your code rendered (${sizes}). Look at it as a pixel artist: does it read as the real place or thing, with believable shapes, light from the top-left and no noise? Lint:\n${Object.entries(best!.assets).map(([name, a]) => describeLint(name, a.lint)).join("\n")}\nCall accept if it is good, or paint with an improved, complete version.` },
          ...Object.entries(best!.assets).map(([name, a]) => [
            { type: "text" as const, text: `${name} (${a.w}x${a.h}):` },
            { type: "image" as const, data: a.png, mime_type: "image/png" },
          ]).flat(),
        ]
      : `${options.brief}\n\nAssets to define (${sizes}).${feedback ? `\n\nYour previous attempt failed. Fix this and call paint again with the complete code:\n${feedback}\nPrevious code:\n${previousCode}` : ""}`;
    let interaction;
    try {
      interaction = await client.interactions.create({
        model: ART_MODEL,
        store: false,
        system_instruction: options.system,
        input,
        tools: reviewing ? [paint, accept] : [paint],
        generation_config: { tool_choice: "any", thinking_level: options.thinking ?? "low", max_output_tokens: 12_288 },
      }, {
        timeout: Math.max(1_000, left() - 13_000),
        retries: { strategy: "attempt-count-backoff", maxRetries: 0 },
        retry_codes: ["429", "500", "502", "503", "504"],
      });
    } catch (error) {
      if (best) return best; // keep what we have rather than failing at the last step
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : undefined;
      console.warn("art agent: Gemini request failed:", Number.isFinite(status) ? status : error instanceof Error ? `${error.name}: ${error.message}` : "unknown");
      throw new ArtError(status === 429 ? "Gemini's request limit was reached." : "Gemini could not paint this right now.", status === 429 ? 429 : 502);
    }
    const call = interaction.steps.find((step) => step.type === "function_call");
    if (reviewing) reviewed = true;
    if (!call) { feedback = "Call the paint tool."; continue; }
    if (call.name === "accept" && best) return best;

    const parsed = paintArgs.safeParse(call.arguments);
    if (!parsed.success) { feedback = `Invalid paint arguments: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`; continue; }
    const args = parsed.data as unknown as T;
    previousCode = args.code;
    const rendered = await renderPxl(args.code, options.assets.map((a) => a.name));
    if (!rendered.ok) { feedback = `pxl error: ${rendered.error}`; continue; }
    const wrongSize = options.assets.find((a) => {
      const r = rendered.assets[a.name];
      return a.exact ? r.w !== a.w || r.h !== a.h : r.w > a.w || r.h > a.h;
    });
    if (wrongSize) {
      const r = rendered.assets[wrongSize.name];
      feedback = `${wrongSize.name} is ${r.w}x${r.h} px but must be ${wrongSize.exact ? "exactly" : "at most"} ${wrongSize.w}x${wrongSize.h} px.`;
      continue;
    }
    const problem = options.check?.(args, rendered.assets);
    if (problem) { feedback = problem; continue; }
    best = { args, assets: rendered.assets, rounds: round };
    feedback = undefined;
    // A lint-clean image can still have a weak silhouette. Review the preview when time permits.
    if (reviewed || left() < 20_000) return best;
  }
  if (best) return best;
  throw new ArtError(`Gemini could not produce valid pixel art${feedback ? `: ${feedback.slice(0, 300)}` : "."}`, 502);
}

/**
 * One reasoning call with a single tool (no pxl): the environment's plan. Invalid arguments, or a
 * failed `check`, go back as feedback once.
 */
export async function planAgent<T>(options: {
  system: string;
  input: string;
  name: string;
  description: string;
  args: z.ZodType<T>;
  check?: (args: T) => string | undefined;
  thinking: Thinking;
  timeoutMs: number;
}): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new ArtError("Set GEMINI_API_KEY in .env (or in Vercel) and restart the server.", 503);
  const client = new GoogleGenAI({ apiKey });
  const tool = { type: "function", name: options.name, description: options.description, parameters: toolSchema(options.args) } as const;
  let feedback: string | undefined;
  const deadline = Date.now() + options.timeoutMs;
  for (let attempt = 0; attempt < 2; attempt++) {
    let interaction;
    try {
      interaction = await client.interactions.create({
        model: ART_MODEL,
        store: false,
        system_instruction: options.system,
        input: feedback ? `${options.input}\n\nYour previous answer was invalid. Fix this and call ${options.name} again:\n${feedback}` : options.input,
        tools: [tool],
        generation_config: { tool_choice: "any", thinking_level: options.thinking, max_output_tokens: 16_384 },
      }, { timeout: Math.max(1_000, deadline - Date.now()), retries: { strategy: "attempt-count-backoff", maxRetries: 0 } });
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : undefined;
      console.warn("art plan: Gemini request failed:", status, error instanceof Error ? error.message.slice(0, 1200) : 'unknown');
      throw new ArtError(status === 429 ? "Gemini's request limit was reached." : "Gemini could not plan this environment right now.", status === 429 ? 429 : 502);
    }
    const call = interaction.steps.find((step) => step.type === "function_call");
    const parsed = options.args.safeParse(call?.arguments);
    if (!parsed.success) { feedback = call ? parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : `Call ${options.name}.`; continue; }
    const problem = options.check?.(parsed.data);
    if (problem) { feedback = problem; continue; }
    return parsed.data;
  }
  throw new ArtError(`Gemini returned an invalid plan: ${feedback?.slice(0, 300)}`, 502);
}

/** Adapt Zod literals and numeric tuples to Gemini's supported JSON Schema subset (as in api/scene.ts). */
function toolSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7" });
  return JSON.parse(JSON.stringify(json, (key, value) => {
    // Nested height maps plus bounded strings/arrays explode Gemini's grammar state space.
    // Zod and the plan checks still enforce all these bounds after the tool returns.
    if (["$schema", "minItems", "maxItems", "minimum", "maximum", "minLength", "maxLength", "pattern"].includes(key)) return undefined;
    if (key === "items" && Array.isArray(value)) return value[0];
    if (value && typeof value === "object" && "const" in value) {
      const { const: literal, ...rest } = value;
      return { ...rest, enum: [literal] };
    }
    return value;
  }));
}
