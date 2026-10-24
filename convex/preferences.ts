import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { PreferenceInput } from "../src/ai/preferences.js";
import { mutation, query, type QueryCtx } from "./_generated/server.js";

async function requireUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Connect to your rooms before using memory.");
  return userId;
}

export const context = query({ args: {}, handler: async (ctx) => {
  const userId = await requireUser(ctx);
  const records = await ctx.db.query("preferences").withIndex("by_user_context", (q) => q.eq("userId", userId)).take(51);
  return { owner: userId, preferences: records.map(({ userId: _owner, ...item }) => item) };
} });

export const save = mutation({ args: { preference: v.any() }, handler: async (ctx, { preference }) => {
  const userId = await requireUser(ctx);
  const parsed = PreferenceInput.safeParse(preference);
  if (!parsed.success) throw new ConvexError("Choose a task and a valid room preference.");
  const values = { ...parsed.data, task: parsed.data.task.toLowerCase(), updatedAt: Date.now() };
  const existing = await ctx.db.query("preferences").withIndex("by_user_context",
    (q) => q.eq("userId", userId).eq("task", values.task).eq("timeBucket", values.timeBucket)).unique();
  if (existing) { await ctx.db.patch(existing._id, values); return existing._id; }
  const count = await ctx.db.query("preferences").withIndex("by_user_context", (q) => q.eq("userId", userId)).take(50);
  if (count.length >= 50) throw new ConvexError("Memory is full. Forget an old preference first.");
  return ctx.db.insert("preferences", { userId, ...values });
} });

export const remove = mutation({ args: { id: v.id("preferences") }, handler: async (ctx, { id }) => {
  const userId = await requireUser(ctx);
  const record = await ctx.db.get(id);
  if (!record || record.userId !== userId) throw new ConvexError("That preference is unavailable.");
  await ctx.db.delete(id);
} });
