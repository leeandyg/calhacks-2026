import { z } from "zod";

// The scene contract (see the blueprint's "Scene contract"). Everything reads and writes this.
// Units are meters, y is up, and the listener sits at the origin facing -z (three.js defaults).

export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;

export const RoomPreset = z.enum(["bedroom", "cafe", "forest", "library", "cabin"]);
export const ReverbPreset = z.enum(["none", "small-room", "large-room", "outdoor"]);

export const Room = z.object({
  preset: RoomPreset,
  size: Vec3,
  reverb: ReverbPreset,
});
export type Room = z.infer<typeof Room>;

export const Listener = z.object({
  position: Vec3,
  /** Radians, counterclockwise seen from above; 0 faces -z. */
  yaw: z.number(),
});
export type Listener = z.infer<typeof Listener>;

export const SoundRef = z.object({
  /** What the agent wants, in words. */
  query: z.string().min(1),
  /** Filled in by the resolver, never by the agent. */
  assetId: z.string().optional(),
});

const objectFields = {
  id: z.string().min(1),
  label: z.string().min(1),
  sound: SoundRef,
  position: Vec3,
  volume: z.number().min(0).max(1),
};

export const BedObject = z.object({ ...objectFields, kind: z.literal("bed") });
export const EventObject = z.object({
  ...objectFields,
  kind: z.literal("event"),
  /** Random delay between plays, [min, max] seconds. */
  intervalSec: z.tuple([z.number().positive(), z.number().positive()]),
});
export const SoundObject = z.discriminatedUnion("kind", [BedObject, EventObject]);
export type SoundObject = z.infer<typeof SoundObject>;

export const Session = z.object({
  task: z.string(),
  mode: z.enum(["focus", "break"]),
  minutesLeft: z.number().min(0),
});

export const Scene = z.object({
  room: Room,
  listener: Listener,
  objects: z.array(SoundObject),
  session: Session.optional(),
});
export type Scene = z.infer<typeof Scene>;

// Edit ops, applied in order. Agent edits and manual drags both use these.
export const EditOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), object: SoundObject }),
  z.object({ op: z.literal("remove"), id: z.string() }),
  z.object({ op: z.literal("move"), id: z.string(), position: Vec3 }),
  z.object({ op: z.literal("set_volume"), id: z.string(), volume: z.number().min(0).max(1) }),
  z.object({
    op: z.literal("set_room"),
    preset: RoomPreset,
    size: Vec3.optional(),
    reverb: ReverbPreset.optional(),
  }),
]);
export type EditOp = z.infer<typeof EditOp>;

// POST /api/scene
export const SceneRequest = z.object({
  prompt: z.string().min(1),
  /** The current scene, so the agent edits instead of starting over. Null on the first prompt. */
  scene: Scene.nullable(),
});
export type SceneRequest = z.infer<typeof SceneRequest>;

export const SceneResponse = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), scene: Scene }),
  z.object({ kind: z.literal("edit"), ops: z.array(EditOp) }),
]);
export type SceneResponse = z.infer<typeof SceneResponse>;
