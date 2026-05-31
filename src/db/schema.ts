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
  // 'paid' = reálná platba, 'comp' = komplimentár (zdarma od admina),
  // 'staff' = audit přístupu administrátora (user.role='admin').
  // Pouze 'paid' se započítává do revenue a fakturace.
  kind: text("kind", { enum: ["paid", "comp", "staff"] }).notNull().default("paid"),
  compReason: text("compReason"),
  grantedBy: text("grantedBy"),
  // Skutečně přijatá částka v Kč. Stripe = amount_total / 100, FIO = tx.amount.
  // Granty (comp/staff) a pending = 0.
  // POZOR — duální sémantika u FIO: pending FIO objednávka zde drží OČEKÁVANOU
  // částku z doby objednání; teprve po napárování bankovní platby se přepíše na
  // REÁLNĚ zaplacenou částku. Pending amountPaid tedy NENÍ důkaz platby.
  amountPaid: integer("amountPaid").notNull().default(0),
  // Firemní fakturační údaje (nullable — uvádí jen B2B / OSVČ, kteří chtějí
  // fakturu na firmu). Při FIO objednávce se promítnou na zálohový doklad,
  // při kterékoli platbě (FIO i Stripe) na finální Fakturoid fakturu.
  companyName: text("companyName"),
  companyIco: text("companyIco"),
  companyDic: text("companyDic"),
  companyAddress: text("companyAddress"),
  companyCity: text("companyCity"),
  companyZip: text("companyZip"),
  contactName: text("contactName"),
  // ZD číslo se generuje jen pro FIO objednávky (Stripe je instant pay,
  // tam stačí finální faktura). Formát: ZD-YYYY-NNN, unikátní napříč rokem.
  proformaNumber: text("proformaNumber").unique(),
  proformaIssuedAt: integer("proformaIssuedAt", { mode: "timestamp" }),
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

// Snapshot agregovaných bunny.net statistik na video (jedna řádka/video,
// upsert při každém synci z cronu). Watch-time v sekundách. engagementScore 0–100.
export const videoStats = sqliteTable("video_stats", {
  videoGuid: text("videoGuid").primaryKey(),
  views: integer("views").notNull().default(0),
  watchTimeSeconds: integer("watchTimeSeconds").notNull().default(0),
  engagementScore: integer("engagementScore").notNull().default(0),
  syncedAt: integer("syncedAt", { mode: "timestamp" }).notNull(),
});

// Per-user sledování lekce — z maxSegment se počítá retenční křivka
// (pro segment s = count uživatelů s maxSegment >= s), watchedSeconds = reálně
// odsledovaný čas. SEGMENTS=20 (křivka po 5 % délky). Viz Track ② spec.
export const lessonWatch = sqliteTable(
  "lesson_watch",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lessonId: integer("lessonId")
      .notNull()
      .references(() => lesson.id, { onDelete: "cascade" }),
    maxSegment: integer("maxSegment").notNull().default(0),
    watchedSeconds: integer("watchedSeconds").notNull().default(0),
    startedAt: integer("startedAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.lessonId] })]
);

export { user, session, account, verification } from "./auth-schema";
