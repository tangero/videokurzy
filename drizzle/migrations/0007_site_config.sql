CREATE TABLE `site_config` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL
);--> statement-breakpoint
INSERT INTO `site_config` (`key`, `value`) VALUES
  ('price_individual', '2000'),
  ('price_organization', '15000'),
  ('benefits_individual', '["Přístup ke všem epizodám","Všechny budoucí kurzy v předplatném","Komentáře a Q&A s Patrickem","14 dní na vrácení, bez dotazů"]'),
  ('benefits_organization', '["Neomezený počet zaměstnanců","Přístup podle emailové domény","Faktura v CZK, standardní daňový doklad","Přehled využití pro L&D oddělení"]');
