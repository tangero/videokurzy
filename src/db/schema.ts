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
  // 'paid'   = reálná platba spárovaná automaticky (Stripe / FIO / Creditas scan),
  // 'manual' = reálná platba potvrzená ručně adminem (převod, který se nenapároval),
  // 'comp'   = komplimentár (přístup zdarma od admina),
  // 'staff'  = audit přístupu administrátora (user.role='admin').
  // 'paid' i 'manual' jsou reálné peníze — obojí se započítává do revenue a fakturace.
  kind: text("kind", { enum: ["paid", "manual", "comp", "staff"] }).notNull().default("paid"),
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
  // Volitelný oddělený fakturační e-mail (plán 5.6, O5). Když chybí, fakturace
  // použije purchase.email. GDPR: anonymizuje se v account-deletion.ts.
  invoiceEmail: text("invoiceEmail"),
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

// Outbox fakturačních úloh (plán docs/fakturacni-system-revize.md v1.0.0, sekce 5.2).
// Jedna řádka = jedna Fakturoid faktura. Idempotence: UNIQUE(customId) = Fakturoid
// custom_id; UNIQUE(purchaseId) WHERE jobKind='initial_purchase' = max 1 vstupní
// faktura/purchase; UNIQUE(paymentSource, sourceEventId) = dedup platební události.
// 'done' = fakturoidInvoiceId && paymentRecordedAt && sentAt. Migrace 0031.
export const invoiceJob = sqliteTable("invoice_job", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // FK na purchase.id BEZ DB constraintu (jako discount_invite) — outbox musí přežít
  // anonymizaci/výmaz purchase a nesmí kaskádně mazat účetní záznam.
  purchaseId: integer("purchaseId").notNull(),
  jobKind: text("jobKind", { enum: ["initial_purchase", "stripe_renewal"] }).notNull(),
  // Idempotency klíč: 'vk-purchase-<id>' | 'vk-stripe-invoice-<stripeInvoiceId>'.
  customId: text("customId").notNull(),
  paymentSource: text("paymentSource", {
    enum: ["stripe_checkout", "stripe_renewal", "fio", "creditas", "manual", "backfill"],
  }).notNull(),
  // Dedup platební události (Stripe session/invoice id, bank tx id, manual-confirm-<id>).
  sourceEventId: text("sourceEventId"),
  // Skutečně přijatá částka, celé CZK (O6). Desetinná z banky → needs_manual_review.
  amount: integer("amount").notNull(),
  // paidAt = timestamp pro SLA/řazení; paidOn = účetní datum (YYYY-MM-DD, TZ Praha) na fakturu.
  paidAt: integer("paidAt", { mode: "timestamp" }).notNull(),
  paidOn: text("paidOn").notNull(),
  paidAtSource: text("paidAtSource", {
    enum: ["stripe_api", "bank_api", "manual_admin_input", "fakturoid_paid_on", "purchase_createdAt_fallback"],
  }).notNull(),
  paidAtConfidence: text("paidAtConfidence", { enum: ["exact", "estimated"] })
    .notNull()
    .default("exact"),
  // Billing snapshot k času platby (PII — GDPR account-deletion). invoiceEmail fallback na email.
  email: text("email").notNull(),
  invoiceEmail: text("invoiceEmail"),
  companyName: text("companyName"),
  companyIco: text("companyIco"),
  companyDic: text("companyDic"),
  companyAddress: text("companyAddress"),
  companyCity: text("companyCity"),
  companyZip: text("companyZip"),
  contactName: text("contactName"),
  state: text("state", {
    enum: ["pending", "processing", "done", "failed_retryable", "failed_permanent",
           "needs_manual_review", "needs_reconcile", "resolved_manually"],
  })
    .notNull()
    .default("pending"),
  attempts: integer("attempts").notNull().default(0),
  claimedAt: integer("claimedAt", { mode: "timestamp" }),
  lastAttemptAt: integer("lastAttemptAt", { mode: "timestamp" }),
  nextRetryAt: integer("nextRetryAt", { mode: "timestamp" }),
  // Sanitované přes sanitizeInvoiceError() — bez PII/tokenů, ≤2 KB. reason např. 'legacy_unsent'.
  lastErrorCode: text("lastErrorCode"),
  lastErrorStatus: integer("lastErrorStatus"),
  lastErrorMessage: text("lastErrorMessage"),
  // Krokové timestampy — idempotentní ensure* kroky (create / payment / send).
  fakturoidInvoiceId: integer("fakturoidInvoiceId"),
  fakturoidSubjectId: integer("fakturoidSubjectId"),
  issuedAt: integer("issuedAt", { mode: "timestamp" }),
  // paymentRecordedAt = čas lokálního potvrzení side-effectu, NE účetní datum (to je paidOn).
  paymentRecordedAt: integer("paymentRecordedAt", { mode: "timestamp" }),
  sentAt: integer("sentAt", { mode: "timestamp" }),
  aresWarning: integer("aresWarning", { mode: "boolean" }).notNull().default(false),
  // Ruční uzavření (resolved_manually) — povinná poznámka.
  resolvedManuallyBy: text("resolvedManuallyBy"),
  resolvedNote: text("resolvedNote"),
  resolvedAt: integer("resolvedAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
}, (table) => [
  // Idempotency vůči Fakturoidu — jeden custom_id = jedna faktura.
  uniqueIndex("invoice_job_custom_id_unique").on(table.customId),
  // Max 1 vstupní faktura na purchase; renewals přes jobKind='stripe_renewal'.
  uniqueIndex("invoice_job_initial_purchase_unique")
    .on(table.purchaseId)
    .where(sql`${table.jobKind} = 'initial_purchase'`),
  // Dedup platební události napříč producery.
  uniqueIndex("invoice_job_source_event_unique")
    .on(table.paymentSource, table.sourceEventId)
    .where(sql`${table.sourceEventId} IS NOT NULL`),
  // Reconcile cron: výběr ke zpracování dle nextRetryAt.
  index("invoice_job_retry_idx").on(table.state, table.nextRetryAt),
  // Detekce uvízlých processing jobů (CLAIM_TIMEOUT recovery).
  index("invoice_job_stale_idx").on(table.state, table.claimedAt),
  // Admin panel: výpis dle stavu a stáří.
  index("invoice_job_admin_idx").on(table.state, table.createdAt),
  // Všechny faktury jednoho purchase (renewals).
  index("invoice_job_purchase_idx").on(table.purchaseId),
]);

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

