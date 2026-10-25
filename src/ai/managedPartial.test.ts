import { beforeEach, describe, expect, it } from 'vitest';
import { applyManagedPartial } from './managedClient.js';
import { useSceneStore } from '../scene/store.js';
import { useArtStore } from '../art/store.js';
import { starter } from '../scene/fixtures.js';
import type { ManagedResult } from './world.js';
const envId = 'agent-partial-test';
function part(objects: boolean): ManagedResult {
  const scene = structuredClone(starter); scene.room.art = envId;
  scene.objects = objects ? [scene.objects[1]] : [];
  if (!objects) scene.room.terrain = Array.from({ length: 10 }, () => Array(10).fill(0.5));
  return { response: { kind: 'create', scene }, assets: { envId, sprites: [], sounds: [], ...(!objects ? { environment: { concept: 'Forest', shell: '#677367', colors: ['#11171e', '#677367'], openAir: false, terrain: scene.room.terrain } } : {}) } };
}
beforeEach(() => { useSceneStore.getState().setScene(starter); useArtStore.setState({ envs: {}, sprites: {} }); });
describe('first-ready world assembly', () => {
  it('shows sources first and preserves manual edits when terrain arrives', () => {
    applyManagedPartial(part(true), 'objects', true);
    expect(useArtStore.getState().envs[envId].managed).toBe(true);
    useSceneStore.getState().applyOps([{ op: 'move', id: 'fan-1', position: [2, 2, -2] }, { op: 'set_muted', id: 'fan-1', muted: true }, { op: 'set_volume', id: 'fan-1', volume: 0.15 }]);
    const moved = useSceneStore.getState().scene.objects[0];
    applyManagedPartial(part(false), 'environment', false);
    expect(useSceneStore.getState().scene.objects[0]).toMatchObject({ position: moved.position, muted: true, volume: 0.15 });
    expect(useSceneStore.getState().scene.room.terrain?.[0][0]).toBe(0.5);
  });
  it('shows an empty painted environment first and keeps it when sources arrive', () => {
    applyManagedPartial(part(false), 'environment', true);
    expect(useSceneStore.getState().scene.objects).toEqual([]);
    applyManagedPartial(part(true), 'objects', false);
    expect(useSceneStore.getState().scene.objects).toHaveLength(1);
    expect(useSceneStore.getState().scene.room.terrain?.[0][0]).toBe(0.5);
    expect(useArtStore.getState().envs[envId].concept).toBe('Forest');
  });
});
