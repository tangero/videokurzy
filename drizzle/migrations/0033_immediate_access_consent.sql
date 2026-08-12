-- Výslovný souhlas se zpřístupněním digitálního obsahu před uplynutím 14denní lhůty
-- pro odstoupení od smlouvy (§ 1837 písm. l) obč. zák.). Bez tohoto souhlasu právo
-- spotřebitele na odstoupení podle § 1829 nezaniká ani po zhlédnutí obsahu.
--
-- Checkbox je v checkoutu POVINNÝ, takže nové objednávky mají vždy 1 + čas.
-- Existující řádky dostanou 0 / NULL záměrně: tyto objednávky souhlas nikdy
-- neudělily a nelze jim ho zpětně přiřadit. Slouží jako důkazní záznam — hodnoty
-- se po zápisu nepřepisují.
ALTER TABLE `purchase` ADD `immediateAccessConsent` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- Čas udělení souhlasu (unix timestamp). NULL u objednávek před touto migrací.
ALTER TABLE `purchase` ADD `immediateAccessConsentAt` integer;
