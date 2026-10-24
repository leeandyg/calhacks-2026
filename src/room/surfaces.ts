export interface SurfaceOpening { x: number; y: number; width: number; height: number }
export interface SurfacePixel { x: number; y: number; size: number; color: string }

// Seeded, sparse surface marks. Re-rendering or moving a window never reshuffles dirt.
export function buildSurfacePixels(width: number, height: number, seed: number, palette: readonly string[], openings: SurfaceOpening[] = []): SurfacePixel[] {
  if (!palette.length) return [];
  const pixels: SurfacePixel[] = [];
  const step = 0.3;
  for (let row = 0; row < Math.floor(height / step); row++) {
    for (let column = 0; column < Math.floor(width / step); column++) {
      const hash = Math.imul(column + 17, 374761393) ^ Math.imul(row + 31, 668265263) ^ Math.imul(seed + 1, 1274126177);
      const value = (Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0);
      if (value % 100 >= 8) continue;
      const size = value % 3 === 0 ? 0.12 : 0.08;
      const x = -width / 2 + (column + 0.5) * step;
      const y = -height / 2 + (row + 0.5) * step;
      if (openings.some(hole => x + size / 2 >= hole.x && x - size / 2 <= hole.x + hole.width && y + size / 2 >= hole.y && y - size / 2 <= hole.y + hole.height)) continue;
      pixels.push({ x, y, size, color: palette[value % palette.length] });
    }
  }
  return pixels;
}
