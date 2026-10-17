-- Více sledovaných nástrojů v jedné tabulce položek changelogu (Claude Code, Grok Build…).
-- Aditivní: stávající řádky jsou Claude Code, starý kód sloupec nevidí.
ALTER TABLE `cc_change_item` ADD `tool` text NOT NULL DEFAULT 'claude-code';
CREATE INDEX `cc_change_item_tool_date_idx` ON `cc_change_item` (`tool`, `publishedAt`);
