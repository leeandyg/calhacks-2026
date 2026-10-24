import { useRoomStore } from '../../store/useRoomStore';

export function RotationArrows() {
  const busy = useRoomStore(state => state.isRotating || !!state.draggingObjectId);
  const rotate = useRoomStore(state => state.rotate);
  return <div className="room-rotation">
    {(['left', 'right'] as const).map(direction => <button key={direction} type="button" className="rotate-room" onClick={() => rotate(direction)} disabled={busy} aria-label={`Rotate ${direction === 'left' ? 'Left' : 'Right'}`}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={direction === 'left' ? 'M19 12H5m7 7-7-7 7-7' : 'M5 12h14m-7-7 7 7-7 7'}/>
      </svg>
    </button>)}
  </div>;
}
