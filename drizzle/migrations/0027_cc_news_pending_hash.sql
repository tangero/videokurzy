-- Re-edit už publikovaného whats-new digestu nesmí depublikovat živý článek.
-- pendingContentHash drží hash čekající (re-editované) verze; živá publikovaná
-- verze zůstává viditelná, dokud člověk čekající verzi neschválí.
ALTER TABLE `cc_news_item` ADD `pendingContentHash` text;
