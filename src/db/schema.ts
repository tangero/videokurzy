import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { user } from "./auth-schema";

export const organization = sqliteTable("organization", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("publicId").notNull().unique(),
  domain: text("domain").notNull().unique(),
  stripeSubscriptionId: text("stripeSubscriptionId"),
  status: text("status", { enum: ["pending", "active", "expired"] })
    .notNull()
    .default("pending"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
});

export const course = sqliteTable("course", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull().default(""),
  published: integer("published", { mode: "boolean" }).notNull().default(false),
});

export const module = sqliteTable("module", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  courseId: integer("courseId")
    .notNull()
    .references(() => course.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  sortOrder: integer("sortOrder").notNull().default(0),
});

export const lesson = sqliteTable("lesson", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("moduleId")
    .notNull()
    .references(() => module.id, { onDelete: "cascade" }),
  publicId: text("publicId").notNull().unique(),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  bunnyVideoId: text("bunnyVideoId"),
  durationSeconds: integer("durationSeconds").notNull().default(0),
  isFree: integer("isFree", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sortOrder").notNull().default(0),
  chapters: text("chapters"),
  moments: text("moments"),
  bodyMarkdown: text("bodyMarkdown"),
  transcribeStatus: text("transcribeStatus", { enum: ["none", "pending", "done", "error"] })
    .notNull()
    .default("none"),
  transcribedAt: integer("transcribedAt", { mode: "timestamp" }),
  transcript: text("transcript"),
  transcribeError: text("transcribeError"),
});

export const progress = sqliteTable(
  "progress",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lessonId: integer("lessonId")
      .notNull()
      .references(() => lesson.id, { onDelete: "cascade" }),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    completedAt: integer("completedAt", { mode: "timestamp" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.lessonId] })]
);

export const purchase = sqliteTable("purchase", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  userId: text("userId"),
  type: text("type", { enum: ["individual", "organization"] }).notNull(),
  paymentMethod: text("paymentMethod", { enum: ["stripe", "fio"] })
    .notNull()
    .default("stripe"),
  variableSymbol: text("variableSymbol").unique(),
  fioTransactionId: text("fioTransactionId"),
  stripePaymentId: text("stripePaymentId").unique(),
  stripeSubscriptionId: text("stripeSubscriptionId"),
  status: text("status", { enum: ["pending", "active", "expired", "refunded"] })
    .notNull()
    .default("active"),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  discountPercent: integer("discountPercent").notNull().default(0),
  discountCode: text("discountCode"),
  fakturoidInvoiceId: integer("fakturoidInvoiceId"),
  fakturoidSubjectId: integer("fakturoidSubjectId"),
});

// ─── Relations ────────────────────────────────────────────────────

export const courseRelations = relations(course, ({ many }) => ({
  modules: many(module),
}));

export const moduleRelations = relations(module, ({ one, many }) => ({
  course: one(course, { fields: [module.courseId], references: [course.id] }),
  lessons: many(lesson),
}));

export const lessonRelations = relations(lesson, ({ one }) => ({
  module: one(module, { fields: [lesson.moduleId], references: [module.id] }),
}));

export const userRelations = relations(user, ({ many }) => ({
  progress: many(progress),
  purchases: many(purchase),
}));

export const progressRelations = relations(progress, ({ one }) => ({
  user: one(user, { fields: [progress.userId], references: [user.id] }),
  lesson: one(lesson, { fields: [progress.lessonId], references: [lesson.id] }),
}));

export const purchaseRelations = relations(purchase, ({ one }) => ({
  user: one(user, { fields: [purchase.userId], references: [user.id] }),
}));

export const siteConfig = sqliteTable("site_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export { user, session, account, verification } from "./auth-schema";
