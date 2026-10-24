import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { RoomConfig, WallConfig } from './types.js';
import { useSceneStore } from '../scene/store.js';
import { buildWallSegments, getWallOpenings } from '../scene/layout.js';
import { SurfacePixels } from './SurfacePixels.js';
import { applyScreenDoorFade, getWallOpacity } from './WallVisibility.js';
import { useArtStore } from '../art/store.js';
import { PaintedSurface } from './PaintedSurface.js';

const cameraWorld = new Vector3();
export function Wall({ wall, config }: { wall: WallConfig; config: RoomConfig }) {
  const ref = useRef<Group>(null);
  const panels = useRef<InstancedMesh>(null);
  const parts = useRef<{ mesh: Mesh; material: MeshStandardMaterial }[]>([]);
  const endExtensions = useRef<[number, number]>([NaN, NaN]);
  const matrix = useMemo(() => new Matrix4(), []);
  const room = useSceneStore(state => state.scene.room);
  const painting = useArtStore(state => room.art ? state.envs[room.art]?.textures[wall.id] : undefined);
  const animation = useArtStore(state => room.art ? state.envs[room.art]?.animations?.[wall.id] : undefined);
  const objects = useSceneStore(state => state.scene.objects);
  const openings = getWallOpenings(room, objects, wall.id);
  const openingKey = JSON.stringify(openings);
  const segments = useMemo(() => buildWallSegments(wall.id, config.grid, JSON.parse(openingKey)), [wall.id, config.grid, openingKey]);
  const { height, wallThickness } = config.dimensions;
  const throughCorner = wall.id === 'north' || wall.id === 'south';
  const surfaceWidth = wall.width + (throughCorner ? wallThickness : -wallThickness);
  const holes = useMemo(() => openings.map(opening => ({ x: opening.column - wall.width / 2, y: opening.level - height / 2, width: opening.span, height: opening.height })), [openingKey, wall.width, height]);
  const leftNeighbor = config.walls.find(candidate => candidate.id === (wall.id === 'east' ? 'north' : 'south'))!;
  const rightNeighbor = config.walls.find(candidate => candidate.id === (wall.id === 'east' ? 'south' : 'north'))!;
  const updatePanels = useCallback((leftExtension: number, rightExtension: number) => {
    const mesh = panels.current;
    if (mesh) {
      segments.forEach((segment, index) => {
        const first = segment.column === 0;
        const last = segment.column === wall.width - 1;
        const panelWidth = 1 + (first ? leftExtension : 0) + (last ? rightExtension : 0);
        const x = segment.position[0] + (last ? rightExtension / 2 : 0) - (first ? leftExtension / 2 : 0);
        mesh.setMatrixAt(index, matrix.makeScale(panelWidth, 1, 1).setPosition(x, segment.position[1], 0));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    endExtensions.current = [leftExtension, rightExtension];
  }, [segments, wall.width, matrix]);
  useLayoutEffect(() => {
    updatePanels(wallThickness / 2, wallThickness / 2);
    parts.current = [];
    ref.current?.traverse(object => {
      if (object instanceof Mesh && object.material instanceof MeshStandardMaterial) {
        applyScreenDoorFade(object.material);
        parts.current.push({ mesh: object, material: object.material });
      }
    });
  }, [updatePanels, wallThickness, config.theme, holes, painting]);
  useFrame(({ camera }) => {
    const group = ref.current;
    if (!group?.parent) return;
    camera.getWorldPosition(cameraWorld);
    const opacity = getWallOpacity(wall, group.parent.matrixWorld, cameraWorld);
    group.userData.opacity = opacity;
    group.visible = opacity > 0.001;
    if (!throughCorner) {
      // Butt against a present neighbor; expose the complete flush slab end when
      // that neighbor disappears. Only the end panel's length changes, never depth.
      const left = wallThickness / 2 * (1 - 2 * getWallOpacity(leftNeighbor, group.parent.matrixWorld, cameraWorld));
      const right = wallThickness / 2 * (1 - 2 * getWallOpacity(rightNeighbor, group.parent.matrixWorld, cameraWorld));
      if (Math.abs(left - endExtensions.current[0]) > 1e-8 || Math.abs(right - endExtensions.current[1]) > 1e-8) updatePanels(left, right);
    }
    for (const { mesh, material } of parts.current) {
      material.opacity = opacity; // drives the screen-door fade, not blending
      mesh.renderOrder = mesh.name === 'wall-body' ? 1 : 2;
    }
  }, -1);
  return <group ref={ref} name={`wall-${wall.id}`} position={wall.position} rotation={[0, wall.rotation, 0]} userData={{ modules: segments.length, openings, thickness: wallThickness, surface: config.theme.surface }}>
    <instancedMesh ref={panels} name="wall-body" args={[undefined, undefined, segments.length]}><boxGeometry args={[1, 1, wallThickness]}/><meshStandardMaterial color={config.theme.surface} roughness={1} flatShading/></instancedMesh>
    {painting ? <PaintedSurface png={painting} animation={animation} cells={segments} width={wall.width} height={height} depth={wallThickness / 2 + 0.003}/> : <SurfacePixels width={surfaceWidth} height={height} seed={41} palette={config.theme.detailPalette} openings={holes} position={[0, height / 2, wallThickness / 2 + 0.002]}/>}
    <SurfacePixels width={surfaceWidth} height={height} seed={42} palette={config.theme.detailPalette} openings={holes.map(hole => ({ ...hole, x: -hole.x - hole.width }))} position={[0, height / 2, -wallThickness / 2 - 0.002]} rotation={[0, Math.PI, 0]}/>
    <SurfacePixels width={surfaceWidth} height={wallThickness} seed={43} palette={config.theme.detailPalette} openings={holes.filter(hole => hole.y + hole.height >= height / 2).map(hole => ({ ...hole, y: -wallThickness / 2, height: wallThickness }))} position={[0, height + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}/>
  </group>;
}
