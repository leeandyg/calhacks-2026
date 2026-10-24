import { beforeEach, describe, expect, it } from 'vitest';
import { useRoomStore } from './useRoomStore';
describe('discrete room rotation', () => {
  beforeEach(() => useRoomStore.setState({ orientation: 0, isRotating: false, pendingSteps: 0, draggingObjectId: null, selectedObjectId: null }));
  it.each(['left', 'right'] as const)('returns exactly home after four %s turns', direction => {
    for (let i = 0; i < 4; i++) { useRoomStore.getState().rotate(direction); useRoomStore.getState().finishRotation(); }
    expect(useRoomStore.getState().orientation).toBe(0);
  });
  it('uses negative Y for clockwise right rotation viewed from above', () => {
    useRoomStore.getState().rotate('right');
    expect(useRoomStore.getState().pendingSteps).toBe(-1);
  });
  it('locks rotation while a sound is being dragged', () => {
    useRoomStore.getState().setDragging('rain-1');
    useRoomStore.getState().rotate('right');
    expect(useRoomStore.getState().isRotating).toBe(false);
    useRoomStore.getState().setDragging(null);
    useRoomStore.getState().rotate('right');
    expect(useRoomStore.getState().isRotating).toBe(true);
  });
  it('ignores commands during animation, including reset', () => {
    const state = useRoomStore.getState();
    state.rotate('right'); state.rotate('left'); state.reset();
    expect(useRoomStore.getState().pendingSteps).toBe(-1);
    state.finishRotation();
    expect(useRoomStore.getState().orientation).toBe(3);
  });
  it('returns home after alternating turns without drift', () => {
    for (let i = 0; i < 1000; i++) { useRoomStore.getState().rotate(i % 2 ? 'left' : 'right'); useRoomStore.getState().finishRotation(); }
    expect(useRoomStore.getState().orientation).toBe(0);
  });
  it.each([1, 2, 3])('resets orientation %i using at most a half turn', orientation => {
    useRoomStore.setState({ orientation });
    useRoomStore.getState().reset();
    expect(Math.abs(useRoomStore.getState().pendingSteps)).toBeLessThanOrEqual(2);
    useRoomStore.getState().finishRotation();
    expect(useRoomStore.getState().orientation).toBe(0);
  });
});
