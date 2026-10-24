import type { RoomGrid } from '../shared/scene';
import type { WallId } from '../shared/layout';

export type Vec3 = [number, number, number];
export interface WallConfig { id: WallId; position: Vec3; rotation: number; outwardNormal: Vec3; width: number }
export interface RoomTheme { surface: string; detailPalette: readonly string[]; accent: string }
export interface RoomConfig {
  id: string;
  grid: RoomGrid;
  dimensions: { width: number; depth: number; height: number; wallThickness: number };
  walls: WallConfig[];
  theme: RoomTheme;
}
