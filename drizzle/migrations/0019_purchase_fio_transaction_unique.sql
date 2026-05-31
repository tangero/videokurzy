-- Partial UNIQUE index na purchase.fioTransactionId (defense-in-depth proti
-- double-spend, audit finding 28). NULL je povolen vícekrát (pending / Stripe
-- nákupy nemají FIO transakci); unikátní musí být jen non-null FIO transakce.
CREATE UNIQUE INDEX IF NOT EXISTS `purchase_fioTransactionId_unique` ON `purchase` (`fioTransactionId`) WHERE `fioTransactionId` IS NOT NULL;
