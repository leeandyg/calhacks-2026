import { Scene } from './scene.js';
import { ManagedAssets } from '../ai/world.js';
import { installManagedAssets } from '../ai/managedClient.js';
import { loadPaintImage } from '../art/images.js';
import { preloadDemoSound } from '../audio/managed.js';

export const capturedDemos = [
  { id: 'cafe', label: 'Rainy café' },
  { id: 'beach', label: 'Beach' },
  { id: 'cyberpunk', label: 'Cyberpunk city' },
] as const;
export type CapturedDemoId = typeof capturedDemos[number]['id'];
const loaded = new Map<CapturedDemoId, Promise<Scene>>();

/** Warm local artwork/audio without changing the active scene or starting playback. */
export function loadCapturedDemo(id: CapturedDemoId): Promise<Scene> {
  let loading = loaded.get(id);
  if (!loading) {
    loading = (async () => {
      const read = async (name: string) => {
        const response = await fetch(`/demo/${id}/${name}.json`, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('This demo room could not be loaded. Please try again.');
        return response.json();
      };
      const [scene, assets] = await Promise.all([read('scene').then(Scene.parse), read('assets').then(ManagedAssets.parse)]);
      if (scene.room.art !== `demo-${id}` || assets.envId !== scene.room.art || scene.objects.length !== 3)
        throw new Error('This demo bundle does not match its room.');
      const urls = [...Object.values(assets.environment?.textures ?? {}), ...assets.sprites, ...assets.sounds].map(asset => asset.url);
      if (urls.some(url => !url.startsWith(`/demo/${id}/assets/`)) || assets.sounds.length !== 3 ||
        scene.objects.some(object => !assets.sounds.some(sound => sound.objectId === object.id &&
          sound.query === object.sound.query && sound.kind === object.kind &&
          object.sound.assetId === `managed:${sound.fileId}:${sound.kind}:${sound.query.replace(/\s+/g, ' ').trim()}`)))
        throw new Error('This demo is missing a local sound binding.');
      await Promise.all([
        ...Object.values(assets.environment?.textures ?? {}).map(image => loadPaintImage(image.url)),
        ...assets.sprites.map(image => loadPaintImage(image.url)),
        ...assets.sounds.map(sound => preloadDemoSound(sound.url)),
      ]);
      installManagedAssets(assets, scene);
      return scene;
    })().catch(error => { loaded.delete(id); throw error; });
    loaded.set(id, loading);
  }
  return loading.then(scene => structuredClone(scene));
}
