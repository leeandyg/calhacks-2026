import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
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
