import { z } from 'zod';
import { MODEL_IDS, WALL_IDS, placeObject } from './layout';

export const MAX_SOUND_OBJECTS = 12;
export const PositionSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const RoomPresetSchema = z.enum(['bedroom', 'cafe', 'cabin', 'forest', 'library']);
export const ReverbSchema = z.enum(['dry', 'small-room', 'warm-room', 'outdoor']);
export const RoomGridSchema = z.object({
  mode: z.enum(['Square', 'Rectangle']),
  columns: z.number().int().min(4).max(24),
  rows: z.number().int().min(4).max(24),
  wallHeight: z.number().int().min(2).max(12),
}).strict().refine(grid => grid.mode !== 'Square' || grid.columns === grid.rows, 'Square blueprints require equal column and row counts.');
export const RoomOpeningSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  kind: z.enum(['door', 'window']),
  wall: z.enum(WALL_IDS),
  column: z.number().int().min(0),
  level: z.number().int().min(0),
  span: z.number().int().min(1),
  height: z.number().int().min(1),
}).strict().refine(opening => opening.kind !== 'door' || opening.level === 0, 'Doors must start at floor level.');
export const RoomSchema = z.object({
  preset: RoomPresetSchema,
  grid: RoomGridSchema,
  openings: z.array(RoomOpeningSchema).max(32).default([]),
  reverb: ReverbSchema,
}).strict().refine(room => new Set(room.openings.map(opening => opening.id)).size === room.openings.length && room.openings.every(opening => opening.column + opening.span <= (opening.wall === 'north' || opening.wall === 'south' ? room.grid.columns : room.grid.rows) && opening.level + opening.height <= room.grid.wallHeight), 'Openings must have unique IDs and fit their wall segments.');
const soundSchema = z.object({ query: z.string().trim().min(1).max(240), assetId: z.string().min(1).max(80).optional() }).strict();
const objectFields = {
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  label: z.string().trim().min(1).max(60),
  sound: soundSchema,
  position: PositionSchema,
  volume: z.number().finite().min(0).max(1),
  model: z.enum(MODEL_IDS).optional(),
  muted: z.boolean().default(false),
  wall: z.enum(WALL_IDS).nullable().default(null),
  scale: z.number().finite().min(0.25).max(4).default(1),
};
export const IntervalSchema = z.tuple([z.number().min(1).max(3600), z.number().min(1).max(3600)])
  .refine(([minimum, maximum]) => minimum <= maximum, 'The minimum interval must not exceed the maximum.');
export const BedSchema = z.object({ ...objectFields, kind: z.literal('bed') }).strict();
export const EventSchema = z.object({ ...objectFields, kind: z.literal('event'), intervalSec: IntervalSchema }).strict();
export const SoundObjectSchema = z.discriminatedUnion('kind', [BedSchema, EventSchema]);
export const ListenerSchema = z.object({ position: PositionSchema, yaw: z.number().finite() }).strict();
const sceneFields = {
  room: RoomSchema,
  listener: ListenerSchema,
  objects: z.array(SoundObjectSchema).max(MAX_SOUND_OBJECTS),
  session: z.object({ task: z.string().max(240), mode: z.enum(['focus', 'break']), minutesLeft: z.number().finite().min(0).max(240) }).strict(),
};
const uniqueIds = (scene: { objects: { id: string }[] }) => new Set(scene.objects.map(object => object.id)).size === scene.objects.length;
export const SceneSchema = z.object(sceneFields).strict().refine(uniqueIds, 'Every sound object must have a unique id.');

// Agents describe sounds; only the resolver is allowed to populate assetId.
const agentSound = soundSchema.omit({ assetId: true });
export const AgentSoundObjectSchema = z.discriminatedUnion('kind', [
  BedSchema.extend({ sound: agentSound }), EventSchema.extend({ sound: agentSound }),
]);
export const CreateSceneSchema = z.object({ ...sceneFields, objects: z.array(AgentSoundObjectSchema).max(MAX_SOUND_OBJECTS) }).strict().refine(uniqueIds, 'Every sound object must have a unique id.');
export const EditOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), object: AgentSoundObjectSchema }).strict(),
  z.object({ op: z.literal('remove'), id: objectFields.id }).strict(),
  z.object({ op: z.literal('move'), id: objectFields.id, position: PositionSchema, wall: z.enum(WALL_IDS).nullable().optional() }).strict(),
  z.object({ op: z.literal('set_volume'), id: objectFields.id, volume: objectFields.volume }).strict(),
  z.object({ op: z.literal('set_muted'), id: objectFields.id, muted: z.boolean() }).strict(),
  z.object({ op: z.literal('set_room'), preset: RoomPresetSchema, grid: RoomGridSchema.optional(), openings: z.array(RoomOpeningSchema).max(32).optional(), reverb: ReverbSchema.optional() }).strict(),
]);
export const EditSceneSchema = z.array(EditOperationSchema).min(1).max(64);

export type Scene = z.infer<typeof SceneSchema>;
export type SceneInput = z.input<typeof SceneSchema>;
export type RoomGrid = z.infer<typeof RoomGridSchema>;
export type RoomOpening = z.infer<typeof RoomOpeningSchema>;
export type SoundObject = z.infer<typeof SoundObjectSchema>;
export type RoomPreset = z.infer<typeof RoomPresetSchema>;
export type EditOperation = z.infer<typeof EditOperationSchema>;
export type Position = z.infer<typeof PositionSchema>;
export type ReverbPreset = z.infer<typeof ReverbSchema>;
export type MutationResult = { ok: true } | { ok: false; error: string };

// Fixed renderer units represent modular blocks, not user-defined metric input.
export function clampPosition(position: Position, size: [number, number, number]): Position {
  return [Math.max(-size[0] / 2 + 0.35, Math.min(size[0] / 2 - 0.35, position[0])), Math.max(0, Math.min(size[1], position[1])), Math.max(-size[2] / 2 + 0.35, Math.min(size[2] / 2 - 0.35, position[2]))];
}
export function clampScene(scene: Scene): Scene {
  const clamp = <T extends { position: Position }>(object: T): T => {
    const position = clampPosition(object.position, [scene.room.grid.columns, scene.room.grid.wallHeight, scene.room.grid.rows]);
    return position.every((value, index) => value === object.position[index]) ? object : { ...object, position };
  };
  return { ...scene, listener: clamp(scene.listener), objects: scene.objects.map(object => placeObject(object, scene.room.grid)) };
}
