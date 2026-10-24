import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { roomConfig } from './roomConfig.js';
import { getWallOpacity } from './WallVisibility.js';
describe('world-space wall visibility', () => {
  const camera = new Vector3(12, 11, 12);
  it.each([0, 1, 2, 3])('hides two adjacent near walls at quarter turn %i', turn => {
    const transform = new Matrix4().makeRotationY(turn * Math.PI / 2);
    const opacities = roomConfig.walls.map(wall => getWallOpacity(wall, transform, camera));
    expect(opacities.filter(value => value === 0)).toHaveLength(2);
    expect(opacities.filter(value => value === 1)).toHaveLength(2);
    const hidden = opacities.map((value, index) => value === 0 ? index : -1).filter(index => index !== -1);
    expect([1, 3]).toContain(Math.abs(hidden[0] - hidden[1]));
    roomConfig.walls.forEach((wall, index) => {
      const position = new Vector3(...wall.position).applyMatrix4(transform);
      expect(opacities[index]).toBe(position.dot(new Vector3(1, 0, 1)) > 0 ? 0 : 1);
    });
  });
  it('blends continuously across every complete revolution in either direction', () => {
    for (const sign of [-1, 1]) {
      let previous = roomConfig.walls.map(wall => getWallOpacity(wall, new Matrix4(), camera));
      for (let step = 1; step <= 1440; step++) {
        const matrix = new Matrix4().makeRotationY(sign * step * Math.PI / 720);
        const current = roomConfig.walls.map(wall => getWallOpacity(wall, matrix, camera));
        current.forEach((value, index) => {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
          expect(Math.abs(value - previous[index])).toBeLessThan(0.02);
        });
        previous = current;
      }
    }
  });
  it('uses transformed positions when the whole room is translated', () => {
    const translation = new Matrix4().makeTranslation(20, 0, -10);
    const movedCamera = camera.clone().add(new Vector3(20, 0, -10));
    for (const wall of roomConfig.walls) expect(getWallOpacity(wall, translation, movedCamera)).toBe(getWallOpacity(wall, new Matrix4(), camera));
  });
  it('changes the hidden pair when the camera moves to the opposite quadrant', () => {
    for (const wall of roomConfig.walls) expect(getWallOpacity(wall, new Matrix4(), camera)).toBe(1 - getWallOpacity(wall, new Matrix4(), new Vector3(-12, 11, -12)));
  });
});
