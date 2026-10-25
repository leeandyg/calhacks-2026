import { groundHeight, isWallMountedArt, SLAB_THICKNESS, WALL_ROTATIONS } from '../scene/layout.js';
import type { Scene, SoundObject, Vec3 } from '../scene/scene.js';

/** PlaneGeometry faces local +Z; rotate its normal onto the actual supporting surface. */
export function portalSurface(object: SoundObject, room: Scene['room']) {
  const mounted = isWallMountedArt(object);
  const position: Vec3 = [...object.position];
  if (mounted && object.wall) {
    const inset = SLAB_THICKNESS / 2 + 0.025;
    if (object.wall === 'north') position[2] = -room.grid.rows / 2 + inset;
    if (object.wall === 'south') position[2] = room.grid.rows / 2 - inset;
    if (object.wall === 'east') position[0] = room.grid.columns / 2 - inset;
    if (object.wall === 'west') position[0] = -room.grid.columns / 2 + inset;
  } else position[1] = groundHeight(position, room) + 0.025;
  const rotation: Vec3 = mounted && object.wall ? [0, WALL_ROTATIONS[object.wall], 0] : [-Math.PI / 2, 0, 0];
  return { position, rotation };
}
