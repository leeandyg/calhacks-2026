import { describe, expect, it } from 'vitest';
import { getRoomConfig, ROOM_THEMES } from './roomConfig.js';
import { SLAB_THICKNESS, ROOM_FRAME } from '../scene/layout.js';
import { buildSurfacePixels } from './surfaces.js';

describe('continuous environment slabs', () => {
  it('keeps equal structural thickness across environments and room sizes', () => {
    for (const preset of ['bedroom', 'forest', 'cafe', 'cabin', 'library'] as const) {
      for (const [columns, rows, wallHeight] of [[4, 6, 2], [10, 10, 7], [24, 16, 12]]) {
        const config = getRoomConfig({ preset, grid: { mode: 'Rectangle', columns, rows, wallHeight }, openings: [], reverb: 'none' });
        expect(config.dimensions.wallThickness).toBe(SLAB_THICKNESS);
        expect(config.dimensions.wallThickness).toBe(ROOM_FRAME.floorDepth);
        expect(ROOM_FRAME.floorOverhang).toBe(SLAB_THICKNESS / 2);
      }
    }
  });
  it('keeps plain rooms clean and adapts forest colors with stable sparse dirt pixels', () => {
    expect(buildSurfacePixels(10, 7, 41, ROOM_THEMES.bedroom.detailPalette)).toEqual([]);
    expect(ROOM_THEMES.bedroom.surface).toBe('#969aa3');
    expect(ROOM_THEMES.forest.surface).not.toBe(ROOM_THEMES.bedroom.surface);
    const dirt = buildSurfacePixels(10, 7, 41, ROOM_THEMES.forest.detailPalette);
    expect(dirt.length).toBeGreaterThan(0);
    expect(dirt.length).toBeLessThan(100);
    expect(buildSurfacePixels(10, 7, 41, ROOM_THEMES.forest.detailPalette)).toEqual(dirt);
    expect(dirt.every(pixel => Math.abs(pixel.x) + pixel.size / 2 <= 5 && Math.abs(pixel.y) + pixel.size / 2 <= 3.5)).toBe(true);
  });
  it('never places dirt across a door or window cutout', () => {
    const palette = ROOM_THEMES.forest.detailPalette;
    const initial = buildSurfacePixels(10, 7, 41, palette);
    const pixel = initial[0];
    const hole = { x: pixel.x - 0.2, y: pixel.y - 0.2, width: 0.4, height: 0.4 };
    const cut = buildSurfacePixels(10, 7, 41, palette, [hole]);
    expect(cut.length).toBeLessThan(initial.length);
    expect(cut.every(mark => mark.x + mark.size / 2 < hole.x || mark.x - mark.size / 2 > hole.x + hole.width || mark.y + mark.size / 2 < hole.y || mark.y - mark.size / 2 > hole.y + hole.height)).toBe(true);
  });
});
