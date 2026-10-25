import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Sprite } from 'three';
import { useSceneStore } from '../scene/store.js';
import { bearGround, bearSpeakers } from '../scene/speakerStack.js';
import { usePaintTexture } from './PaintedSurface.js';
import { useRoomStore } from './useRoomStore.js';
import { BEAR_VIEWS, bearDirection } from './bearDirections.js';

/** A persistent listener avatar, separate from agent-owned sound sources. */
export function BearAvatar() {
  const scene = useSceneStore(state => state.scene);
  const hidden = useRoomStore(state => state.hiddenObjectIds);
  const direction = useRoomStore(state => bearDirection(state.viewAngle));
  const backRight = usePaintTexture(BEAR_VIEWS[0].image);
  const backLeft = usePaintTexture(BEAR_VIEWS[1].image);
  const frontLeft = usePaintTexture(BEAR_VIEWS[2].image);
  const frontRight = usePaintTexture(BEAR_VIEWS[3].image);
  const texture = [backRight, backLeft, frontLeft, frontRight][direction];
  const ref = useRef<Sprite>(null);
  // Sit on the highest central cell covered by the bear's feet, including on
  // an even-sized grid where the exact room center meets four terrain cells.
  const elevation = Math.max(bearGround(scene.room), ...bearSpeakers(scene)
    .filter(object => !hidden.includes(object.id)).map(object => object.position[1] + 0.7 * object.scale));
  useFrame(() => {
    if (!ref.current) return;
    ref.current.visible = Boolean(texture?.image);
    if (texture?.image) ref.current.scale.x = 2.5 * texture.image.width / texture.image.height;
  });
  return <sprite ref={ref} name="listener-avatar" position={[0, elevation + 0.025, 0]}
    userData={{ direction: BEAR_VIEWS[direction].name }}
    scale={[2, 2.5, 1]} center={[0.5, 0.02]} visible={false} raycast={() => {}}>
    <spriteMaterial map={texture} transparent alphaTest={0.5} depthWrite toneMapped={false}/>
  </sprite>;
}
