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
  // Generated sounds (convex/sounds.ts), stored once in file storage and shared by every browser.
  sounds: defineTable({
    kind: v.union(v.literal("bed"), v.literal("event")),
    query: v.string(),
    status: v.union(v.literal("generating"), v.literal("ready"), v.literal("failed")),
    storageId: v.optional(v.id("_storage")),
    updatedAt: v.number(),
  }).index("by_key", ["kind", "query"]),
});
