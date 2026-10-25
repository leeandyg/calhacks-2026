import { describe, expect, it } from 'vitest';
import { BEAR_VIEWS, bearDirection } from './bearDirections.js';

describe('user bear directions', () => {
  it('faces the left side of the room at the default camera angle', () => {
    expect(BEAR_VIEWS[bearDirection(0)].name).toBe('back-left');
  });
  it('uses two front and two back assets for a complete turn in either direction', () => {
    expect(BEAR_VIEWS.filter(view => view.name.startsWith('front'))).toHaveLength(2);
    expect(BEAR_VIEWS.filter(view => view.name.startsWith('back'))).toHaveLength(2);
    expect(new Set(BEAR_VIEWS.map(view => view.image)).size).toBe(4);
    expect([0, 1, 2, 3, 4].map(turn => bearDirection(turn * Math.PI / 2))).toEqual([1, 2, 3, 0, 1]);
    expect([0, -1, -2, -3, -4].map(turn => bearDirection(turn * Math.PI / 2))).toEqual([1, 0, 3, 2, 1]);
  });
  it('changes view at the midpoint of a manual quarter turn', () => {
    expect(bearDirection(Math.PI / 4 - 0.001)).toBe(1);
    expect(bearDirection(Math.PI / 4 + 0.001)).toBe(2);
  });
});
