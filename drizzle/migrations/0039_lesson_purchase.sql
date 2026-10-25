-- Prodej přístupu k jednomu videu (lekci) lidem bez předplatného.
-- Aditivní: nové sloupce lekce mají výchozí hodnoty, nová tabulka, starý kód je nevidí.
-- Nákup videa ZÁMĚRNĚ není v tabulce purchase: hasAccess() dává celou platformu
-- za jakýkoli aktivní řádek purchase a čte z ní i newsletter a připomínky obnovy.

-- NULL = video se samostatně neprodává.
ALTER TABLE `lesson` ADD COLUMN `priceCzk` integer;--> statement-breakpoint
ALTER TABLE `lesson` ADD COLUMN `accessDays` integer NOT NULL DEFAULT 120;--> statement-breakpoint

CREATE TABLE `lesson_purchase` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `lessonId` integer NOT NULL,
  `email` text NOT NULL,
  `userId` text,
  `variableSymbol` text NOT NULL,
  `stripePaymentId` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `amountPaid` integer NOT NULL DEFAULT 0,
  `expiresAt` integer NOT NULL,
  `createdAt` integer NOT NULL,
  `companyName` text,
  `companyIco` text,
  `companyDic` text,
  `companyAddress` text,
  `companyCity` text,
  `companyZip` text,
  `contactName` text,
  `invoiceEmail` text,
  `immediateAccessConsent` integer NOT NULL DEFAULT 0,
  `immediateAccessConsentAt` integer,
  `marketingConsent` integer NOT NULL DEFAULT 0,
  `conversionOccurredAt` integer,
  `fbc` text,
  `fbp` text,
  `gclid` text,
  `gbraid` text,
  `wbraid` text,
  `clientIp` text,
  `userAgent` text,
  `fakturoidInvoiceId` integer,
  `fakturoidSubjectId` integer,
  `expiryReminderSentAt` integer
);--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_purchase_vs_unique` ON `lesson_purchase` (`variableSymbol`);--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_purchase_stripe_unique` ON `lesson_purchase` (`stripePaymentId`);--> statement-breakpoint
CREATE INDEX `idx_lesson_purchase_email` ON `lesson_purchase` (`email`);--> statement-breakpoint
CREATE INDEX `idx_lesson_purchase_user` ON `lesson_purchase` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_lesson_purchase_status_expires` ON `lesson_purchase` (`status`, `expiresAt`);--> statement-breakpoint

-- Konverze nákupů videí mají vlastní řadu id (lesson_purchase.id), proto se
-- jedinečnost v logu rozlišuje i podle zdroje. Starý kód zapisuje source='purchase'
-- výchozí hodnotou a jeho ON CONFLICT dál funguje.
ALTER TABLE `conversion_log` ADD COLUMN `source` text NOT NULL DEFAULT 'purchase';--> statement-breakpoint
DROP INDEX IF EXISTS `conversion_log_purchase_provider_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `conversion_log_source_purchase_provider_unique` ON `conversion_log` (`source`, `purchaseId`, `provider`);
