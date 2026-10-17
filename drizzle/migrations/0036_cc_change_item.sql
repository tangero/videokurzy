-- Položky changelogu Claude Code roztříděné do témat („Novinky v CC", fáze 2).
-- Zdroj: CHANGELOG.md + data vydání ze stránky changelogu v dokumentaci.
-- id = <verze>#<sha8(text)> (stabilní i při úpravě starých záznamů), ord = pořadí řádku.
-- topic/significance/reason doplní třídění (Haiku); followsId = položka, na kterou navazuje.
CREATE TABLE `cc_change_item` (
  `id` text PRIMARY KEY NOT NULL,
  `version` text NOT NULL,
  `publishedAt` integer NOT NULL,
  `ord` integer NOT NULL,
  `type` text NOT NULL,
  `scope` text,
  `text` text NOT NULL,
  `topic` text,
  `significance` integer,
  `reason` text,
  `followsId` text,
  `relation` text,
  `followReason` text,
  `classifiedAt` integer,
  `promptVersion` text
);
CREATE INDEX `cc_change_item_version_idx` ON `cc_change_item` (`version`);
CREATE INDEX `cc_change_item_topic_idx` ON `cc_change_item` (`topic`, `publishedAt`);
CREATE INDEX `cc_change_item_unclassified_idx` ON `cc_change_item` (`classifiedAt`);
