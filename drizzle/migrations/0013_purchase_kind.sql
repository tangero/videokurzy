-- Purchase kind: rozlišení placená objednávka / komplimentární / staff přístup.
--
-- Důvod: dosavadní hack `stripePaymentId LIKE 'admin_grant_%'` maskoval granty
-- jako Stripe platby, takže se započítávaly do total_revenue v partner-API.
-- Nový sloupec `kind` to řeší explicitně.
--
--   paid  — reálná platba (Stripe / FIO). Default pro všechny existující řádky.
--   comp  — komplimentární přístup (admin dal zdarma běžnému uživateli).
--   staff — historický audit přístupu administrátora (user.role='admin').
--           Tyto řádky se v admin/objednavky vůbec nezobrazují.

ALTER TABLE `purchase` ADD `kind` text DEFAULT 'paid' NOT NULL;
--> statement-breakpoint
ALTER TABLE `purchase` ADD `compReason` text;
--> statement-breakpoint
ALTER TABLE `purchase` ADD `grantedBy` text;
--> statement-breakpoint
CREATE INDEX `idx_purchase_kind_status` ON `purchase` (`kind`,`status`);
--> statement-breakpoint

-- Backfill: existující admin granty rozdělit podle role uživatele.
-- Administrátoři -> 'staff' (přístup z titulu role, ne reálná objednávka).
UPDATE `purchase`
SET `kind` = 'staff'
WHERE `stripePaymentId` LIKE 'admin_grant_%'
  AND `userId` IN (SELECT `id` FROM `user` WHERE `role` = 'admin');
--> statement-breakpoint

-- Zbylé admin granty -> 'comp' (komplimentáři).
UPDATE `purchase`
SET `kind` = 'comp'
WHERE `stripePaymentId` LIKE 'admin_grant_%'
  AND `kind` = 'paid';
