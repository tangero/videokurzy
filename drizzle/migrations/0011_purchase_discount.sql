ALTER TABLE `purchase` ADD `discountPercent` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `purchase` ADD `discountCode` text;
