-- Kdy byl ROZESLÁN newsletter předplatitelům pro toto vydání. Per-vydání zámek
-- proti opakovanému rozeslání: atomický UPDATE … WHERE newsletterSentAt IS NULL
-- zaručí, že rozesílku spustí jen jeden běh. Re-edit digestu (changed) ho NEnuluje
-- — newsletter se rozesílá jednou za vydání; nové rozeslání je vědomé (force).
ALTER TABLE `cc_news_item` ADD `newsletterSentAt` integer;
