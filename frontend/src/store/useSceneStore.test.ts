import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from './useSceneStore';
import { soundscapes } from '../config/soundscapes';
import { SceneSchema, CreateSceneSchema } from '../shared/scene';
import { getRoomConfig } from '../config/room';

describe('frontend scene contract and edit operations', () => {
  beforeEach(() => { useSceneStore.getState().createScene(soundscapes.rainy.scene); });
  it('serializes the blueprint contract as plain scene JSON', () => {
    const scene = useSceneStore.getState().scene;
    expect(SceneSchema.parse(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
    expect(scene.listener).toEqual({ position: [0, 1.6, 0], yaw: 0 });
    expect(Object.keys(scene).sort()).toEqual(['listener', 'objects', 'room', 'session']);
  });
  it('clamps source positions to the room in all three axes', () => {
    expect(useSceneStore.getState().editScene([{ op: 'move', id: 'fan-1', position: [-100, 100, 100] }])).toEqual({ ok: true });
    expect(useSceneStore.getState().scene.objects[1].position).toEqual([-4, 6, 4]);
  });
  it('keeps manual positions when a later operation edits volume', () => {
    useSceneStore.getState().editScene([{ op: 'move', id: 'fan-1', position: [2.3, 1.5, -1.7] }]);
    useSceneStore.getState().editScene([{ op: 'set_volume', id: 'fan-1', volume: 0.4 }]);
    const rain = useSceneStore.getState().scene.objects[1];
    expect(rain.position).toEqual([2, 1.5, -2]);
    expect(rain.volume).toBeCloseTo(0.4);
  });
  it('applies an ordered add, move, volume and remove batch', () => {
    const source = { ...soundscapes.rainy.scene.objects[1], id: 'extra-fan' };
    const result = useSceneStore.getState().editScene([
      { op: 'add', object: source }, { op: 'move', id: source.id, position: [2, 2, 2] },
      { op: 'set_volume', id: source.id, volume: 0.2 }, { op: 'remove', id: 'fan-1' },
    ]);
    expect(result.ok).toBe(true);
    expect(useSceneStore.getState().scene.objects.find(object => object.id === source.id)).toMatchObject({ position: [2, 2, 2], volume: 0.2 });
    expect(useSceneStore.getState().scene.objects.some(object => object.id === 'fan-1')).toBe(false);
  });
  it('rejects an invalid batch without committing its earlier valid edits', () => {
    const original = useSceneStore.getState().scene;
    const result = useSceneStore.getState().editScene([{ op: 'move', id: 'rain-1', position: [2, 1, 2] }, { op: 'remove', id: 'missing' }]);
    expect(result.ok).toBe(false);
    expect(useSceneStore.getState().scene).toBe(original);
  });
  it('rejects duplicate ids and the thirteenth source', () => {
    expect(useSceneStore.getState().editScene([{ op: 'add', object: soundscapes.rainy.scene.objects[0] }]).ok).toBe(false);
    const scene = structuredClone(soundscapes.rainy.scene);
    scene.objects = Array.from({ length: 13 }, (_, i) => ({ ...scene.objects[0], id: `sound-${i}` }));
    expect(useSceneStore.getState().createScene(scene).ok).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity])('rejects non-finite source coordinate %s', value => {
    expect(useSceneStore.getState().editScene([{ op: 'move', id: 'rain-1', position: [value, 1, 0] }]).ok).toBe(false);
  });
  it('rejects invalid volumes and reversed event intervals', () => {
    expect(useSceneStore.getState().editScene([{ op: 'set_volume', id: 'rain-1', volume: 1.1 }]).ok).toBe(false);
    const bird = soundscapes.rainy.scene.objects.find(object => object.kind === 'event')!;
    expect(useSceneStore.getState().editScene([{ op: 'add', object: { ...bird, id: 'bird-2', intervalSec: [60, 20] } }]).ok).toBe(false);
  });
  it('preserves room and unmodified source references during a drag', () => {
    const original = useSceneStore.getState().scene;
    useSceneStore.getState().editScene([{ op: 'move', id: 'rain-1', position: [1, 1.5, 1] }]);
    const next = useSceneStore.getState().scene;
    expect(next.room).toBe(original.room);
    expect(next.listener).toBe(original.listener);
    expect(next.objects[1]).toBe(original.objects[1]);
    expect(next.objects[0]).not.toBe(original.objects[0]);
  });
  it('derives floor and wall geometry from shared room dimensions', () => {
    useSceneStore.getState().editScene([{ op: 'set_room', preset: 'cabin', grid: { mode: 'Rectangle', columns: 6, rows: 4, wallHeight: 3 } }]);
    const scene = useSceneStore.getState().scene;
    const config = getRoomConfig(scene.room);
    expect(config.dimensions).toMatchObject({ width: 6, height: 3, depth: 4 });
    expect(config.walls.find(wall => wall.id === 'east')).toMatchObject({ position: [3, 0, 0], width: 4 });
    expect(config.walls.find(wall => wall.id === 'north')).toMatchObject({ position: [0, 0, -2], width: 6 });
    for (const source of scene.objects) { expect(Math.abs(source.position[0])).toBeLessThan(3); expect(Math.abs(source.position[2])).toBeLessThan(2); }
  });
  it('allows hydrated assets in the scene contract but not in create/edit descriptions', () => {
    const scene = structuredClone(soundscapes.rainy.scene);
    scene.objects[0].sound.assetId = 'resolved-by-another-module';
    expect(SceneSchema.safeParse(scene).success).toBe(true);
    expect(CreateSceneSchema.safeParse(scene).success).toBe(false);
    expect(useSceneStore.getState().createScene(scene).ok).toBe(true);
    expect(useSceneStore.getState().scene.objects[0].sound.assetId).toBe('resolved-by-another-module');
  });
  it('updates listener position and yaw without mutating sources', () => {
    const source = useSceneStore.getState().scene.objects[0];
    expect(useSceneStore.getState().setListener({ position: [100, 1.6, 0], yaw: Math.PI / 2 }).ok).toBe(true);
    expect(useSceneStore.getState().scene.listener).toEqual({ position: [4.65, 1.6, 0], yaw: Math.PI / 2 });
    expect(useSceneStore.getState().scene.objects[0]).toBe(source);
  });
});
