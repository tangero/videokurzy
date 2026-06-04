-- Napojení druhé banky (Creditas) pro příchozí převody.
-- paymentMethod je prostý text (enum jen na úrovni Drizzle), takže hodnota
-- 'creditas' žádnou změnu sloupce nevyžaduje. Přidáváme jen úložiště ID
-- spárované Creditas transakce a stejnou pojistku proti double-spend jako u FIO.
ALTER TABLE `purchase` ADD `creditasTransactionId` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `purchase_creditasTransactionId_unique` ON `purchase` (`creditasTransactionId`) WHERE `creditasTransactionId` IS NOT NULL;
