import { create } from 'zustand';
import { normalizeTurn } from './easing.js';
import type { Vec3 } from './types.js';
import { DEFAULT_ROOM_GRID, getRoomDimensions, roomCamera, type RoomDimensions } from '../scene/layout.js';
interface RoomState {
  orientation: number;
  pendingSteps: number;
  isRotating: boolean;
  selectedObjectId: string | null;
  draggingObjectId: string | null;
  /** View-only: sources hidden from the environment through the Assets panel. They are also muted
   *  (silence goes through the scene store), but their props and portals are not rendered at all. */
  hiddenObjectIds: string[];
  lighting: 'day' | 'evening';
  /** View-only room rotation in radians, including mid-turn. Audio stays in canonical coordinates. */
  viewAngle: number;
  camera: { position: Vec3; target: Vec3 };
  rotate: (direction: 'left' | 'right') => void;
  reset: () => void;
  finishRotation: () => void;
  toggleLighting: () => void;
  selectObject: (id: string | null) => void;
  setDragging: (id: string | null) => void;
  setHidden: (id: string, hidden: boolean) => void;
  frameRoom: (dimensions: RoomDimensions) => void;
}
export const useRoomStore = create<RoomState>((set, get) => ({
  orientation: 0, pendingSteps: 0, isRotating: false, lighting: 'day', viewAngle: 0,
  selectedObjectId: null, draggingObjectId: null, hiddenObjectIds: [],
  camera: roomCamera(getRoomDimensions(DEFAULT_ROOM_GRID)),
  rotate: (direction) => { if (!get().isRotating && !get().draggingObjectId) set({ pendingSteps: direction === 'right' ? -1 : 1, isRotating: true }); },
  reset: () => {
    const { orientation, isRotating } = get();
    if (isRotating || get().draggingObjectId || orientation === 0) return;
    set({ pendingSteps: orientation > 2 ? 4 - orientation : -orientation, isRotating: true });
  },
  finishRotation: () => set((state) => ({ orientation: normalizeTurn(state.orientation + state.pendingSteps), pendingSteps: 0, isRotating: false })),
  toggleLighting: () => set((state) => ({ lighting: state.lighting === 'day' ? 'evening' : 'day' })),
  selectObject: selectedObjectId => set({ selectedObjectId }),
  setDragging: draggingObjectId => set({ draggingObjectId }),
  setHidden: (id, hidden) => set(state => ({ hiddenObjectIds: hidden ? [...new Set([...state.hiddenObjectIds, id])] : state.hiddenObjectIds.filter(hiddenId => hiddenId !== id) })),
  frameRoom: dimensions => set({ camera: roomCamera(dimensions) }),
}));
