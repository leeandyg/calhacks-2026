import { useRoomStore } from '../room/useRoomStore.js';
import { PixelIcon } from './PixelIcon.js';

export function RotationArrows() {
  const busy = useRoomStore(state => state.isRotating || !!state.draggingObjectId);
  const rotate = useRoomStore(state => state.rotate);
  return <div className="room-rotation">
    {(['left', 'right'] as const).map(direction => <button key={direction} type="button" className="rotate-room" onClick={() => rotate(direction)} disabled={busy} aria-label={`Rotate ${direction === 'left' ? 'Left' : 'Right'}`}>
      <PixelIcon name={direction} size={32}/>
    </button>)}
  </div>;
}
