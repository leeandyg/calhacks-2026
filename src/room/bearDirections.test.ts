import { describe, expect, it } from 'vitest';
import { BEAR_VIEWS, bearDirection } from './bearDirections.js';

describe('user bear directions', () => {
  it('uses two front and two back assets for a complete turn in either direction', () => {
    expect(BEAR_VIEWS.filter(view => view.name.startsWith('front'))).toHaveLength(2);
    expect(BEAR_VIEWS.filter(view => view.name.startsWith('back'))).toHaveLength(2);
    expect(new Set(BEAR_VIEWS.map(view => view.image)).size).toBe(4);
    expect([0, 1, 2, 3, 4].map(turn => bearDirection(turn * Math.PI / 2))).toEqual([0, 1, 2, 3, 0]);
    expect([0, -1, -2, -3, -4].map(turn => bearDirection(turn * Math.PI / 2))).toEqual([0, 3, 2, 1, 0]);
  });
  it('changes view at the midpoint of a manual quarter turn', () => {
    expect(bearDirection(Math.PI / 4 - 0.001)).toBe(0);
    expect(bearDirection(Math.PI / 4 + 0.001)).toBe(1);
  });
});
