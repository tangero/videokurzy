-- Kdy byl naposledy ODESLÁN schvalovací e-mail „Ke schválení: Novinky v Claude
-- Code" pro toto vydání. Slouží k idempotenci ručního triggeru (neposlat omylem
-- podruhé) a k zobrazení stavu v /admin/newsletter. Re-edit digestu (nový obsah)
-- ho vynuluje, aby šel poslat e-mail k nové verzi.
ALTER TABLE `cc_news_item` ADD `approvalEmailSentAt` integer;
