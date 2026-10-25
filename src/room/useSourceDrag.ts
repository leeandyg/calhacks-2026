import { bearSpeakers, bearGround, isBearSpeaker, getBearDragPosition } from '../scene/speakerStack.js';
import { useEffect, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3, type Group } from 'three';
import type { RefObject } from 'react';
import { useRoomStore } from './useRoomStore.js';
import { useSceneStore } from '../scene/store.js';
import { DRAG_THRESHOLD_PX, dragPlacement } from '../scene/layout.js';
import type { Vec3 as Position, SoundObject } from '../scene/scene.js';

interface Gesture {
  pointerId: number;
  pointerType: string;
  x: number; y: number;
  startX: number; startY: number;
  offset: Vector3;
  original: SoundObject;
  supports: SoundObject[];
  moved: boolean;
}
export function useSourceDrag(id: string, group: RefObject<Group | null>) {
  const { camera, gl, scene } = useThree();
  const active = useRef<Gesture | null>(null);
  const ray = useRef(new Raycaster());
  const pointer = useRef(new Vector2());
  const point = useRef(new Vector3());
  const floor = useRef(new Plane(new Vector3(0, 1, 0), 0));
  const getFloorPoint = (x: number, y: number) => {
    const bounds = gl.domElement.getBoundingClientRect();
    pointer.current.set((x - bounds.left) / bounds.width * 2 - 1, -(y - bounds.top) / bounds.height * 2 + 1);
    ray.current.setFromCamera(pointer.current, camera);
    if (!ray.current.ray.intersectPlane(floor.current, point.current) || !group.current?.parent) return null;
    return group.current.parent.worldToLocal(point.current);
  };
  const overBear = (x: number, y: number) => {
    const avatar = scene.getObjectByName('listener-avatar');
    if (!avatar?.visible) return false;
    const bounds = gl.domElement.getBoundingClientRect();
    const origin = avatar.getWorldPosition(new Vector3());
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const project = (point: Vector3) => {
      point.project(camera);
      return [bounds.left + (point.x + 1) * bounds.width / 2, bounds.top + (1 - point.y) * bounds.height / 2];
    };
    const bottom = project(origin.clone().addScaledVector(up, -0.02 * avatar.scale.y));
    const top = project(origin.clone().addScaledVector(up, 0.98 * avatar.scale.y));
    const edge = project(origin.clone().addScaledVector(right, avatar.scale.x / 2));
    return y >= top[1] && y <= bottom[1] && Math.abs(x - bottom[0]) <= Math.abs(edge[0] - bottom[0]);
  };
  const finish = (mode: 'drop' | 'cancel') => {
    const gesture = active.current;
    if (!gesture) return;
    active.current = null;
    if (gl.domElement.hasPointerCapture(gesture.pointerId)) gl.domElement.releasePointerCapture(gesture.pointerId);
    const store = useSceneStore.getState();
    const object = store.scene.objects.find(object => object.id === id);
    if (object) {
      if (mode === 'cancel' && gesture.moved) store.applyOps([gesture.original, ...gesture.supports.filter(source => source.id !== id)].filter(source => store.scene.objects.some(current => current.id === source.id)).map(source => ({ op: 'move' as const, id: source.id, position: source.position, wall: source.wall })));
      if (mode === 'drop' && !gesture.moved) store.applyOps([{ op: 'set_muted', id, muted: !object.muted }]);
    }
    const state = useRoomStore.getState();
    if (state.draggingObjectId === id) state.setDragging(null);
    // Releasing capture need not move the pointer. Keep hover after a click/drop
    // only if the mouse still hits the prop; touch and cancelled drags clear it.
    const hovering = object && mode === 'drop' && gesture.pointerType !== 'touch' && getFloorPoint(gesture.x, gesture.y) && group.current && ray.current.intersectObject(group.current, true).length > 0;
    state.setHovered(hovering ? id : null);
    gl.domElement.style.cursor = ''; document.body.style.cursor = hovering ? 'grab' : '';
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const gesture = active.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gesture.x = event.clientX; gesture.y = event.clientY;
      if (event.cancelable) event.preventDefault();
      if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < DRAG_THRESHOLD_PX) return;
      gesture.moved = true;
      const store = useSceneStore.getState();
      const object = store.scene.objects.find(object => object.id === id);
      const hit = getFloorPoint(event.clientX, event.clientY);
      if (!object || !hit) return;
      const raw: Position = [hit.x - gesture.offset.x, (isBearSpeaker(gesture.original, store.scene.room) ? bearGround(store.scene.room) + 0.75 * object.scale : gesture.original.position[1]), hit.z - gesture.offset.z];
      const placement = getBearDragPosition(object, overBear(event.clientX, event.clientY) ? [0, raw[1], 0] : raw, store.scene) ?? dragPlacement(object, raw, store.scene.room.grid);
      store.applyOps([{ op: 'move', id, position: placement.position, wall: placement.wall }]);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== active.current?.pointerId) return;
      active.current.x = event.clientX; active.current.y = event.clientY;
      finish('drop');
    };
    const cancelPointer = (event: PointerEvent) => { if (event.pointerId === active.current?.pointerId) finish('cancel'); };
    const cancel = () => finish('cancel');
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('blur', cancel); window.addEventListener('keydown', escape);
    gl.domElement.addEventListener('lostpointercapture', cancelPointer);
    const unsubscribe = useSceneStore.subscribe(state => { if (active.current && !state.scene.objects.some(object => object.id === id)) cancel(); });
    return () => {
      cancel(); unsubscribe();
      gl.domElement.style.cursor = ''; document.body.style.cursor = '';
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancelPointer);
      window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape);
      gl.domElement.removeEventListener('lostpointercapture', cancelPointer);
    };
    // Pointer callbacks intentionally read the latest scene/view state from stores.
  }, [id, camera, gl]);
  return (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const state = useRoomStore.getState();
    if (state.isRotating || state.draggingObjectId) return;
    const object = useSceneStore.getState().scene.objects.find(object => object.id === id);
    const hit = getFloorPoint(event.clientX, event.clientY);
    if (!object || !hit) return;
    active.current = { pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, original: object, supports: bearSpeakers(useSceneStore.getState().scene), moved: false, offset: hit.clone().sub(new Vector3(...object.position)) };
    state.selectObject(id); state.setDragging(id);
    gl.domElement.setPointerCapture(event.pointerId);
    gl.domElement.style.cursor = 'grabbing'; document.body.style.cursor = 'grabbing';
  };
}
