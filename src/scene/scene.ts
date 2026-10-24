import { z } from "zod";

// The scene contract (see the blueprint's "Scene contract"). Everything reads and writes this.
// Units are meters (1 grid block = 1 m), y is up, the floor is centered on the origin, and the
// listener faces -z at yaw 0 (three.js defaults).

export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;

export const RoomPreset = z.enum(["bedroom", "cafe", "forest", "library", "cabin"]);
export type RoomPreset = z.infer<typeof RoomPreset>;
export const ReverbPreset = z.enum(["none", "small-room", "large-room", "outdoor"]);
export type ReverbPreset = z.infer<typeof ReverbPreset>;

export const WallId = z.enum(["north", "east", "south", "west"]);
export type WallId = z.infer<typeof WallId>;
/** The room view's prop for a sound object: a rain window, fan, birds on a perch, or a speaker. */
export const ModelId = z.enum(["rain", "fan", "birds", "speaker"]);
export type ModelId = z.infer<typeof ModelId>;

/** The room is a fixed grid of 1 m blocks drawn by the room view. The agent never chooses it. */
export const RoomGrid = z.object({
  mode: z.enum(["Square", "Rectangle"]),
  columns: z.number().int().min(4).max(24),
  rows: z.number().int().min(4).max(24),
  wallHeight: z.number().int().min(2).max(12),
}).strict(); // no segment sizes, floor masks or other shapes
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
export type RoomOpening = z.infer<typeof RoomOpening>;

/** Ground height of each floor cell in blocks, [row][column] (row 0 is the north edge). */
export const TERRAIN_MAX = 1.5;
export const Terrain = z.array(z.array(z.number().min(0).max(TERRAIN_MAX)));
export type Terrain = z.infer<typeof Terrain>;

export const Room = z.object({
  preset: RoomPreset,
  grid: RoomGrid,
  openings: z.array(RoomOpening),
  reverb: ReverbPreset,
  /** The painted environment (api/environment.ts); its textures stay in the browser (src/art/). */
  art: z.string().min(1).max(80).optional(),
  /** Uneven ground painted with the environment. Missing means a flat floor. */
  terrain: Terrain.optional(),
}).strict(); // no room.size that could disagree with the grid (#49)
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
  // Room-view fields. A missing model is derived from the sound's query (src/scene/layout.ts).
  model: ModelId.optional(),
  /** Silences the sound without changing volume. */
  muted: z.boolean().default(false),
  /** The wall a prop is mounted on or snapped against; null stands on the floor. */
  wall: WallId.nullable().default(null),
  scale: z.number().min(0.25).max(4).default(1),
};

export const BedObject = z.object({ ...objectFields, kind: z.literal("bed") });
export const EventObject = z.object({
  ...objectFields,
  kind: z.literal("event"),
  /** Random delay between plays, [min, max] seconds. */
  intervalSec: z.tuple([z.number().positive(), z.number().positive()])
    .refine(([min, max]) => min <= max, "The minimum interval must not exceed the maximum."),
});
export const SoundObject = z.discriminatedUnion("kind", [BedObject, EventObject]);
export type SoundObject = z.infer<typeof SoundObject>;

export const MAX_OBJECTS = 12;

export const Session = z.object({
  task: z.string(),
  mode: z.enum(["focus", "break"]),
  minutesLeft: z.number().min(0),
});

export const Scene = z.object({
  room: Room,
  listener: Listener,
  objects: z.array(SoundObject).max(MAX_OBJECTS),
  session: Session.optional(),
});
export type Scene = z.infer<typeof Scene>;
/** A scene before defaults (muted, wall, scale) are filled in, e.g. a hand-written fixture. */
export type SceneInput = z.input<typeof Scene>;

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
/** An op before defaults are filled in, e.g. an added object without muted/wall/scale. */
export type EditOpInput = z.input<typeof EditOp>;

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
