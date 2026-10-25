import { create } from 'zustand';
import { normalizeTurn } from './easing.js';
import type { Vec3 } from './types.js';
import { DEFAULT_ROOM_GRID, getRoomDimensions, roomCamera, type RoomDimensions } from '../scene/layout.js';
interface RoomState {
  orientation: number;
  pendingSteps: number;
  isRotating: boolean;
  selectedObjectId: string | null;
  hoveredObjectId: string | null;
  draggingObjectId: string | null;
  lighting: 'day' | 'evening';
  /** The room's on-screen rotation in radians, including mid-turn. The audio listener turns with it. */
  viewAngle: number;
  camera: { position: Vec3; target: Vec3 };
  rotate: (direction: 'left' | 'right') => void;
  reset: () => void;
  finishRotation: () => void;
  toggleLighting: () => void;
  selectObject: (id: string | null) => void;
  setHovered: (id: string | null) => void;
  setDragging: (id: string | null) => void;
  frameRoom: (dimensions: RoomDimensions) => void;
}
export const useRoomStore = create<RoomState>((set, get) => ({
  orientation: 0, pendingSteps: 0, isRotating: false, lighting: 'day', viewAngle: 0,
  selectedObjectId: null, hoveredObjectId: null, draggingObjectId: null,
  camera: roomCamera(getRoomDimensions(DEFAULT_ROOM_GRID)),
  rotate: (direction) => { if (!get().isRotating && !get().draggingObjectId) set({ pendingSteps: direction === 'right' ? -1 : 1, isRotating: true, hoveredObjectId: null }); },
  reset: () => {
    const { orientation, isRotating } = get();
    if (isRotating || get().draggingObjectId || orientation === 0) return;
    set({ pendingSteps: orientation > 2 ? 4 - orientation : -orientation, isRotating: true, hoveredObjectId: null });
  },
  finishRotation: () => set((state) => ({ orientation: normalizeTurn(state.orientation + state.pendingSteps), pendingSteps: 0, isRotating: false })),
  toggleLighting: () => set((state) => ({ lighting: state.lighting === 'day' ? 'evening' : 'day' })),
  selectObject: selectedObjectId => set({ selectedObjectId }),
  setHovered: hoveredObjectId => { if (get().hoveredObjectId !== hoveredObjectId) set({ hoveredObjectId }); },
  setDragging: draggingObjectId => set({ draggingObjectId }),
  frameRoom: dimensions => set({ camera: roomCamera(dimensions) }),
}));
