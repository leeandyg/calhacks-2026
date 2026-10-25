import { DEFAULT_GRID, ModelId, WallId, type RoomGrid, type RoomOpening, type Scene, type SoundObject, type Vec3 as Position } from './scene.js';

// The room's placement rules, shared by the scene store (so what you hear matches what you see)
// and the room view: modular grid snapping, wall mounting, window openings and camera framing.

export const SEGMENT_SIZE = 1;
/** Painted environments and props (api/environment.ts, api/sprite.ts) use this many pixels per block. */
export const ART_PX_PER_BLOCK = 16;
export const DEFAULT_ROOM_GRID = DEFAULT_GRID;
export const VIEW_ELEVATION = Math.PI / 6;
/** The fixed camera looks in from +x/+z, so "into the screen" is yaw π/4 (forward -x/-z). */
export const VIEW_AZIMUTH = Math.PI / 4;
// Structural thickness never scales with grid counts or environment.
export const SLAB_THICKNESS = 0.42;
export const ROOM_FRAME = { floorDepth: SLAB_THICKNESS, floorOverhang: SLAB_THICKNESS / 2, wallCapTop: 0, envelopeOverhang: SLAB_THICKNESS / 2 } as const;
export type RoomDimensions = [width: number, height: number, depth: number];
export const WALL_IDS = WallId.options;
export type { WallId };
export const MODEL_IDS = ModelId.options;
export type { ModelId };
export const DRAG_THRESHOLD_PX = 6;
export const EDGE_ZONE = 0.5;
export const WINDOW_CORNER_SEGMENTS = 1;
export const WALL_ROTATIONS: Record<WallId, number> = { north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 };

