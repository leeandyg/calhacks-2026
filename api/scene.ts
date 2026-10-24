import { GoogleGenAI, type Interactions } from "@google/genai";
import { z } from "zod";
import {
  BedObject, EditOp, EventObject, Scene, SceneRequest, SceneResponse, SoundRef,
  type Room, type SoundObject,
} from "../src/scene/scene.js";
import { applyOp, clampPosition } from "../src/scene/store.js";

// POST /api/scene: { prompt, scene } -> { kind: "create", scene } | { kind: "edit", ops }
// Runs as a Vercel function in production and through the Vite dev middleware locally.
// Server-only: read keys from process.env here, never in src/.
//
// The agent describes sounds; resolving queries to playable assets belongs to #17.
const agentSound = SoundRef.omit({ assetId: true }).strict();
const agentObject = z.discriminatedUnion("kind", [
  BedObject.extend({ sound: agentSound }),
  EventObject.extend({ sound: agentSound }),
]);
const createArgs = z.object({ scene: Scene.extend({ objects: z.array(agentObject).max(12) }) });
const editArgs = z.object({
  ops: z.array(z.discriminatedUnion("op", [
    EditOp.options[0].extend({ object: agentObject }),
    ...EditOp.options.slice(1),
  ])),
});
const tools = [
  {
    type: "function", name: "create_scene",
    description: "Create or replace the entire soundscape with a new environment.",
    parameters: toolSchema(createArgs),
  },
  {
    type: "function", name: "edit_scene",
    description: "Apply ordered edits to the current scene, preserving everything else.",
    parameters: toolSchema(editArgs),
  },
] satisfies Interactions.Tool[];

const systemInstruction = `You build spatial soundscapes for a focus app. Call exactly one tool.
Use create_scene for a request describing a new environment or replacing the room,
even when a starter scene is already present. Use edit_scene for changes to the current
scene. If the current scene is null, use create_scene.
For edits, keep existing object IDs and preserve all properties the user did not ask
to change, including manually moved positions. Added objects must have new unique IDs.
Positions are meters, y is up, and the listener faces -z at yaw 0. Room dimensions
must be positive. Volumes are between 0 and 1. Use at most 12 objects.
Describe each sound in sound.query. Never supply assetId, a filename, or a URL.
Object kind must be exactly "bed" for a continuous loop or "event" for a one-shot.
Every event must include intervalSec: [minimum, maximum] positive seconds, with minimum <= maximum.
If validation feedback is supplied, fix the error and call the tool again.`;

