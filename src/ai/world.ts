import { z } from 'zod';
import { SceneResponse, Terrain, WallId } from '../scene/scene.js';

const hex = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const Animation = z.object({ frames: z.number().int().min(1).max(32).default(1), fps: z.number().min(1).max(24).default(10) });
const filename = z.string().max(180).regex(/^[a-zA-Z0-9_-]+\.(png|wav|mp3|ogg)$/);
export const ImageOutput = Animation.extend({ file: filename, w: z.number().int().min(1).max(384), h: z.number().int().min(1).max(384) });
const surfaces = z.object({ floor: ImageOutput.optional(), north: ImageOutput.optional(), east: ImageOutput.optional(), south: ImageOutput.optional(), west: ImageOutput.optional() });
/** Files produced in the managed sandbox; never executed by the app server or browser. */
export const WorldOutput = z.object({
  version: z.literal(1),
  turn: z.string().regex(/^r_[a-f0-9]{16}$/),
  response: SceneResponse,
  environment: z.object({
    concept: z.string().min(1).max(1500), shell: hex, colors: z.array(hex).min(2).max(48),
    openAir: z.boolean().default(false), terrain: Terrain.optional(), textures: surfaces,
  }).optional(),
  sprites: z.array(ImageOutput.extend({ objectId: z.string().min(1).max(120) })).max(12).default([]),
  sounds: z.array(z.object({ objectId: z.string().min(1).max(120), file: filename })).max(12).default([]),
});
export type WorldOutput = z.infer<typeof WorldOutput>;

// A file through the session's /api/world proxy, or its copy kept in Convex file storage (#112).
const assetUrl = z.string().refine(url => url.startsWith('/api/world?') || /^https:\/\/[a-z0-9-]+\.convex\.cloud\/api\/storage\/[\w-]+$/.test(url), 'Unknown asset URL');
const runtimeImage = ImageOutput.omit({ file: true }).extend({ url: assetUrl });
export const ManagedAssets = z.object({
  envId: z.string(),
  environment: WorldOutput.shape.environment.unwrap().omit({ textures: true }).extend({
    textures: z.partialRecord(z.enum(['floor', ...WallId.options]), runtimeImage).optional(),
  }).optional(),
  sprites: z.array(runtimeImage.extend({ objectId: z.string(), label: z.string(), query: z.string(), wall: WallId.nullable() })),
  sounds: z.array(z.object({ objectId: z.string(), query: z.string(), kind: z.enum(['bed', 'event']), fileId: z.string(), url: assetUrl })),
});
export type ManagedAssets = z.infer<typeof ManagedAssets>;
export const ManagedResult = z.object({ response: SceneResponse, assets: ManagedAssets });
export type ManagedResult = z.infer<typeof ManagedResult>;
