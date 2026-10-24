import { Terrain, type Scene, type SoundObject } from "../scene/scene.js";
import { addEnvironment, addTexture, setSprite, spriteKey, useArtStore, type EnvArt, type Surface } from "./store.js";

// Browser side of POST /api/environment (streamed) and POST /api/sprite. Keys stay on the server.

const ENVIRONMENT_TIMEOUT_MS = 200_000;
const SPRITE_TIMEOUT_MS = 100_000;
const MAX_PARALLEL_SPRITES = 4; // keeps Gemini under its rate limit

/**
 * Paints the environment for a newly created scene. Resolves with the plan as soon as it arrives
 * (terrain, colors), then keeps adding textures to the art store; `painted` settles when every
 * surface is done or has failed.
 */
export async function paintEnvironment(prompt: string, scene: Scene): Promise<{ env: EnvArt; painted: Promise<void> }> {
  const res = await fetch("/api/environment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt, preset: scene.room.preset, grid: scene.room.grid,
      objects: scene.objects.map((o) => ({ label: o.label, wall: o.wall })),
    }),
    signal: AbortSignal.timeout(ENVIRONMENT_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `The environment couldn't be painted (${res.status}).`);
  const events = readLines(res.body);
  const first = await events.next();
  const plan = first.done ? undefined : JSON.parse(first.value);
  if (plan?.type !== "plan") throw new Error("The environment couldn't be planned.");
  const terrain = Terrain.safeParse(plan.terrain);
  if (!terrain.success || terrain.data.length !== scene.room.grid.rows || terrain.data.some(row => row.length !== scene.room.grid.columns)) {
    await events.return(undefined);
    throw new Error('The environment returned an invalid ground layout.');
  }
  const env: EnvArt = { id: plan.id, concept: plan.concept, shell: plan.shell, colors: plan.colors, terrain: terrain.data, textures: {} };
  addEnvironment(env);
  const painted = (async () => {
    let failed = false;
    let done = false;
    for await (const line of events) {
      const event = JSON.parse(line);
      if (event.type === "texture" && event.png) addTexture(env.id, event.surface as Surface, event.png, event.colors ?? []);
      if (event.type === "texture" && event.error) { failed = true; console.warn(`environment: ${event.surface} wasn't painted:`, event.error); }
      if (event.type === "done") done = true;
    }
    if (!done || failed) throw new Error('Some environment surfaces were not painted.');
  })();
  // The caller applies the plan before awaiting the rest of the stream.
  void painted.catch(() => {});
  return { env, painted };
}

async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

const queue: (() => Promise<void>)[] = [];
let running = 0;
function schedule(job: () => Promise<void>) {
  queue.push(job);
  const next = () => {
    if (running >= MAX_PARALLEL_SPRITES || !queue.length) return;
    running++;
    void queue.shift()!().finally(() => { running--; next(); });
  };
  next();
}

/** Paints each object's prop once per environment (in the background, a few at a time). */
export function paintSprites(envId: string, objects: SoundObject[]) {
  const env = useArtStore.getState().envs[envId];
  if (!env) return;
  for (const object of objects) {
    const key = spriteKey(envId, object);
    if (useArtStore.getState().sprites[key]) continue;
    setSprite(key, { status: "painting" });
    schedule(async () => {
      try {
        const res = await fetch("/api/sprite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: object.label, query: object.sound.query, mount: object.wall ? "wall" : "floor", concept: env.concept, colors: env.colors.slice(0, 48) }),
          signal: AbortSignal.timeout(SPRITE_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`/api/sprite ${res.status}: ${await res.text()}`);
        const { png, w, h } = await res.json();
        setSprite(key, { status: "ready", png, w, h });
      } catch (error) {
        console.warn(`art: "${object.label}" wasn't painted; using its stock prop`, error);
        setSprite(key, { status: "failed" });
      }
    });
  }
}
