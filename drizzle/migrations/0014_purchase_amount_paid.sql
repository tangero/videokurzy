-- Skutečná zaplacená částka v Kč pro každou purchase.
--
-- Důvod: dosud se revenue počítalo dopočtem z aktuálního site_config × discount.
-- Po změně ceníku se historické součty přepočítávaly špatně. Nový sloupec
-- amountPaid drží reálně přijatou částku v Kč:
--   - Stripe webhook ukládá amount_total / 100
--   - FIO párovací cron ukládá částku z FIO transakce
--   - kind='comp'/'staff' a status='pending' = 0 (žádné přijaté peníze)
--
-- Backfill: historicky všichni paid uživatelé platili 1500 Kč
-- (individual po 50 % slevě). Granty zůstávají na 0.

ALTER TABLE `purchase` ADD `amountPaid` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

UPDATE `purchase` SET `amountPaid` = 1500 WHERE `kind` = 'paid';
