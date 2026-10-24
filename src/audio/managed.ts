import type { Scene, SoundObject } from '../scene/scene.js';
import { normalize } from './generated.js';

type GeneratedSound = { objectId: string; query: string; kind: SoundObject['kind']; fileId: string; url: string };
const bindings = new Map<string, string>();
const sounds = new Map<string, GeneratedSound>();
const key = (env: string, id: string, query: string) => JSON.stringify([env, id, query]);

export function registerManagedSound(envId: string, sound: GeneratedSound) {
  const id = `managed:${sound.fileId}`;
  sounds.set(id, sound);
  bindings.set(key(envId, sound.objectId, sound.query), id);
}
/** Called only by the resolver, which remains the owner of sound.assetId. */
export function managedSoundFor(scene: Scene, object: SoundObject): string | undefined {
  return scene.room.art ? bindings.get(key(scene.room.art, object.id, object.sound.query)) : undefined;
}
export function isManagedSound(id: string): boolean { return id.startsWith('managed:'); }
export async function loadManagedSound(ctx: AudioContext, id: string): Promise<AudioBuffer> {
  const sound = sounds.get(id);
  if (!sound) throw new Error('This generated sound is no longer available in this page.');
  const response = await fetch(sound.url, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error('The generated sound could not be downloaded.');
  return normalize(await ctx.decodeAudioData(await response.arrayBuffer()), sound.kind);
}
