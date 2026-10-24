import type { RoomConfig, RoomTheme, WallConfig } from '../types/room';
import type { Scene } from '../shared/scene';
import { DEFAULT_ROOM_GRID, getRoomDimensions, SLAB_THICKNESS } from '../shared/layout';

export const ROOM_THEMES: Record<Scene['room']['preset'], RoomTheme> = {
  bedroom: { surface: '#969aa3', detailPalette: [], accent: '#b8d59c' },
  cafe: { surface: '#a39c94', detailPalette: [], accent: '#cdb592' },
  cabin: { surface: '#999486', detailPalette: [], accent: '#c5ad86' },
  forest: { surface: '#828c79', detailPalette: ['#63584b', '#756650', '#6c7956'], accent: '#b2c58b' },
  library: { surface: '#90979b', detailPalette: [], accent: '#a4bdb6' },
};

function createWalls(width: number, depth: number): WallConfig[] {
  return [
    { id: 'north', position: [0, 0, -depth / 2], rotation: 0, outwardNormal: [0, 0, -1], width },
    { id: 'east', position: [width / 2, 0, 0], rotation: -Math.PI / 2, outwardNormal: [1, 0, 0], width: depth },
    { id: 'south', position: [0, 0, depth / 2], rotation: Math.PI, outwardNormal: [0, 0, 1], width },
    { id: 'west', position: [-width / 2, 0, 0], rotation: Math.PI / 2, outwardNormal: [-1, 0, 0], width: depth },
  ];
}
const [width, height, depth] = getRoomDimensions(DEFAULT_ROOM_GRID);
export const roomConfig: RoomConfig = {
  id: 'cozy-corner',
  grid: { ...DEFAULT_ROOM_GRID },
  dimensions: { width, depth, height, wallThickness: SLAB_THICKNESS },
  theme: ROOM_THEMES.bedroom,
  walls: createWalls(width, depth),
};

export function getRoomConfig(room: Scene['room']): RoomConfig {
  const [width, height, depth] = getRoomDimensions(room.grid);
  return {
    ...roomConfig, grid: room.grid, dimensions: { width, depth, height, wallThickness: SLAB_THICKNESS },
    theme: ROOM_THEMES[room.preset],
    walls: createWalls(width, depth),
  };
}
