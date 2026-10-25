import { eventIsPlaying } from '../audio/activity.js';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Color, DoubleSide, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { useSceneStore } from '../scene/store.js';
import { useRoomStore } from './useRoomStore.js';
import { ART_PX_PER_BLOCK, getModelId, gridFootprint, groundHeight, WALL_ROTATIONS } from '../scene/layout.js';
import { getRoomConfig } from './roomConfig.js';
import type { SoundObject } from '../scene/scene.js';
import { useSourceDrag } from './useSourceDrag.js';
import { BirdsModel, FanModel, RainWindow, SpeakerModel } from './SoundModels.js';
import { getWallOpacity } from './WallVisibility.js';
import { SpawnPortal, SPAWN_EMERGE_DELAY, SPAWN_EMERGE_SPAN, clamp01, easeOutBack, useSpawnSchedule } from './spawn.js';
import { spriteKey, useArtStore, type SpriteArt } from '../art/store.js';
import { usePaintTexture } from './PaintedSurface.js';
import { paintSprites } from '../art/client.js';

function PaintedProp({ art, object }: { art: Extract<SpriteArt, { status: 'ready' }>; object: SoundObject }) {
  const texture = usePaintTexture(art.png, { frames: art.frames ?? 1, fps: art.fps ?? 10 }, () => !object.muted && (object.kind === 'bed' || eventIsPlaying(object.id)), object.kind === 'event' && !object.muted);
  const ref = useRef<Mesh>(null);
  const rotation = useMemo(() => new Quaternion(), []);
  const room = useSceneStore(state => state.scene.room);
  const width = Math.min(art.w / ART_PX_PER_BLOCK, gridFootprint(object).columns / object.scale);
  const height = width * art.h / art.w;
  useFrame(({ camera }) => {
    if (!object.wall && ref.current?.parent) {
      ref.current.parent.getWorldQuaternion(rotation);
      ref.current.quaternion.copy(rotation.invert().multiply(camera.quaternion));
    }
  });
  const y = object.wall ? 0 : (groundHeight(object.position, room) - object.position[1]) / object.scale + height / 2;
  return <mesh ref={ref} name="painted-prop" position={[0, y, 0]}>
    <planeGeometry args={[width, height]}/>
    <meshStandardMaterial map={texture} transparent alphaTest={0.15} side={DoubleSide} roughness={1}/>
  </mesh>;
}

interface Part { mesh: Mesh; material: MeshStandardMaterial; color: Color; emissive: Color; emissiveIntensity: number }
const gray = new Color('#929895');
const cameraPosition = new Vector3();
function Source({ object }: { object: SoundObject }) {
  const group = useRef<Group>(null);
  const parts = useRef<Part[]>([]);
  const startGesture = useSourceDrag(object.id, group);
  const schedule = useSpawnSchedule();
  useEffect(() => () => {
    const state = useRoomStore.getState();
    if (state.hoveredObjectId === object.id) state.setHovered(null);
  }, [object.id]);
  const room = useSceneStore(state => state.scene.room);
  const managed = useArtStore(state => room.art ? state.envs[room.art]?.managed : false);
  const art = useArtStore(state => room.art ? state.sprites[spriteKey(room.art, object)] : undefined);
  useEffect(() => {
    if (room.art && !art) paintSprites(room.art, [object]);
  }, [room.art, object, art]);
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
  }, [model, art]);
  useLayoutEffect(() => {
    for (const part of parts.current) {
      part.material.color.copy(part.color);
      if (object.muted) part.material.color.lerp(gray, 0.94);
      part.material.emissive.copy(part.emissive);
      part.material.emissiveIntensity = object.muted ? 0 : part.emissiveIntensity;
    }
  }, [object.muted, model, art]);
  useFrame(({ camera, clock }) => {
    if (!group.current?.parent) return;
    // Spawn pop: the source scales up out of its portal, then rests at its real scale.
    const start = schedule.current.get(object.id);
    const emerge = start === undefined ? 0
      : easeOutBack(clamp01((clock.elapsedTime - start - SPAWN_EMERGE_DELAY) / SPAWN_EMERGE_SPAN));
    group.current.scale.setScalar(object.scale * Math.max(0, emerge));
    camera.getWorldPosition(cameraPosition);
    const fade = (art?.status === 'ready' || model === 'rain') && wall ? 0.2 + 0.8 * getWallOpacity(wall, group.current.parent.matrixWorld, cameraPosition) : 1;
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
  const hover = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const state = useRoomStore.getState();
    if (event.pointerType === 'touch' || state.isRotating || state.draggingObjectId) return;
    state.setHovered(object.id);
    document.body.style.cursor = 'grab';
  };
  return <group ref={group} name={`sound-${object.id}`} position={object.position} rotation={[0, rotation, 0]} scale={object.scale} userData={{ model, muted: object.muted, wall: object.wall }} onPointerDown={startGesture} onPointerOver={hover} onPointerMove={hover} onPointerOut={() => {
    const state = useRoomStore.getState();
    if (state.draggingObjectId) return;
    if (state.hoveredObjectId === object.id) state.setHovered(null);
    document.body.style.cursor = '';
  }}>
    {art?.status === 'ready' ? <PaintedProp art={art} object={object}/> : (managed && object.kind !== 'live') || art?.status === 'painting' ? null : model === 'rain' ? <RainWindow width={footprint.columns / object.scale} height={footprint.height / object.scale} muted={object.muted}/> : model === 'fan' ? <FanModel height={height} muted={object.muted}/> : model === 'birds' ? <BirdsModel height={height} muted={object.muted}/> : <SpeakerModel height={height}/>}
  </group>;
}

export function SoundObjects() {
  const objects = useSceneStore(state => state.scene.objects);
  const room = useSceneStore(state => state.scene.room);
  useEffect(() => { useRoomStore.getState().setHovered(null); }, [room]);
  useEffect(() => {
    const clear = () => { useRoomStore.getState().setHovered(null); document.body.style.cursor = ''; };
    window.addEventListener('blur', clear);
    return () => window.removeEventListener('blur', clear);
  }, []);
  return <group name="sound-objects">
    {objects.map(object => <Source key={object.id} object={object}/>)}
    {objects.map(object => <SpawnPortal key={`portal-${object.id}`} id={object.id} position={object.position} scale={object.scale} preset={room.preset}/>)}
  </group>;
}
