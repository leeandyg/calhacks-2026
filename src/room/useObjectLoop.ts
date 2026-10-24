import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';

/** A finite 16-frame / 1.6s local loop. Mute freezes the current pose. */
export function useObjectLoop(enabled: boolean, update: (frame: number, phase: number) => void) {
  const elapsed = useRef(0);
  const previous = useRef(-1);
  useFrame((_, delta) => {
    if (enabled) elapsed.current = (elapsed.current + delta) % 1.6;
    const frame = Math.floor(elapsed.current * 10) % 16;
    if (frame !== previous.current) {
      update(frame, frame / 16);
      previous.current = frame;
    }
  });
}
