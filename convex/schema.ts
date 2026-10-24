import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  preferences: defineTable({
    userId: v.id("users"), task: v.string(), timeBucket: v.string(), timezone: v.string(),
    summary: v.string(), scene: v.any(), updatedAt: v.number(),
  }).index("by_user_context", ["userId", "task", "timeBucket"]),
  savedScenes: defineTable({
    userId: v.id("users"),
    name: v.string(),
    // The existing Zod Scene contract validates this in savedScenes.save.
    scene: v.any(),
    updatedAt: v.number(),
  })
    .index("by_user_name", ["userId", "name"])
    .index("by_user_updated", ["userId", "updatedAt"]),
});
