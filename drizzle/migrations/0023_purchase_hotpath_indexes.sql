-- Indexy pro hot-path dotazy nad `purchase`. Doposud existovaly jen UNIQUE
-- indexy (stripePaymentId, variableSymbol, fio/creditas tx, proformaNumber)
-- a composite (kind, status); běžné lookupy přes email / userId / status
-- jely full table scanem. S růstem počtu objednávek to zdražuje KAŽDÝ
-- autentizovaný request (hasAccess) i webhook/cron.
--
-- Drizzle-kit generate je v tomto repu rozbité (kolize meta snapshotů),
-- migrace se proto píší ručně. `wrangler d1 migrations apply` čte jen .sql.
-- Všechny indexy jsou IF NOT EXISTS — bezpečné pro re-run i prostředí,
-- kde už byly vytvořeny ručně.

-- hasAccess(): WHERE status='active' AND expiresAt>now AND (userId=? OR email=?)
-- SQLite umí použít jen jeden index na tabulku v rámci OR větve, proto dva
-- složené indexy — jeden vedený userId, druhý email. Oba s prefixem
-- (status, expiresAt), aby pokryly i samostatné filtry na status/expiraci.
CREATE INDEX IF NOT EXISTS `idx_purchase_status_expires_user`
  ON `purchase` (`status`, `expiresAt`, `userId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_purchase_status_expires_email`
  ON `purchase` (`status`, `expiresAt`, `email`);--> statement-breakpoint

-- linkPurchasesToUser(): UPDATE ... WHERE email=? AND userId IS NULL
-- (běží na waitUntil při každé session). Plain email index obslouží i admin
-- vyhledávání podle e-mailu a párování webhooku na existující objednávku.
CREATE INDEX IF NOT EXISTS `idx_purchase_email`
  ON `purchase` (`email`);--> statement-breakpoint

-- handleSubscriptionDeleted / handleInvoicePaid: UPDATE ... WHERE stripeSubscriptionId=?
CREATE INDEX IF NOT EXISTS `idx_purchase_stripeSubscriptionId`
  ON `purchase` (`stripeSubscriptionId`)
  WHERE `stripeSubscriptionId` IS NOT NULL;--> statement-breakpoint

-- Cron scan nezaplacených převodů: WHERE paymentMethod IN ('fio','creditas') AND status='pending'
-- a dedup existující pending objednávky v startFioCheckout().
CREATE INDEX IF NOT EXISTS `idx_purchase_paymentMethod_status`
  ON `purchase` (`paymentMethod`, `status`);
