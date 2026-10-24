import { SceneSchema, clampScene, type EditOperation, type Scene } from './scene';

export function applySceneOperations(scene: Scene, operations: EditOperation[]): Scene {
  let next = scene;
  for (const operation of operations) {
    if (operation.op === 'set_room') {
      const reverbs = { bedroom: 'small-room', cafe: 'small-room', cabin: 'warm-room', forest: 'outdoor', library: 'warm-room' } as const;
      next = { ...next, room: { ...next.room, preset: operation.preset, grid: operation.grid ?? next.room.grid, openings: operation.openings ?? next.room.openings, reverb: operation.reverb ?? reverbs[operation.preset] } };
    } else if (operation.op === 'add') {
      if (next.objects.some(object => object.id === operation.object.id)) throw new Error(`Sound id "${operation.object.id}" already exists.`);
      next = { ...next, objects: [...next.objects, operation.object] };
    } else {
      const index = next.objects.findIndex(object => object.id === operation.id);
      if (index < 0) throw new Error(`Sound "${operation.id}" does not exist.`);
      if (operation.op === 'remove') next = { ...next, objects: next.objects.filter(object => object.id !== operation.id) };
      if (operation.op === 'move') next = { ...next, objects: next.objects.map(object => object.id === operation.id ? { ...object, position: operation.position, wall: operation.wall === undefined ? object.wall : operation.wall } : object) };
      if (operation.op === 'set_volume') next = { ...next, objects: next.objects.map(object => object.id === operation.id ? { ...object, volume: operation.volume } : object) };
      if (operation.op === 'set_muted') next = { ...next, objects: next.objects.map(object => object.id === operation.id ? { ...object, muted: operation.muted } : object) };
    }
    next = clampScene(next);
  }
  // A failed batch never reaches the store: all operations are atomic.
  SceneSchema.parse(next);
  return next;
}
