import { eventIsPlaying } from '../audio/activity.js';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Color, DoubleSide, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { useSceneStore } from '../scene/store.js';
import { useRoomStore } from './useRoomStore.js';
import { getModelId, gridFootprint, groundHeight, isWallMountedArt, WALL_ROTATIONS } from '../scene/layout.js';
import { getRoomConfig } from './roomConfig.js';
import type { SoundObject } from '../scene/scene.js';
import { useSourceDrag } from './useSourceDrag.js';
import { BirdsModel, FanModel, RainWindow, SpeakerModel } from './SoundModels.js';
import { getWallOpacity } from './WallVisibility.js';
import { SpawnPortal, SPAWN_EMERGE_DELAY, SPAWN_EMERGE_SPAN, clamp01, easeOutBack, useSpawnSchedule } from './spawn.js';
import { spriteKey, useArtStore, type SpriteArt } from '../art/store.js';
import { usePaintTexture } from './PaintedSurface.js';
import { paintedPropLayout } from './paintedProp.js';
import { paintSprites } from '../art/client.js';

const up = new Vector3(0, 1, 0);
function PaintedProp({ art, object, layout }: { art: Extract<SpriteArt, { status: 'ready' }>; object: SoundObject; layout: ReturnType<typeof paintedPropLayout> }) {
  const texture = usePaintTexture(art.png, { frames: art.frames ?? 1, fps: art.fps ?? 10 }, () => !object.muted && (object.kind === 'bed' || eventIsPlaying(object.id)), object.kind === 'event' && !object.muted);
  const ref = useRef<Mesh>(null);
  const rotation = useMemo(() => new Quaternion(), []);
  const direction = useMemo(() => new Vector3(), []);
  const { width, height } = layout;
  useFrame(({ camera }) => {
    if (!layout.mounted && ref.current?.parent) {
      // Yaw only: camera pitch must not lift the feet or lean the canopy through a wall.
      camera.getWorldDirection(direction).negate().setY(0);
      ref.current.parent.getWorldQuaternion(rotation);
      ref.current.quaternion.setFromAxisAngle(up, Math.atan2(direction.x, direction.z)).premultiply(rotation.invert());
    }
  });
  return <mesh ref={ref} name="painted-prop" position={[0, layout.offsetY, 0]}>
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
    // Managed originals are installed/restored as a set. Only an explicit AI
    // addition may request new art inside those rooms (PromptBar).
    if (room.art && !art && !managed) paintSprites(room.art, [object]);
  }, [room.art, object, art, managed]);
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
    group.current.scale.setScalar(object.scale * Math.max(0, art?.status === 'ready' ? Math.min(1, emerge) : emerge));
    camera.getWorldPosition(cameraPosition);
    // Only the rain window belongs to the wall, so it fades out with it. Every other source is a
    // thing standing in the room: it stays fully visible even when mounted on a near/hidden wall,
    // so dragging a source to the room's edge or rotating never makes it disappear.
    const fade = model === 'rain' && wall ? 0.2 + 0.8 * getWallOpacity(wall, group.current.parent.matrixWorld, cameraPosition) : 1;
    const opacity = fade * (object.muted ? 0.58 : 1);
    group.current.userData.opacity = opacity;
    for (const { mesh, material } of parts.current) {
      material.opacity = opacity;
      material.depthWrite = opacity > 0.999;
      mesh.renderOrder = 3;
    }
  });
  const layout = art?.status === 'ready' ? paintedPropLayout(object, room, art) : undefined;
  const rotation = layout && !layout.mounted ? 0 : object.wall ? WALL_ROTATIONS[object.wall] : model === 'fan' ? Math.PI / 4 : 0;
  const height = object.position[1] / object.scale;
  const footprint = gridFootprint(object);
  const stockFallback = object.kind === 'live' || !managed || (art?.status === 'failed' && art.stockFallback);
  const hover = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const state = useRoomStore.getState();
    if (event.pointerType === 'touch' || state.isRotating || state.draggingObjectId) return;
    state.setHovered(object.id);
    document.body.style.cursor = 'grab';
  };
  return <group ref={group} name={`sound-${object.id}`} position={layout?.position ?? object.position} rotation={[0, rotation, 0]} scale={object.scale} userData={{ model, muted: object.muted, wall: object.wall }} onPointerDown={startGesture} onPointerOver={hover} onPointerMove={hover} onPointerOut={() => {
    const state = useRoomStore.getState();
    if (state.draggingObjectId) return;
    if (state.hoveredObjectId === object.id) state.setHovered(null);
    document.body.style.cursor = '';
  }}>
    {art?.status === 'ready' && layout ? <PaintedProp art={art} object={object} layout={layout}/> : !stockFallback || art?.status === 'painting' ? null : model === 'rain' ? <RainWindow width={footprint.columns / object.scale} height={footprint.height / object.scale} muted={object.muted}/> : model === 'fan' ? <FanModel height={height} muted={object.muted}/> : model === 'birds' ? <BirdsModel height={height} muted={object.muted}/> : <SpeakerModel height={height}/>}
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
  const preset = room.preset;
  // Sources hidden from the environment through the Assets panel are muted and not rendered at all.
  const hidden = useRoomStore(state => state.hiddenObjectIds);
  const visible = objects.filter(object => !hidden.includes(object.id));
  return <group name="sound-objects">
    {visible.map(object => <Source key={object.id} object={object}/>)}
    {visible.map(object => <SpawnPortal key={`portal-${object.id}`} id={object.id} position={room.art && !isWallMountedArt(object) ? [object.position[0], groundHeight(object.position, room), object.position[2]] : object.position} scale={object.scale} preset={preset}/>)}
  </group>;
}
