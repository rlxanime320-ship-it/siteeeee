import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const mediaAnalyses = sqliteTable("media_analyses", {
  id: text("id").primaryKey(), scope: text("scope").notNull(),
  provider: text("provider").notNull(), reference: text("reference").notNull(),
  formats: text("formats").notNull(), expiresAt: integer("expires_at").notNull(),
}, table => [index("idx_media_analyses_expiry").on(table.expiresAt)]);
export const mediaJobs = sqliteTable("media_jobs", {
  id: text("id").primaryKey(), scope: text("scope").notNull(),
  analysisId: text("analysis_id").notNull(), formatId: text("format_id").notNull(),
  provider: text("provider").notNull(), reference: text("reference").notNull(),
  state: text("state").notNull(), expiresAt: integer("expires_at").notNull(),
}, table => [index("idx_media_jobs_expiry").on(table.expiresAt)]);
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(), count: integer("count").notNull(), expiresAt: integer("expires_at").notNull(),
}, table => [index("idx_rate_limits_expiry").on(table.expiresAt)]);
