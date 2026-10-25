import { beforeEach, expect, it } from 'vitest';
import { useSceneStore } from './store.js';
import { starter } from './fixtures.js';
import { bearSpeakers, getBearDragPosition } from './speakerStack.js';

const store = () => useSceneStore.getState();
beforeEach(() => {
  store().setScene({ ...starter, room: { ...starter.room, art: undefined, terrain: undefined }, objects: [0, 1, 2].map(i => ({ ...starter.objects[1], id: `speaker-${i}`, model: 'speaker', wall: null, position: [i - 2, 1, 3], scale: 1 })) });
});
function drag(id: string, position: [number, number, number]) {
  const object = store().scene.objects.find(source => source.id === id)!;
  const placed = getBearDragPosition(object, position, store().scene);
  return store().applyOps([{ op: 'move', id, position: placed?.position ?? position, wall: null }]);
}
it('stacks two speakers at canonical heights, rejects a third atomically and preserves listener/audio state', () => {
  const listener = store().scene.listener;
  expect(drag('speaker-0', [0.2, 1, 0.1]).ok).toBe(true);
  expect(drag('speaker-1', [0.1, 1, 0.2]).ok).toBe(true);
  expect(bearSpeakers(store().scene).map(source => source.position)).toEqual([[0, 1, 0], [0, 2.5, 0]]);
  const scene = store().scene;
  expect(drag('speaker-2', [0, 1, 0]).ok).toBe(false);
  expect(store().scene).toBe(scene);
  expect(store().scene.listener).toBe(listener);
  expect(store().scene.objects.map(source => source.volume)).toEqual([starter.objects[1].volume, starter.objects[1].volume, starter.objects[1].volume]);
});
it('keeps the stack order stable on repeated pointer moves and settles after the lower speaker leaves', () => {
  drag('speaker-0', [0, 1, 0]); drag('speaker-1', [0, 1, 0]);
  drag('speaker-0', [0.2, 1, 0.2]);
  expect(bearSpeakers(store().scene).map(source => source.id)).toEqual(['speaker-0', 'speaker-1']);
  drag('speaker-0', [3, 1, 2]);
  expect(bearSpeakers(store().scene).map(source => source.position)).toEqual([[0, 1, 0]]);
  expect(store().scene.objects.find(source => source.id === 'speaker-0')?.position).toEqual([3, 1, 2]);
});
it('settles a surviving speaker after deletion and restores saved stack positions', () => {
  drag('speaker-0', [0, 1, 0]); drag('speaker-1', [0, 1, 0]);
  const saved = structuredClone(store().scene);
  expect(store().setScene(saved).ok).toBe(true);
  expect(bearSpeakers(store().scene).map(source => source.position[1])).toEqual([1, 2.5]);
  store().applyOps([{ op: 'remove', id: 'speaker-0' }]);
  expect(bearSpeakers(store().scene)[0].position).toEqual([0, 1, 0]);
});
it('supports uneven center terrain and odd floor dimensions without moving unrelated objects', () => {
  const scene = store().scene;
  const terrain = Array.from({ length: 9 }, () => Array(9).fill(0)); terrain[4][4] = 1.25;
  store().setScene({ ...scene, room: { ...scene.room, grid: { ...scene.room.grid, columns: 9, rows: 9 }, terrain } });
  const other = store().scene.objects[2];
  drag('speaker-0', [0, 1, 0]); drag('speaker-1', [0, 1, 0]);
  expect(bearSpeakers(store().scene).map(source => source.position)).toEqual([[0, 2, 0], [0, 3.5, 0]]);
  expect(store().scene.objects[2]).toBe(other);
});
it('does not treat generated trees or wall sources as speaker supports', () => {
  const object = store().scene.objects[0];
  const scene = { ...store().scene, room: { ...store().scene.room, art: 'forest' } };
  expect(getBearDragPosition({ ...object, kind: 'bed', label: 'Tree', sound: { ...object.sound, query: 'rustling leaves' } }, [0, 1, 0], scene)).toBeUndefined();
  expect(getBearDragPosition({ ...object, model: 'rain' }, [0, 1, 0], store().scene)).toBeUndefined();
});
