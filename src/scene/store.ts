import { create } from "zustand";
import { cafe } from "./fixtures.js";
import { EditOp, Scene, type Room, type SoundObject, type Vec3 } from "./scene.js";

// The one place scene state lives. The room view and the audio engine render whatever is here;
// drags, the agent and presets change it only through setScene / applyOps.

type SceneState = {
  scene: Scene;
  setScene: (scene: Scene) => void;
  applyOps: (ops: EditOp[]) => void;
};

export const useSceneStore = create<SceneState>()((set) => ({
  scene: cafe,
  setScene: (scene) => set({ scene: clampScene(Scene.parse(scene)) }),
  applyOps: (ops) =>
    set((state) => ({ scene: EditOp.array().parse(ops).reduce(applyOp, state.scene) })),
}));

/** Pure: returns a new scene with one op applied. Unknown ids are ignored. */
export function applyOp(scene: Scene, op: EditOp): Scene {
  switch (op.op) {
    case "add": {
      const object = clampObject(op.object, scene.room);
      const others = scene.objects.filter((o) => o.id !== object.id);
      return { ...scene, objects: [...others, object] };
    }
    case "remove":
      return { ...scene, objects: scene.objects.filter((o) => o.id !== op.id) };
    case "move":
      return updateObject(scene, op.id, (o) => ({ ...o, position: clampPosition(op.position, scene.room) }));
    case "set_volume":
      return updateObject(scene, op.id, (o) => ({ ...o, volume: op.volume }));
    case "set_room": {
      const room: Room = {
        preset: op.preset,
        size: op.size ?? scene.room.size,
        reverb: op.reverb ?? scene.room.reverb,
      };
      return clampScene({ ...scene, room });
    }
  }
}

function updateObject(scene: Scene, id: string, fn: (o: SoundObject) => SoundObject): Scene {
  if (!scene.objects.some((o) => o.id === id)) {
    console.warn(`scene: no object "${id}"`);
    return scene;
  }
  return { ...scene, objects: scene.objects.map((o) => (o.id === id ? fn(o) : o)) };
}

/** Keeps x and z inside the floor and y between the floor and the ceiling. */
export function clampPosition([x, y, z]: Vec3, room: Room): Vec3 {
  const [w, h, d] = room.size;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return [clamp(x, -w / 2, w / 2), clamp(y, 0, h), clamp(z, -d / 2, d / 2)];
}

function clampObject(object: SoundObject, room: Room): SoundObject {
  return { ...object, position: clampPosition(object.position, room) };
}

function clampScene(scene: Scene): Scene {
  return { ...scene, objects: scene.objects.map((o) => clampObject(o, scene.room)) };
}
