import { beforeEach, describe, expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { DEFAULT_ROOM_GRID, getRoomDimensions, roomCamera, WALL_IDS, gridFootprint, placeObject, dragPlacement, snapCenter, wallInset, wallLength, sourceWindowOpening, buildWallSegments, getWallOpenings } from './layout';
import { useSceneStore } from '../store/useSceneStore';
import { soundscapes } from '../config/soundscapes';
import reference from '../../docs/reference-proportions.json';
import { ROOM_FRAME } from './layout';
import { SceneSchema } from './scene';

describe('LAYOUT.md modular grid contract', () => {
  beforeEach(() => { useSceneStore.getState().createScene(soundscapes.rainy.scene); });
  it('uses reference-calibrated 10-by-10 floor and independent seven-block wall height', () => {
    expect(useSceneStore.getState().scene.room.grid).toEqual(DEFAULT_ROOM_GRID);
    expect(getRoomDimensions(DEFAULT_ROOM_GRID)).toEqual([10, 7, 10]);
  });
  it('accepts rectangles with independent counts and wall height', () => {
    expect(useSceneStore.getState().editScene([{ op: 'set_room', preset: 'cabin', grid: { mode: 'Rectangle', columns: 10, rows: 6, wallHeight: 3 } }]).ok).toBe(true);
    expect(getRoomDimensions(useSceneStore.getState().scene.room.grid)).toEqual([10, 3, 6]);
    expect(useSceneStore.getState().editScene([{ op: 'set_room', preset: 'cabin', grid: { mode: 'Square', columns: 10, rows: 6, wallHeight: 3 } }]).ok).toBe(false);
  });
  it.each([
    { ...DEFAULT_ROOM_GRID, columns: 7.5 },
    { ...DEFAULT_ROOM_GRID, wallHeight: 3.5 },
    { ...DEFAULT_ROOM_GRID, mode: 'L-shaped' },
    { ...DEFAULT_ROOM_GRID, segmentSize: 0.5 },
    { ...DEFAULT_ROOM_GRID, floorMask: [[1, 1], [1, 0]] },
  ])('rejects fractional/custom-shape/custom-metric grids %#', grid => {
    expect(useSceneStore.getState().editScene([{ op: 'set_room', preset: 'cabin', grid }]).ok).toBe(false);
  });
  it('does not accept a competing room.size tuple', () => {
    const scene = structuredClone(soundscapes.rainy.scene);
    Object.assign(scene.room, { size: [8, 8, 8] });
    expect(useSceneStore.getState().createScene(scene).ok).toBe(false);
  });
  it('matches the reference floor-edge slope with 30-degree orthographic elevation', () => {
    const pose = roomCamera([10, 4, 6]);
    const camera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
    camera.position.fromArray(pose.position); camera.lookAt(...pose.target); camera.updateMatrixWorld();
    const offset = new Vector3(...pose.position).sub(new Vector3(...pose.target));
    expect(offset.x).toBe(offset.z);
    expect(Math.asin(offset.clone().normalize().y) * 180 / Math.PI).toBeCloseTo(reference.targets.cameraElevationDegrees, 8);
    const origin = new Vector3().project(camera);
    for (const axis of [new Vector3(1, 0, 0), new Vector3(0, 0, 1)]) {
      const projected = axis.project(camera).sub(origin);
      expect(Math.abs(projected.y / projected.x)).toBeCloseTo(reference.targets.floorEdgeRiseRun, 8);
    }
  });
  it('matches the reference structural height/width ratio within half a percent', () => {
    const [width, height, depth] = getRoomDimensions(DEFAULT_ROOM_GRID);
    const pose = roomCamera([width, height, depth]);
    const camera = new OrthographicCamera(-20, 20, 20, -20, 0.1, 200);
    camera.position.fromArray(pose.position); camera.lookAt(...pose.target); camera.updateMatrixWorld();
    const extentX = width / 2 + ROOM_FRAME.floorOverhang;
    const extentZ = depth / 2 + ROOM_FRAME.floorOverhang;
    const left = new Vector3(-extentX, -ROOM_FRAME.floorDepth, extentZ).project(camera);
    const right = new Vector3(extentX, -ROOM_FRAME.floorDepth, -extentZ).project(camera);
    const front = new Vector3(extentX, -ROOM_FRAME.floorDepth, extentZ).project(camera);
    const top = new Vector3(-extentX, height, -extentZ).project(camera);
    const ratio = (top.y - front.y) / (right.x - left.x);
    expect(Math.abs(ratio - reference.targets.outlineHeightWidth)).toBeLessThan(reference.targets.outlineRatioTolerance);
  });
  it.each(WALL_IDS)('moves every source to %s using the correct rectangular edge', wall => {
    const store = useSceneStore.getState();
    store.editScene([{ op: 'set_room', preset: 'bedroom', grid: { mode: 'Rectangle', columns: 10, rows: 6, wallHeight: 4 } }]);
    for (const source of useSceneStore.getState().scene.objects) {
      expect(store.editScene([{ op: 'move', id: source.id, position: [0, source.position[1], 0], wall }]).ok).toBe(true);
      const current = useSceneStore.getState().scene.objects.find(object => object.id === source.id)!;
      const edge = (wall === 'east' || wall === 'west' ? 5 : 3) - wallInset(current);
      expect(current.wall).toBe(wall);
      expect(current.position[wall === 'east' || wall === 'west' ? 0 : 2]).toBe((wall === 'north' || wall === 'west' ? -1 : 1) * edge);
      const footprint = gridFootprint(current);
      const tangent = current.position[wall === 'east' || wall === 'west' ? 2 : 0];
      expect(Number.isInteger(tangent + wallLength(wall, useSceneStore.getState().scene.room.grid) / 2 - footprint.columns / 2)).toBe(true);
    }
  });
  it('quantizes whole footprints with the correct odd/even center parity', () => {
    expect(snapCenter(0.37, 8, 2)).toBe(0);
    expect(snapCenter(0.37, 8, 3)).toBe(0.5);
    expect(snapCenter(-0.37, 8, 3)).toBe(-0.5);
    const fan = useSceneStore.getState().scene.objects[1];
    const placed = placeObject({ ...fan, position: [2.37, 1.6, -1.72] }, DEFAULT_ROOM_GRID);
    expect(placed.position).toEqual([2, 1.5, -2]);
    expect(placeObject(placed, DEFAULT_ROOM_GRID)).toBe(placed);
  });
  it('clamps a scaled window to a short rectangular wall and modular levels', () => {
    const rain = useSceneStore.getState().scene.objects[0];
    const grid = { mode: 'Rectangle', columns: 4, rows: 6, wallHeight: 2 } as const;
    const current = placeObject({ ...rain, position: [100, 100, 100], wall: 'east', scale: 4 }, grid);
    const footprint = gridFootprint(current);
    expect(Math.abs(current.position[2]) + footprint.columns / 2).toBeLessThanOrEqual(3);
    expect(current.position[1] + footprint.height / 2).toBeLessThanOrEqual(2);
  });
  it('snaps to walls without changing orientation and releases attachment in the interior', () => {
    const fan = useSceneStore.getState().scene.objects[1];
    const edge = dragPlacement(fan, [100, fan.position[1], 0], DEFAULT_ROOM_GRID);
    expect(edge.wall).toBe('east'); expect(edge.position[0]).toBe(4);
    const interior = dragPlacement(edge, [0, fan.position[1], 0], DEFAULT_ROOM_GRID);
    expect(interior.wall).toBeNull(); expect(interior.position).toEqual([0, fan.position[1], 0]);
  });
  it('derives source-window cutouts and rebuilds the destination wall on movement', () => {
    let scene = useSceneStore.getState().scene;
    const opening = sourceWindowOpening(scene.objects[0], scene.room.grid)!;
    expect(opening).toMatchObject({ wall: 'west', column: 5, level: 2, span: 2, height: 3 });
    expect(buildWallSegments('west', scene.room.grid, getWallOpenings(scene.room, scene.objects, 'west'))).toHaveLength(64);
    useSceneStore.getState().editScene([{ op: 'move', id: 'rain-1', position: [0, 2, 0], wall: 'east' }]);
    scene = useSceneStore.getState().scene;
    expect(buildWallSegments('west', scene.room.grid, getWallOpenings(scene.room, scene.objects, 'west'))).toHaveLength(70);
    expect(buildWallSegments('east', scene.room.grid, getWallOpenings(scene.room, scene.objects, 'east'))).toHaveLength(64);
  });
  it.each(WALL_IDS)('keeps the window inside solid corner posts at both ends of %s', wall => {
    const rain = useSceneStore.getState().scene.objects[0];
    for (const grid of [DEFAULT_ROOM_GRID, { mode: 'Rectangle', columns: 6, rows: 4, wallHeight: 3 } as const]) {
      for (const end of [-100, 100]) {
        const window = placeObject({ ...rain, wall, position: [end, rain.position[1], end], scale: 4 }, grid);
        const opening = sourceWindowOpening(window, grid)!;
        const length = wallLength(wall, grid);
        expect(opening.column).toBeGreaterThanOrEqual(1);
        expect(opening.column + opening.span).toBeLessThanOrEqual(length - 1);
        const segments = buildWallSegments(wall, grid, [opening]);
        for (let level = opening.level; level < opening.level + opening.height; level++) {
          expect(segments.some(segment => segment.column === 0 && segment.level === level)).toBe(true);
          expect(segments.some(segment => segment.column === length - 1 && segment.level === level)).toBe(true);
        }
        expect(placeObject(window, grid)).toBe(window);
      }
    }
  });
  it('supports integer door/window ranges and excludes baseboard panels at doors', () => {
    const opening = { id: 'entry', kind: 'door', wall: 'west', column: 1, level: 0, span: 1, height: 2 } as const;
    expect(useSceneStore.getState().editScene([{ op: 'set_room', preset: 'bedroom', openings: [opening] }]).ok).toBe(true);
    const scene = useSceneStore.getState().scene;
    const segments = buildWallSegments('west', scene.room.grid, getWallOpenings(scene.room, scene.objects, 'west'));
    expect(segments).toHaveLength(62);
    expect(segments.some(segment => segment.column === 1 && segment.level === 0)).toBe(false);
  });
  it.each([
    { id: 'bad', kind: 'door', wall: 'west', column: 1, level: 1, span: 1, height: 2 },
    { id: 'bad', kind: 'window', wall: 'east', column: 9, level: 1, span: 2, height: 2 },
    { id: 'bad', kind: 'window', wall: 'north', column: 0.5, level: 1, span: 2, height: 2 },
    { id: 'bad', kind: 'window', wall: 'north', column: 0, level: 6, span: 2, height: 2 },
  ])('rejects openings that do not fit modular wall cells %#', opening => {
    expect(useSceneStore.getState().editScene([{ op: 'set_room', preset: 'bedroom', openings: [opening] }]).ok).toBe(false);
  });
  it('mute preserves saved volume, placement and scene JSON round trips', () => {
    const original = useSceneStore.getState().scene.objects[1];
    const store = useSceneStore.getState();
    store.editScene([{ op: 'set_muted', id: original.id, muted: true }]);
    let current = useSceneStore.getState().scene.objects[1];
    expect(current.muted).toBe(true); expect(current.volume).toBe(original.volume); expect(current.position).toEqual(original.position);
    expect(SceneSchema.parse(JSON.parse(JSON.stringify(useSceneStore.getState().scene)))).toEqual(useSceneStore.getState().scene);
    store.editScene([{ op: 'set_muted', id: original.id, muted: false }]);
    current = useSceneStore.getState().scene.objects[1];
    expect(current.muted).toBe(false); expect(current.volume).toBe(original.volume);
  });
  it('rejects unsupported decorative models', () => {
    const source = { ...soundscapes.rainy.scene.objects[0], id: 'sofa', model: 'sofa' };
    expect(useSceneStore.getState().editScene([{ op: 'add', object: source }]).ok).toBe(false);
  });
});
