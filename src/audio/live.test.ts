import { beforeEach, describe, expect, it } from 'vitest';
import { cafe, starter } from '../scene/fixtures.js';
import { useSceneStore } from '../scene/store.js';
import { liveObjectId, reconcileLive } from './live.js';

const spotify = { stream: 'app:com.spotify.client', name: 'Spotify' };
const id = liveObjectId(spotify.stream);
type Placements = Parameters<typeof reconcileLive>[2];

/** What live.ts does on each store change: remember live placements, then apply the ops. */
function reconcile(playing: typeof spotify[], placements: Placements) {
  const { scene, applyOps } = useSceneStore.getState();
  for (const o of scene.objects) if (o.kind === 'live') placements.set(o.sound.stream, { position: o.position, wall: o.wall, volume: o.volume, muted: o.muted, scale: o.scale });
  const ops = reconcileLive(scene, playing, placements);
  expect(applyOps(ops)).toEqual({ ok: true });
  return ops;
}

describe('live app audio in the scene', () => {
  beforeEach(() => { useSceneStore.getState().setScene(starter); });

  it('adds a playing app as a live speaker in front of the listener', () => {
    reconcile([spotify], new Map());
    const live = useSceneStore.getState().scene.objects.find(o => o.id === id)!;
    expect(live).toMatchObject({ kind: 'live', label: 'Spotify', model: 'speaker', sound: { stream: spotify.stream }, volume: 0.5 });
    expect(live.position[2]).toBeLessThan(0);
    expect(reconcile([spotify], new Map())).toEqual([]);
  });

  it('keeps its dragged spot, volume and mute when the scene is replaced', () => {
    const placements: Placements = new Map();
    reconcile([spotify], placements);
    useSceneStore.getState().applyOps([
      { op: 'move', id, position: [-3, 1, 2] }, { op: 'set_volume', id, volume: 0.8 }, { op: 'set_muted', id, muted: true },
    ]);
    const moved = useSceneStore.getState().scene.objects.find(o => o.id === id)!;
    reconcile([spotify], placements);
    useSceneStore.getState().setScene(cafe); // an agent create, preset or Load room
    reconcile([spotify], placements);
    const back = useSceneStore.getState().scene.objects.find(o => o.id === id)!;
    expect(back).toMatchObject({ position: moved.position, volume: 0.8, muted: true });
    expect(useSceneStore.getState().scene.objects.filter(o => o.kind !== 'live')).toEqual(cafe.objects);
  });

  it('removes the object when its stream stops', () => {
    reconcile([spotify], new Map());
    expect(reconcile([], new Map())).toEqual([{ op: 'remove', id }]);
    expect(useSceneStore.getState().scene.objects.some(o => o.kind === 'live')).toBe(false);
  });
});
