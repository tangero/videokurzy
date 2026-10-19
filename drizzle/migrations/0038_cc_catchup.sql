-- Dohánění mezi nástroji: pojem, který Claude Code měl dřív a jiný nástroj ho
-- později zavedl jako novou funkci. Kandidáti z pravidel, verdikt od modelu.
-- Aditivní: nová tabulka, starý kód ji nevidí.
CREATE TABLE `cc_catchup` (
  `id` text PRIMARY KEY NOT NULL,
  `tool` text NOT NULL,
  `term` text NOT NULL,
  `topic` text NOT NULL,
  `ccItemId` text NOT NULL,
  `ccAt` integer NOT NULL,
  `ccVersion` text NOT NULL,
  `ccType` text NOT NULL,
  `otherItemId` text NOT NULL,
  `otherAt` integer NOT NULL,
  `otherVersion` text NOT NULL,
  `verdict` text NOT NULL DEFAULT 'pending',
  `title` text,
  `reason` text,
  `checkedAt` integer,
  `promptVersion` text,
  `createdAt` integer NOT NULL
);
CREATE INDEX `cc_catchup_verdict_idx` ON `cc_catchup` (`verdict`, `tool`);
