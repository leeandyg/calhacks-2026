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
  moved: boolean;
}
export function useSourceDrag(id: string, group: RefObject<Group | null>) {
  const { camera, gl } = useThree();
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
  const finish = (mode: 'drop' | 'cancel') => {
    const gesture = active.current;
    if (!gesture) return;
    active.current = null;
    if (gl.domElement.hasPointerCapture(gesture.pointerId)) gl.domElement.releasePointerCapture(gesture.pointerId);
    const store = useSceneStore.getState();
    const object = store.scene.objects.find(object => object.id === id);
    if (object) {
      if (mode === 'cancel' && gesture.moved) store.applyOps([{ op: 'move', id, position: gesture.original.position, wall: gesture.original.wall }]);
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
      const raw: Position = [hit.x - gesture.offset.x, gesture.original.position[1], hit.z - gesture.offset.z];
      const placement = dragPlacement(object, raw, store.scene.room.grid);
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
    active.current = { pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, original: object, moved: false, offset: hit.clone().sub(new Vector3(...object.position)) };
    state.selectObject(id); state.setDragging(id);
    gl.domElement.setPointerCapture(event.pointerId);
    gl.domElement.style.cursor = 'grabbing'; document.body.style.cursor = 'grabbing';
  };
}
