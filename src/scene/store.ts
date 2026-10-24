import { create } from "zustand";
import { ZodError } from "zod";
import { starter } from "./fixtures.js";
import { placeObject, wallLength } from "./layout.js";
import { EditOp, MAX_OBJECTS, Scene, roomSize, type EditOpInput, type Room, type SceneInput, type SoundObject, type Vec3 } from "./scene.js";

// The one place scene state lives. The room view and the audio engine render whatever is here;
// drags, the agent and presets change it only through setScene / applyOps. Both are all or
// nothing: an invalid scene or op batch leaves the store unchanged and returns the error.

export type MutationResult = { ok: true } | { ok: false; error: string };

type SceneState = {
  scene: Scene;
  setScene: (scene: SceneInput) => MutationResult;
  applyOps: (ops: EditOpInput[]) => MutationResult;
};

export const useSceneStore = create<SceneState>()((set, get) => ({
  scene: prepare(starter),
  setScene: (scene) => mutate(() => set({ scene: prepare(scene) })),
  applyOps: (ops) =>
    mutate(() => {
      const next = EditOp.array().parse(ops).reduce(applyOp, get().scene);
      validateScene(next);
      set({ scene: next });
    }),
}));

/**
 * Pure: returns a new scene with one op applied, snapped to the room's grid. Unchanged objects keep
 * their references, so a drag only re-renders the dragged prop. Throws on an unknown id.
 */
export function applyOp(scene: Scene, op: EditOp): Scene {
  switch (op.op) {
    case "add": {
      // Replaces an object with the same id in place: the resolver fills in assetIds this way.
      const index = scene.objects.findIndex((o) => o.id === op.object.id);
      if (index < 0 && scene.objects.length >= MAX_OBJECTS) throw new Error(`A room holds at most ${MAX_OBJECTS} sounds.`);
      const objects = index < 0 ? [...scene.objects, op.object] : scene.objects.map((o, i) => (i === index ? op.object : o));
      return clampScene({ ...scene, objects });
    }
    case "remove":
      findObject(scene, op.id);
      return { ...scene, objects: scene.objects.filter((o) => o.id !== op.id) };
    case "move":
      return updateObject(scene, op.id, (o) => ({
        ...o,
        position: clampPosition(op.position, scene.room),
        wall: op.wall === undefined ? o.wall : op.wall,
      }));
    case "set_volume":
      return updateObject(scene, op.id, (o) => ({ ...o, volume: op.volume }));
    case "set_muted":
      return updateObject(scene, op.id, (o) => ({ ...o, muted: op.muted }));
    case "set_room": {
      const room: Room = {
        preset: op.preset,
        grid: op.grid ?? scene.room.grid,
        openings: op.openings ?? scene.room.openings,
        reverb: op.reverb ?? scene.room.reverb,
      };
      return clampScene({ ...scene, room });
    }
  }
}

function findObject(scene: Scene, id: string): SoundObject {
  const object = scene.objects.find((o) => o.id === id);
  if (!object) throw new Error(`No sound has id "${id}".`);
  return object;
}

function updateObject(scene: Scene, id: string, fn: (o: SoundObject) => SoundObject): Scene {
  const object = findObject(scene, id);
  const next = placeObject(fn(object), scene.room.grid);
  return { ...scene, objects: scene.objects.map((o) => (o === object ? next : o)) };
}

/** Keeps x and z inside the floor and y between the floor and the ceiling (bounds from the grid). */
export function clampPosition([x, y, z]: Vec3, room: Pick<Room, "grid">): Vec3 {
  const [w, h, d] = roomSize(room);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return [clamp(x, -w / 2, w / 2), clamp(y, 0, h), clamp(z, -d / 2, d / 2)];
}

/** Snaps every object onto the grid (windows onto a wall), keeping references that don't move. */
export function clampScene(scene: Scene): Scene {
  const listener = { ...scene.listener, position: clampPosition(scene.listener.position, scene.room) };
  const same = listener.position.every((v, i) => v === scene.listener.position[i]);
  return { ...scene, listener: same ? scene.listener : listener, objects: scene.objects.map((o) => placeObject(o, scene.room.grid)) };
}

function prepare(input: SceneInput): Scene {
  const scene = clampScene(Scene.parse(input));
  validateScene(scene);
  return scene;
}

/** Rules zod can't express on its own: unique ids and openings that fit their wall. */
function validateScene(scene: Scene) {
  Scene.parse(scene);
  if (new Set(scene.objects.map((o) => o.id)).size !== scene.objects.length) throw new Error("Every sound must have a unique id.");
  const { grid, openings } = scene.room;
  if (grid.mode === "Square" && grid.columns !== grid.rows) throw new Error("A Square room needs equal columns and rows.");
  if (new Set(openings.map((o) => o.id)).size !== openings.length) throw new Error("Every opening must have a unique id.");
  for (const o of openings) {
    if (o.kind === "door" && o.level !== 0) throw new Error(`Door ${o.id} must start at floor level.`);
    if (o.column + o.span > wallLength(o.wall, grid) || o.level + o.height > grid.wallHeight) throw new Error(`Opening ${o.id} doesn't fit its wall.`);
  }
}

function mutate(change: () => void): MutationResult {
  try {
    change();
    return { ok: true };
  } catch (error) {
    const message = error instanceof ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : undefined;
    return { ok: false, error: message ?? "The scene could not be updated." };
  }
}
