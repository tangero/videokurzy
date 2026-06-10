import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
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
  paymentMethod: text("paymentMethod", { enum: ["stripe", "fio", "creditas"] })
    .notNull()
    .default("stripe"),
  variableSymbol: text("variableSymbol").unique(),
  fioTransactionId: text("fioTransactionId"),
  // ID spárované Creditas transakce — obdoba fioTransactionId pro druhou banku.
  creditasTransactionId: text("creditasTransactionId"),
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
  // Nehádatelný token (nanoid) pro přístup k pay/proforma stránce — oprava
  // IDOR (VS šlo enumerovat). Nullable: staré objednávky token nemají.
  accessToken: text("accessToken"),
}, (table) => [
  // Partial unique index: zabraňuje dvojímu spárování stejné FIO transakce
  // (defense-in-depth proti double-spend, finding 28). NULL je povolen
  // vícekrát (pending / Stripe nákupy). Vynuceno migrací 0019.
  uniqueIndex("purchase_fioTransactionId_unique")
    .on(table.fioTransactionId)
    .where(sql`${table.fioTransactionId} IS NOT NULL`),
  // Stejná pojistka proti dvojímu spárování pro Creditas transakce.
  uniqueIndex("purchase_creditasTransactionId_unique")
    .on(table.creditasTransactionId)
    .where(sql`${table.creditasTransactionId} IS NOT NULL`),
  // Hot-path indexy (migrace 0023). hasAccess() filtruje status+expiresAt+(userId|email)
  // na každém autentizovaném requestu; dva složené indexy kvůli OR větvi.
  index("idx_purchase_status_expires_user").on(table.status, table.expiresAt, table.userId),
  index("idx_purchase_status_expires_email").on(table.status, table.expiresAt, table.email),
  // linkPurchasesToUser() (každá session), admin lookup, párování webhooku.
  index("idx_purchase_email").on(table.email),
  // handleSubscriptionDeleted / handleInvoicePaid.
  index("idx_purchase_stripeSubscriptionId")
    .on(table.stripeSubscriptionId)
    .where(sql`${table.stripeSubscriptionId} IS NOT NULL`),
  // Cron scan nezaplacených převodů + dedup pending objednávky.
  index("idx_purchase_paymentMethod_status").on(table.paymentMethod, table.status),
  // Lookup pay/proforma stránky přes nehádatelný token (oprava IDOR, migrace 0024).
  uniqueIndex("purchase_accessToken_unique")
    .on(table.accessToken)
    .where(sql`${table.accessToken} IS NOT NULL`),
]);

export const discountInvite = sqliteTable("discount_invite", {
  // Náhodný nanoid() token, nese se v URL jako ?invite=TOKEN.
  token: text("token").primaryKey(),
  // Komu byl vystaven — jen evidence, shoda e-mailu se při nákupu nevynucuje.
  email: text("email").notNull(),
  percent: integer("percent").notNull(),
  // Popisek do checkoutu, např. "Osobní sleva pro absolventy".
  label: text("label"),
  // NULL = bez expirace; jinak token platí jen do tohoto data.
  expiresAt: integer("expiresAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  // Označení dávky (např. "vibecoding-2026-06") pro reporting.
  batch: text("batch"),
  // NULL = nevyužitý; vyplní se při aktivaci zaplaceného nákupu.
  usedAt: integer("usedAt", { mode: "timestamp" }),
  // Který purchase token spotřeboval (FK na purchase.id, bez DB constraintu).
  usedByPurchaseId: integer("usedByPurchaseId"),
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
    lastPositionSeconds: integer("lastPositionSeconds").notNull().default(0),
    startedAt: integer("startedAt", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.lessonId] })]
);

export { user, session, account, verification } from "./auth-schema";
