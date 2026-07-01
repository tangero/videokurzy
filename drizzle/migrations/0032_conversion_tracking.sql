-- Konverzní měření do reklamních platforem (Meta CAPI, Google Offline/Data Manager, Sklik).
-- Viz KONVERZE-PLAN.md. Dvě části: (1) match/consent signály + čas platby na purchase,
-- (2) per-provider stavová tabulka conversion_log s lease-claimem (idempotence R3).

-- (1) purchase: čas reálné platby, marketingový souhlas a match signály z checkoutu.
-- conversionOccurredAt = čas PLATBY (ne objednávky): u převodů datum transakce, u Stripe
-- session.completed, u manuálu čas potvrzení. Posílá se jako conversion time do Google/Meta.
ALTER TABLE `purchase` ADD `conversionOccurredAt` integer;
--> statement-breakpoint
-- marketingConsent: konverze se reportuje jen při 1 (právní základ souhlas, ne plnění smlouvy).
ALTER TABLE `purchase` ADD `marketingConsent` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- fbc = serverový formát fb.1.<ms>.<fbclid> (NE raw fbclid); fbp jen z existující _fbp cookie.
ALTER TABLE `purchase` ADD `fbc` text;
--> statement-breakpoint
ALTER TABLE `purchase` ADD `fbp` text;
--> statement-breakpoint
-- Google click identifikátory (uloženy tak, jak přišly v URL).
ALTER TABLE `purchase` ADD `gclid` text;
--> statement-breakpoint
ALTER TABLE `purchase` ADD `gbraid` text;
--> statement-breakpoint
ALTER TABLE `purchase` ADD `wbraid` text;
--> statement-breakpoint
-- IP a User-Agent z requestu při checkoutu (Meta advanced matching). U Stripe z create-checkout
-- requestu, ne z hosted stránky.
ALTER TABLE `purchase` ADD `clientIp` text;
--> statement-breakpoint
ALTER TABLE `purchase` ADD `userAgent` text;
--> statement-breakpoint

-- (2) conversion_log: jeden řádek na (purchase, provider). Drží lease-claim proti souběhu
-- a historii pokusů. Re-run doposílá jen failed / expired-pending, 'sent' přeskočí.
CREATE TABLE `conversion_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchaseId` integer NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`claimToken` text,
	`claimedAt` integer,
	`leaseUntil` integer,
	`attemptCount` integer DEFAULT 0 NOT NULL,
	`lastError` text,
	`httpStatus` integer,
	`responseBody` text,
	`requestId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
-- Bez tohoto unikátu vznikají duplicitní řádky a není jasné, který stav je autoritativní.
CREATE UNIQUE INDEX `conversion_log_purchase_provider_unique` ON `conversion_log` (`purchaseId`,`provider`);
--> statement-breakpoint
-- Re-run hledá failed / expired-pending k doposlání.
CREATE INDEX `idx_conversion_log_status` ON `conversion_log` (`status`);
