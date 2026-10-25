import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group } from 'three';
import { useRoomStore } from './useRoomStore.js';
import { easeInOutCubic, QUARTER_TURN, ROTATION_DURATION } from './easing.js';
import type { RoomConfig } from './types.js';
import { Floor } from './Floor.js';
import { Wall } from './Wall.js';
import { SoundObjects } from './SoundObjects.js';
import { GenerationSurfaces } from './GenerationSurfaces.js';
import { BearAvatar } from './BearAvatar.js';

export function RoomGroup({ config, loading = false }: { config: RoomConfig; loading?: boolean }) {
  const group = useRef<Group>(null);
  const animation = useRef<{ start: number; end: number; elapsed: number } | null>(null);
  useFrame((_, delta) => {
    if (!group.current) return;
    const state = useRoomStore.getState();
    if (state.isRotating && !animation.current) {
      animation.current = { start: state.orientation * QUARTER_TURN, end: (state.orientation + state.pendingSteps) * QUARTER_TURN, elapsed: 0 };
    }
    const active = animation.current;
    if (active) {
      active.elapsed += delta;
      const progress = Math.min(active.elapsed / ROTATION_DURATION, 1);
      group.current.rotation.y = active.start + (active.end - active.start) * easeInOutCubic(progress);
      if (progress === 1) {
        state.finishRotation();
        group.current.rotation.y = useRoomStore.getState().orientation * QUARTER_TURN;
        animation.current = null;
      }
    } else group.current.rotation.y = state.orientation * QUARTER_TURN;
    if (group.current.rotation.y !== useRoomStore.getState().viewAngle) useRoomStore.setState({ viewAngle: group.current.rotation.y });
    // Wall callbacks run after this callback and use the current frame's transform.
    group.current.updateMatrixWorld(true);
  }, -2);
  return <group ref={group} name="room">
    <Floor config={config}/>
    {loading ? <group name="sound-objects"/> : <SoundObjects/>}
    {config.walls.map(wall => <Wall key={wall.id} wall={wall} config={config}/>)}
    {loading && <GenerationSurfaces config={config}/>}
    {!loading && <BearAvatar/>}
  </group>;
}
