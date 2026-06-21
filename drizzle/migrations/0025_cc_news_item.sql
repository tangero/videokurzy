-- Služba „Novinky v Claude Code": detekované týdenní whats-new digesty.
-- Idempotence detekce stojí na UNIQUE(sourceId = canonical_url); contentHash
-- zachytí změnu obsahu téhož týdne. Žádné PII. Viz src/lib/cc-news/detect.ts.
CREATE TABLE `cc_news_item` (
	`id` text PRIMARY KEY NOT NULL,
	`sourceId` text NOT NULL,
	`contentHash` text NOT NULL,
	`weekLabel` text,
	`versionRange` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`articlePath` text,
	`approveNonce` text,
	`createdAt` integer NOT NULL,
	`publishedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `cc_news_item_sourceId_unique` ON `cc_news_item` (`sourceId`);
