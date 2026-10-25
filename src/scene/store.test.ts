import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from './store.js';
import { starter } from './fixtures.js';
import { presets } from './presets.js';
import { Scene } from './scene.js';
import { getRoomConfig } from '../room/roomConfig.js';

const initialScene = useSceneStore.getState().scene;
it('starts with only the fixed empty structure, without starter content', () => {
  expect(initialScene.objects).toEqual([]);
  expect(initialScene.room.grid).toEqual({ mode: 'Square', columns: 10, rows: 10, wallHeight: 7 });
  expect(initialScene.room.art).toBeUndefined();
  expect(initialScene.room.terrain).toBeUndefined();
  expect(initialScene.session).toBeUndefined();
});

describe('frontend scene contract and edit operations', () => {
  beforeEach(() => { useSceneStore.getState().setScene(starter); });
  it('keeps terrain in canonical source placement and preserves it across sound edits', () => {
    const scene = structuredClone(starter);
    scene.room.art = 'forest-art';
    scene.room.terrain = Array.from({ length: scene.room.grid.rows }, () => Array(scene.room.grid.columns).fill(1.25));
    expect(useSceneStore.getState().setScene(scene)).toEqual({ ok: true });
    const source = useSceneStore.getState().scene.objects.find(object => object.id === 'fan-1')!;
    expect(source.position[1]).toBeGreaterThanOrEqual(2);
    const room = useSceneStore.getState().scene.room;
    useSceneStore.getState().applyOps([{ op: 'set_volume', id: source.id, volume: 0.2 }]);
    expect(useSceneStore.getState().scene.room).toBe(room);
    expect(useSceneStore.getState().scene.objects.find(object => object.id === source.id)!.position).toEqual(source.position);
  });
  it('rejects mismatched terrain atomically and clears it when the grid changes', () => {
    const original = useSceneStore.getState().scene;
    expect(useSceneStore.getState().setScene({ ...original, room: { ...original.room, terrain: [[1]] } }).ok).toBe(false);
    expect(useSceneStore.getState().scene).toBe(original);
    useSceneStore.getState().setScene({ ...original, room: { ...original.room, art: 'art', terrain: Array.from({ length: 10 }, () => Array(10).fill(0.25)) } });
    expect(useSceneStore.getState().applyOps([{ op: 'set_room', preset: 'forest', grid: { mode: 'Square', columns: 6, rows: 6, wallHeight: 4 } }]).ok).toBe(true);
    expect(useSceneStore.getState().scene.room.art).toBeUndefined();
    expect(useSceneStore.getState().scene.room.terrain).toBeUndefined();
  });
  it('mounts painted wall sources against the wall at their canonical audio position', () => {
    const scene = structuredClone(starter);
    scene.room.art = 'forest-art';
    scene.objects[1].model = 'birds';
    scene.objects[1].wall = 'north';
    expect(useSceneStore.getState().setScene(scene)).toEqual({ ok: true });
    const object = useSceneStore.getState().scene.objects[1];
    expect(object.position[2]).toBeCloseTo(-scene.room.grid.rows / 2 + 0.225);
    useSceneStore.getState().applyOps([{ op: 'set_volume', id: object.id, volume: 0.3 }]);
    expect(useSceneStore.getState().scene.objects[1].position).toEqual(object.position);
  });
  it('serializes the blueprint contract as plain scene JSON', () => {
    const scene = useSceneStore.getState().scene;
    expect(Scene.parse(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
    expect(scene.listener).toEqual({ position: [0, 1.6, 0], yaw: 0 });
    expect(Object.keys(scene).sort()).toEqual(['listener', 'objects', 'room', 'session']);
  });
  it('clamps source positions to the room in all three axes', () => {
    expect(useSceneStore.getState().applyOps([{ op: 'move', id: 'fan-1', position: [-100, 100, 100] }])).toEqual({ ok: true });
    expect(useSceneStore.getState().scene.objects[1].position).toEqual([-4, 6, 4]);
  });
  it('keeps manual positions when a later operation edits volume', () => {
    useSceneStore.getState().applyOps([{ op: 'move', id: 'fan-1', position: [2.3, 1.5, -1.7] }]);
    useSceneStore.getState().applyOps([{ op: 'set_volume', id: 'fan-1', volume: 0.4 }]);
    const rain = useSceneStore.getState().scene.objects[1];
    expect(rain.position).toEqual([2, 1.5, -2]);
    expect(rain.volume).toBeCloseTo(0.4);
  });
  it('applies an ordered add, move, volume and remove batch', () => {
    const source = { ...starter.objects[1], id: 'extra-fan' };
    const result = useSceneStore.getState().applyOps([
      { op: 'add', object: source }, { op: 'move', id: source.id, position: [2, 2, 2] },
      { op: 'set_volume', id: source.id, volume: 0.2 }, { op: 'remove', id: 'fan-1' },
    ]);
    expect(result.ok).toBe(true);
    expect(useSceneStore.getState().scene.objects.find(object => object.id === source.id)).toMatchObject({ position: [2, 2, 2], volume: 0.2 });
    expect(useSceneStore.getState().scene.objects.some(object => object.id === 'fan-1')).toBe(false);
  });
  it('rejects an invalid batch without committing its earlier valid edits', () => {
    const original = useSceneStore.getState().scene;
    const result = useSceneStore.getState().applyOps([{ op: 'move', id: 'rain-1', position: [2, 1, 2] }, { op: 'remove', id: 'missing' }]);
    expect(result.ok).toBe(false);
    expect(useSceneStore.getState().scene).toBe(original);
  });
  it('replaces a same-id add in place and rejects the thirteenth source', () => {
    const resolved = { ...starter.objects[1], sound: { ...starter.objects[1].sound, assetId: 'brown_noise' } };
    expect(useSceneStore.getState().applyOps([{ op: 'add', object: resolved }]).ok).toBe(true);
    expect(useSceneStore.getState().scene.objects.map(object => object.id)).toEqual(['rain-1', 'fan-1', 'birds-1']);
    expect(useSceneStore.getState().scene.objects[1].sound.assetId).toBe('brown_noise');
    const scene = structuredClone(starter);
    scene.objects = Array.from({ length: 13 }, (_, i) => ({ ...scene.objects[0], id: `sound-${i}` }));
    expect(useSceneStore.getState().setScene(scene).ok).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity])('rejects non-finite source coordinate %s', value => {
    expect(useSceneStore.getState().applyOps([{ op: 'move', id: 'rain-1', position: [value, 1, 0] }]).ok).toBe(false);
  });
  it('rejects invalid volumes and reversed event intervals', () => {
    expect(useSceneStore.getState().applyOps([{ op: 'set_volume', id: 'rain-1', volume: 1.1 }]).ok).toBe(false);
    const bird = starter.objects.find(object => object.kind === 'event')!;
    expect(useSceneStore.getState().applyOps([{ op: 'add', object: { ...bird, id: 'bird-2', intervalSec: [60, 20] } }]).ok).toBe(false);
  });
  it('preserves room and unmodified source references during a drag', () => {
    const original = useSceneStore.getState().scene;
    useSceneStore.getState().applyOps([{ op: 'move', id: 'rain-1', position: [1, 1.5, 1] }]);
    const next = useSceneStore.getState().scene;
    expect(next.room).toBe(original.room);
    expect(next.listener).toBe(original.listener);
    expect(next.objects[1]).toBe(original.objects[1]);
    expect(next.objects[0]).not.toBe(original.objects[0]);
  });
  it('derives floor and wall geometry from shared room dimensions', () => {
    useSceneStore.getState().applyOps([{ op: 'set_room', preset: 'cabin', grid: { mode: 'Rectangle', columns: 6, rows: 4, wallHeight: 3 } }]);
    const scene = useSceneStore.getState().scene;
    const config = getRoomConfig(scene.room);
    expect(config.dimensions).toMatchObject({ width: 6, height: 3, depth: 4 });
    expect(config.walls.find(wall => wall.id === 'east')).toMatchObject({ position: [3, 0, 0], width: 4 });
    expect(config.walls.find(wall => wall.id === 'north')).toMatchObject({ position: [0, 0, -2], width: 6 });
    for (const source of scene.objects) { expect(Math.abs(source.position[0])).toBeLessThan(3); expect(Math.abs(source.position[2])).toBeLessThan(2); }
  });
  it('keeps resolved assets in the scene contract', () => {
    const scene = structuredClone(starter);
    scene.objects[0].sound.assetId = 'resolved-by-another-module';
    expect(Scene.safeParse(scene).success).toBe(true);
    expect(useSceneStore.getState().setScene(scene).ok).toBe(true);
    expect(useSceneStore.getState().scene.objects[0].sound.assetId).toBe('resolved-by-another-module');
  });
  it('fills the room-view defaults for objects that omit them', () => {
    const { muted: _muted, wall: _wall, scale: _scale, ...bare } = starter.objects[1];
    expect(useSceneStore.getState().applyOps([{ op: 'add', object: { ...bare, id: 'bare-fan' } }]).ok).toBe(true);
    expect(useSceneStore.getState().scene.objects.find(object => object.id === 'bare-fan')).toMatchObject({ muted: false, wall: null, scale: 1 });
  });
  it.each(presets.map(preset => [preset.label, preset.scene] as const))('loads the %s preset exactly as defined (already on the grid)', (_, scene) => {
    expect(useSceneStore.getState().setScene(scene)).toEqual({ ok: true });
    expect(useSceneStore.getState().scene.objects).toEqual(scene.objects);
  });
});
