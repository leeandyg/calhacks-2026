import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api.js";
import { action, internalMutation, query, type QueryCtx } from "./_generated/server.js";
import { ManagedAssets } from "../src/ai/world.js";
import { mergeWorld, ownsWorld, rewriteUrls, worldFiles, type WorldFile } from "../src/ai/worldFiles.js";

// Claude agent worlds, kept after their 24-hour session (#112). A world's artwork and chirp sounds live
// in Anthropic's session storage behind /api/world; this copies each file into Convex file storage once
// and keeps one manifest per world (room.art), so a reload, a saved room or a remembered "usual setup"
// shows and plays the world as it was generated. The browser calls `save` right after a world arrives
// (src/ai/managedClient.ts) and reads `world` / `file` to restore it.
//
// No secret is needed: Convex fetches each file from the app's own /api/world proxy with the world's
// signed token, which only our server can issue and which only serves that session's files, and it
// accepts a world id only for that token's session.

const APP_ORIGIN = "https://calhacks-2026.vercel.app";
const MAX_BYTES = 4 * 1024 * 1024; // the proxy's own limit
const FETCH_TIMEOUT_MS = 20_000;
const FILE_TYPES = /^(image\/png|audio\/(wav|ogg|mpeg))$/;

function findFile(ctx: QueryCtx, fileId: string) {
  return ctx.db.query("agentFiles").withIndex("by_file", (q) => q.eq("fileId", fileId)).unique();
}

/** Copies a fresh world's files into file storage and merges its manifest into the kept world. */
export const save = action({
  args: { envId: v.string(), assets: v.any() },
  handler: async (ctx, { envId, assets }) => {
    const parsed = ManagedAssets.safeParse(assets);
    if (!parsed.success || parsed.data.envId !== envId) throw new ConvexError("These world assets are invalid.");
    const files = worldFiles(parsed.data);
    if (!files.length) throw new ConvexError("This world has no files to keep.");
    if (!files.every((file) => ownsWorld(file.token, envId))) throw new ConvexError("These files belong to a different world.");
    const keep = async (file: WorldFile): Promise<string> => {
      const kept = await ctx.runQuery(api.agentWorlds.file, { fileId: file.fileId });
      if (kept) return kept;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(APP_ORIGIN + file.url, { signal: abort.signal });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !FILE_TYPES.test(type)) throw new ConvexError(`A world file could not be fetched (${res.status}).`);
        const blob = await res.blob();
        if (blob.size > MAX_BYTES) throw new ConvexError("A world file is too large to keep.");
        const storageId = await ctx.storage.store(blob);
        return await ctx.runMutation(internal.agentWorlds.addFile, { fileId: file.fileId, storageId });
      } finally {
        clearTimeout(timer);
      }
    };
    const urls = new Map(await Promise.all(files.map(async (file) => [file.url, await keep(file)] as const)));
    await ctx.runMutation(internal.agentWorlds.merge, { envId, assets: rewriteUrls(parsed.data, (url) => urls.get(url) ?? url) });
  },
});

/** The kept world's assets, with Convex URLs, or null if it was never kept. */
export const world = query({
  args: { envId: v.string() },
  handler: async (ctx, { envId }) => {
    const row = await ctx.db.query("agentWorlds").withIndex("by_env", (q) => q.eq("envId", envId)).unique();
    return row ? ManagedAssets.parse(row.assets) : null;
  },
});

/** A kept file's URL by its Anthropic file id (a managed: sound id carries it), or null. */
export const file = query({
  args: { fileId: v.string() },
  handler: async (ctx, { fileId }) => {
    const row = await findFile(ctx, fileId);
    return row ? await ctx.storage.getUrl(row.storageId) : null;
  },
});

/** Records a stored file; if another save stored the same file meanwhile, keeps theirs and drops this copy. */
export const addFile = internalMutation({
  args: { fileId: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { fileId, storageId }): Promise<string> => {
    const existing = await findFile(ctx, fileId);
    if (existing) await ctx.storage.delete(storageId);
    else await ctx.db.insert("agentFiles", { fileId, storageId });
    const url = await ctx.storage.getUrl(existing?.storageId ?? storageId);
    if (!url) throw new ConvexError("A kept world file has no URL.");
    return url;
  },
});

export const merge = internalMutation({
  args: { envId: v.string(), assets: v.any() },
  handler: async (ctx, { envId, assets }) => {
    const row = await ctx.db.query("agentWorlds").withIndex("by_env", (q) => q.eq("envId", envId)).unique();
    const merged = mergeWorld(row ? ManagedAssets.parse(row.assets) : undefined, ManagedAssets.parse(assets));
    if (row) await ctx.db.patch(row._id, { assets: merged, updatedAt: Date.now() });
    else await ctx.db.insert("agentWorlds", { envId, assets: merged, updatedAt: Date.now() });
  },
});
