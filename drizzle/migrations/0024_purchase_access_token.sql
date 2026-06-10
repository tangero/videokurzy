-- Nehádatelný token pro přístup k platební / proforma stránce (oprava IDOR).
-- Dosud byly /checkout/pay/:vs a /checkout/proforma/:vs klíčované jen 8místným
-- VS (33 + 6 číslic = ~900k hodnot), což šlo enumerovat a číst z nich PII
-- (e-mail, jméno, IČO, adresa). accessToken je nanoid (21 znaků), nehádatelný.
--
-- Nullable: staré objednávky token nemají a obsluhují se zpětně kompatibilní
-- VS routou (s rate-limitem). Nové FIO/Creditas objednávky token dostávají
-- při vzniku a odkazy v e-mailech míří na token routu.
ALTER TABLE `purchase` ADD `accessToken` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `purchase_accessToken_unique` ON `purchase` (`accessToken`) WHERE `accessToken` IS NOT NULL;
