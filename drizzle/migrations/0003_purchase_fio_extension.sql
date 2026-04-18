-- Rozšíření purchase tabulky o FIO-specifické sloupce.
-- SQLite neumí měnit NOT NULL → nullable, musíme tabulku znovu vytvořit.

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_purchase` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`userId` text,
	`type` text NOT NULL,
	`paymentMethod` text DEFAULT 'stripe' NOT NULL,
	`variableSymbol` text,
	`fioTransactionId` text,
	`stripePaymentId` text,
	`stripeSubscriptionId` text,
	`status` text DEFAULT 'active' NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_purchase`(`id`, `email`, `userId`, `type`, `paymentMethod`, `variableSymbol`, `fioTransactionId`, `stripePaymentId`, `stripeSubscriptionId`, `status`, `expiresAt`, `createdAt`)
SELECT `id`, `email`, `userId`, `type`, 'stripe' AS `paymentMethod`, NULL AS `variableSymbol`, NULL AS `fioTransactionId`, `stripePaymentId`, `stripeSubscriptionId`, `status`, `expiresAt`, `createdAt` FROM `purchase`;
--> statement-breakpoint
DROP TABLE `purchase`;--> statement-breakpoint
ALTER TABLE `__new_purchase` RENAME TO `purchase`;--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_variableSymbol_unique` ON `purchase` (`variableSymbol`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_stripePaymentId_unique` ON `purchase` (`stripePaymentId`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
