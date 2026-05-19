-- Firemní fakturační údaje pro nákupy (B2B i B2C jako OSVČ).
-- Když uživatel zadá IČO, načteme z ARES a uložíme spolu s purchase row.
-- proformaNumber se generuje jen pro FIO objednávky (Stripe je instant pay).

ALTER TABLE `purchase` ADD `companyName` text;
--> statement-breakpoint
ALTER TABLE `purchase` ADD `companyIco` text;
--> statement-breakpoint
ALTER TABLE `purchase` ADD `companyDic` text;
--> statement-breakpoint
ALTER TABLE `purchase` ADD `companyAddress` text;
--> statement-breakpoint
ALTER TABLE `purchase` ADD `companyCity` text;
--> statement-breakpoint
ALTER TABLE `purchase` ADD `companyZip` text;
--> statement-breakpoint
ALTER TABLE `purchase` ADD `contactName` text;
--> statement-breakpoint
ALTER TABLE `purchase` ADD `proformaNumber` text;
--> statement-breakpoint
ALTER TABLE `purchase` ADD `proformaIssuedAt` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_proforma_number_unique` ON `purchase` (`proformaNumber`);
