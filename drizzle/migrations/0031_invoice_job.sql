-- Outbox tabulka fakturačních úloh (plán docs/fakturacni-system-revize.md v1.0.0,
-- sekce 5.2). Jedna řádka = jedna Fakturoid faktura. Idempotence stojí na:
--   UNIQUE(customId)                                = Fakturoid custom_id (jedna faktura)
--   UNIQUE(purchaseId) WHERE jobKind='initial_purchase'  = max 1 vstupní faktura/purchase
--   UNIQUE(paymentSource, sourceEventId)            = dedup platební události
-- Stavový automat: pending→processing→done | failed_retryable | failed_permanent
--   | needs_manual_review | needs_reconcile | resolved_manually.
--
-- purchaseId je FK na purchase.id BEZ DB constraintu (jako discount_invite) — outbox
-- musí přežít i anonymizaci/výmaz purchase a nesmí kaskádně mazat účetní záznam.
--
-- Drizzle-kit generate je v repu rozbité (kolize meta snapshotů) → psáno ručně.
-- `wrangler d1 migrations apply` čte jen .sql. IF NOT EXISTS kvůli bezpečnému re-runu.
CREATE TABLE IF NOT EXISTS `invoice_job` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchaseId` integer NOT NULL,
	`jobKind` text NOT NULL,
	`customId` text NOT NULL,
	`paymentSource` text NOT NULL,
	`sourceEventId` text,
	`amount` integer NOT NULL,
	`paidAt` integer NOT NULL,
	`paidOn` text NOT NULL,
	`paidAtSource` text NOT NULL,
	`paidAtConfidence` text DEFAULT 'exact' NOT NULL,
	`email` text NOT NULL,
	`invoiceEmail` text,
	`companyName` text,
	`companyIco` text,
	`companyDic` text,
	`companyAddress` text,
	`companyCity` text,
	`companyZip` text,
	`contactName` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`claimedAt` integer,
	`lastAttemptAt` integer,
	`nextRetryAt` integer,
	`lastErrorCode` text,
	`lastErrorStatus` integer,
	`lastErrorMessage` text,
	`fakturoidInvoiceId` integer,
	`fakturoidSubjectId` integer,
	`issuedAt` integer,
	`paymentRecordedAt` integer,
	`sentAt` integer,
	`aresWarning` integer DEFAULT 0 NOT NULL,
	`resolvedManuallyBy` text,
	`resolvedNote` text,
	`resolvedAt` integer,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
-- Idempotency vůči Fakturoidu — jeden custom_id = jedna faktura.
CREATE UNIQUE INDEX IF NOT EXISTS `invoice_job_custom_id_unique` ON `invoice_job` (`customId`);--> statement-breakpoint
-- Max 1 vstupní faktura na purchase; renewals jdou mimo přes jobKind='stripe_renewal'.
CREATE UNIQUE INDEX IF NOT EXISTS `invoice_job_initial_purchase_unique` ON `invoice_job` (`purchaseId`) WHERE `jobKind` = 'initial_purchase';--> statement-breakpoint
-- Dedup platební události napříč producery (Stripe session/invoice id, bank tx id).
CREATE UNIQUE INDEX IF NOT EXISTS `invoice_job_source_event_unique` ON `invoice_job` (`paymentSource`, `sourceEventId`) WHERE `sourceEventId` IS NOT NULL;--> statement-breakpoint
-- Reconcile cron: výběr ke zpracování dle nextRetryAt.
CREATE INDEX IF NOT EXISTS `invoice_job_retry_idx` ON `invoice_job` (`state`, `nextRetryAt`);--> statement-breakpoint
-- Detekce uvízlých processing jobů (CLAIM_TIMEOUT recovery).
CREATE INDEX IF NOT EXISTS `invoice_job_stale_idx` ON `invoice_job` (`state`, `claimedAt`);--> statement-breakpoint
-- Admin panel: výpis dle stavu a stáří.
CREATE INDEX IF NOT EXISTS `invoice_job_admin_idx` ON `invoice_job` (`state`, `createdAt`);--> statement-breakpoint
-- Všechny faktury jednoho purchase (renewals).
CREATE INDEX IF NOT EXISTS `invoice_job_purchase_idx` ON `invoice_job` (`purchaseId`);--> statement-breakpoint

-- Volitelný oddělený fakturační e-mail (plán 5.6, O5). Když chybí, fakturace
-- použije purchase.email. GDPR: account-deletion.ts musí anonymizovat i tento
-- sloupec (+ PII snapshot v invoice_job).
ALTER TABLE `purchase` ADD `invoiceEmail` text;
