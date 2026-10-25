import { describe, expect, it } from 'vitest';
import { paintedPropLayout } from './paintedProp.js';
import { placeInRoom, SLAB_THICKNESS, WALL_IDS } from '../scene/layout.js';
import { starter } from '../scene/fixtures.js';
const room = { ...starter.room, art: 'agent-test' };
const tree = { ...starter.objects[1], model: 'speaker' as const, position: [0, 1.5, 0] as [number, number, number] };
describe('painted standing sources', () => {
  it('shows different source scales without letting a tall 4x sprite exceed the room', () => {
    const small = paintedPropLayout({ ...tree, scale: 1 }, room, { w: 24, h: 48 });
    const large = paintedPropLayout({ ...tree, scale: 4 }, room, { w: 24, h: 48 });
    expect(large.width * 4).toBeGreaterThan(small.width);
    expect(large.height * 4).toBeLessThanOrEqual(room.grid.wallHeight);
  });
  it('anchors a tree at terrain height before scaling its emergence', () => {
    const raised = { ...room, terrain: Array.from({ length: 10 }, () => Array(10).fill(0.75)) };
    const object = placeInRoom(tree, raised);
    const layout = paintedPropLayout(object, raised, { w: 24, h: 48 });
    expect(layout.mounted).toBe(false);
    expect(layout.position).toEqual([0, 0.75, 0]);
    expect(layout.offsetY - layout.height / 2).toBe(0);
  });
  it.each(WALL_IDS)('keeps an edge tree upright and inside the %s slab', wall => {
    const object = placeInRoom({ ...tree, wall, position: [-100, 1.5, -100], scale: 1.4 }, room);
    const layout = paintedPropLayout(object, room, { w: 24, h: 48 });
    expect(layout.mounted).toBe(false);
    // At any view yaw, the complete plane must fit inside the physical inner wall faces.
    for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 8) {
      for (const side of [-1, 1]) {
        const x = layout.position[0] + side * layout.width * object.scale / 2 * Math.cos(yaw);
        const z = layout.position[2] - side * layout.width * object.scale / 2 * Math.sin(yaw);
        expect(Math.abs(x)).toBeLessThanOrEqual(5 - SLAB_THICKNESS / 2);
        expect(Math.abs(z)).toBeLessThanOrEqual(5 - SLAB_THICKNESS / 2);
      }
    }
  });
  it('does not turn generated floor water with a rain hint into a wall window', () => {
    const stream = placeInRoom({ ...tree, model: 'rain', label: 'Babbling stream', wall: null }, room);
    expect(stream.wall).toBeNull();
    expect(stream.model).toBe('speaker');
    expect(paintedPropLayout(stream, room, { w: 48, h: 20 }).mounted).toBe(false);
  });
  it('keeps a mounted window at its canonical height and inside corner posts', () => {
    const object = placeInRoom({ ...starter.objects[0], position: [-100, 3, -100] }, room);
    const layout = paintedPropLayout(object, room, { w: 32, h: 48 });
    expect(layout.mounted).toBe(true);
    expect(layout.position).toEqual(object.position);
    expect(layout.offsetY).toBe(0);
  });
});
