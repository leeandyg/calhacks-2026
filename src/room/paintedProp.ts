import { ART_PX_PER_BLOCK, gridFootprint, groundHeight, isWallMountedArt, SLAB_THICKNESS } from '../scene/layout.js';
import type { Scene, SoundObject, Vec3 } from '../scene/scene.js';

/** Upright source art grows from its ground contact; attached art keeps its wall anchor. */
export function paintedPropLayout(object: SoundObject, room: Scene['room'], art: { w: number; h: number }) {
  const mounted = isWallMountedArt(object);
  const position: Vec3 = mounted ? object.position : [object.position[0], groundHeight(object.position, room), object.position[2]];
  const xSpace = room.grid.columns / 2 - SLAB_THICKNESS / 2 - Math.abs(position[0]);
  const zSpace = room.grid.rows / 2 - SLAB_THICKNESS / 2 - Math.abs(position[2]);
  const halfSpan = mounted ? (object.wall === 'north' || object.wall === 'south' ? xSpace : zSpace) : Math.min(xSpace, zSpace);
  // A standing billboard can turn through any yaw; its whole width must fit inside the slabs.
  const width = Math.min(art.w / ART_PX_PER_BLOCK, gridFootprint(object).columns / object.scale, Math.max(0.01, halfSpan * 2 / object.scale));
  const height = width * art.h / art.w;
  return { mounted, position, width, height, offsetY: mounted ? 0 : height / 2 };
}
