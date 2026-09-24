import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// MVP deliberately does not persist anonymous browsing content. These tables are
// foundations for opt-in account-scoped features after authentication is selected.
export default defineSchema({
  searchHistory: defineTable({
    owner: v.string(),
    query: v.string(),
  }).index("by_owner", ["owner"]),
  browserHistory: defineTable({
    owner: v.string(),
    url: v.string(),
    title: v.optional(v.string()),
  }).index("by_owner", ["owner"]),
  bookmarks: defineTable({
    owner: v.string(),
    url: v.string(),
    title: v.string(),
  }).index("by_owner", ["owner"]),
  settings: defineTable({
    owner: v.string(),
    searchProvider: v.optional(v.string()),
  }).index("by_owner", ["owner"]),
});
