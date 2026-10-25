import type { Scene, SoundObject } from '../src/scene/scene.js';
import { gridFootprint, isWallMountedArt, placeInRoom } from '../src/scene/layout.js';

export const AGENT_PLACEMENT_RULES = `The Berkeley bear is the USER, permanently centered at x=0,z=0, and is supplied by the app. NEVER generate, replace, move, delete, or duplicate the bear. NEVER place a source at the middle. Reserve a 1-meter-radius clear space around x=0,z=0; the complete scaled source must stay outside it. For standing props, keep horizontal distance from the center at least 1 + half the scaled footprint width. Use edges, corners, and the surrounding floor instead. Keep central terrain flat and unobstructed; do not paint an object or duplicate avatar into the central floor.
Choose each object's scale deliberately from 1 to 4 inclusive (1x–4x); use varied sizes appropriate to the physical source, not scale=1 for everything. Scale multiplies the base prop size. Account for the complete scaled footprint, room bounds, and bear clearance. Choose a smaller scale within that range when a larger prop cannot fit. On edits, preserve unrelated manual positions and existing scales.`;

/** Agent-only placement guard; manual moves and unrelated edits remain untouched. */
export function placeAgentObject(object: SoundObject, room: Scene['room'], chooseScale = true): SoundObject {
  const placed = placeInRoom(chooseScale ? { ...object, scale: Math.max(1, Math.min(4, object.scale)) } : object, room);
  const footprint = gridFootprint(placed);
  const clearance = 1 + Math.max(footprint.columns, footprint.rows) / 2;
  const clear = (candidate: SoundObject) => isWallMountedArt(candidate)
    || Math.hypot(candidate.position[0], candidate.position[2]) >= clearance - 1e-8;
  if (clear(placed)) return placed;
  let best: SoundObject | undefined, distance = Infinity;
  for (let row = 0; row < room.grid.rows; row++) {
    for (let column = 0; column < room.grid.columns; column++) {
      const candidate = placeInRoom({ ...placed, position: [column + 0.5 - room.grid.columns / 2, placed.position[1], row + 0.5 - room.grid.rows / 2] }, room);
      if (!clear(candidate)) continue;
      const delta = Math.hypot(candidate.position[0] - placed.position[0], candidate.position[2] - placed.position[2]);
      if (delta < distance) { best = candidate; distance = delta; }
    }
  }
  if (!best) throw new Error('This source cannot fit outside the bear’s reserved center. Use a smaller scale or a wall-mounted source.');
  return best;
}
