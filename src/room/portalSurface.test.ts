import { expect, it } from 'vitest';
import { Euler, Vector3 } from 'three';
import { portalSurface } from './portalSurface.js';
import { starter } from '../scene/fixtures.js';
import type { WallId } from '../scene/scene.js';

it('keeps floor portals parallel to raised terrain, including props snapped beside walls', () => {
  const room = { ...starter.room, terrain: Array.from({ length: 10 }, () => Array(10).fill(1.25)) };
  const source = { ...starter.objects[1], model: 'speaker' as const, position: [2, 3, 1] as [number, number, number], wall: 'east' as const };
  const surface = portalSurface(source, room);
  expect(surface.position).toEqual([2, 1.275, 1]);
  const normal = new Vector3(0, 0, 1).applyEuler(new Euler(...surface.rotation));
  expect(normal.y).toBeCloseTo(1); expect(normal.z).toBeCloseTo(0);
});
it.each<[WallId, number[]]>([['north', [0, 0, 1]], ['east', [-1, 0, 0]], ['south', [0, 0, -1]], ['west', [1, 0, 0]]])('aligns mounted portals with the %s inner slab', (wall, inward) => {
  const surface = portalSurface({ ...starter.objects[0], model: 'rain', wall, position: [0, 2, 0] }, starter.room);
  const normal = new Vector3(0, 0, 1).applyEuler(new Euler(...surface.rotation));
  normal.toArray().forEach((value, i) => expect(value).toBeCloseTo(inward[i]));
  expect(surface.position[1]).toBe(2);
  expect(Math.max(Math.abs(surface.position[0]), Math.abs(surface.position[2]))).toBeCloseTo(4.765);
});
