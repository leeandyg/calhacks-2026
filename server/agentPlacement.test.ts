import { describe, expect, it } from 'vitest';
import { starter } from '../src/scene/fixtures.js';
import { gridFootprint } from '../src/scene/layout.js';
import { placeAgentObject } from './agentPlacement.js';

describe('agent bear clearance and size', () => {
  it.each([1, 2, 3, 4])('moves a %sx standing source out of the center while retaining its scale', scale => {
    const source = { ...starter.objects[1], model: 'speaker' as const, wall: null, scale, position: [0, 1, 0] as [number, number, number] };
    const placed = placeAgentObject(source, starter.room);
    const footprint = gridFootprint(placed);
    expect(placed.scale).toBe(scale);
    expect(Math.hypot(placed.position[0], placed.position[2])).toBeGreaterThanOrEqual(1 + footprint.columns / 2);
    expect(Math.abs(placed.position[0]) + footprint.columns / 2).toBeLessThanOrEqual(5);
    expect(Math.abs(placed.position[2]) + footprint.rows / 2).toBeLessThanOrEqual(5);
    expect(source.position).toEqual([0, 1, 0]);
  });
  it('leaves a safe placement alone', () => {
    const source = { ...starter.objects[1], position: [-3, 1.5, -3] as [number, number, number] };
    expect(placeAgentObject(source, starter.room).position).toEqual(source.position);
  });
  it('allows wall-mounted art without treating its tangential width as floor occupancy', () => {
    const window = { ...starter.objects[0], scale: 2 };
    const placed = placeAgentObject(window, starter.room);
    expect(placed.wall).toBe(window.wall);
    expect(placed.scale).toBe(2);
  });
  it('retains a legacy manually chosen scale on an explicit AI move', () => {
    const source = { ...starter.objects[1], scale: 0.5, position: [0, 1.5, 0] as [number, number, number] };
    expect(placeAgentObject(source, starter.room, false).scale).toBe(0.5);
  });
});
