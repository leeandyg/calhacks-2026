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
  // Claude agent worlds kept after their session (convex/agentWorlds.ts): one manifest per world (room.art)
  // with the art and chirp sounds' kept URLs, and each generated file stored once by its Anthropic file id.
  agentWorlds: defineTable({ envId: v.string(), assets: v.any(), updatedAt: v.number() }).index("by_env", ["envId"]),
  agentFiles: defineTable({ fileId: v.string(), storageId: v.id("_storage") }).index("by_file", ["fileId"]),
  // Generated sounds (convex/sounds.ts), stored once in file storage and shared by every browser.
  sounds: defineTable({
    kind: v.union(v.literal("bed"), v.literal("event")),
    query: v.string(),
    status: v.union(v.literal("generating"), v.literal("ready"), v.literal("failed")),
    storageId: v.optional(v.id("_storage")),
    updatedAt: v.number(),
  }).index("by_key", ["kind", "query"]),
});
