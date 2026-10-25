import { api } from '../../convex/_generated/api.js';
import { convex } from '../scene/convex.js';
import type { Scene, SoundObject } from '../scene/scene.js';
import { normalize } from './generated.js';

const KEPT_TIMEOUT_MS = 10_000;

type GeneratedSound = { objectId: string; query: string; kind: Exclude<SoundObject['kind'], 'live'>; fileId: string; url: string };
const bindings = new Map<string, string>();
const sounds = new Map<string, GeneratedSound>();
const key = (env: string, id: string, query: string) => JSON.stringify([env, id, query]);

// The id also carries kind and query, so a page that no longer has the file (a reload, a saved room)
// can still play the closest pack sound instead of going silent (AudioEngine).
const PREFIX = 'managed:';

export function registerManagedSound(envId: string, sound: GeneratedSound) {
  const id = `${PREFIX}${sound.fileId}:${sound.kind}:${sound.query.replace(/\s+/g, ' ').trim()}`;
  sounds.set(id, sound);
  bindings.set(key(envId, sound.objectId, sound.query), id);
}
/** Called only by the resolver, which remains the owner of sound.assetId. */
export function managedSoundFor(scene: Scene, object: SoundObject): string | undefined {
  return scene.room.art ? bindings.get(key(scene.room.art, object.id, object.sound.query)) : undefined;
}
export function isManagedSound(id: string): boolean { return id.startsWith(PREFIX); }
export function parseManagedAssetId(id: string): { kind: Exclude<SoundObject['kind'], 'live'>; query: string } {
  const [, kind = 'bed', ...query] = id.slice(PREFIX.length).split(':');
  return { kind: kind === 'event' ? 'event' : 'bed', query: query.join(':') };
}
export async function loadManagedSound(ctx: AudioContext, id: string): Promise<AudioBuffer> {
  const url = sounds.get(id)?.url ?? await keptSoundUrl(id);
  if (!url) throw new Error('This generated sound is no longer available.');
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error('The generated sound could not be downloaded.');
  return normalize(await ctx.decodeAudioData(await response.arrayBuffer()), parseManagedAssetId(id).kind);
}

/** A sound this page doesn't have (a reload, a saved room): its copy kept in Convex, if any (#112). */
async function keptSoundUrl(id: string): Promise<string | null> {
  if (!convex) return null;
  const fileId = id.slice(PREFIX.length).split(':')[0];
  const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), KEPT_TIMEOUT_MS));
  return Promise.race([convex.query(api.agentWorlds.file, { fileId }), timeout]);
}
