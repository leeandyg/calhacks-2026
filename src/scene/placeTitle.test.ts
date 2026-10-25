import { describe, it, expect } from 'vitest';
import { placeTitle } from './placeTitle.js';

describe('placeTitle', () => {
  it('derives a short title from the environment description', () => {
    expect(placeTitle('A cozy rainy Parisian café at night', [])).toBe('Cozy Rainy Parisian Café');
  });
  it('stops at the first clause and stop-word', () => {
    expect(placeTitle('Rainy café at night, warm lights, jazz', [])).toBe('Rainy Café');
  });
  it('caps the title length', () => {
    expect(placeTitle('Sprawling neonlit cyberpunk megacity downtown skyline', []).length).toBeLessThanOrEqual(28);
  });
  it('falls back to the first object label, then a default', () => {
    expect(placeTitle('', [{ label: 'Creek' }])).toBe('Creek');
    expect(placeTitle(undefined, [])).toBe('Untitled place');
  });
});