export async function POST(request: Request): Promise<Response> {
  const parsed = SceneRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parsed.data.prompt.trim()) {
    return Response.json({ error: "Send a non-empty prompt and a valid scene (or null)." }, { status: 400 });
  }
  if (parsed.data.scene) {
    try {
      validateScene(parsed.data.scene);
    } catch {
      return Response.json({ error: "The current scene has invalid dimensions, IDs, or intervals." }, { status: 400 });
    }
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "Set GEMINI_API_KEY in .env (or in Vercel) and restart the server." }, { status: 503 });
  }

  const client = new GoogleGenAI({ apiKey });
  let feedback: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let interaction;
    try {
      interaction = await client.interactions.create({
        model: "gemini-3.8-flash",
        store: false,
        system_instruction: systemInstruction,
        input: JSON.stringify({ ...parsed.data, validationError: feedback }),
        tools: parsed.data.scene ? tools : tools.slice(0, 1),
        generation_config: { tool_choice: "any", thinking_level: "low", max_output_tokens: 8192 },
      }, {
        timeout: 20_000,
        retries: {
          strategy: "attempt-count-backoff", maxRetries: 2, retryConnectionErrors: true,
          backoff: { initialInterval: 1000, exponent: 2, maxInterval: 4000 },
        },
        retry_codes: ["408", "429", "500", "502", "503", "504"],
      });
    } catch (error) {
      // Never return provider error bodies: they can contain request details or credentials.
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      console.warn("Gemini request failed:", status ?? (error instanceof Error ? error.name : "unknown error"));
      if (status === 408 || status === 504 || (error instanceof Error && error.name.includes("Timeout"))) {
        return Response.json({ error: "Gemini took too long to respond, even after retrying. Please try again." }, { status: 504 });
      }
      if (status === 429) {
        return Response.json({ error: "Gemini's request limit was reached. Check your AI Studio quota and try again." }, { status: 429 });
      }
      if (status === 401 || status === 403) {
        return Response.json({ error: "Gemini rejected the API credentials. Check GEMINI_API_KEY and project access." }, { status: 502 });
      }
      if (status === 400 || status === 404) {
        return Response.json({ error: "Gemini could not process this scene request. Check model access in AI Studio." }, { status: 502 });
      }
      if (status === 503) {
        return Response.json({ error: "Gemini is busy or temporarily unavailable, even after retrying. Please try again shortly." }, { status: 503 });
      }
      return Response.json({ error: "Could not reach Gemini. Please check the server connection and try again." }, { status: 502 });
    }

    try {
      const calls = interaction.steps.filter((step) => step.type === "function_call");
      if (calls.length !== 1) throw new Error("Call exactly one create_scene or edit_scene tool.");
      const call = calls[0];
      let response: SceneResponse;
      if (call.name === "create_scene") {
        const { scene } = createArgs.parse(call.arguments);
        validateScene(scene);
        response = {
          kind: "create",
          scene: {
            ...scene,
            listener: { ...scene.listener, position: clampPosition(scene.listener.position, scene.room) },
            objects: scene.objects.map((object) => clampObject(object, scene.room)),
          },
        };
      } else if (call.name === "edit_scene" && parsed.data.scene) {
        const { ops } = editArgs.parse(call.arguments);
        let scene = parsed.data.scene;
        const normalized = ops.map((op): EditOp => {
          if (op.op === "add") {
            const id = op.object.id;
            if (scene.objects.some((object) => object.id === id)) {
              throw new Error(`Added object ID ${id} already exists. Use a new ID.`);
            }
            op = { ...op, object: clampObject(op.object, scene.room) };
          } else if (op.op === "set_room") {
            if (op.size?.some((size) => size <= 0)) throw new Error("Room dimensions must be positive.");
          } else {
            const id = op.id;
            if (!scene.objects.some((object) => object.id === id)) {
              throw new Error(`No object has ID ${id}. Use an existing ID.`);
            }
            if (op.op === "move") op = { ...op, position: clampPosition(op.position, scene.room) };
          }
          scene = applyOp(scene, op);
          validateScene(scene);
          return op;
        });
        response = { kind: "edit", ops: normalized };
      } else {
        throw new Error("Use create_scene, or edit_scene only when a current scene exists.");
      }
      return Response.json(SceneResponse.parse(response));
    } catch (error) {
      feedback = error instanceof Error ? error.message.slice(0, 2000) : "Invalid tool arguments.";
    }
  }

  return Response.json({ error: "Gemini returned an invalid scene twice. Please rephrase your request." }, { status: 502 });
}

function clampObject(object: SoundObject, room: Room): SoundObject {
  return { ...object, position: clampPosition(object.position, room) };
}

function validateScene(scene: Scene) {
  if (scene.room.size.some((size) => size <= 0)) throw new Error("Room dimensions must be positive.");
  if (scene.objects.length > 12) throw new Error("Use at most 12 objects.");
  if (new Set(scene.objects.map((object) => object.id)).size !== scene.objects.length) {
    throw new Error("Every object must have a unique ID.");
  }
  for (const object of scene.objects) {
    if (object.kind === "event" && object.intervalSec[0] > object.intervalSec[1]) {
      throw new Error(`Event ${object.id} has an inverted interval. Minimum must be <= maximum.`);
    }
  }
}

/** Adapt Zod literals and numeric tuples to Gemini's supported JSON Schema subset. */
function toolSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7" });
  return JSON.parse(JSON.stringify(json, (key, value) => {
    if (key === "$schema") return undefined;
    if (key === "items" && Array.isArray(value)) return value[0];
    if (value && typeof value === "object" && "const" in value) {
      const { const: literal, ...rest } = value;
      return { ...rest, enum: [literal] };
    }
    return value;
  }));
}