export const purchaseRelations = relations(purchase, ({ one, many }) => ({
  user: one(user, { fields: [purchase.userId], references: [user.id] }),
  invoiceJobs: many(invoiceJob),
}));

export const invoiceJobRelations = relations(invoiceJob, ({ one }) => ({
  purchase: one(purchase, { fields: [invoiceJob.purchaseId], references: [purchase.id] }),
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

// Detekované týdenní záznamy z code.claude.com/docs/en/whats-new (služba
// „Novinky v Claude Code"). Jedna řádka = jeden whats-new digest. Idempotence
// detekce stojí na UNIKÁTNÍM sourceId (= canonical_url): cron při každém běhu
// dělá anti-join proti této tabulce. contentHash zachytí změnu obsahu téhož
// týdne (re-edit existujícího digestu) — viz lib/cc-news/detect.ts.
//   status: draft (čeká redakční zpracování + schválení)
//         → approved (člověk klikl schvalovací link)
//         → published (zveřejněno v gated sekci „Novinky v CC").
// Žádné PII; obsah článku se ukládá jako markdown soubor, articlePath drží cestu.
export const ccNewsItem = sqliteTable("cc_news_item", {
  id: text("id").primaryKey(),
  // Kanonická URL detailu digestu, např. /docs/en/whats-new/2026-w24.
  // UNIQUE = idempotency key. guid/pubDate z RSS se na klíč NEPOUŽÍVAJÍ
  // (Week 24 a Week 23 mohou sdílet pubDate; guid se může změnit).
  sourceId: text("sourceId").notNull().unique(),
  // SHA-256 plného detailu .md; změna => stejný sourceId, nový obsah.
  contentHash: text("contentHash").notNull(),
  weekLabel: text("weekLabel"),        // „Week 24", lidský štítek z RSS
  versionRange: text("versionRange"),  // rozsah verzí z kategorie RSS
  status: text("status").notNull().default("draft"), // draft|approved|published
  articlePath: text("articlePath"),    // cesta k markdown souboru článku v repu
  approveNonce: text("approveNonce"),  // jednorázový nonce pro schvalovací link (W-005)
  // Když se re-edituje digest týdne, který je UŽ publikovaný: živá publikovaná
  // verze (publikovaný KV blob + status=published) zůstává beze změny, aby
  // čtenáři nezmizel obsah, a nový obsah čeká na lidské schválení. pendingContentHash
  // drží hash této čekající verze; po schválení se promotuje a vynuluje.
  pendingContentHash: text("pendingContentHash"),
  // Úvodník — markdown osobní komentář redaktora vkládaný POUZE do rozesílaného
  // newsletteru (ne na web /novinky-cc). Edituje se v adminu /admin/newsletter.
  editorialMarkdown: text("editorialMarkdown"),
  // Kdy byl naposledy odeslán schvalovací e-mail. Idempotence ručního triggeru
  // (neposlat omylem 2×) + zobrazení v adminu. Re-edit digestu (changed) ho
  // vynuluje, ať jde poslat e-mail k nové verzi.
  approvalEmailSentAt: integer("approvalEmailSentAt", { mode: "timestamp" }),
  // Kdy byl ROZESLÁN newsletter předplatitelům. Per-vydání zámek proti opakovanému
  // rozeslání (atomický UPDATE … WHERE newsletterSentAt IS NULL). Vědomé znovurozeslání
  // jen přes force.
  newsletterSentAt: integer("newsletterSentAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  publishedAt: integer("publishedAt", { mode: "timestamp" }),
});

// Odhlášení z newsletteru „Novinky v Claude Code" (GDPR, W-007). ZÁMĚRNĚ NEdrží
// plain e-mail: klíč je `emailHash` = HMAC-SHA256(normalizovaný e-mail, účel
// `claude_code_news`). Výběr příjemců spočítá stejný hash a udělá anti-join.
//   - Neukládat sem PII: suppression přežije i GDPR výmaz uživatele (proto
//     samostatná tabulka, ne sloupec na user/purchase — viz B-002).
//   - `createdFromUserId` je volitelná, BEZ FK (nesmí bránit výmazu uživatele).
export const newsletterSuppression = sqliteTable("newsletter_suppression", {
  emailHash: text("emailHash").primaryKey(),
  newsletter: text("newsletter").notNull().default("claude_code_news"),
  optedOutAt: integer("optedOutAt", { mode: "timestamp" }).notNull(),
  source: text("source"),                 // „unsubscribe-link" | „admin" | …
  createdFromUserId: text("createdFromUserId"), // nullable, bez FK
});

export { user, session, account, verification } from "./auth-schema";
