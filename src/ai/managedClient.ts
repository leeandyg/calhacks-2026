import type { Scene, SoundObject } from '../scene/scene.js';
import { ManagedResult, type ManagedAssets } from './world.js';
import { useArtStore, addEnvironment, setSprite, spriteKey } from '../art/store.js';
import { registerManagedSound } from '../audio/managed.js';
import { loadPaintImage } from '../art/images.js';
import { api } from '../../convex/_generated/api.js';
import { convex } from '../scene/convex.js';
import { useSceneStore } from '../scene/store.js';

const RESTORE_TIMEOUT_MS = 10_000;

let sessionToken: string | undefined;
export function currentAgentSession(): string | undefined { return sessionToken; }

/** One durable managed run can span many short API/SSE connections. */
export async function followManagedRun(token: string, scene: Scene | null, progress?: (message: string) => void, budgetMs = 12 * 60 * 1000, partial?: (result: ManagedResult, part: WorldPart) => void): Promise<ManagedResult> {
  const deadline = Date.now() + budgetMs;
  const seen = new Set<string>();
  const ready = new Set<WorldPart>();
  let complete = false, failures = 0;
  while (!complete && Date.now() < deadline) {
    try {
      const res = await fetch(`/api/world?${new URLSearchParams({ action: 'stream', token })}`, { signal: AbortSignal.timeout(55_000) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? 'Claude could not connect.');
      for await (const value of sse(res.body)) {
        const event = JSON.parse(value);
        if (event.type === 'error') throw new AgentRunError(event.error ?? 'Claude could not finish this environment.');
        if (event.type === 'ready' && (event.part === 'environment' || event.part === 'objects') && !ready.has(event.part)) {
          if (partial) {
            const result = await readManagedResult(token, scene, event.part);
            partial(result, event.part);
            sessionToken = token;
          }
          ready.add(event.part);
          progress?.(event.part === 'environment' ? 'Environment ready. Creating sound sources…' : 'Sound sources ready. Painting the environment…');
        }
        if (event.type === 'complete') { complete = true; break; }
        if (event.type === 'progress' && (!event.id || !seen.has(event.id))) {
          if (event.id) seen.add(event.id);
          progress?.(event.message);
        }
      }
      failures = 0;
      if (!complete) await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      if (error instanceof AgentRunError || ++failures >= 3) throw error;
      progress?.('Reconnecting to your environment…');
    }
  }
  if (!complete) throw new Error('Claude is taking too long to finish this environment. Please try again.');
  progress?.('Loading your environment, artwork and sounds…');
  const result = await readManagedResult(token, scene);
  sessionToken = token;
  return result;
}

export type WorldPart = 'environment' | 'objects';
async function readManagedResult(token: string, scene: Scene | null, part?: WorldPart): Promise<ManagedResult> {
  // Published output files may arrive just after the end-turn event.
  for (let attempt = 0; attempt < 16; attempt++) {
    const res = await fetch('/api/world', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'result', token, scene, ...(part ? { part } : {}) }), signal: AbortSignal.timeout(25_000) });
    if (res.status === 202) { await new Promise(resolve => setTimeout(resolve, 2000)); continue; }
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? 'The generated environment could not be loaded.');
    const result = ManagedResult.parse(body);
    // Preload images before revealing the first room; no empty shell flashes on slow connections.
    await Promise.all([
      ...Object.values(result.assets.environment?.textures ?? {}).map(image => loadPaintImage(image.url)),
      ...result.assets.sprites.map(image => loadPaintImage(image.url)),
    ]);
    keepWorld(result.assets);
    return result;
  }
  throw new Error('Claude finished, but its generated files are not available yet. Please try again.');
}
class AgentRunError extends Error {}

/** Copies a fresh world into Convex (convex/agentWorlds.ts), so a reload or a saved room can reopen it (#112). */
function keepWorld(assets: ManagedAssets) {
  if (!convex) return;
  convex.action(api.agentWorlds.save, { envId: assets.envId, assets })
    .catch(error => console.warn('world: could not keep this world in Convex', error));
}

/**
 * Reinstalls a kept world's art and sounds when the scene names an agent world this page doesn't have:
 * after a reload, a saved room or a remembered "usual setup" (#112). Returns a function that stops it.
 */
export function startWorldRestore(): () => void {
  const asked = new Set<string>();
  const check = () => {
    const envId = useSceneStore.getState().scene.room.art;
    if (!convex || !envId?.startsWith('agent-') || asked.has(envId) || useArtStore.getState().envs[envId]) return;
    asked.add(envId);
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), RESTORE_TIMEOUT_MS));
    Promise.race([convex.query(api.agentWorlds.world, { envId }), timeout]).then(assets => {
      const scene = useSceneStore.getState().scene;
      if (assets && scene.room.art === envId && !useArtStore.getState().envs[envId]) installManagedAssets(assets, scene);
    }).catch(error => console.warn('world: could not restore this world from Convex', error));
  };
  check();
  return useSceneStore.subscribe(check);
}
export function installManagedAssets(assets: ManagedAssets, scene: Scene) {
  const { environment, envId } = assets;
  if (!environment && !useArtStore.getState().envs[envId]) addEnvironment({ id: envId, concept: 'Environment is being painted', shell: '#969aa3', colors: [], terrain: scene.room.terrain ?? [], textures: {}, managed: true });
  if (environment) {
    addEnvironment({ id: envId, concept: environment.concept, shell: environment.shell, colors: environment.colors,
      terrain: environment.terrain ?? Array.from({ length: scene.room.grid.rows }, () => Array(scene.room.grid.columns).fill(0)),
      openAir: environment.openAir,
      textures: Object.fromEntries(Object.entries(environment.textures ?? {}).map(([surface, image]) => [surface, image.url])),
      animations: Object.fromEntries(Object.entries(environment.textures ?? {}).map(([surface, image]) => [surface, { frames: image.frames, fps: image.fps }])),
      managed: true,
    });
  }
  for (const image of assets.sprites) {
    const object: Pick<SoundObject, 'id' | 'label' | 'sound' | 'wall'> = { id: image.objectId, label: image.label, sound: { query: image.query }, wall: image.wall };
    setSprite(spriteKey(envId, object), { status: 'ready', png: image.url, w: image.w, h: image.h, frames: image.frames, fps: image.fps });
  }
  for (const sound of assets.sounds) registerManagedSound(envId, sound);
}

async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader(), decoder = new TextDecoder(); let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      if (buffer.length > 128 * 1024) throw new Error('The agent sent an oversized update.');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const lines = buffer.slice(0, end).split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart());
        buffer = buffer.slice(end + 2);
        if (lines.length) yield lines.join('\n');
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Apply one creation branch without replaying an older source list over manual edits. */
export function applyManagedPartial(result: ManagedResult, part: WorldPart, first: boolean) {
  if (result.response.kind !== 'create') throw new Error('A creation branch must create a scene.');
  const store = useSceneStore.getState();
  const incoming = result.response.scene;
  if (!first && store.scene.room.art !== incoming.room.art) throw new Error('Your room changed while the agent was working.');
  const scene = first ? incoming : part === 'environment'
    ? { ...store.scene, room: incoming.room }
    : { ...incoming, room: store.scene.room, listener: store.scene.listener };
  installManagedAssets(result.assets, scene);
  const applied = store.setScene(scene);
  if (!applied.ok) throw new Error(applied.error);
}
