import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { Scene } from "../src/scene/scene.js";
import { mutation, query, type QueryCtx } from "./_generated/server.js";

async function requireUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Connect to saved rooms first.");
  return userId;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const rooms = await ctx.db.query("savedScenes")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .order("desc").take(100);
    return rooms.map(({ _id, name, updatedAt }) => ({ _id, name, updatedAt }));
  },
});

export const save = mutation({
  args: { name: v.string(), scene: v.any() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const name = args.name.trim();
    if (!name || name.length > 80) throw new ConvexError("Use a room name of 1–80 characters.");
    const parsed = Scene.safeParse(args.scene);
    if (!parsed.success) throw new ConvexError("This room is invalid and could not be saved.");
    const existing = await ctx.db.query("savedScenes")
      .withIndex("by_user_name", (q) => q.eq("userId", userId).eq("name", name)).unique();
    const values = { name, scene: parsed.data, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, values);
      return existing._id;
    }
    return ctx.db.insert("savedScenes", { userId, ...values });
  },
});

function validName(raw: string) {
  const name = raw.trim();
  if (!name || name.length > 80) throw new ConvexError("Use a room name of 1–80 characters.");
  return name;
}

// A place is auto-saved once and then patched in place as it is edited (Visited places sidebar).
export const create = mutation({
  args: { name: v.string(), scene: v.any() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const name = validName(args.name);
    const parsed = Scene.safeParse(args.scene);
    if (!parsed.success) throw new ConvexError("This room is invalid and could not be saved.");
    return ctx.db.insert("savedScenes", { userId, name, scene: parsed.data, updatedAt: Date.now() });
  },
});

export const update = mutation({
  args: { id: v.id("savedScenes"), name: v.string(), scene: v.any() },
  handler: async (ctx, { id, name: rawName, scene }) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db.get(id);
    if (!existing || existing.userId !== userId) throw new ConvexError("That saved room is unavailable.");
    const name = validName(rawName);
    const parsed = Scene.safeParse(scene);
    if (!parsed.success) throw new ConvexError("This room is invalid and could not be saved.");
    await ctx.db.patch(id, { name, scene: parsed.data, updatedAt: Date.now() });
    return id;
  },
});

export const load = query({
  args: { id: v.id("savedScenes") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const saved = await ctx.db.get(id);
    if (!saved || saved.userId !== userId) throw new ConvexError("That saved room is unavailable.");
    return { name: saved.name, scene: saved.scene };
  },
});
