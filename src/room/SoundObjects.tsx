import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { useSceneStore } from '../scene/store.js';
import { useRoomStore } from './useRoomStore.js';
import { getModelId, gridFootprint, WALL_ROTATIONS } from '../scene/layout.js';
import { getRoomConfig } from './roomConfig.js';
import type { SoundObject } from '../scene/scene.js';
import { useSourceDrag } from './useSourceDrag.js';
import { BirdsModel, FanModel, RainWindow, SpeakerModel } from './SoundModels.js';
import { getWallOpacity } from './WallVisibility.js';
import { SpawnPortal, SPAWN_EMERGE_DELAY, SPAWN_EMERGE_SPAN, clamp01, easeOutBack, useSpawnSchedule } from './spawn.js';

interface Part { mesh: Mesh; material: MeshStandardMaterial; color: Color; emissive: Color; emissiveIntensity: number }
const gray = new Color('#929895');
const cameraPosition = new Vector3();
function Source({ object }: { object: SoundObject }) {
  const group = useRef<Group>(null);
  const parts = useRef<Part[]>([]);
  const startGesture = useSourceDrag(object.id, group);
  const schedule = useSpawnSchedule();
  const room = useSceneStore(state => state.scene.room);
  const model = getModelId(object);
  const wall = useMemo(() => object.wall ? getRoomConfig(room).walls.find(wall => wall.id === object.wall) : undefined, [room, object.wall]);
  useLayoutEffect(() => {
    parts.current = [];
    group.current?.traverse(child => {
      if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
        child.material.transparent = true;
        child.material.needsUpdate = true;
        parts.current.push({ mesh: child, material: child.material, color: child.material.color.clone(), emissive: child.material.emissive.clone(), emissiveIntensity: child.material.emissiveIntensity });
      }
    });
  }, [model]);
  useLayoutEffect(() => {
    for (const part of parts.current) {
      part.material.color.copy(part.color);
      if (object.muted) part.material.color.lerp(gray, 0.94);
      part.material.emissive.copy(part.emissive);
      part.material.emissiveIntensity = object.muted ? 0 : part.emissiveIntensity;
    }
  }, [object.muted, model]);
  useFrame(({ camera, clock }) => {
    if (!group.current?.parent) return;
    // Spawn pop: the source scales up out of its portal, then rests at its real scale.
    const start = schedule.current.get(object.id);
    const emerge = start === undefined ? 0
      : easeOutBack(clamp01((clock.elapsedTime - start - SPAWN_EMERGE_DELAY) / SPAWN_EMERGE_SPAN));
    group.current.scale.setScalar(object.scale * Math.max(0, emerge));
    camera.getWorldPosition(cameraPosition);
    const fade = model === 'rain' && wall ? 0.2 + 0.8 * getWallOpacity(wall, group.current.parent.matrixWorld, cameraPosition) : 1;
    const opacity = fade * (object.muted ? 0.58 : 1);
    group.current.userData.opacity = opacity;
    for (const { mesh, material } of parts.current) {
      material.opacity = opacity;
      material.depthWrite = opacity > 0.999;
      mesh.renderOrder = 3;
    }
  });
  const rotation = object.wall ? WALL_ROTATIONS[object.wall] : model === 'fan' ? Math.PI / 4 : 0;
  const height = object.position[1] / object.scale;
  const footprint = gridFootprint(object);
  return <group ref={group} name={`sound-${object.id}`} position={object.position} rotation={[0, rotation, 0]} scale={object.scale} userData={{ model, muted: object.muted, wall: object.wall }} onPointerDown={startGesture} onPointerOver={event => { event.stopPropagation(); if (!useRoomStore.getState().draggingObjectId) document.body.style.cursor = 'grab'; }} onPointerOut={() => { if (!useRoomStore.getState().draggingObjectId) document.body.style.cursor = ''; }}>
    {model === 'rain' ? <RainWindow width={footprint.columns / object.scale} height={footprint.height / object.scale} muted={object.muted}/> : model === 'fan' ? <FanModel height={height} muted={object.muted}/> : model === 'birds' ? <BirdsModel height={height} muted={object.muted}/> : <SpeakerModel height={height}/>}
  </group>;
}

export function SoundObjects() {
  const objects = useSceneStore(state => state.scene.objects);
  const preset = useSceneStore(state => state.scene.room.preset);
  return <group name="sound-objects">
    {objects.map(object => <Source key={object.id} object={object}/>)}
    {objects.map(object => <SpawnPortal key={`portal-${object.id}`} id={object.id} position={object.position} scale={object.scale} preset={preset}/>)}
  </group>;
}