export function getRoomDimensions(grid: RoomGrid): RoomDimensions { return [grid.columns * SEGMENT_SIZE, grid.wallHeight * SEGMENT_SIZE, grid.rows * SEGMENT_SIZE]; }
export function wallLength(wall: WallId, grid: RoomGrid) { return wall === 'north' || wall === 'south' ? grid.columns : grid.rows; }
/** Canonical ground under a source; both audio placement and the view use this height. */
export function groundHeight(position: Position, room: Pick<Scene['room'], 'grid' | 'terrain'>): number {
  const column = Math.max(0, Math.min(room.grid.columns - 1, Math.floor(position[0] + room.grid.columns / 2)));
  const row = Math.max(0, Math.min(room.grid.rows - 1, Math.floor(position[2] + room.grid.rows / 2)));
  return room.terrain?.[row]?.[column] ?? 0;
}
/** Wall contact does not turn a standing tree/fan/speaker into a wall painting. */
export function isWallMountedArt(object: SoundObject): boolean {
  const model = getModelId(object);
  return Boolean(object.wall) && (model === 'rain' || model === 'birds');
}
export function placeInRoom(object: SoundObject, room: Scene['room']): SoundObject {
  const placed = placeObject(object, room.grid);
  if (room.art && isWallMountedArt(placed)) {
    // Painted wall props are planes growing out of the actual inner wall face, not the
    // thick stock model's floor footprint. Audio receives this same mounted position.
    const position: Position = [...placed.position];
    const inset = SLAB_THICKNESS / 2 + 0.015;
    if (placed.wall === 'north') position[2] = -room.grid.rows / 2 + inset;
    if (placed.wall === 'south') position[2] = room.grid.rows / 2 - inset;
    if (placed.wall === 'east') position[0] = room.grid.columns / 2 - inset;
    if (placed.wall === 'west') position[0] = -room.grid.columns / 2 + inset;
    return position.every((value, i) => value === object.position[i]) && placed.scale === object.scale && placed.wall === object.wall ? object : { ...placed, position };
  }
  const minimum = groundHeight(placed.position, room) + 0.75 * placed.scale;
  if (!room.terrain || (room.art ? isWallMountedArt(placed) : placed.wall) || placed.position[1] >= minimum) return placed;
  return { ...placed, position: [placed.position[0], Math.ceil(minimum * 2) / 2, placed.position[2]] };
}
export function getModelId(object: Pick<SoundObject, 'model' | 'sound'>): ModelId {
  if (object.model) return object.model;
  const query = object.sound.query.toLowerCase();
  if (/rain|glass|drizzle/.test(query)) return 'rain';
  if (/fan|ventilation/.test(query)) return 'fan';
  if (/bird|sparrow|chirp/.test(query)) return 'birds';
  return 'speaker';
}
export function gridFootprint(object: SoundObject) {
  const model = getModelId(object);
  const width = Math.max(1, Math.ceil(({ rain: 2, fan: 1.56, birds: 1.8, speaker: 1.1 }[model]) * object.scale - 1e-8));
  return { columns: width, rows: model === 'rain' ? 1 : width, height: Math.max(1, Math.ceil((model === 'rain' ? 3 : 1.5) * object.scale - 1e-8)) };
}
export function wallInset(object: SoundObject) {
  // The 0.13-deep window frame sits with its back flush to the inner wall face.
  return getModelId(object) === 'rain' ? SLAB_THICKNESS / 2 + 0.065 * object.scale : gridFootprint(object).columns / 2;
}
export function nearestWall(position: Position, dimensions: RoomDimensions): WallId {
  const [width, , depth] = dimensions;
  const distances = [depth / 2 + position[2], width / 2 - position[0], depth / 2 - position[2], width / 2 + position[0]];
  return WALL_IDS[distances.indexOf(Math.min(...distances))];
}
export function wallDistance(position: Position, wall: WallId, dimensions: RoomDimensions) {
  const [width, , depth] = dimensions;
  return wall === 'north' ? depth / 2 + position[2] : wall === 'south' ? depth / 2 - position[2] : wall === 'east' ? width / 2 - position[0] : width / 2 + position[0];
}
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
// Quantize the start of an entire footprint, so odd/even footprints both align.
export function snapCenter(value: number, length: number, span: number) {
  const column = clamp(Math.round(value + length / 2 - span / 2), 0, length - span);
  return column + span / 2 - length / 2;
}
function snapHeight(value: number, height: number, margin: number) {
  return clamp(Math.round(value * 2) / 2, Math.ceil(margin * 2) / 2, Math.floor((height - margin) * 2) / 2);
}
export function placeObject(object: SoundObject, grid: RoomGrid): SoundObject {
  const dimensions = getRoomDimensions(grid);
  const [width, height, depth] = dimensions;
  const model = getModelId(object);
  const wall = object.wall ?? (model === 'rain' ? nearestWall(object.position, dimensions) : null);
  const availableWidth = model === 'rain' && wall ? wallLength(wall, grid) - 2 * WINDOW_CORNER_SEGMENTS : Math.min(width, depth);
  const scale = Math.min(object.scale, availableWidth / ({ rain: 2, fan: 1.56, birds: 1.8, speaker: 1.1 }[model]), (height - 0.1) / (model === 'rain' ? 3 : 1.5));
  const effective = scale === object.scale ? object : { ...object, scale };
  const footprint = gridFootprint(effective);
  const position: Position = [snapCenter(object.position[0], width, footprint.columns), snapHeight(object.position[1], height, 0.75 * scale), snapCenter(object.position[2], depth, model === 'rain' ? footprint.columns : footprint.rows)];
  if (model === 'rain') {
    const level = clamp(Math.round(object.position[1] - footprint.height / 2), 0, height - footprint.height);
    position[1] = level + footprint.height / 2;
  }
  if (wall) {
    const inset = wallInset(effective);
    if (wall === 'north') position[2] = -depth / 2 + inset;
    if (wall === 'south') position[2] = depth / 2 - inset;
    if (wall === 'east') position[0] = width / 2 - inset;
    if (wall === 'west') position[0] = -width / 2 + inset;
    if (model === 'rain') {
      // The end panels close the slab's corner/return. A window may not remove
      // them, even when dragged beyond the floor or resized to a narrow room.
      const axis = wall === 'east' || wall === 'west' ? 2 : 0;
      position[axis] = snapCenter(object.position[axis], wallLength(wall, grid) - 2 * WINDOW_CORNER_SEGMENTS, footprint.columns);
    } else if (wall === 'east' || wall === 'west') position[2] = snapCenter(object.position[2], depth, footprint.columns);
  }
  return object.wall === wall && object.scale === scale && position.every((value, index) => value === object.position[index]) ? object : { ...object, position, wall, scale };
}
/** A scene with every object snapped onto its grid, as the store keeps it. Unmoved objects keep their reference. */
export function snapScene<T extends Pick<Scene, 'room' | 'objects'>>(scene: T): T {
  return { ...scene, objects: scene.objects.map(object => placeObject(object, scene.room.grid)) };
}
export function dragPlacement(object: SoundObject, raw: Position, grid: RoomGrid): SoundObject {
  const dimensions = getRoomDimensions(grid);
  const wall = nearestWall(raw, dimensions);
  const atEdge = wallDistance(raw, wall, dimensions) <= wallInset(object) + EDGE_ZONE;
  return placeObject({ ...object, position: raw, wall: getModelId(object) === 'rain' || atEdge ? wall : null }, grid);
}
export function roomCamera(dimensions: RoomDimensions) {
  const [width, height, depth] = dimensions;
  const target: Position = [0, (height + ROOM_FRAME.wallCapTop - ROOM_FRAME.floorDepth) / 2, 0];
  const distance = Math.max(width, height, depth) * 1.75;
  // The reference has a 1:2 floor-edge rise/run: a 30° camera elevation.
  const position: Position = [distance, target[1] + Math.SQRT2 * distance * Math.tan(VIEW_ELEVATION), distance];
  return { position, target };
}
export function roomProjectionEnvelope([width, height, depth]: RoomDimensions) {
  const horizontal = Math.hypot(width + 2 * ROOM_FRAME.envelopeOverhang, depth + 2 * ROOM_FRAME.envelopeOverhang);
  const vertical = (height + ROOM_FRAME.floorDepth + ROOM_FRAME.wallCapTop) * Math.cos(VIEW_ELEVATION) + horizontal * Math.sin(VIEW_ELEVATION);
  return { horizontal, vertical };
}

export interface WallSegment { column: number; level: number; position: Position }
// Sources never cut the wall slab: a wall-mounted source (a rain window, a branch) sits on the
// intact inner face as a prop/painting. The only wall holes are the room's explicit openings.
export function getWallOpenings(room: Scene['room'], wall: WallId): RoomOpening[] {
  return room.openings.filter(opening => opening.wall === wall);
}
export function buildWallSegments(wall: WallId, grid: RoomGrid, openings: RoomOpening[]): WallSegment[] {
  const length = wallLength(wall, grid);
  const segments: WallSegment[] = [];
  for (let column = 0; column < length; column++) for (let level = 0; level < grid.wallHeight; level++) {
    const insideOpening = openings.some(opening => opening.wall === wall && column >= opening.column && column < opening.column + opening.span && level >= opening.level && level < opening.level + opening.height);
    if (!insideOpening) segments.push({ column, level, position: [column + 0.5 - length / 2, level + 0.5, 0] });
  }
  return segments;
}
