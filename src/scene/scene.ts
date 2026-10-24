import { z } from "zod";

// The scene contract (see the blueprint's "Scene contract"). Everything reads and writes this.
// Units are meters (1 grid block = 1 m), y is up, the floor is centered on the origin, and the
// listener faces -z at yaw 0 (three.js defaults).

export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;

export const RoomPreset = z.enum(["bedroom", "cafe", "forest", "library", "cabin"]);
export const ReverbPreset = z.enum(["none", "small-room", "large-room", "outdoor"]);

export const WallId = z.enum(["north", "east", "south", "west"]);
/** The room view's prop for a sound object. */
export const ModelId = z.enum(["rain", "fan", "birds", "speaker"]);

/** The room is a fixed grid of 1 m blocks drawn by the room view. The agent never chooses it. */
export const RoomGrid = z.object({
  mode: z.enum(["Square", "Rectangle"]),
  columns: z.number().int().min(4).max(24),
  rows: z.number().int().min(4).max(24),
  wallHeight: z.number().int().min(2).max(12),
});
export type RoomGrid = z.infer<typeof RoomGrid>;
export const DEFAULT_GRID: RoomGrid = { mode: "Square", columns: 10, rows: 10, wallHeight: 7 };

/** A door or window cut into a wall, in grid cells. */
export const RoomOpening = z.object({
  id: z.string().min(1),
  kind: z.enum(["door", "window"]),
  wall: WallId,
  column: z.number().int().min(0),
  level: z.number().int().min(0),
  span: z.number().int().min(1),
  height: z.number().int().min(1),
});

export const Room = z.object({
  preset: RoomPreset,
  grid: RoomGrid,
  openings: z.array(RoomOpening),
  reverb: ReverbPreset,
});
export type Room = z.infer<typeof Room>;

/** The room's extent in meters, [width (x), height (y), depth (z)], derived from its grid. */
export function roomSize(room: Pick<Room, "grid">): Vec3 {
  return [room.grid.columns, room.grid.wallHeight, room.grid.rows];
}

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
  // Room-view fields. Missing means: no specific prop, not muted, standing on the floor, scale 1.
  model: ModelId.optional(),
  /** Silences the sound without changing volume. */
  muted: z.boolean().optional(),
  /** The wall a window-mounted prop hangs on. */
  wall: WallId.nullable().optional(),
  scale: z.number().min(0.25).max(4).optional(),
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
  z.object({ op: z.literal("move"), id: z.string(), position: Vec3, wall: WallId.nullable().optional() }),
  z.object({ op: z.literal("set_volume"), id: z.string(), volume: z.number().min(0).max(1) }),
  z.object({
    op: z.literal("set_room"),
    preset: RoomPreset,
    /** The room view may reshape the room; the agent may not (api/scene.ts strips these). */
    grid: RoomGrid.optional(),
    openings: z.array(RoomOpening).optional(),
    reverb: ReverbPreset.optional(),
  }),
  z.object({ op: z.literal("set_muted"), id: z.string(), muted: z.boolean() }),
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
